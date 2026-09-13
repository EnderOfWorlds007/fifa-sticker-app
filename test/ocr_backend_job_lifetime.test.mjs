import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadOcrBackend() {
  globalThis.window = {
    PANINI_CONFIG: { recognitionBaseUrl: "https://scanner.test" },
    location: { href: "https://app.test/scanner/", protocol: "https:" },
  };
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  globalThis.document = { cookie: "" };
  const source = await readFile(new URL("../v2/assets/ocr_backend.js", import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`);
}

function jsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] || headers[name.toLowerCase()] || null },
    json: async () => payload,
  };
}

async function waitUntil(predicate, message = "condition") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

test("lost PUT acknowledgement reconciles the accepted job without re-uploading", async () => {
  const { createPhotoCodeJob } = await loadOcrBackend();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new TypeError("connection dropped");
    return jsonResponse(200, { job_id: "a".repeat(32), status: "running" });
  };

  const file = { type: "image/jpeg" };
  const job = await createPhotoCodeJob(file, {
    jobId: "a".repeat(32),
    retryBaseMs: 0,
  });

  assert.equal(job.status, "running");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[0].options.body, file);
  assert.equal(calls[1].options.method, undefined);
  assert.equal(calls[0].url, calls[1].url);
});

test("syntactically truncated PUT response reconciles instead of failing the accepted job", async () => {
  const { createPhotoCodeJob } = await loadOcrBackend();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        `{"job_id":"${"0".repeat(32)}","status":"queued"`,
        { status: 202, headers: { "content-type": "application/json" } },
      );
    }
    return jsonResponse(200, { job_id: "0".repeat(32), status: "running" });
  };

  const job = await createPhotoCodeJob({ type: "image/jpeg" }, {
    jobId: "0".repeat(32),
    retryBaseMs: 0,
  });
  assert.equal(job.status, "running");
  assert.equal(calls, 2);
});

test("cancellation aborts an in-flight initial PUT without another request", async () => {
  const { createPhotoCodeJob } = await loadOcrBackend();
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  };

  const pending = createPhotoCodeJob({ type: "image/jpeg" }, {
    jobId: "1".repeat(32),
    signal: controller.signal,
    retryBaseMs: 0,
  });
  await waitUntil(() => calls === 1, "initial PUT");
  controller.abort();

  await assert.rejects(pending, (error) => error.kind === "cancelled");
  assert.equal(calls, 1);
});

test("cancellation aborts an in-flight reconciliation GET without re-uploading", async () => {
  const { createPhotoCodeJob } = await loadOcrBackend();
  const controller = new AbortController();
  const calls = [];
  globalThis.fetch = async (_url, options = {}) => {
    calls.push(options.method || "GET");
    if (calls.length === 1) throw new TypeError("lost acknowledgement");
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  };

  const pending = createPhotoCodeJob({ type: "image/jpeg" }, {
    jobId: "2".repeat(32),
    signal: controller.signal,
    retryBaseMs: 0,
  });
  await waitUntil(() => calls.length === 2, "reconciliation GET");
  controller.abort();

  await assert.rejects(pending, (error) => error.kind === "cancelled");
  assert.deepEqual(calls, ["PUT", "GET"]);
});

test("unaccepted PUT retries the same client job id and body after reconciliation 404", async () => {
  const { createPhotoCodeJob } = await loadOcrBackend();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new TypeError("connection dropped");
    if (calls.length === 2) return jsonResponse(404, { error: "not_found" });
    return jsonResponse(202, { job_id: "b".repeat(32), status: "queued" });
  };

  const file = { type: "image/jpeg" };
  const job = await createPhotoCodeJob(file, {
    jobId: "b".repeat(32),
    retryBaseMs: 0,
  });
  assert.equal(job.status, "queued");
  assert.deepEqual(calls.map((call) => call.options.method || "GET"), ["PUT", "GET", "PUT"]);
  assert.equal(calls[0].url, calls[2].url);
  assert.equal(calls[0].options.body, calls[2].options.body);
});

test("polling survives network rejection, transient response, and body interruption", async () => {
  const { waitForPhotoCodeJob } = await loadOcrBackend();
  const statuses = [];
  let polls = 0;
  globalThis.fetch = async () => {
    polls += 1;
    if (polls === 1) throw new TypeError("offline");
    if (polls === 2) return jsonResponse(503, { error: "busy" });
    if (polls === 3) {
      return {
        ...jsonResponse(200, null),
        json: async () => { throw new TypeError("body stream ended"); },
      };
    }
    return jsonResponse(200, {
      job_id: "retry-job",
      status: "done",
      result: { codes: ["ENG5"] },
    });
  };

  const result = await waitForPhotoCodeJob("retry-job", {
    pollIntervalMs: 0,
    retryBaseMs: 0,
    onStatus: (message) => statuses.push(message),
  });
  assert.equal(polls, 4);
  assert.deepEqual(result.result.codes, ["ENG5"]);
  assert.equal(statuses.filter((message) => message.startsWith("Connection interrupted")).length, 3);
});

test("malformed JSON remains a terminal protocol error", async () => {
  const { waitForPhotoCodeJob } = await loadOcrBackend();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ...jsonResponse(200, null),
      json: async () => { throw new SyntaxError("bad json"); },
    };
  };

  await assert.rejects(
    waitForPhotoCodeJob("json-job", { retryBaseMs: 0 }),
    (error) => error.kind === "protocol" && /invalid JSON/.test(error.message),
  );
  assert.equal(calls, 1);
});

test("submission authentication failure and job conflict are terminal", async () => {
  const { createPhotoCodeJob } = await loadOcrBackend();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse(401, { error: "unauthorized" })
      : jsonResponse(409, { error: "job_id_conflict" });
  };

  await assert.rejects(
    createPhotoCodeJob({ type: "image/jpeg" }, {
      jobId: "c".repeat(32),
      retryBaseMs: 0,
    }),
    (error) => error.kind === "auth" && error.status === 401,
  );
  await assert.rejects(
    createPhotoCodeJob({ type: "image/jpeg" }, {
      jobId: "d".repeat(32),
      retryBaseMs: 0,
    }),
    (error) => error.status === 409 && error.code === "job_id_conflict",
  );
  assert.equal(calls, 2);
});

test("cancellation interrupts retry backoff", async () => {
  const { waitForPhotoCodeJob } = await loadOcrBackend();
  const controller = new AbortController();
  globalThis.fetch = async () => jsonResponse(503, { error: "busy" }, { "Retry-After": "60" });
  setTimeout(() => controller.abort(), 0);

  await assert.rejects(
    waitForPhotoCodeJob("backoff-job", { signal: controller.signal }),
    (error) => error.kind === "cancelled",
  );
});

test("photo jobs keep polling beyond the former 90-second client cutoff", async () => {
  const { waitForPhotoCodeJob } = await loadOcrBackend();
  let polls = 0;
  const statuses = [];
  globalThis.fetch = async () => {
    polls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => polls > 95
        ? { job_id: "slow-job", status: "done", result: { codes: ["ESP4"] } }
        : { job_id: "slow-job", status: polls === 1 ? "queued" : "running" },
    };
  };

  const payload = await waitForPhotoCodeJob("slow-job", {
    pollIntervalMs: 0,
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(polls, 96);
  assert.deepEqual(payload.result.codes, ["ESP4"]);
  assert.equal(statuses[0], "Waiting for recognizer...");
  assert.equal(statuses.at(-1), "Recognizing photo...");
});

test("photo jobs surface backend failures", async () => {
  const { waitForPhotoCodeJob } = await loadOcrBackend();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ job_id: "failed-job", status: "error", error: "Recognizer exited." }),
  });

  await assert.rejects(
    waitForPhotoCodeJob("failed-job", { pollIntervalMs: 0 }),
    /Recognizer exited/,
  );
});

test("photo jobs fail closed on unknown backend states", async () => {
  const { waitForPhotoCodeJob } = await loadOcrBackend();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ job_id: "unknown-job", status: "paused" }),
  });

  await assert.rejects(
    waitForPhotoCodeJob("unknown-job", { pollIntervalMs: 0 }),
    /unknown job status/,
  );
});
