const config = window.PANINI_CONFIG || {};
const RECOGNITION_URL_KEY = "panini.recognitionBaseUrl.v1";
const OCR_TOKEN_KEY = "panini.ocrToken.v1";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const PHOTO_CODE_JOBS_PATH = ["", "api", "photo-code-jobs"].join('/');
export const PHOTO_CODE_REVIEW_LABELS_PATH = ["", "api", "photo-code-review", "labels"].join('/');
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
  const response = await fetch(recognitionUrl(PHOTO_CODE_JOBS_PATH), {
    method: "POST",
    headers: authHeaders({
      "Content-Type": file.type || "application/octet-stream",
      "X-Panini-Expected-Side": side,
    }),
    body: file,
  });
  if (response.status === 401 || response.status === 403) throw new Error("Laptop OCR token is missing or incorrect.");
  if (response.status === 409) throw new Error("That scanner backend does not serve the selected sticker side.");
  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  return response.json();
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
  const response = await fetch(recognitionUrl("/readyz"), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(`Backend check failed (${response.status}).`);
  const payload = await response.json();
  const albumJobs = payload?.v2?.album_page_jobs || {};
  return {
    available: albumJobs.available !== false && albumJobs.create_endpoint === ALBUM_PAGE_JOBS_PATH,
    authRequired: Boolean(albumJobs.auth_required),
    auth: String(albumJobs.auth || ""),
  };
}

export async function waitForPhotoCodeJob(jobId, { onStatus } = {}) {
  if (!jobId) throw new Error("Backend did not return a job id.");
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await fetch(recognitionUrl(`${PHOTO_CODE_JOBS_PATH}/${encodeURIComponent(jobId)}`), {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (response.status === 401 || response.status === 403) throw new Error("Laptop OCR token is missing or incorrect.");
    if (!response.ok) throw new Error(`Recognition status failed (${response.status}).`);
    const payload = await response.json();
    if (payload.status === "done") return payload;
    if (payload.status === "error") throw new Error(payload.error || "Photo recognition failed.");
    if (onStatus) onStatus(payload.status === "running" ? "Recognizing photo..." : "Waiting for recognizer...");
    await delay(1000);
  }
  throw new Error("Recognition timed out.");
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
