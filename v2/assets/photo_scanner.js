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
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-ac122bda6c93";

const input = document.querySelector("#photoScannerInput");
const side = document.querySelector("#photoScannerSide");
const scanButton = document.querySelector("#photoScannerButton");
const copyButton = document.querySelector("#photoScannerCopyButton");
const status = document.querySelector("#photoScannerStatus");
const result = document.querySelector("#photoScannerResult");
const codesList = document.querySelector("#photoScannerCodes");
const reviewPanel = document.querySelector("#photoReviewPanel");
const reviewSummary = document.querySelector("#photoReviewSummary");
const reviewStage = document.querySelector("#photoReviewStage");
const reviewImage = document.querySelector("#photoReviewImage");
const reviewCanvas = document.querySelector("#photoReviewOverlay");
const reviewCtx = reviewCanvas?.getContext("2d");
const reviewInspector = document.querySelector("#photoReviewInspector");
const reviewQueue = document.querySelector("#photoReviewQueue");
const reviewQueueText = document.querySelector("#photoReviewQueueText");
const reviewNextButton = document.querySelector("#photoReviewNext");
const backendUrlInput = document.querySelector("[data-ocr-backend-url]");
const backendTokenInput = document.querySelector("[data-ocr-backend-token]");
const backendSaveButton = document.querySelector("[data-ocr-backend-save]");
const backendTestButton = document.querySelector("[data-ocr-backend-test]");
const backendStatus = document.querySelector("[data-ocr-backend-status]");
let photoReviewState = { imageUrl: "", slots: [], selectedSlotId: "" };

applyOcrBackendFromQuery();
initializeBackendSettings();
initializeSideSelection();
scanButton?.addEventListener("click", () => input?.click());
input?.addEventListener("input", scanSelectedPhotos);
input?.addEventListener("change", scanSelectedPhotos);
reviewImage?.addEventListener("load", () => drawPhotoReview());
reviewStage?.addEventListener("click", selectReviewSlotAtEvent);
reviewInspector?.addEventListener("submit", saveInspectorCode);
reviewNextButton?.addEventListener("click", selectNextReviewSlot);
window.addEventListener("resize", () => drawPhotoReview());
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
  const imageUrl = selected[0] ? URL.createObjectURL(selected[0]) : "";
  showPhotoReviewImage(imageUrl);
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
  renderPhotoReview(payloads[0] || null);
}

function showPhotoReviewImage(imageUrl) {
  if (!reviewPanel || !reviewImage) return;
  if (photoReviewState.imageUrl) URL.revokeObjectURL(photoReviewState.imageUrl);
  photoReviewState = { imageUrl, slots: [], selectedSlotId: "" };
  reviewPanel.hidden = false;
  reviewImage.src = imageUrl;
  if (reviewSummary) reviewSummary.textContent = "Waiting for recognizer...";
  renderInspector();
  drawPhotoReview();
}

function renderPhotoReview(payload) {
  const overview = payload?.overview_map || payload?.overview?.map || payload?.scanner_overview || null;
  const slots = normalizeReviewSlots(overview?.slots || payload?.slots || []);
  photoReviewState.slots = slots;
  const firstReviewSlot = slots.find((slot) => slotNeedsReview(slot));
  photoReviewState.selectedSlotId = firstReviewSlot?.id || slots[0]?.id || "";
  const matched = slots.filter((slot) => slotStatus(slot) === "matched").length;
  const uncertain = slots.filter((slot) => slotNeedsReview(slot)).length;
  if (reviewSummary) {
    reviewSummary.textContent = slots.length
      ? `${matched}/${slots.length} matched · ${uncertain} to review`
      : payload ? "No overlay geometry returned by backend." : "No result";
  }
  renderReviewQueue();
  renderInspector();
  drawPhotoReview();
}

function normalizeReviewSlots(slots) {
  return slots
    .map((slot, index) => ({
      ...slot,
      id: String(slot.id || `slot-${index + 1}`),
      code: String(slot.code || "").toUpperCase(),
      confidence: Number(slot.confidence ?? slot.best_score ?? 0),
      normalized_polygon: normalizedPolygon(slot.normalized_polygon || slot.polygon),
      normalized_code_anchor_box: normalizedPolygon(slot.normalized_code_anchor_box),
    }))
    .filter((slot) => (slot.normalized_polygon?.length || slot.normalized_code_anchor_box?.length) >= 4);
}

function normalizedPolygon(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null)
    .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function drawPhotoReview() {
  if (!reviewCanvas || !reviewCtx || !reviewImage?.complete) return;
  const rect = reviewCanvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  reviewCanvas.width = Math.max(1, Math.round(rect.width * scale));
  reviewCanvas.height = Math.max(1, Math.round(rect.height * scale));
  reviewCtx.setTransform(scale, 0, 0, scale, 0, 0);
  reviewCtx.clearRect(0, 0, rect.width, rect.height);
  const imageRect = photoImageRect(rect);
  for (const slot of photoReviewState.slots) drawReviewSlot(slot, imageRect);
}

function photoImageRect(rect) {
  const naturalWidth = reviewImage.naturalWidth || rect.width;
  const naturalHeight = reviewImage.naturalHeight || rect.height;
  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { x: (rect.width - width) / 2, y: (rect.height - height) / 2, width, height };
}

function drawReviewSlot(slot, imageRect) {
  const polygon = slot.normalized_polygon?.length >= 4 ? slot.normalized_polygon : slot.normalized_code_anchor_box;
  const points = polygon.map(([x, y]) => [imageRect.x + x * imageRect.width, imageRect.y + y * imageRect.height]);
  if (points.length < 4) return;
  const selected = slot.id === photoReviewState.selectedSlotId;
  const statusValue = slotNeedsReview(slot) ? "review" : slotStatus(slot);
  const color = statusValue === "matched" ? "#00c2a8" : statusValue === "review" ? "#ffb000" : "#ff4d4f";
  reviewCtx.save();
  reviewCtx.globalAlpha = statusValue === "matched" ? 0.22 : 0.18;
  reviewCtx.fillStyle = color;
  reviewCtx.beginPath();
  reviewCtx.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) reviewCtx.lineTo(point[0], point[1]);
  reviewCtx.closePath();
  reviewCtx.fill();
  reviewCtx.globalAlpha = 1;
  reviewCtx.lineWidth = selected ? 4 : 2.5;
  reviewCtx.strokeStyle = color;
  if (statusValue === "review") reviewCtx.setLineDash([6, 4]);
  reviewCtx.stroke();
  reviewCtx.setLineDash([]);
  const center = polygonCenter(points);
  const label = slot.code || (statusValue === "review" ? "Review" : "Unknown");
  reviewCtx.font = "800 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  reviewCtx.textAlign = "center";
  reviewCtx.fillStyle = "rgba(0, 0, 0, 0.74)";
  reviewCtx.fillRect(center[0] - 48, center[1] - 11, 96, 22);
  reviewCtx.fillStyle = "#fff";
  reviewCtx.fillText(label.slice(0, 12), center[0], center[1] + 5);
  reviewCtx.restore();
}

function selectReviewSlotAtEvent(event) {
  if (!photoReviewState.slots.length || !reviewCanvas) return;
  const rect = reviewCanvas.getBoundingClientRect();
  const imageRect = photoImageRect(rect);
  const point = [event.clientX - rect.left, event.clientY - rect.top];
  for (let index = photoReviewState.slots.length - 1; index >= 0; index -= 1) {
    const slot = photoReviewState.slots[index];
    const polygon = (slot.normalized_polygon?.length >= 4 ? slot.normalized_polygon : slot.normalized_code_anchor_box)
      .map(([x, y]) => [imageRect.x + x * imageRect.width, imageRect.y + y * imageRect.height]);
    if (pointInPolygon(point, polygon)) {
      photoReviewState.selectedSlotId = slot.id;
      renderInspector();
      drawPhotoReview();
      return;
    }
  }
}

function renderInspector() {
  if (!reviewInspector) return;
  const slot = selectedSlot();
  if (!slot) {
    reviewInspector.hidden = true;
    reviewInspector.replaceChildren();
    return;
  }
  reviewInspector.hidden = false;
  const form = document.createElement("form");
  form.className = "photoReviewInspectorForm";
  form.dataset.slotId = slot.id;
  const input = document.createElement("input");
  input.name = "code";
  input.placeholder = "BEL19";
  input.value = slot.code || "";
  input.autocapitalize = "characters";
  input.autocomplete = "off";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Set";
  const meta = document.createElement("p");
  meta.textContent = `${slotStatus(slot)} · ${formatConfidence(slot.confidence)} · ${slot.geometry_status || "geometry unknown"}`;
  reviewInspector.replaceChildren(inspectorTitle(slot.code || "Unknown card"), meta, form);
  form.append(input, save);
}

function saveInspectorCode(event) {
  event.preventDefault();
  const slot = selectedSlot();
  const input = event.target?.elements?.code;
  if (!slot || !input) return;
  slot.code = String(input.value || "").trim().toUpperCase();
  slot.review_status = slot.code ? "matched" : "unreadable";
  slot.needs_user_help = !slot.code;
  updateResultFromReviewSlots();
  renderReviewQueue();
  renderInspector();
  drawPhotoReview();
}

function updateResultFromReviewSlots() {
  const codes = photoReviewState.slots.filter((slot) => slot.code && slotStatus(slot) === "matched").map((slot) => slot.code);
  result.value = groupCodes(codes);
  copyButton.disabled = !result.value;
  codesList.replaceChildren(...(codes.length ? codes.map(codeRow) : [emptyRow("No recognized codes.")]));
}

function groupCodes(codes) {
  const groups = new Map();
  for (const code of codes) {
    const match = String(code).match(/^([A-Z]{2,4})(\d+[A-Z]?)$/);
    const key = match ? match[1] : "Cards";
    const value = match ? match[2] : code;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return [...groups.entries()].map(([team, values]) => `${team}: ${values.join(", ")}`).join("\n");
}

function renderReviewQueue() {
  const reviewSlots = photoReviewState.slots.filter((slot) => slotNeedsReview(slot));
  if (!reviewQueue || !reviewQueueText || !reviewNextButton) return;
  reviewQueue.hidden = reviewSlots.length === 0;
  reviewQueueText.textContent = `${reviewSlots.length} uncertain match${reviewSlots.length === 1 ? "" : "es"} to review`;
  reviewNextButton.disabled = reviewSlots.length === 0;
}

function selectNextReviewSlot() {
  const reviewSlots = photoReviewState.slots.filter((slot) => slotNeedsReview(slot));
  if (!reviewSlots.length) return;
  const currentIndex = reviewSlots.findIndex((slot) => slot.id === photoReviewState.selectedSlotId);
  photoReviewState.selectedSlotId = reviewSlots[(currentIndex + 1) % reviewSlots.length].id;
  renderInspector();
  drawPhotoReview();
}

function selectedSlot() {
  return photoReviewState.slots.find((slot) => slot.id === photoReviewState.selectedSlotId);
}

function slotStatus(slot) {
  if (slot.review_status) return slot.review_status;
  if (slot.state === "confirmed") return "matched";
  if (slot.state === "candidate") return "unconfirmed";
  return slot.code ? "matched" : "unreadable";
}

function slotNeedsReview(slot) {
  const statusValue = slotStatus(slot);
  return Boolean(slot.needs_user_help || statusValue !== "matched" || (slot.confidence > 0 && slot.confidence < 0.90));
}

function formatConfidence(value) {
  return value ? `${Math.round(value * 100)}% confidence` : "confidence unknown";
}

function inspectorTitle(text) {
  const node = document.createElement("strong");
  node.textContent = text;
  return node;
}

function polygonCenter(points) {
  const total = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [total[0] / points.length, total[1] / points.length];
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersects = ((yi > point[1]) !== (yj > point[1]))
      && (point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
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
