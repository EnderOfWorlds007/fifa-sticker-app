import {
  applyOcrBackendFromQuery,
  createPhotoCodeJob,
  ocrToken,
  photoOcrSide,
  recognitionBaseUrl,
  recognitionUrl,
  saveOcrBackendSettings,
  scannerMode,
  waitForPhotoCodeJob,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-eb043093e810";

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
scanButton?.addEventListener("click", () => input?.click());
input?.addEventListener("input", scanSelectedPhotos);
input?.addEventListener("change", scanSelectedPhotos);
copyButton?.addEventListener("click", async () => {
  if (!result.value) return;
  await navigator.clipboard?.writeText(result.value);
  status.textContent = "Codes copied.";
});

async function scanSelectedPhotos() {
  const files = [...(input?.files || [])];
  if (!files.length) return;
  await scanPhotos(files);
  if (input) input.value = "";
}

async function scanPhotos(files) {
  if (scannerMode() !== "back-card") {
    status.textContent = "This scanner route is not configured for card backs.";
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
  scanButton.classList.add("scanning");
  scanButton.setAttribute("aria-busy", "true");
  const selected = [...files];
  const recognizedPayloads = [];
  let lastError = null;
  try {
    for (let index = 0; index < selected.length; index += 1) {
      setScanProgress(`Scanning... ${index + 1}/${selected.length}`);
      try {
        const job = await createPhotoCodeJob(selected[index], { side: side.value || photoOcrSide() });
        const payload = await waitForPhotoCodeJob(job.job_id, {
          onStatus: (message) => { setScanProgress(message); },
        });
        recognizedPayloads.push(payload.result || payload);
      } catch (error) {
        lastError = error;
      }
    }
    renderResults(recognizedPayloads, { requestedCount: selected.length, lastError });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Photo scan failed.";
    codesList.replaceChildren(emptyRow("No result."));
  } finally {
    scanButton.disabled = false;
    scanButton.classList.remove("scanning");
    scanButton.setAttribute("aria-busy", "false");
    scanButton.textContent = "Use Photos";
  }
}

function setScanProgress(message) {
  scanButton.textContent = message;
  status.textContent = message;
}

function renderResults(payloads, options = {}) {
  const codes = payloads.flatMap((payload) => Array.isArray(payload?.codes) ? payload.codes : []);
  const text = payloads
    .map((payload) => String(payload?.grouped_text || (Array.isArray(payload?.codes) ? payload.codes.join(", ") : "")).trim())
    .filter(Boolean)
    .join("\n");
  result.value = text;
  copyButton.disabled = !text;
  const failedCount = Math.max(0, Number(options.requestedCount || payloads.length) - payloads.length);
  const failureText = failedCount ? ` ${failedCount} photo${failedCount === 1 ? "" : "s"} could not be read.` : "";
  status.textContent = codes.length
    ? `${codes.length} cards recognized.${failureText}`
    : options.lastError instanceof Error
      ? options.lastError.message
      : "No cards recognized in those photos.";
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
  if (scannerMode() === "back-card") {
    side.dataset.configuredMode = "back-card";
  }
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
    const selectedSide = side?.value || photoOcrSide();
    if (payload.expected_side && payload.expected_side !== selectedSide) {
      updateBackendStatus(`Backend is ${payload.expected_side} OCR, but this page is set to ${selectedSide}.`, { mirror: true });
      return;
    }
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
