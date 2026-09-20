import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createCloudSyncGate,
  fetchAllDeltaPages,
  monotonicRevision,
  requestJsonWithTimeout,
  validateSparseCloudHistory,
} from "../v2/assets/cloud_delta.js";
import { accountContextMatches, accountRevisionMatches, canActivateCloudAccount, resolveAccountBound } from "../v2/assets/cloud_account_context.js";

test("cloud delta loading consumes every page before exposing the applied revision", async () => {
  const calls = [];
  const pages = new Map([
    ["0", { currentRevision: 3, transactions: [{ revision: 1 }, { revision: 2 }] }],
    ["2", { currentRevision: 3, transactions: [{ revision: 3 }] }],
  ]);
  const result = await fetchAllDeltaPages(async (after) => {
    calls.push(String(after));
    return pages.get(String(after));
  }, { startRevision: 0, limit: 2 });
  assert.deepEqual(calls, ["0", "2"]);
  assert.deepEqual(result.transactions.map((item) => item.revision), [1, 2, 3]);
  assert.equal(result.revision, 3);
});

test("legacy sparse cloud revisions paginate completely and adopt the remote high-water mark", async () => {
  const calls = [];
  const pages = new Map([
    ["0", { currentRevision: 7, transactions: [{ revision: 2 }, { revision: 4 }] }],
    ["4", { currentRevision: 7, transactions: [{ revision: 6 }] }],
    ["6", { currentRevision: 7, transactions: [] }],
  ]);
  const history = await fetchAllDeltaPages(async (after) => {
    calls.push(String(after));
    return pages.get(String(after));
  }, { startRevision: 0, limit: 2 });
  assert.deepEqual(calls, ["0", "4", "6"]);
  assert.deepEqual(history.transactions.map((item) => item.revision), [2, 4, 6]);
  assert.equal(history.revision, 6);
  assert.deepEqual(validateSparseCloudHistory(history), {
    highWaterRevision: 7,
    lastTransactionRevision: 6,
  });
});

test("delta streaming freezes the first remote head and does not retain payloads", async () => {
  const calls = [];
  const visited = [];
  const pages = new Map([
    ["0", { currentRevision: 3, transactions: [{ revision: 1, large: "one" }] }],
    ["1", { currentRevision: 4, transactions: [{ revision: 2, large: "two" }] }],
    ["2", { currentRevision: 4, transactions: [{ revision: 3, large: "three" }] }],
  ]);
  const result = await fetchAllDeltaPages(async (after) => {
    calls.push(String(after));
    return pages.get(String(after));
  }, {
    startRevision: 0,
    limit: 1,
    retainTransactions: false,
    visitTransaction: async (transaction, progress) => {
      visited.push([transaction.revision, progress.remoteRevision]);
    },
  });
  assert.deepEqual(calls, ["0", "1", "2"]);
  assert.deepEqual(visited, [[1, 3], [2, 3], [3, 3]]);
  assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.transactionRevisions, [1, 2, 3]);
  assert.equal(result.transactionCount, 3);
  assert.equal(result.remoteRevision, 3);
});

test("cloud requests time out while waiting for headers or the response body", async () => {
  for (const fetchImpl of [
    () => new Promise(() => {}),
    async () => ({ ok: true, json: () => new Promise(() => {}) }),
  ]) {
    await assert.rejects(requestJsonWithTimeout(fetchImpl, "https://example.invalid", {}, {
      timeoutMs: 5,
      timeoutMessage: "Cloud review download timed out.",
    }), /timed out/);
  }
});

test("cancelling a cloud request rejects promptly even when fetch ignores abort", async () => {
  const controller = new AbortController();
  const pending = requestJsonWithTimeout(() => new Promise(() => {}), "https://example.invalid", {
    signal: controller.signal,
  }, { timeoutMs: 5_000 });
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
});

test("sparse cloud history rejects unsafe ordering, invalid rows, and pagination truncation", async () => {
  for (const transactions of [
    [{ revision: 2 }, { revision: 2 }],
    [{ revision: 3 }, { revision: 2 }],
    [{ revision: 0 }],
    [{ revision: 1.5 }],
    [{ revision: Number.MAX_SAFE_INTEGER + 1 }],
    [{ revision: 8 }],
  ]) {
    assert.throws(() => validateSparseCloudHistory({
      transactions,
      revision: Number(transactions.at(-1)?.revision || 0),
      remoteRevision: 7,
    }), /Cloud review history/);
  }
  assert.throws(() => validateSparseCloudHistory({
    transactions: [{ revision: 2 }, { revision: 4 }],
    revision: 2,
    remoteRevision: 7,
  }), /pagination is incomplete/);
  await assert.rejects(fetchAllDeltaPages(async () => ({
    currentRevision: 9,
    transactions: [{ revision: 2 }],
  }), { startRevision: 0, limit: 1, maxPages: 1 }), /pagination exceeded/);
  for (const revision of [Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1, 10]) {
    await assert.rejects(fetchAllDeltaPages(async () => ({
      currentRevision: 9,
      transactions: [{ revision }],
    }), { startRevision: 0, limit: 1 }), /non-advancing transaction page/);
  }
});

test("duplicate acknowledgements cannot move the cloud cursor backward", () => {
  assert.equal(monotonicRevision(5, 2), 5);
  assert.equal(monotonicRevision(5, 8), 8);
});

test("review recovery waits for the complete running sync or autosave and rejects overlap", async () => {
  const gate = createCloudSyncGate();
  let releaseSync;
  const runningSync = gate.run(() => new Promise((resolve) => { releaseSync = resolve; }));
  await Promise.resolve();
  let recoveryReady = false;
  const recoveryBarrier = gate.block().then(() => { recoveryReady = true; });
  const overlapping = await gate.run(() => "must-not-run", () => "recovery-in-progress");
  assert.equal(overlapping, "recovery-in-progress");
  assert.equal(recoveryReady, false);
  releaseSync("sync-complete");
  assert.equal(await runningSync, "sync-complete");
  await recoveryBarrier;
  assert.equal(recoveryReady, true);
  gate.unblock();
  assert.equal(await gate.run(() => "catch-up"), "catch-up");
});

test("captured sync work is rejected after an account generation changes", () => {
  const captured = { generation: 1, profileId: "profile-a", userSecretId: "secret-a" };
  assert.equal(accountContextMatches(captured, captured), true);
  assert.equal(accountContextMatches({ ...captured, generation: 2 }, captured), false);
  assert.equal(accountContextMatches({ ...captured, profileId: "profile-b" }, captured), false);
});

test("an autosave cannot append an old checkpoint at a newer revision", () => {
  const context = { startRevision: 7 };
  assert.equal(accountRevisionMatches(7, context), true);
  assert.equal(accountRevisionMatches(8, context), false);
});

test("delayed account work is discarded when the account changes while awaiting it", async () => {
  let finish;
  let active = { generation: 1, profileId: "profile-a", userSecretId: "secret-a" };
  const captured = { ...active };
  const pending = new Promise((resolve) => { finish = resolve; });
  const guarded = resolveAccountBound(pending, captured, () => active);
  active = { generation: 2, profileId: "profile-b", userSecretId: "secret-b" };
  finish({ kind: "storage-checkpoint", storage: { ledger: "must-not-apply" } });
  assert.deepEqual(await guarded, { stale: true, value: null });
});

test("review-only deltas cannot activate an account without a collection projection", () => {
  assert.equal(canActivateCloudAccount({ checkpointApplied: false, hasCachedProjection: false }), false);
  assert.equal(canActivateCloudAccount({ checkpointApplied: true, hasCachedProjection: false }), true);
  assert.equal(canActivateCloudAccount({ checkpointApplied: false, hasCachedProjection: true }), true);
});

test("explicit review loading replays from revision zero and permits a review-only account", () => {
  const source = readFileSync(new URL("../v2/assets/cloud_sync.js", import.meta.url), "utf8");
  assert.match(source, /recoverCloudReviewHistory[\s\S]*startRevision: 0/);
  assert.match(source, /limit: 1,[\s\S]*retainTransactions: false/);
  assert.doesNotMatch(source, /const payloads = \[\]/);
  assert.match(source, /if \(recoverReviews\) \{[\s\S]*applyAccountProjection\(storage, previousProjection, catalog\)/);
  assert.match(source, /recovery\.hasReviewCommit[\s\S]*Cloud reviews loaded/);
  assert.match(source, /client\.setLastRevision\(recovery\.revision\)/);
  assert.match(source, /cachedProjection && !recoverReviews/);
  assert.match(source, /validateSparseCloudHistory\(history, \{ startRevision \}\)/);
});
