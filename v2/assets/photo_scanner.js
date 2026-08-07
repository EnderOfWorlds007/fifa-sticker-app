import {
  applyOcrBackendFromQuery,
  createPhotoCodeJob,
  ocrToken,
  photoOcrSide,
  recognitionBaseUrl,
  recognitionUrl,
  saveOcrBackendSettings,
  waitForPhotoCodeJob,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-023a20dddc41";

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

applyOcrBackendFromQuery();
initializeBackendSettings();
initializeSideSelection();
scanButton?.addEventListener("click", () => scanPhoto());
input?.addEventListener("change", () => {
  if (input.files?.[0]) scanPhoto();
});
copyButton?.addEventListener("click", async () => {
  if (!result.value) return;
  await navigator.clipboard?.writeText(result.value);
  status.textContent = "Codes copied.";
});

async function scanPhoto() {
  const file = input?.files?.[0];
  if (!file) {
    status.textContent = "Choose a photo first. The picker should open now.";
    input?.click();
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
    const job = await createPhotoCodeJob(file, { side: side.value || photoOcrSide() });
    const payload = await waitForPhotoCodeJob(job.job_id, {
      onStatus: (message) => { status.textContent = message; },
    });
    renderResult(payload.result || payload);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Photo scan failed.";
    codesList.replaceChildren(emptyRow("No result."));
  } finally {
    scanButton.disabled = false;
  }
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
  const saved = saveOcrBackendSettings({
    baseUrl: backendUrlInput?.value || "",
    token: backendTokenInput?.value || "",
  });
  if (backendUrlInput) backendUrlInput.value = saved.baseUrl;
  updateBackendStatus("Backend saved.", { mirror: true });
}

async function testBackend() {
  saveBackendSettings();
  const base = recognitionBaseUrl();
  if (!base) {
    updateBackendStatus("Add a laptop Funnel URL first.", { mirror: true });
    return;
  }
  if (backendTestButton) backendTestButton.disabled = true;
  updateBackendStatus("Testing backend...", { mirror: true });
  try {
    const response = await fetch(recognitionUrl("/readyz"), { cache: "no-store" });
    if (!response.ok) throw new Error(`Backend check failed (${response.status}).`);
    const payload = await response.json();
    const auth = payload.ocr_auth_required ? "token required" : "no token required";
    const sideText = payload.expected_side || photoOcrSide();
    updateBackendStatus(`Backend ready: ${sideText} OCR, ${auth}.`, { mirror: true });
  } catch {
    updateBackendStatus("Could not reach that backend.", { mirror: true });
  } finally {
    if (backendTestButton) backendTestButton.disabled = false;
  }
}

function updateBackendStatus(message, options = {}) {
  if (!backendStatus) return;
  backendStatus.textContent = message || (recognitionBaseUrl()
    ? `Using ${recognitionBaseUrl()}`
    : "Recognition backend is not configured.");
  if (options.mirror && status) status.textContent = message || backendStatus.textContent;
}
