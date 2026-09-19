import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllDeltaPages, monotonicRevision } from "../v2/assets/cloud_delta.js";
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

test("duplicate acknowledgements cannot move the cloud cursor backward", () => {
  assert.equal(monotonicRevision(5, 2), 5);
  assert.equal(monotonicRevision(5, 8), 8);
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
