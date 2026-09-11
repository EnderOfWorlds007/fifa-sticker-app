import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClientErrorReport,
  diagnosticReference,
  flushClientErrorReports,
  OcrClientError,
  recordClientError,
  requestIdFrom,
} from "../v2/assets/client_error_reports.js";

const IDS = {
  clientEventId: "evt_0123456789abcdef0123456789abcdef",
  pageSessionId: "ses_0123456789abcdef0123456789abcdef",
  operationId: "op_0123456789abcdef0123456789abcdef",
  requestId: "req_abcdef0123456789abcdef0123456789",
};

function environment() {
  return {
    clientEventId: IDS.clientEventId,
    occurredAt: "2026-09-11T17:30:00.000Z",
    appBuildId: "build-758205c86f15",
    pageSessionId: IDS.pageSessionId,
    navigatorRef: { onLine: false },
  };
}

test("client report contains only the fixed schema and never serializes causes or secrets", () => {
  const cause = new Error("token=secret https://example.invalid/?ocrToken=secret");
  cause.stack = "private stack";
  const error = new OcrClientError("Local safe message", {
    code: "NETWORK_UNREACHABLE",
    operation: "photo_job_create",
    phase: "request",
    retryable: true,
    cause,
  });

  const report = buildClientErrorReport(
    error,
    { operationId: IDS.operationId },
    environment(),
  );
  const encoded = JSON.stringify(report);

  assert.deepEqual(Object.keys(report), [
    "schema_version",
    "client_event_id",
    "occurred_at",
    "app_build_id",
    "page_session_id",
    "operation_id",
    "operation",
    "phase",
    "error_code",
    "retryable",
    "http_status",
    "related_request_id",
    "job_id",
    "upload_id",
    "attempt",
    "connectivity",
  ]);
  assert.equal(report.connectivity, "offline");
  assert.doesNotMatch(encoded, /secret|example\.invalid|private stack|Local safe message/);
});

test("diagnostic reference prefers backend error then response request then client event", () => {
  assert.equal(
    diagnosticReference(
      { diagnosticId: "err_11111111111111111111111111111111", requestId: IDS.requestId },
      { client_event_id: IDS.clientEventId },
    ),
    "err_1111111111",
  );
  assert.equal(
    diagnosticReference({ requestId: IDS.requestId }, { client_event_id: IDS.clientEventId }),
    "req_0123456789",
  );
  assert.equal(diagnosticReference({}, { client_event_id: IDS.clientEventId }), "evt_6789abcdef");
  assert.equal(diagnosticReference({}, null), null);
});

test("request id is accepted only from the correlation response header", () => {
  assert.equal(
    requestIdFrom({ headers: { get: () => IDS.requestId } }),
    IDS.requestId,
  );
  assert.equal(requestIdFrom({ headers: { get: () => "https://host/?token=secret" } }), null);
});

test("offline reports persist and are removed only after authenticated acknowledgement", async () => {
  const indexedDBRef = fakeIndexedDB();
  const error = new OcrClientError("Could not reach backend", {
    code: "NETWORK_UNREACHABLE",
    operation: "photo_job_create",
    phase: "request",
    retryable: true,
  });
  const context = { operationId: IDS.operationId };
  const baseTransport = {
    reportUrl: "https://backend.invalid/api/client-error-reports",
    token: "secret-token",
    indexedDBRef,
    environment: environment(),
    scheduleFlush: () => {},
  };

  const recorded = await recordClientError(error, context, {
    ...baseTransport,
    fetchFn: async () => { throw new Error("offline"); },
  });
  assert.equal(recorded.queued, true);
  assert.equal(recorded.delivered, false);
  assert.equal(indexedDBRef.values.size, 1);

  await flushClientErrorReports({
    ...baseTransport,
    fetchFn: async (_url, options) => {
      const submitted = JSON.parse(options.body);
      assert.equal(submitted.client_event_id, IDS.clientEventId);
      assert.equal(options.headers.Authorization, "Bearer secret-token");
      return { ok: false, status: 401 };
    },
  });
  assert.equal(indexedDBRef.values.size, 1);

  await flushClientErrorReports({
    ...baseTransport,
    fetchFn: async () => ({ ok: true, status: 201 }),
  });
  assert.equal(indexedDBRef.values.size, 0);
});

test("recording persists immediately without waiting for report delivery", async () => {
  const indexedDBRef = fakeIndexedDB();
  let scheduled;
  let fetchCalls = 0;
  const recorded = await recordClientError(
    new OcrClientError("Backend stalled", {
      code: "NETWORK_UNREACHABLE",
      operation: "photo_job_create",
      phase: "request",
      retryable: true,
    }),
    { operationId: IDS.operationId },
    {
      reportUrl: "https://backend.invalid/api/client-error-reports",
      token: "secret-token",
      indexedDBRef,
      environment: environment(),
      scheduleFlush: (callback) => { scheduled = callback; },
      fetchFn: async () => {
        fetchCalls += 1;
        return new Promise(() => {});
      },
    },
  );

  assert.equal(recorded.queued, true);
  assert.equal(fetchCalls, 0);
  assert.equal(typeof scheduled, "function");
});

test("permanent rejection is dead-lettered without blocking later reports", async () => {
  const indexedDBRef = fakeIndexedDB();
  const first = buildClientErrorReport(
    new OcrClientError("First", {
      code: "MALFORMED_RESPONSE",
      operation: "photo_job_create",
      phase: "decode",
    }),
    { operationId: IDS.operationId },
    environment(),
  );
  const second = {
    ...first,
    client_event_id: "evt_11111111111111111111111111111111",
  };
  indexedDBRef.values.set(first.client_event_id, first);
  indexedDBRef.values.set(second.client_event_id, second);
  let calls = 0;

  await flushClientErrorReports({
    reportUrl: "https://backend.invalid/api/client-error-reports",
    token: "secret-token",
    indexedDBRef,
    fetchFn: async () => {
      calls += 1;
      return calls === 1 ? { ok: false, status: 400 } : { ok: true, status: 201 };
    },
  });

  assert.equal(calls, 2);
  assert.equal(indexedDBRef.values.size, 0);
  assert.equal(indexedDBRef.deadLetters.size, 1);
  assert.equal(indexedDBRef.deadLetters.get(first.client_event_id).rejection_status, 400);
});

test("report delivery aborts promptly and retains the queued report", async () => {
  const indexedDBRef = fakeIndexedDB();
  const report = buildClientErrorReport(
    new OcrClientError("Timeout", {
      code: "REQUEST_TIMEOUT",
      operation: "photo_job_wait",
      phase: "timeout",
      retryable: true,
    }),
    { operationId: IDS.operationId },
    environment(),
  );
  indexedDBRef.values.set(report.client_event_id, report);

  await flushClientErrorReports({
    reportUrl: "https://backend.invalid/api/client-error-reports",
    token: "secret-token",
    indexedDBRef,
    reportTimeoutMs: 1,
    fetchFn: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  });

  assert.equal(indexedDBRef.values.size, 1);
});

function fakeIndexedDB() {
  const stores = {
    reports: new Map(),
    rejected_reports: new Map(),
  };
  const objectStoreNames = { contains: (name) => Object.hasOwn(stores, name) };
  const database = {
    objectStoreNames,
    createObjectStore(name) {
      stores[name] = new Map();
    },
    transaction() {
      const transaction = {
        error: null,
        objectStore(name) {
          const values = stores[name];
          return {
            put(value) {
              return scheduledRequest(transaction, () => {
                values.set(value.client_event_id, structuredClone(value));
              });
            },
            getAll() {
              return scheduledRequest(
                transaction,
                () => Array.from(values.values(), (value) => structuredClone(value)),
              );
            },
            delete(key) {
              return scheduledRequest(transaction, () => values.delete(key));
            },
          };
        },
      };
      return transaction;
    },
  };
  return {
    values: stores.reports,
    deadLetters: stores.rejected_reports,
    open() {
      const request = { result: database, error: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}

function scheduledRequest(transaction, operation) {
  const request = { result: undefined, error: null };
  queueMicrotask(() => {
    try {
      request.result = operation();
      transaction.oncomplete?.();
    } catch (error) {
      request.error = error;
      transaction.error = error;
      request.onerror?.();
      transaction.onerror?.();
    }
  });
  return request;
}
