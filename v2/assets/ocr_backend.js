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

export class PhotoJobRequestError extends Error {
  constructor(message, { kind = "terminal", status = null, code = "", cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PhotoJobRequestError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export async function createPhotoCodeJob(file, {
  side = photoOcrSide(),
  onStatus,
  retryBaseMs = 500,
  retryMaxMs = 5000,
  signal,
  jobId = newPhotoCodeJobId(),
} = {}) {
  if (!/^[0-9a-f]{32}$/.test(jobId)) {
    throw new PhotoJobRequestError("Could not create a valid photo job id.", { kind: "protocol" });
  }
  const path = `${PHOTO_CODE_JOBS_PATH}/${jobId}`;
  let retryAttempt = 0;
  while (true) {
    assertNotCancelled(signal);
    try {
      const response = await fetch(recognitionUrl(path), {
        method: "PUT",
        headers: authHeaders({
          "Content-Type": file.type || "application/octet-stream",
          "X-Panini-Expected-Side": side,
        }),
        body: file,
        signal,
      });
      if (response.ok) return await parsePhotoJobResponse(response, jobId, signal);
      if (!isTransientStatus(response.status)) throw await photoJobHttpError(response, "Upload");
      retryAttempt += 1;
      notifyConnectionInterrupted(onStatus);
      await retryDelay(response, retryAttempt, retryBaseMs, retryMaxMs, signal);
    } catch (error) {
      if (error instanceof PhotoJobRequestError) throw error;
      assertNotCancelled(signal, error);
      retryAttempt += 1;
      notifyConnectionInterrupted(onStatus);
      await retryDelay(null, retryAttempt, retryBaseMs, retryMaxMs, signal);
    }

    while (true) {
      assertNotCancelled(signal);
      try {
        const response = await fetch(recognitionUrl(path), {
          cache: "no-store",
          headers: authHeaders(),
          signal,
        });
        if (response.ok) return await parsePhotoJobResponse(response, jobId, signal);
        if (response.status === 404) break;
        if (!isTransientStatus(response.status)) throw await photoJobHttpError(response, "Upload recovery");
        retryAttempt += 1;
        notifyConnectionInterrupted(onStatus);
        await retryDelay(response, retryAttempt, retryBaseMs, retryMaxMs, signal);
      } catch (error) {
        if (error instanceof PhotoJobRequestError) throw error;
        assertNotCancelled(signal, error);
        retryAttempt += 1;
        notifyConnectionInterrupted(onStatus);
        await retryDelay(null, retryAttempt, retryBaseMs, retryMaxMs, signal);
      }
    }
  }
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

export async function waitForPhotoCodeJob(jobId, {
  onStatus,
  pollIntervalMs = 1000,
  retryBaseMs = 500,
  retryMaxMs = 5000,
  signal,
} = {}) {
  if (!jobId) throw new PhotoJobRequestError("Backend did not return a job id.", { kind: "protocol" });
  let retryAttempt = 0;
  while (true) {
    assertNotCancelled(signal);
    try {
      const response = await fetch(recognitionUrl(`${PHOTO_CODE_JOBS_PATH}/${encodeURIComponent(jobId)}`), {
        cache: "no-store",
        headers: authHeaders(),
        signal,
      });
      if (!response.ok) {
        if (!isTransientStatus(response.status)) throw await photoJobHttpError(response, "Recognition status");
        retryAttempt += 1;
        notifyConnectionInterrupted(onStatus);
        await retryDelay(response, retryAttempt, retryBaseMs, retryMaxMs, signal);
        continue;
      }
      const payload = await parsePhotoJobResponse(response, jobId, signal);
      retryAttempt = 0;
      if (payload.status === "done") return payload;
      if (payload.status === "error") {
        throw new PhotoJobRequestError(payload.error || "Photo recognition failed.", {
          kind: "backend",
          code: payload.error_code || "",
        });
      }
      if (onStatus) onStatus(payload.status === "running" ? "Recognizing photo..." : "Waiting for recognizer...");
      await delay(pollIntervalMs, signal);
    } catch (error) {
      if (error instanceof PhotoJobRequestError) throw error;
      assertNotCancelled(signal, error);
      retryAttempt += 1;
      notifyConnectionInterrupted(onStatus);
      await retryDelay(null, retryAttempt, retryBaseMs, retryMaxMs, signal);
    }
  }
}

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

function newPhotoCodeJobId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll("-", "");
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function isTransientStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function parsePhotoJobResponse(response, expectedJobId, signal) {
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    assertNotCancelled(signal, cause);
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new PhotoJobRequestError("Recognition backend returned invalid JSON.", {
      kind: "protocol",
      status: response.status,
      cause,
    });
  }
  if (!payload || typeof payload !== "object" || payload.job_id !== expectedJobId) {
    throw new PhotoJobRequestError("Recognition backend returned a mismatched job.", {
      kind: "protocol",
      status: response.status,
    });
  }
  if (!["queued", "running", "done", "error"].includes(payload.status)) {
    throw new PhotoJobRequestError("Recognition backend returned an unknown job status.", {
      kind: "protocol",
      status: response.status,
    });
  }
  return payload;
}

async function photoJobHttpError(response, operation) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // The status still provides a stable terminal classification.
  }
  const code = String(payload?.error || "");
  if (response.status === 401 || response.status === 403) {
    return new PhotoJobRequestError("Laptop OCR token is missing or incorrect.", {
      kind: "auth",
      status: response.status,
      code,
    });
  }
  if (response.status === 409 && code === "ocr_side_unavailable") {
    return new PhotoJobRequestError("That scanner backend does not serve the selected sticker side.", {
      status: response.status,
      code,
    });
  }
  if (response.status === 410 && code === "job_expired") {
    return new PhotoJobRequestError("The recognizer restarted after accepting this photo. Please scan it again.", {
      kind: "expired",
      status: response.status,
      code,
    });
  }
  return new PhotoJobRequestError(`${operation} failed (${response.status}).`, {
    status: response.status,
    code,
  });
}

function notifyConnectionInterrupted(onStatus) {
  if (onStatus) onStatus("Connection interrupted; still waiting for this scan...");
}

function retryDelay(response, attempt, baseMs, maxMs, signal) {
  const retryAfter = retryAfterMs(response);
  const exponential = Math.min(maxMs, baseMs * (2 ** Math.min(attempt - 1, 6)));
  const jittered = exponential <= 0 ? 0 : Math.round(exponential * (0.75 + Math.random() * 0.5));
  return delay(retryAfter ?? jittered, signal);
}

function retryAfterMs(response) {
  const raw = response?.headers?.get?.("Retry-After");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function assertNotCancelled(signal, cause = null) {
  if (!signal?.aborted) return;
  throw new PhotoJobRequestError("Photo recognition was cancelled.", {
    kind: "cancelled",
    cause,
  });
}

function delay(ms, signal) {
  assertNotCancelled(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    const cancel = () => {
      clearTimeout(timer);
      reject(new PhotoJobRequestError("Photo recognition was cancelled.", { kind: "cancelled" }));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
