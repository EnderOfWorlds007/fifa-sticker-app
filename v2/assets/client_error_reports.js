export const CLIENT_ERROR_REPORTS_PATH = ["", "api", "client-error-reports"].join('/');

const DATABASE_NAME = "panini.clientErrorReports.v1";
const STORE_NAME = "reports";
const DEAD_LETTER_STORE_NAME = "rejected_reports";
const DATABASE_VERSION = 2;
const FLUSH_BATCH_SIZE = 20;
const MAX_FLUSH_PER_TRIGGER = 100;
const REPORT_TIMEOUT_MS = 4_000;
const PERMANENT_REJECTION_STATUSES = new Set([400, 409, 413, 422]);
const ALLOWED_CODES = new Set([
  "AUTH_REJECTED",
  "AUTH_REQUIRED",
  "HTTP_CLIENT_ERROR",
  "HTTP_SERVER_ERROR",
  "JOB_FAILED",
  "JOB_MISSING",
  "MALFORMED_RESPONSE",
  "NETWORK_UNREACHABLE",
  "REQUEST_TIMEOUT",
  "SIDE_UNAVAILABLE",
  "UNKNOWN_CLIENT_ERROR",
]);

let pageSessionId;
let flushPromise;

export class OcrClientError extends Error {
  constructor(message, fields = {}) {
    super(message, fields.cause === undefined ? undefined : { cause: fields.cause });
    this.name = "OcrClientError";
    this.code = ALLOWED_CODES.has(fields.code) ? fields.code : "UNKNOWN_CLIENT_ERROR";
    this.operation = fields.operation || "photo_job_create";
    this.phase = fields.phase || "request";
    this.retryable = Boolean(fields.retryable);
    this.httpStatus = Number.isInteger(fields.httpStatus) ? fields.httpStatus : null;
    this.requestId = opaqueId(fields.requestId, "req_");
    this.diagnosticId = opaqueDiagnosticId(fields.diagnosticId);
    this.jobId = bareHexId(fields.jobId);
    this.uploadId = bareHexId(fields.uploadId);
    this.attempt = Number.isInteger(fields.attempt) && fields.attempt > 0 ? fields.attempt : 1;
  }
}

export function newOperationId() {
  return newOpaqueId("op");
}

export function requestIdFrom(response) {
  return opaqueId(response?.headers?.get?.("X-Panini-Request-ID"), "req_");
}

export function appBuildId(documentRef = globalThis.document) {
  const candidates = [
    ...(documentRef?.querySelectorAll?.('script[src*="build-"]') || []),
    ...(documentRef?.querySelectorAll?.('link[href*="build-"]') || []),
  ];
  for (const element of candidates) {
    const value = String(element.src || element.href || "");
    const match = value.match(/[?&]v=(build-[0-9a-f]{12})(?:&|$)/);
    if (match) return match[1];
  }
  return "unknown-build";
}

export function diagnosticReference(error, report) {
  const preferred = opaqueDiagnosticId(error?.diagnosticId)
    || opaqueId(error?.requestId, "req_")
    || opaqueId(report?.client_event_id, "evt_");
  if (!preferred) return null;
  return preferred.slice(0, 4) + preferred.slice(-10);
}

export function buildClientErrorReport(error, context = {}, environment = {}) {
  const typed = error instanceof OcrClientError
    ? error
    : new OcrClientError("Photo scan failed.", {
      code: "UNKNOWN_CLIENT_ERROR",
      operation: context.operation,
      phase: context.phase,
    });
  return {
    schema_version: 1,
    client_event_id: environment.clientEventId || newOpaqueId("evt"),
    occurred_at: environment.occurredAt || new Date().toISOString(),
    app_build_id: environment.appBuildId || appBuildId(),
    page_session_id: environment.pageSessionId || currentPageSessionId(),
    operation_id: context.operationId || newOperationId(),
    operation: typed.operation,
    phase: typed.phase,
    error_code: typed.code,
    retryable: typed.retryable,
    http_status: typed.httpStatus,
    related_request_id: typed.requestId,
    job_id: typed.jobId,
    upload_id: typed.uploadId,
    attempt: typed.attempt,
    connectivity: connectivityState(environment.navigatorRef),
  };
}

export async function recordClientError(error, context = {}, transport = {}) {
  const report = buildClientErrorReport(error, context, transport.environment);
  try {
    await storeReport(report, transport.indexedDBRef);
  } catch {
    return { report, queued: false, delivered: false, storageFailed: true };
  }
  const schedule = transport.scheduleFlush || globalThis.setTimeout;
  if (typeof schedule === "function") {
    schedule(() => {
      void flushClientErrorReports(transport).catch(() => {});
    }, 0);
  }
  return { report, queued: true, delivered: false, storageFailed: false };
}

export function flushClientErrorReports(transport = {}) {
  if (flushPromise) return flushPromise;
  flushPromise = flushReports(transport).finally(() => {
    flushPromise = undefined;
  });
  return flushPromise;
}

async function flushReports(transport) {
  const reportUrl = String(transport.reportUrl || "");
  const token = String(transport.token || "");
  const fetchFn = transport.fetchFn || globalThis.fetch;
  if (!reportUrl || !token || typeof fetchFn !== "function") return false;
  let delivered = false;
  let processed = 0;
  while (processed < MAX_FLUSH_PER_TRIGGER) {
    let reports;
    try {
      reports = await storedReports(transport.indexedDBRef);
    } catch {
      return delivered;
    }
    const batch = reports.slice(0, Math.min(FLUSH_BATCH_SIZE, MAX_FLUSH_PER_TRIGGER - processed));
    if (!batch.length) break;
    let stopped = false;
    for (const report of batch) {
      const response = await sendReport(fetchFn, reportUrl, token, report, transport.reportTimeoutMs);
      if (!response) {
        stopped = true;
        break;
      }
      if (response.status === 401 || response.status === 403) {
        stopped = true;
        break;
      }
      if (response.status === 429 || response.status >= 500) {
        stopped = true;
        break;
      }
      if (PERMANENT_REJECTION_STATUSES.has(response.status)) {
        try {
          await moveToDeadLetter(report, response.status, transport.indexedDBRef);
          processed += 1;
          continue;
        } catch {
          stopped = true;
          break;
        }
      }
      if (!response.ok) {
        stopped = true;
        break;
      }
      try {
        await deleteStoredReport(report.client_event_id, transport.indexedDBRef);
        delivered = true;
        processed += 1;
      } catch {
        stopped = true;
        break;
      }
    }
    if (stopped || batch.length < FLUSH_BATCH_SIZE) break;
  }
  return delivered;
}

async function sendReport(fetchFn, reportUrl, token, report, timeoutMs = REPORT_TIMEOUT_MS) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller && typeof globalThis.setTimeout === "function"
    ? globalThis.setTimeout(() => controller.abort(), timeoutMs, undefined)
    : null;
  try {
    return await fetchFn(reportUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(report),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch {
    return null;
  } finally {
    if (timer !== null) globalThis.clearTimeout?.(timer);
  }
}

function currentPageSessionId() {
  if (!pageSessionId) pageSessionId = newOpaqueId("ses");
  return pageSessionId;
}

function connectivityState(navigatorRef = globalThis.navigator) {
  if (navigatorRef?.onLine === false) return "offline";
  if (navigatorRef?.onLine === true) return "online";
  return "unknown";
}

function opaqueDiagnosticId(value) {
  return opaqueId(value, "err_") || opaqueId(value, "req_") || opaqueId(value, "evt_");
}

function opaqueId(value, prefix) {
  const normalized = String(value || "").toLowerCase();
  return new RegExp(`^${prefix}[0-9a-f]{32}$`).test(normalized) ? normalized : null;
}

function bareHexId(value) {
  const normalized = String(value || "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : null;
}

function newOpaqueId(prefix) {
  const cryptoRef = globalThis.crypto;
  if (!cryptoRef?.getRandomValues) throw new Error("Secure random identifiers are unavailable.");
  const bytes = new Uint8Array(16);
  cryptoRef.getRandomValues(bytes);
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

async function storeReport(report, indexedDBRef = globalThis.indexedDB) {
  const database = await openDatabase(indexedDBRef);
  await transactionPromise(database, "readwrite", (store) => store.put(report));
}

async function storedReports(indexedDBRef = globalThis.indexedDB) {
  const database = await openDatabase(indexedDBRef);
  return transactionPromise(database, "readonly", (store) => store.getAll());
}

async function deleteStoredReport(clientEventId, indexedDBRef = globalThis.indexedDB) {
  const database = await openDatabase(indexedDBRef);
  await transactionPromise(database, "readwrite", (store) => store.delete(clientEventId));
}

async function moveToDeadLetter(report, status, indexedDBRef = globalThis.indexedDB) {
  const database = await openDatabase(indexedDBRef);
  await new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, DEAD_LETTER_STORE_NAME], "readwrite");
    transaction.objectStore(DEAD_LETTER_STORE_NAME).put({
      ...report,
      rejected_at: new Date().toISOString(),
      rejection_code: "permanent_http_rejection",
      rejection_status: status,
    });
    transaction.objectStore(STORE_NAME).delete(report.client_event_id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase(indexedDBRef) {
  if (!indexedDBRef?.open) return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDBRef.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "client_event_id" });
      }
      if (!request.result.objectStoreNames.contains(DEAD_LETTER_STORE_NAME)) {
        request.result.createObjectStore(DEAD_LETTER_STORE_NAME, { keyPath: "client_event_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

function transactionPromise(database, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error || new Error("IndexedDB operation failed"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}
