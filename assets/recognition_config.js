const STORAGE_KEYS = {
  url: "panini.recognitionBaseUrl.v1",
  localUrl: "panini.localOcrUrl.v1",
  localToken: "panini.localOcrToken.v1",
};

const READY_TIMEOUT_MS = 5000;
const UPLOAD_TIMEOUT_MS = 30000;
const POLL_TIMEOUT_MS = 10000;
const MAX_POLL_ATTEMPTS = 180;

export function normalizeRecognitionBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return "";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function applyRecognitionBaseUrlFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("ocr") || params.get("recognitionBaseUrl");
  if (value !== null) {
    const normalized = normalizeRecognitionBaseUrl(value);
    if (normalized) {
      window.localStorage.setItem(STORAGE_KEYS.localUrl, normalized);
      window.localStorage.setItem(STORAGE_KEYS.url, normalized);
    } else if (value.trim() === "") {
      window.localStorage.removeItem(STORAGE_KEYS.localUrl);
      window.localStorage.removeItem(STORAGE_KEYS.url);
    }
  }
  const token = params.get("ocrToken") || params.get("recognitionToken");
  if (token !== null) {
    const trimmed = token.trim();
    if (trimmed) window.localStorage.setItem(STORAGE_KEYS.localToken, trimmed);
    else window.localStorage.removeItem(STORAGE_KEYS.localToken);
  }
}

export function recognitionBaseUrl() {
  const local = normalizeRecognitionBaseUrl(window.localStorage.getItem(STORAGE_KEYS.localUrl));
  if (local) return local;
  const stored = normalizeRecognitionBaseUrl(window.localStorage.getItem(STORAGE_KEYS.url));
  if (stored) return stored;
  return normalizeRecognitionBaseUrl(window.PANINI_CONFIG?.recognitionBaseUrl);
}

export function recognitionUrl(path) {
  const base = recognitionBaseUrl();
  if (!base) throw new Error("photo OCR backend is not configured");
  return `${base}${path}`;
}

export function photoOcrSide() {
  const side = String(window.PANINI_CONFIG?.photoOcrSide || "back").trim().toLowerCase();
  return side === "front" ? "front" : "back";
}

export function bindRecognitionBackendSettings(root = document) {
  const urlInput = root.querySelector("[data-ocr-backend-url]");
  const tokenInput = root.querySelector("[data-ocr-backend-token]");
  const saveButton = root.querySelector("[data-ocr-backend-save]");
  const testButton = root.querySelector("[data-ocr-backend-test]");
  const status = root.querySelector("[data-ocr-backend-status]");
  if (!urlInput || !tokenInput) return;

  urlInput.value = normalizeRecognitionBaseUrl(window.localStorage.getItem(STORAGE_KEYS.localUrl));
  tokenInput.value = window.localStorage.getItem(STORAGE_KEYS.localToken) || "";
  renderBackendStatus(status);

  saveButton?.addEventListener("click", () => {
    saveBackendSettings(urlInput.value, tokenInput.value);
    urlInput.value = normalizeRecognitionBaseUrl(urlInput.value);
    tokenInput.value = tokenInput.value.trim();
    renderBackendStatus(status, "Laptop OCR settings saved.");
  });
  testButton?.addEventListener("click", async () => {
    saveBackendSettings(urlInput.value, tokenInput.value);
    const backend = localBackend();
    if (!backend) {
      renderBackendStatus(status, "No laptop URL saved. Railway fallback remains available.");
      return;
    }
    testButton.disabled = true;
    renderBackendStatus(status, `Testing ${backend.label}...`);
    try {
      const ready = await assertBackendReady(backend);
      const sides = Array.isArray(ready.available_sides) ? ready.available_sides.join(", ") : "unknown";
      renderBackendStatus(status, `${backend.label} is ready. Models: ${sides}.`);
    } catch (error) {
      renderBackendStatus(status, `${backend.label} failed: ${messageFromError(error)}`);
    } finally {
      testButton.disabled = false;
    }
  });
}

export async function recognizePhotoCodes(file, options = {}) {
  const errors = [];
  for (const backend of configuredRecognitionBackends()) {
    try {
      options.onStatus?.(`Checking ${backend.label}...`);
      await assertBackendReady(backend);
      options.onStatus?.(`Uploading to ${backend.label}...`);
      const job = await createPhotoCodeJob(file, backend);
      const payload = await waitForPhotoCodeJob(job.job_id, backend, options.onStatus);
      return payload.result || payload;
    } catch (error) {
      errors.push(`${backend.label}: ${messageFromError(error)}`);
      if (!backend.fallback) options.onStatus?.(`${backend.label} unavailable. Trying fallback...`);
    }
  }
  const error = new Error("photo OCR unavailable");
  error.details = errors;
  throw error;
}

export function recognitionErrorMessage(error) {
  if (error?.message === "photo OCR side is not available") {
    return "That scanner backend does not serve the photo model this page needs.";
  }
  if (error?.message === "photo OCR backend is not configured") {
    return "Photo OCR backend is not configured.";
  }
  if (Array.isArray(error?.details) && error.details.length) {
    return `Could not read those photos. ${error.details.join(" ")}`;
  }
  return "Could not read those photos. Make sure the scanner backend is running.";
}

function saveBackendSettings(url, token) {
  const normalized = normalizeRecognitionBaseUrl(url);
  const trimmedToken = String(token || "").trim();
  if (normalized) window.localStorage.setItem(STORAGE_KEYS.localUrl, normalized);
  else window.localStorage.removeItem(STORAGE_KEYS.localUrl);
  if (trimmedToken) window.localStorage.setItem(STORAGE_KEYS.localToken, trimmedToken);
  else window.localStorage.removeItem(STORAGE_KEYS.localToken);
}

function renderBackendStatus(status, message = "") {
  if (!status) return;
  if (message) {
    status.textContent = message;
    return;
  }
  status.textContent = localBackend()
    ? "Laptop OCR configured. Railway remains fallback."
    : "Blank laptop URL uses Railway only.";
}

function configuredRecognitionBackends() {
  const backends = [];
  const local = localBackend();
  if (local) backends.push(local);
  for (const backend of fallbackBackends()) {
    if (!backends.some((item) => item.url === backend.url)) backends.push(backend);
  }
  return backends;
}

function localBackend() {
  const url = normalizeRecognitionBaseUrl(window.localStorage.getItem(STORAGE_KEYS.localUrl));
  if (!url) return null;
  return {
    label: "Laptop OCR",
    url,
    token: window.localStorage.getItem(STORAGE_KEYS.localToken) || "",
    fallback: false,
  };
}

function fallbackBackends() {
  const configured = Array.isArray(window.PANINI_CONFIG?.recognitionBackends)
    ? window.PANINI_CONFIG.recognitionBackends
    : [];
  const backends = configured.map((backend) => normalizeBackend(backend, true)).filter(Boolean);
  const legacy = normalizeBackend({
    label: "Railway OCR",
    url: window.PANINI_CONFIG?.recognitionBaseUrl,
  }, true);
  if (legacy && !backends.some((backend) => backend.url === legacy.url)) backends.push(legacy);
  return backends;
}

function normalizeBackend(backend, fallback) {
  const url = normalizeRecognitionBaseUrl(backend?.url || backend?.baseUrl);
  if (!url) return null;
  return {
    label: String(backend.label || "OCR backend"),
    url,
    token: String(backend.token || ""),
    fallback,
  };
}

async function assertBackendReady(backend) {
  const response = await fetchWithTimeout(`${backend.url}/readyz`, { cache: "no-store" }, READY_TIMEOUT_MS);
  if (!response.ok) throw new Error(`health check failed (${response.status})`);
  const payload = await response.json();
  const side = photoOcrSide();
  const sides = Array.isArray(payload.available_sides) ? payload.available_sides : [];
  if (sides.length && !sides.includes(side)) throw new Error("photo OCR side is not available");
  if (payload.ocr_auth_required && !backend.token) throw new Error("OCR token required");
  return payload;
}

async function createPhotoCodeJob(file, backend) {
  const response = await fetchWithTimeout(`${backend.url}/api/photo-code-jobs`, {
    method: "POST",
    headers: {
      ...authHeaders(backend),
      "Content-Type": file.type || "application/octet-stream",
      "X-Panini-Expected-Side": photoOcrSide(),
    },
    body: file,
  }, UPLOAD_TIMEOUT_MS);
  if (response.status === 409) throw new Error("photo OCR side is not available");
  if (!response.ok) throw new Error(`upload failed (${response.status})`);
  return response.json();
}

async function waitForPhotoCodeJob(jobId, backend, onStatus) {
  if (!jobId) throw new Error("backend did not return a job id");
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const response = await fetchWithTimeout(`${backend.url}/api/photo-code-jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      headers: authHeaders(backend),
    }, POLL_TIMEOUT_MS);
    if (!response.ok) throw new Error(`recognition status failed (${response.status})`);
    const payload = await response.json();
    if (payload.status === "done") return payload;
    if (payload.status === "error") throw new Error(payload.error || "photo recognition failed");
    onStatus?.(payload.status === "running" ? `Recognizing on ${backend.label}...` : `Waiting for ${backend.label}...`);
    await delay(1000);
  }
  throw new Error("recognition timed out");
}

function authHeaders(backend) {
  return backend.token ? { Authorization: `Bearer ${backend.token}` } : {};
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("request timed out");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageFromError(error) {
  return error instanceof Error ? error.message : "photo OCR failed";
}
