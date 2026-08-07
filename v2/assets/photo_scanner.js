const config = window.PANINI_CONFIG || {};
const RECOGNITION_URL_KEY = "panini.recognitionBaseUrl.v1";
const OCR_TOKEN_KEY = "panini.ocrToken.v1";
const PHOTO_CODE_JOBS_PATH = ["", "api", "photo-code-jobs"].join("/fifa-sticker-app/v2/");
const input = document.querySelector("#photoScannerInput");
const side = document.querySelector("#photoScannerSide");
const scanButton = document.querySelector("#photoScannerButton");
const copyButton = document.querySelector("#photoScannerCopyButton");
const status = document.querySelector("#photoScannerStatus");
const result = document.querySelector("#photoScannerResult");
const codesList = document.querySelector("#photoScannerCodes");
const backendUrlInput = document.querySelector("[data-ocr-backend-url]");
const backendTokenInput = document.querySelector("[data-ocr-backend-token]");
const backendSaveButton = document.querySelector("[data-ocr-backend-save]");
const backendTestButton = document.querySelector("[data-ocr-backend-test]");
const backendStatus = document.querySelector("[data-ocr-backend-status]");

applyBackendFromQuery();
initializeBackendSettings();
initializeSideSelection();
scanButton?.addEventListener("click", () => scanPhoto());
copyButton?.addEventListener("click", async () => {
  if (!result.value) return;
  await navigator.clipboard?.writeText(result.value);
  status.textContent = "Codes copied.";
});

async function scanPhoto() {
  const file = input?.files?.[0];
  if (!file) {
    status.textContent = "Choose a photo first.";
    return;
  }
  if (!recognitionBaseUrl()) {
    status.textContent = "Recognition backend is not configured for this deployment.";
    return;
  }
  scanButton.disabled = true;
  copyButton.disabled = true;
  result.value = "";
  codesList.replaceChildren(emptyRow("Scanning..."));
  status.textContent = "Uploading photo...";
  try {
    const job = await createPhotoCodeJob(file);
    const payload = await waitForPhotoCodeJob(job.job_id);
    renderResult(payload.result || payload);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Photo scan failed.";
    codesList.replaceChildren(emptyRow("No result."));
  } finally {
    scanButton.disabled = false;
  }
}

async function createPhotoCodeJob(file) {
  const response = await fetch(recognitionUrl(PHOTO_CODE_JOBS_PATH), {
    method: "POST",
    headers: authHeaders({
      "Content-Type": file.type || "application/octet-stream",
      "X-Panini-Expected-Side": side.value || photoOcrSide(),
    }),
    body: file,
  });
  if (response.status === 401 || response.status === 403) throw new Error("Laptop OCR token is missing or incorrect.");
  if (response.status === 409) throw new Error("That scanner backend does not serve the selected sticker side.");
  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  return response.json();
}

async function waitForPhotoCodeJob(jobId) {
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
    status.textContent = payload.status === "running" ? "Recognizing photo..." : "Waiting for recognizer...";
    await delay(1000);
  }
  throw new Error("Recognition timed out.");
}

function renderResult(payload) {
  const codes = Array.isArray(payload?.codes) ? payload.codes : [];
  const text = String(payload?.grouped_text || codes.join(", "));
  result.value = text;
  copyButton.disabled = !text;
  status.textContent = codes.length
    ? `${codes.length} cards recognized.`
    : "No cards recognized in that photo.";
  codesList.replaceChildren(...(codes.length ? codes.map(codeRow) : [emptyRow("No recognized codes.")]));
}

function codeRow(code) {
  const row = document.createElement("li");
  row.className = "found";
  row.innerHTML = `<strong>${code}</strong><span>Recognized</span>`;
  return row;
}

function emptyRow(text) {
  const row = document.createElement("li");
  row.className = "empty";
  row.textContent = text;
  return row;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyBackendFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const backend = params.get("ocr") || params.get("recognitionBaseUrl");
  if (backend !== null) {
    const normalized = normalizeRecognitionBaseUrl(backend);
    if (normalized) {
      localStorage.setItem(RECOGNITION_URL_KEY, normalized);
    } else if (backend.trim() === "") {
      localStorage.removeItem(RECOGNITION_URL_KEY);
    }
  }
  const token = params.get("ocrToken");
  if (token !== null) {
    if (token) {
      localStorage.setItem(OCR_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(OCR_TOKEN_KEY);
    }
  }
}

function initializeBackendSettings() {
  if (backendUrlInput) backendUrlInput.value = recognitionBaseUrl();
  if (backendTokenInput) backendTokenInput.value = ocrToken();
  updateBackendStatus();
  backendSaveButton?.addEventListener("click", saveBackendSettings);
  backendTestButton?.addEventListener("click", () => testBackend());
}

function initializeSideSelection() {
  if (!side) return;
  side.value = photoOcrSide();
}

function saveBackendSettings() {
  const normalized = normalizeRecognitionBaseUrl(backendUrlInput?.value || "");
  if (normalized) {
    localStorage.setItem(RECOGNITION_URL_KEY, normalized);
    if (backendUrlInput) backendUrlInput.value = normalized;
  } else {
    localStorage.removeItem(RECOGNITION_URL_KEY);
    if (backendUrlInput) backendUrlInput.value = "";
  }
  const token = String(backendTokenInput?.value || "");
  if (token) {
    localStorage.setItem(OCR_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(OCR_TOKEN_KEY);
  }
  updateBackendStatus("Backend saved.");
}

async function testBackend() {
  saveBackendSettings();
  const base = recognitionBaseUrl();
  if (!base) {
    updateBackendStatus("Add a laptop Funnel URL first.");
    return;
  }
  if (backendTestButton) backendTestButton.disabled = true;
  updateBackendStatus("Testing backend...");
  try {
    const response = await fetch(recognitionUrl("/readyz"), { cache: "no-store" });
    if (!response.ok) throw new Error(`Backend check failed (${response.status}).`);
    const payload = await response.json();
    const auth = payload.ocr_auth_required ? "token required" : "no token required";
    const sideText = payload.expected_side || photoOcrSide();
    updateBackendStatus(`Backend ready: ${sideText} OCR, ${auth}.`);
  } catch {
    updateBackendStatus("Could not reach that backend.");
  } finally {
    if (backendTestButton) backendTestButton.disabled = false;
  }
}

function updateBackendStatus(message) {
  if (!backendStatus) return;
  backendStatus.textContent = message || (recognitionBaseUrl()
    ? `Using ${recognitionBaseUrl()}`
    : "Recognition backend is not configured.");
}

function recognitionBaseUrl() {
  const stored = normalizeRecognitionBaseUrl(localStorage.getItem(RECOGNITION_URL_KEY));
  if (stored) return stored;
  return normalizeRecognitionBaseUrl(config.recognitionBaseUrl);
}

function recognitionUrl(path) {
  return `${recognitionBaseUrl()}${path}`;
}

function normalizeRecognitionBaseUrl(value) {
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

function photoOcrSide() {
  const configured = String(config.photoOcrSide || "back").trim().toLowerCase();
  return configured === "front" ? "front" : "back";
}

function ocrToken() {
  return String(localStorage.getItem(OCR_TOKEN_KEY) || "");
}

function authHeaders(headers = {}) {
  const token = ocrToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}
