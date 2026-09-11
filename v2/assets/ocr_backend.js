import {
  CLIENT_ERROR_REPORTS_PATH,
  flushClientErrorReports,
  OcrClientError,
  requestIdFrom,
} from "/fifa-sticker-app/v2/assets/client_error_reports.js?v=build-758205c86f15";

const config = window.PANINI_CONFIG || {};
const RECOGNITION_URL_KEY = "panini.recognitionBaseUrl.v1";
const OCR_TOKEN_KEY = "panini.ocrToken.v1";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const PHOTO_CODE_JOBS_PATH = ["", "api", "photo-code-jobs"].join('/');
export const PHOTO_CODE_REVIEW_LABELS_PATH = ["", "api", "photo-code-review", "labels"].join('/');
export const BACK_INSIGNIA_REVIEW_LABELS_PATH = ["", "api", "back-insignia-review", "labels"].join('/');
export const ALBUM_PAGE_JOBS_PATH = ["", "api", "album-page-jobs"].join('/');

export function applyOcrBackendFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const backend = params.get("ocr") || params.get("recognitionBaseUrl");
  let changedSensitiveParams = false;
  if (backend !== null) {
    const normalized = normalizeRecognitionBaseUrl(backend);
    if (normalized) {
      savePersistedValue(RECOGNITION_URL_KEY, normalized);
    } else if (backend.trim() === "") {
      clearPersistedValue(RECOGNITION_URL_KEY);
    }
    changedSensitiveParams = true;
  }
  const token = params.get("ocrToken") ?? params.get("token") ?? params.get("ocr_token");
  if (token !== null) {
    if (token) {
      savePersistedValue(OCR_TOKEN_KEY, token);
    } else {
      clearPersistedValue(OCR_TOKEN_KEY);
    }
    changedSensitiveParams = true;
  }
  if (changedSensitiveParams) clearSensitiveQueryParams();
}

export function recognitionBaseUrl() {
  const stored = normalizeRecognitionBaseUrl(persistedValue(RECOGNITION_URL_KEY));
  if (stored) return stored;
  return normalizeRecognitionBaseUrl(config.recognitionBaseUrl);
}

export function recognitionUrl(path) {
  return `${recognitionBaseUrl()}${path}`;
}

export function normalizeRecognitionBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function photoOcrSide() {
  const configured = String(config.photoOcrSide || "back").trim().toLowerCase();
  return configured === "front" ? "front" : "back";
}

export function scannerMode() {
  const configured = String(config.scannerMode || "back-card").trim().toLowerCase();
  return configured === "album-pages" ? "album-pages" : "back-card";
}

export function ocrToken() {
  return String(persistedValue(OCR_TOKEN_KEY) || "");
}

export function saveOcrBackendSettings({ baseUrl = "", token = "" } = {}) {
  const normalized = normalizeRecognitionBaseUrl(baseUrl);
  if (normalized) {
    savePersistedValue(RECOGNITION_URL_KEY, normalized);
  } else {
    clearPersistedValue(RECOGNITION_URL_KEY);
  }
  if (token) {
    savePersistedValue(OCR_TOKEN_KEY, String(token));
  } else {
    clearPersistedValue(OCR_TOKEN_KEY);
  }
  return { baseUrl: normalized, token: String(token || "") };
}

export async function createPhotoCodeJob(file, { side = photoOcrSide() } = {}) {
  let response;
  try {
    response = await fetch(recognitionUrl(PHOTO_CODE_JOBS_PATH), {
      method: "POST",
      headers: authHeaders({
        "Content-Type": file.type || "application/octet-stream",
        "X-Panini-Expected-Side": side,
      }),
      body: file,
    });
  } catch (cause) {
    throw new OcrClientError("Could not reach the OCR backend.", {
      code: "NETWORK_UNREACHABLE",
      operation: "photo_job_create",
      phase: "request",
      retryable: true,
      cause,
    });
  }
  throwForPhotoHttpStatus(response, "photo_job_create");
  const payload = await responseJson(response, "photo_job_create");
  void flushPendingClientErrorReports();
  return payload;
}

export async function createAlbumPageJob(file) {
  const response = await fetch(recognitionUrl(ALBUM_PAGE_JOBS_PATH), {
    method: "POST",
    headers: authHeaders({
      "Content-Type": file.type || "application/octet-stream",
    }),
    body: file,
  });
  if (response.status === 401 || response.status === 403) throw new Error("Laptop OCR token is missing or incorrect.");
  if (!response.ok) throw new Error(`Album upload failed (${response.status}).`);
  return response.json();
}

export async function albumPageBackendReadiness() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(recognitionUrl("/readyz"), {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Backend check failed (${response.status}).`);
  const payload = await response.json();
  const albumJobs = payload?.v2?.album_page_jobs || {};
  return {
    available: albumJobs.available !== false && albumJobs.create_endpoint === ALBUM_PAGE_JOBS_PATH,
    authRequired: Boolean(albumJobs.auth_required),
    auth: String(albumJobs.auth || ""),
  };
}

export async function waitForPhotoCodeJob(jobOrId, { onStatus } = {}) {
  const job = typeof jobOrId === "object" && jobOrId !== null ? jobOrId : {};
  const jobId = typeof jobOrId === "string" ? jobOrId : job.job_id;
  const correlation = {
    jobId,
    uploadId: job.upload_id,
    creationRequestId: job.creation_request_id,
  };
  if (!jobId) {
    throw new OcrClientError("The OCR backend returned an invalid job.", {
      code: "MALFORMED_RESPONSE",
      operation: "photo_job_wait",
      phase: "decode",
    });
  }
  for (let attempt = 0; attempt < 90; attempt += 1) {
    let response;
    try {
      response = await fetch(recognitionUrl(`${PHOTO_CODE_JOBS_PATH}/${encodeURIComponent(jobId)}`), {
        cache: "no-store",
        headers: authHeaders(),
      });
    } catch (cause) {
      throw new OcrClientError("Connection to the OCR backend was interrupted.", {
        code: "NETWORK_UNREACHABLE",
        operation: "photo_job_status",
        phase: "poll",
        retryable: true,
        ...correlation,
        requestId: correlation.creationRequestId,
        attempt: attempt + 1,
        cause,
      });
    }
    throwForPhotoHttpStatus(response, "photo_job_status", { ...correlation, attempt: attempt + 1 });
    const payload = await responseJson(response, "photo_job_status", { ...correlation, attempt: attempt + 1 });
    correlation.uploadId = payload.upload_id || correlation.uploadId;
    correlation.creationRequestId = payload.creation_request_id || correlation.creationRequestId;
    if (payload.status === "done") return payload;
    if (payload.status === "error") {
      throw new OcrClientError("Photo recognition failed on the backend.", {
        code: "JOB_FAILED",
        operation: "photo_job_wait",
        phase: "job",
        retryable: false,
        diagnosticId: payload.diagnostic_id,
        requestId: requestIdFrom(response),
        ...correlation,
        attempt: attempt + 1,
      });
    }
    if (onStatus) onStatus(payload.status === "running" ? "Recognizing photo..." : "Waiting for recognizer...");
    await delay(1000);
  }
  throw new OcrClientError("Photo recognition timed out.", {
    code: "REQUEST_TIMEOUT",
    operation: "photo_job_wait",
    phase: "timeout",
    retryable: true,
    ...correlation,
    requestId: correlation.creationRequestId,
    attempt: 90,
  });
}

export function flushPendingClientErrorReports() {
  return flushClientErrorReports({
    reportUrl: recognitionUrl(CLIENT_ERROR_REPORTS_PATH),
    token: ocrToken(),
  });
}

function schedulePendingClientErrorFlush() {
  const schedule = globalThis.setTimeout;
  if (typeof schedule !== "function") return;
  schedule(() => {
    void flushPendingClientErrorReports().catch(() => {});
  }, 0);
}

globalThis.window?.addEventListener?.("online", schedulePendingClientErrorFlush);
schedulePendingClientErrorFlush();

export async function savePhotoCodeReviewLabel(payload) {
  const response = await fetch(recognitionUrl(PHOTO_CODE_REVIEW_LABELS_PATH), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (response.status === 401 || response.status === 403) throw new Error("Laptop OCR token is missing or incorrect.");
  if (!response.ok) throw new Error(`Review save failed (${response.status}).`);
  return response.json();
}

export async function saveBackInsigniaReviewLabel(payload) {
  const response = await fetch(recognitionUrl(BACK_INSIGNIA_REVIEW_LABELS_PATH), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (response.status === 401 || response.status === 403) throw new Error("Laptop OCR token is missing or incorrect.");
  if (!response.ok) throw new Error(`Back-colour feedback save failed (${response.status}).`);
  return response.json();
}

export async function waitForAlbumPageJob(jobId, { onStatus } = {}) {
  if (!jobId) throw new Error("Backend did not return an album job id.");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(recognitionUrl(`${ALBUM_PAGE_JOBS_PATH}/${encodeURIComponent(jobId)}`), {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (response.status === 401 || response.status === 403) throw new Error("Laptop OCR token is missing or incorrect.");
    if (!response.ok) throw new Error(`Album recognition status failed (${response.status}).`);
    const payload = await response.json();
    if (payload.status === "done") return payload;
    if (payload.status === "error") throw new Error(payload.error || "Album page recognition failed.");
    if (onStatus) onStatus(payload.status === "running" ? "Parsing album page..." : "Waiting for album parser...");
    await delay(1000);
  }
  throw new Error("Album page recognition timed out.");
}

function authHeaders(headers = {}) {
  const token = ocrToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

function throwForPhotoHttpStatus(response, operation, context = {}) {
  if (response.ok) return;
  const fields = {
    operation,
    phase: "response",
    httpStatus: response.status,
    requestId: requestIdFrom(response) || context.creationRequestId,
    jobId: context.jobId,
    uploadId: context.uploadId,
    attempt: context.attempt,
  };
  if (response.status === 401 || response.status === 403) {
    throw new OcrClientError("Laptop OCR token is missing or incorrect.", {
      ...fields,
      code: ocrToken() ? "AUTH_REJECTED" : "AUTH_REQUIRED",
      retryable: false,
    });
  }
  if (response.status === 409 && operation === "photo_job_create") {
    throw new OcrClientError("That OCR backend does not serve the selected sticker side.", {
      ...fields,
      code: "SIDE_UNAVAILABLE",
      retryable: false,
    });
  }
  if (response.status === 404 && operation === "photo_job_status") {
    throw new OcrClientError("The OCR job is no longer available.", {
      ...fields,
      code: "JOB_MISSING",
      retryable: false,
    });
  }
  throw new OcrClientError(
    response.status >= 500 ? "The OCR backend had an internal error." : "The OCR request was rejected.",
    {
      ...fields,
      code: response.status >= 500 ? "HTTP_SERVER_ERROR" : "HTTP_CLIENT_ERROR",
      retryable: response.status >= 500 || response.status === 429,
    },
  );
}

async function responseJson(response, operation, context = {}) {
  try {
    return await response.json();
  } catch (cause) {
    throw new OcrClientError("The OCR backend returned an invalid response.", {
      code: "MALFORMED_RESPONSE",
      operation,
      phase: "decode",
      retryable: false,
      httpStatus: response.status,
      requestId: requestIdFrom(response) || context.creationRequestId,
      jobId: context.jobId,
      uploadId: context.uploadId,
      attempt: context.attempt,
      cause,
    });
  }
}

function persistedValue(name) {
  return localStorage.getItem(name) || cookieValue(name);
}

function savePersistedValue(name, value) {
  localStorage.setItem(name, value);
  setCookieValue(name, value);
}

function clearPersistedValue(name) {
  localStorage.removeItem(name);
  clearCookieValue(name);
}

function cookieValue(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!value) return "";
  try {
    return decodeURIComponent(value.slice(prefix.length));
  } catch {
    return "";
  }
}

function setCookieValue(name, value) {
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureCookieSuffix()}`;
}

function clearCookieValue(name) {
  document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/; SameSite=Lax${secureCookieSuffix()}`;
}

function secureCookieSuffix() {
  return window.location.protocol === "https:" ? "; Secure" : "";
}

function clearSensitiveQueryParams() {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ["ocr", "recognitionBaseUrl", "ocrToken", "token", "ocr_token"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
