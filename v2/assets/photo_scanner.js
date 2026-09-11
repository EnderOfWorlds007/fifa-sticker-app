import {
  applyOcrBackendFromQuery,
  createPhotoCodeJob,
  ocrToken,
  photoOcrSide,
  recognitionBaseUrl,
  recognitionUrl,
  saveBackInsigniaReviewLabel,
  saveOcrBackendSettings,
  savePhotoCodeReviewLabel,
  scannerMode,
  waitForPhotoCodeJob,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-6ac0f3b421de";
import {
  cancelTransaction,
  createTransaction,
  loadLedger,
  saveLedger,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-cf1e606d819a";
import { loadCollectionState } from "/fifa-sticker-app/v2/assets/collection_state.js?v=build-cf1e606d819a";
import { loadCachedInventoryPayload } from "/fifa-sticker-app/v2/assets/inventory_source.js?v=build-cf1e606d819a";
import {
  normalizeCollectionCodeList,
  splitCodesByAlbumStatus,
  splitCodesByResolvedCollectionModel,
} from "/fifa-sticker-app/v2/assets/collection_model.js?v=build-cf1e606d819a";
import { loadInventoryProjection } from "/fifa-sticker-app/v2/assets/inventory_projection.js?v=build-cf1e606d819a";
import { ensureActiveProfileId } from "/fifa-sticker-app/v2/assets/v2_profile.js?v=build-cf1e606d819a";
import { openCameraCapture } from "/fifa-sticker-app/v2/assets/camera_capture.js?v=build-cf1e606d819a";
import {
  classifyScannedCards,
  SCANNED_CARD_STATUS,
  summarizeScannedCardStatuses,
} from "/fifa-sticker-app/v2/assets/scan_card_status.js?v=build-cf1e606d819a";
import {
  receivedLinesForScan,
  SCAN_INSIGNIA_VARIANTS,
  scanReceiptSignature,
  summarizeScanInsignias,
} from "/fifa-sticker-app/v2/assets/scan_inventory.js?v=build-48d107a3be6c";

const input = document.querySelector("#photoScannerInput");
const side = document.querySelector("#photoScannerSide");
const scanButton = document.querySelector("#photoScannerButton");
const cameraButton = document.querySelector("#photoScannerCameraButton");
const cameraDiagnostics = document.querySelector("#photoCameraDiagnostics");
const copyButton = document.querySelector("#photoScannerCopyButton");
const status = document.querySelector("#photoScannerStatus");
const result = document.querySelector("#photoScannerResult");
const codesList = document.querySelector("#photoScannerCodes");
const collectionActions = document.querySelector("#photoCollectionActions");
const collectionSummary = document.querySelector("#photoCollectionSummary");
const addCollectionButton = document.querySelector("#photoAddCollectionButton");
const undoCollectionButton = document.querySelector("#photoUndoCollectionButton");
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
const reviewFinishButton = document.querySelector("#photoReviewFinish");
const reviewAllCorrectButton = document.querySelector("#photoReviewAllCorrect");
const reviewToolbar = document.querySelector("#photoReviewToolbar");
const reviewZoomOutButton = document.querySelector("#photoReviewZoomOut");
const reviewZoomInButton = document.querySelector("#photoReviewZoomIn");
const reviewOverviewButton = document.querySelector("#photoReviewOverview");
const toast = document.querySelector("#photoScannerToast");
const backendUrlInput = document.querySelector("[data-ocr-backend-url]");
const backendTokenInput = document.querySelector("[data-ocr-backend-token]");
const backendSaveButton = document.querySelector("[data-ocr-backend-save]");
const backendTestButton = document.querySelector("[data-ocr-backend-test]");
const backendStatus = document.querySelector("[data-ocr-backend-status]");
let photoReviewState = { imageUrl: "", slots: [], selectedSlotId: "" };
let photoReviewView = { focused: false, zoomFactor: 1 };
let latestScanCodes = [];
let latestCollectionSplit = { newCodes: [], inventoryCodes: [] };
let latestScanStatuses = [];
let latestInventoryProjection = null;
let latestAppliedScan = { signature: "", transactionId: "" };
let scanInFlight = false;
let latestCaptureSummary = "";

applyOcrBackendFromQuery();
initializeBackendSettings();
initializeSideSelection();
refreshScannerCollectionProjection().then(() => {
  latestCollectionSplit = splitCollectionCodes(latestScanCodes);
  latestScanStatuses = classifyCurrentScan();
  renderCollectionActions();
  renderRecognizedCodeRows();
});
scanButton?.addEventListener("click", () => input?.click());
cameraButton?.addEventListener("click", captureCameraPhoto);
input?.addEventListener("change", scanSelectedPhotos);
reviewImage?.addEventListener("load", () => drawPhotoReview());
reviewStage?.addEventListener("click", selectReviewSlotAtEvent);
reviewInspector?.addEventListener("submit", saveInspectorCode);
reviewNextButton?.addEventListener("click", selectNextReviewSlot);
reviewFinishButton?.addEventListener("click", finishReviewForNow);
reviewAllCorrectButton?.addEventListener("click", saveAllReviewSlotsCorrect);
reviewZoomOutButton?.addEventListener("click", () => adjustReviewZoom(1 / 1.35));
reviewZoomInButton?.addEventListener("click", () => adjustReviewZoom(1.35));
reviewOverviewButton?.addEventListener("click", showReviewOverview);
addCollectionButton?.addEventListener("click", addScanToCollection);
undoCollectionButton?.addEventListener("click", undoLastScanAdd);
window.addEventListener("resize", () => drawPhotoReview());
copyButton?.addEventListener("click", async () => {
  const text = copyTextForCodes(latestScanCodes);
  if (!text) return;
  await navigator.clipboard?.writeText(text);
  status.textContent = "Codes copied.";
  const originalText = copyButton.textContent;
  copyButton.textContent = "Copied";
  showToast("Codes copied.");
  window.setTimeout(() => { copyButton.textContent = originalText || "Copy codes"; }, 1600);
});

async function scanSelectedPhotos() {
  if (scanInFlight) return;
  const files = [...(input?.files || [])];
  if (!files.length) return;
  latestCaptureSummary = "";
  if (cameraDiagnostics) cameraDiagnostics.textContent = "Using photo-library image; in-app camera diagnostics do not apply.";
  scanInFlight = true;
  try {
    await scanPhotos(files);
  } finally {
    scanInFlight = false;
    if (input) input.value = "";
  }
}

async function captureCameraPhoto() {
  if (scanInFlight) return;
  const capture = await openCameraCapture({
    invoker: cameraButton,
    onFallback: () => input?.click(),
    onStatus: (message) => {
      if (cameraDiagnostics) cameraDiagnostics.textContent = message;
    },
  });
  if (!capture?.file) return;
  latestCaptureSummary = capture.summary;
  if (cameraDiagnostics) cameraDiagnostics.textContent = capture.summary;
  scanInFlight = true;
  try {
    await scanPhotos([capture.file]);
  } finally {
    scanInFlight = false;
  }
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
  if (cameraButton) cameraButton.disabled = true;
  copyButton.disabled = true;
  result.value = "";
  latestScanCodes = [];
  latestCollectionSplit = { newCodes: [], inventoryCodes: [] };
  latestScanStatuses = [];
  latestAppliedScan = { signature: "", transactionId: "" };
  renderCollectionActions();
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
        const resultPayload = payload.result || payload;
        resultPayload.upload_id ||= payload.upload_id || job.upload_id || "";
        resultPayload.job_id ||= payload.job_id || job.job_id || "";
        recognizedPayloads.push(resultPayload);
      } catch (error) {
        lastError = error;
      }
    }
    await renderResults(recognizedPayloads, { requestedCount: selected.length, lastError });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Photo scan failed.";
    codesList.replaceChildren(emptyRow("No result."));
  } finally {
    scanButton.disabled = false;
    if (cameraButton) cameraButton.disabled = false;
    scanButton.classList.remove("scanning");
    scanButton.setAttribute("aria-busy", "false");
    scanButton.textContent = "Use Photos";
  }
}

function setScanProgress(message) {
  scanButton.textContent = message;
  status.textContent = message;
}

async function renderResults(payloads, options = {}) {
  const fallbackCodes = payloads.flatMap((payload) => Array.isArray(payload?.codes) ? payload.codes : []);
  const reviewCodes = renderPhotoReview(payloads[0] || null);
  latestScanCodes = reviewCodes.length ? reviewCodes : normalizeCodeList(fallbackCodes);
  await refreshScannerCollectionProjection();
  latestCollectionSplit = splitCollectionCodes(latestScanCodes);
  latestScanStatuses = classifyCurrentScan();
  const text = copyTextForCodes(latestScanCodes);
  result.value = text;
  copyButton.disabled = !text;
  const failedCount = Math.max(0, Number(options.requestedCount || payloads.length) - payloads.length);
  const failureText = failedCount ? ` ${failedCount} photo${failedCount === 1 ? "" : "s"} could not be read.` : "";
  status.textContent = latestScanCodes.length
    ? `${latestScanCodes.length} cards recognized.${failureText}`
    : options.lastError instanceof Error
      ? options.lastError.message
      : "No cards recognized in those photos.";
  if (latestCaptureSummary && cameraDiagnostics) cameraDiagnostics.textContent = latestCaptureSummary;
  renderCollectionActions();
  renderRecognizedCodeRows();
}

function showPhotoReviewImage(imageUrl) {
  if (!reviewPanel || !reviewImage) return;
  if (photoReviewState.imageUrl) URL.revokeObjectURL(photoReviewState.imageUrl);
  photoReviewState = { imageUrl, slots: [], selectedSlotId: "" };
  photoReviewView = { focused: false, zoomFactor: 1 };
  reviewPanel.hidden = false;
  reviewImage.src = imageUrl;
  if (reviewSummary) reviewSummary.textContent = "Waiting for recognizer...";
  renderInspector();
  drawPhotoReview();
}

function renderPhotoReview(payload) {
  const overview = payload?.overview_map || payload?.overview?.map || payload?.scanner_overview || null;
  const slots = normalizeReviewSlots(overview?.slots || payload?.slots || [], payload);
  photoReviewState.slots = slots;
  const firstReviewSlot = reviewSlots()[0];
  photoReviewState.selectedSlotId = firstReviewSlot?.id || slots[0]?.id || "";
  renderReviewSummary(payload);
  renderReviewQueue();
  renderInspector();
  drawPhotoReview();
  return matchedReviewSlotCodes(slots);
}

function renderReviewSummary(payload = true) {
  if (!reviewSummary) return;
  const slots = photoReviewState.slots;
  const matched = slots.filter((slot) => slotStatus(slot) === "matched").length;
  const codeReviewCount = slots.filter((slot) => slotNeedsCodeReview(slot)).length;
  const insigniaReviewCount = slots.filter((slot) => slotNeedsInsigniaReview(slot)).length;
  const pendingSummary = reviewQueueSummary(codeReviewCount, insigniaReviewCount);
  reviewSummary.textContent = slots.length
    ? `${matched}/${slots.length} codes matched · ${pendingSummary}`
    : payload ? "No overlay geometry returned by backend." : "No result";
}

function normalizeReviewSlots(slots, payload = {}) {
  return slots
    .map((slot, index) => ({
      ...slot,
      id: String(slot.id || `slot-${index + 1}`),
      code: String(slot.code || "").toUpperCase(),
      original_code: String(slot.code || "").toUpperCase(),
      original_back_insignia_type: String(slot.back_insignia_type || "no_clue"),
      original_back_insignia_confidence: Number(slot.back_insignia_confidence || 0),
      insignia_review_status: "",
      code_candidates: normalizedCodeCandidates(slot),
      upload_id: String(payload?.upload_id || payload?.ocr?.upload_id || ""),
      job_id: String(payload?.job_id || ""),
      requested_side: String(payload?.ocr?.side || side?.value || photoOcrSide()),
      confidence: Number(slot.confidence ?? slot.best_score ?? 0),
      normalized_polygon: normalizedPolygon(slot.normalized_polygon || slot.polygon),
      normalized_code_anchor_box: normalizedPolygon(slot.normalized_code_anchor_box),
    }))
    .filter((slot) => (slot.normalized_polygon?.length || slot.normalized_code_anchor_box?.length) >= 4);
}

function matchedReviewSlotCodes(slots) {
  return normalizeCodeList(slots.filter((slot) => slot.code && slotStatus(slot) === "matched").map((slot) => slot.code));
}

function normalizedPolygon(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null)
    .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function drawPhotoReview() {
  if (!reviewCanvas || !reviewCtx || !reviewImage?.complete) return;
  const rect = { width: reviewStage?.clientWidth || reviewCanvas.clientWidth, height: reviewStage?.clientHeight || reviewCanvas.clientHeight };
  const scale = window.devicePixelRatio || 1;
  reviewCanvas.width = Math.max(1, Math.round(rect.width * scale));
  reviewCanvas.height = Math.max(1, Math.round(rect.height * scale));
  reviewCtx.setTransform(scale, 0, 0, scale, 0, 0);
  reviewCtx.clearRect(0, 0, rect.width, rect.height);
  const baseImageRect = photoImageRect(rect);
  const imageRect = reviewImageRect(baseImageRect, rect);
  const slots = photoReviewView.focused ? [selectedSlot()].filter(Boolean) : photoReviewState.slots;
  for (const slot of slots) drawReviewSlot(slot, imageRect);
  applyReviewImageTransform(baseImageRect, imageRect);
}

function reviewImageRect(baseImageRect, stageRect) {
  const slot = selectedSlot();
  if (!photoReviewView.focused || !slot) return baseImageRect;
  const polygon = slot.normalized_polygon?.length >= 4 ? slot.normalized_polygon : slot.normalized_code_anchor_box;
  const points = polygon.map(([x, y]) => [baseImageRect.x + x * baseImageRect.width, baseImageRect.y + y * baseImageRect.height]);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const width = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const height = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const fitScale = Math.min((stageRect.width * 0.82) / width, (stageRect.height * 0.82) / height, 10);
  const scale = Math.max(1, Math.min(12, fitScale * photoReviewView.zoomFactor));
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return {
    x: stageRect.width / 2 + (baseImageRect.x - centerX) * scale,
    y: stageRect.height / 2 + (baseImageRect.y - centerY) * scale,
    width: baseImageRect.width * scale,
    height: baseImageRect.height * scale,
  };
}

function applyReviewImageTransform(baseImageRect, imageRect) {
  if (!reviewImage) return;
  if (!photoReviewView.focused) {
    reviewImage.style.transform = "";
    reviewStage?.classList.remove("isFocused");
    return;
  }
  const scale = imageRect.width / Math.max(1, baseImageRect.width);
  const translateX = imageRect.x - baseImageRect.x * scale;
  const translateY = imageRect.y - baseImageRect.y * scale;
  reviewImage.style.transformOrigin = "0 0";
  reviewImage.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  reviewStage?.classList.add("isFocused");
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
  const bounds = reviewCanvas.getBoundingClientRect();
  const rect = { width: reviewStage?.clientWidth || reviewCanvas.clientWidth, height: reviewStage?.clientHeight || reviewCanvas.clientHeight };
  const imageRect = reviewImageRect(photoImageRect(rect), rect);
  const point = [event.clientX - bounds.left, event.clientY - bounds.top];
  for (let index = photoReviewState.slots.length - 1; index >= 0; index -= 1) {
    const slot = photoReviewState.slots[index];
    const polygon = (slot.normalized_polygon?.length >= 4 ? slot.normalized_polygon : slot.normalized_code_anchor_box)
      .map(([x, y]) => [imageRect.x + x * imageRect.width, imageRect.y + y * imageRect.height]);
    if (pointInPolygon(point, polygon)) {
      photoReviewState.selectedSlotId = slot.id;
      if (photoReviewView.focused) photoReviewView.zoomFactor = 1;
      renderInspector();
      renderReviewQueue();
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
  const identitySection = document.createElement("section");
  identitySection.className = "photoReviewDecision";
  const identityTitle = inspectorTitle("Card identity");
  const identityHelp = document.createElement("p");
  identityHelp.textContent = slotNeedsCodeReview(slot)
    ? "Confirm the code printed in the top pill, or correct it below."
    : "Code accepted by OCR. Edit it only if the printed code is different.";
  const form = document.createElement("form");
  form.className = "photoReviewInspectorForm";
  form.dataset.slotId = slot.id;
  const choices = document.createElement("div");
  choices.className = "photoReviewChoices";
  for (const candidate of slot.code_candidates) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.textContent = candidate.code;
    choice.addEventListener("click", () => {
      const field = form.elements.code;
      if (field) field.value = candidate.code;
    });
    choices.append(choice);
  }
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
  meta.textContent = `${slotStatus(slot)} · ${formatConfidence(slot.confidence).replace("confidence", "code OCR")} · ${geometryLabel(slot.geometry_status)}`;
  reviewInspector.replaceChildren(inspectorTitle(slot.code || "Unknown card"), meta);
  identitySection.append(identityTitle, identityHelp);
  if (choices.childElementCount) identitySection.append(choices);
  identitySection.append(form);
  form.append(input, save);
  reviewInspector.append(identitySection);
  if (isBackScanSlot(slot)) reviewInspector.append(insigniaDecisionSection(slot));
}

function insigniaDecisionSection(slot) {
  const section = document.createElement("section");
  section.className = "photoReviewDecision insigniaDecision";
  const title = inspectorTitle("Card-back insignia");
  const help = document.createElement("p");
  help.textContent = "Choose the centre mark. This choice is saved with this card and sent as OCR feedback.";
  const model = document.createElement("p");
  model.className = "insigniaModelResult";
  model.textContent = insigniaModelSummary(slot);
  const choices = document.createElement("div");
  choices.className = "insigniaDecisionButtons";
  const options = [
    { decision: "blue", variant: SCAN_INSIGNIA_VARIANTS.blue, label: "Blue", detail: "Official Licensed" },
    { decision: "green", variant: SCAN_INSIGNIA_VARIANTS.green, label: "Green", detail: "United Edition" },
    { decision: "skip", variant: "no_clue", label: "Can’t tell", detail: "Leave colour unknown" },
  ];
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.insigniaDecision = option.decision;
    button.classList.toggle("selected", selectedInsigniaDecision(slot) === option.decision);
    button.setAttribute("aria-pressed", String(selectedInsigniaDecision(slot) === option.decision));
    button.disabled = isCurrentScanApplied();
    button.innerHTML = `<strong>${option.label}</strong><span>${option.detail}</span>`;
    button.addEventListener("click", () => chooseInsignia(slot, option));
    choices.append(button);
  }
  section.append(title, help, model, choices);
  return section;
}

async function chooseInsignia(slot, option) {
  const previous = {
    back_insignia_type: slot.back_insignia_type,
    insignia_review_status: slot.insignia_review_status,
  };
  slot.back_insignia_type = option.variant;
  slot.insignia_review_status = option.decision;
  renderInspector();
  renderReviewQueue();
  renderReviewSummary();
  renderCollectionActions();
  drawPhotoReview();
  try {
    await persistInsigniaReviewLabel(slot, option.decision);
    status.textContent = `${slot.code || "Card"} saved as ${option.label}.`;
    showToast(`${option.label} back saved.`);
  } catch {
    status.textContent = `${slot.code || "Card"} will be saved as ${option.label}; OCR feedback could not upload.`;
    showToast("Saved for collection; feedback upload failed.");
  }
  if (previous.back_insignia_type !== slot.back_insignia_type || previous.insignia_review_status !== slot.insignia_review_status) {
    selectNextReviewSlot({ afterSlotId: slot.id });
  }
}

async function persistInsigniaReviewLabel(slot, decision) {
  if (!slot.upload_id) throw new Error("This scan has no upload id.");
  await saveBackInsigniaReviewLabel({
    id: `photo:${slot.upload_id}:${slot.id}`,
    decision,
    code: slot.code || "",
    predicted_type: slot.original_back_insignia_type || "no_clue",
    predicted_confidence: slot.original_back_insignia_confidence || 0,
  });
}

function selectedInsigniaDecision(slot) {
  if (slot.insignia_review_status) return slot.insignia_review_status;
  if (slot.back_insignia_type === SCAN_INSIGNIA_VARIANTS.blue) return "blue";
  if (slot.back_insignia_type === SCAN_INSIGNIA_VARIANTS.green) return "green";
  return "";
}

function insigniaModelSummary(slot) {
  const scores = slot.back_insignia_scores || {};
  const blue = Number(scores.standard_fifa_licensed || 0);
  const green = Number(scores.united_edition || 0);
  if (!blue && !green) return "Recognizer: no usable insignia crop.";
  const original = slot.original_back_insignia_type;
  const verdict = original === SCAN_INSIGNIA_VARIANTS.blue
    ? "Recognizer: Blue"
    : original === SCAN_INSIGNIA_VARIANTS.green
      ? "Recognizer: Green"
      : "Recognizer: no prediction";
  return `${verdict} · Blue ${Math.round(blue * 100)}% · Green ${Math.round(green * 100)}%`;
}

function geometryLabel(value) {
  if (value === "resolved") return "card boundary resolved";
  if (value === "orientation_uncertain") return "card orientation uncertain";
  if (value === "code_only") return "code only; no complete card crop";
  return value || "geometry unknown";
}

async function saveInspectorCode(event) {
  event.preventDefault();
  const slot = selectedSlot();
  const input = event.target?.elements?.code;
  if (!slot || !input) return;
  const correctedCode = String(input.value || "").trim().toUpperCase();
  const saveButton = event.target.querySelector("button[type='submit']");
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
  }
  try {
    await persistReviewLabel(slot, correctedCode);
    slot.code = correctedCode;
    slot.review_status = slot.code ? "matched" : "unreadable";
    slot.needs_user_help = !slot.code;
    slot.saved_review = true;
    updateResultFromReviewSlots();
    renderReviewQueue();
    renderReviewSummary();
    renderInspector();
    drawPhotoReview();
    status.textContent = slot.code ? `Saved correction ${slot.code}.` : "Saved unreadable card review.";
    showToast(slot.code ? `Saved ${slot.code}.` : "Saved unreadable card.");
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Review save failed.";
    showToast(status.textContent);
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "Set";
    }
  }
}

async function persistReviewLabel(slot, correctedCode) {
  if (!slot.upload_id) throw new Error("Review cannot be saved because this scan has no upload id.");
  await savePhotoCodeReviewLabel({
    upload_id: slot.upload_id,
    job_id: slot.job_id || "",
    slot_id: slot.id,
    decision: correctedCode ? "set_code" : "unreadable",
    corrected_code: correctedCode,
    original_code: slot.original_code || "",
    requested_side: slot.requested_side || side?.value || photoOcrSide(),
    confidence: slot.confidence || null,
    review_status: slotStatus(slot),
    geometry_status: slot.geometry_status || "",
    normalized_polygon: slot.normalized_polygon || [],
    normalized_code_anchor_box: slot.normalized_code_anchor_box || [],
  });
}

async function saveAllReviewSlotsCorrect() {
  const slots = photoReviewState.slots.filter((slot) => slot.code && slotNeedsCodeReview(slot));
  if (!slots.length) return;
  if (reviewAllCorrectButton) {
    reviewAllCorrectButton.disabled = true;
    reviewAllCorrectButton.textContent = "Saving...";
  }
  try {
    for (const slot of slots) {
      if (slot.saved_review && slot.review_status === "matched") continue;
      await persistReviewLabel(slot, slot.code);
      slot.review_status = "matched";
      slot.needs_user_help = false;
      slot.saved_review = true;
    }
    updateResultFromReviewSlots();
    renderReviewQueue();
    renderReviewSummary();
    renderInspector();
    drawPhotoReview();
    status.textContent = `Saved ${slots.length} correct card${slots.length === 1 ? "" : "s"}.`;
    showToast("All cards marked correct.");
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not save all cards.";
    showToast(status.textContent);
  } finally {
    if (reviewAllCorrectButton) {
      reviewAllCorrectButton.textContent = "Confirm shown codes";
      reviewAllCorrectButton.disabled = !photoReviewState.slots.some((slot) => slot.code && slotNeedsCodeReview(slot));
    }
  }
}

async function updateResultFromReviewSlots() {
  const codes = photoReviewState.slots.filter((slot) => slot.code && slotStatus(slot) === "matched").map((slot) => slot.code);
  latestScanCodes = normalizeCodeList(codes);
  await refreshScannerCollectionProjection();
  latestCollectionSplit = splitCollectionCodes(latestScanCodes);
  latestScanStatuses = classifyCurrentScan();
  result.value = copyTextForCodes(latestScanCodes);
  copyButton.disabled = !result.value;
  renderCollectionActions();
  renderRecognizedCodeRows();
}

function normalizeCodeList(codes) {
  return normalizeCollectionCodeList(codes);
}

function copyTextForCodes(codes) {
  return normalizeCodeList(codes).join("\n");
}

function splitCollectionCodes(codes) {
  if (latestInventoryProjection?.collectionModel) {
    return splitCodesByResolvedCollectionModel(codes, latestInventoryProjection.collectionModel);
  }
  return splitCodesByAlbumStatus(codes, {
    collectionState: loadCollectionState(),
    ledger: loadLedger(),
    inventoryPayload: loadCachedInventoryPayload(),
  });
}

function classifyCurrentScan() {
  return classifyScannedCards(latestScanCodes, latestInventoryProjection?.collectionModel || fallbackCollectionModel());
}

function fallbackCollectionModel() {
  const newCodes = new Set(latestCollectionSplit.newCodes);
  return {
    byCode: Object.fromEntries([...new Set(latestScanCodes)].map((code) => [code, {
      code,
      missing: newCodes.has(code),
      inventory: { availableToTradeQuantity: 0 },
    }])),
  };
}

async function refreshScannerCollectionProjection() {
  try {
    latestInventoryProjection = await loadInventoryProjection();
  } catch {
    latestInventoryProjection = null;
  }
  return latestInventoryProjection;
}

function renderCollectionActions() {
  if (!collectionActions || !collectionSummary || !addCollectionButton) return;
  const total = latestScanCodes.length;
  if (!total) {
    collectionActions.hidden = true;
    addCollectionButton.disabled = true;
    if (undoCollectionButton) {
      undoCollectionButton.hidden = true;
      undoCollectionButton.disabled = true;
    }
    collectionSummary.textContent = "";
    return;
  }
  const scanSummary = summarizeScannedCardStatuses(latestScanStatuses);
  const insignias = summarizeScanInsignias(currentScanReceivedLines());
  const insigniaSummary = [
    insignias.blue ? `${insignias.blue} blue` : "",
    insignias.green ? `${insignias.green} green` : "",
    insignias.unknown ? `${insignias.unknown} colour unknown` : "",
  ].filter(Boolean).join(" · ");
  const applied = isCurrentScanApplied();
  collectionActions.hidden = false;
  addCollectionButton.disabled = applied;
  addCollectionButton.textContent = applied ? "Added to collection" : "Add to collection";
  if (undoCollectionButton) {
    undoCollectionButton.hidden = !applied;
    undoCollectionButton.disabled = !applied;
  }
  collectionSummary.textContent = applied
    ? `${total} scanned card${total === 1 ? "" : "s"} already added · ${insigniaSummary} · Undo to add again`
    : `${scanSummary.newForAlbum} new for album · ${scanSummary.newTradingCards} new trading card${scanSummary.newTradingCards === 1 ? "" : "s"} · ${scanSummary.duplicateTradingCards} duplicate trading card${scanSummary.duplicateTradingCards === 1 ? "" : "s"} · ${insigniaSummary}`;
}

function renderRecognizedCodeRows() {
  codesList.replaceChildren(...(latestScanStatuses.length ? latestScanStatuses.map(codeRow) : [emptyRow("No recognized codes.")]));
}

function addScanToCollection() {
  const received = currentScanReceivedLines();
  const receivedCount = received.reduce((total, line) => total + line.quantity, 0);
  if (!receivedCount) return;
  if (isCurrentScanApplied()) {
    status.textContent = "This scan was already added. Use Undo before adding it again.";
    showToast("Scan already added.");
    renderCollectionActions();
    return;
  }
  const nextLedger = createTransaction(loadLedger(), { kind: "received", received, given: [] });
  const transactionId = nextLedger.transactions[nextLedger.transactions.length - 1]?.id || "";
  saveLedger(nextLedger);
  ensureActiveProfileId();
  latestAppliedScan = { signature: currentScanSignature(), transactionId };
  refreshScannerCollectionProjection().then(() => {
    latestCollectionSplit = splitCollectionCodes(latestScanCodes);
    renderCollectionActions();
    renderRecognizedCodeRows();
  });
  status.textContent = `Added ${receivedCount} scanned card${receivedCount === 1 ? "" : "s"} to collection activity with card-back colours.`;
  showToast("Scan added to collection.");
}

function undoLastScanAdd() {
  if (!isCurrentScanApplied()) {
    status.textContent = "There is no scan add to undo.";
    showToast("Nothing to undo.");
    renderCollectionActions();
    return;
  }
  try {
    saveLedger(cancelTransaction(loadLedger(), latestAppliedScan.transactionId));
  } catch {
    latestAppliedScan = { signature: "", transactionId: "" };
    status.textContent = "That scan add was already undone elsewhere.";
    showToast("Already undone.");
    renderCollectionActions();
    return;
  }
  latestAppliedScan = { signature: "", transactionId: "" };
  refreshScannerCollectionProjection().then(() => {
    latestCollectionSplit = splitCollectionCodes(latestScanCodes);
    renderCollectionActions();
    renderRecognizedCodeRows();
  });
  status.textContent = "Scan add undone. You can add this scan again.";
  showToast("Scan add undone.");
}

function isCurrentScanApplied() {
  return Boolean(latestAppliedScan.transactionId && latestAppliedScan.signature === currentScanSignature());
}

function currentScanSignature() {
  return scanReceiptSignature(currentScanReceivedLines());
}

function currentScanReceivedLines() {
  const slots = photoReviewState.slots.filter((slot) => slot.code && slotStatus(slot) === "matched");
  return receivedLinesForScan({ slots, fallbackCodes: latestScanCodes });
}

function renderReviewQueue() {
  const pending = reviewSlots();
  if (!reviewQueue || !reviewQueueText || !reviewNextButton) return;
  const codeCount = photoReviewState.slots.filter((slot) => slotNeedsCodeReview(slot)).length;
  const insigniaCount = photoReviewState.slots.filter((slot) => slotNeedsInsigniaReview(slot)).length;
  if (reviewAllCorrectButton) {
    reviewAllCorrectButton.hidden = codeCount === 0;
    reviewAllCorrectButton.disabled = codeCount === 0;
  }
  reviewQueue.hidden = pending.length === 0;
  reviewQueueText.textContent = reviewQueueSummary(codeCount, insigniaCount);
  reviewNextButton.disabled = pending.length === 0;
  reviewNextButton.textContent = photoReviewView.focused ? "Next review" : insigniaCount && !codeCount ? "Review backs" : "Start review";
  const focused = photoReviewView.focused && selectedSlot();
  const focusedIndex = focused ? pending.findIndex((slot) => slot.id === focused.id) : -1;
  if (focusedIndex >= 0) reviewQueueText.textContent = `Reviewing ${focusedIndex + 1} of ${pending.length} · ${focused.code || "Unknown card"} · ${slotReviewReason(focused)}`;
  if (reviewToolbar) reviewToolbar.hidden = !focused;
}

function selectNextReviewSlot(options = {}) {
  const pending = reviewSlots();
  if (!pending.length) {
    showReviewOverview();
    return;
  }
  const currentId = options.afterSlotId || photoReviewState.selectedSlotId;
  const currentPosition = photoReviewState.slots.findIndex((slot) => slot.id === currentId);
  const next = pending.find((slot) => photoReviewState.slots.indexOf(slot) > currentPosition) || pending[0];
  photoReviewState.selectedSlotId = next.id;
  photoReviewView = { focused: true, zoomFactor: 1 };
  renderInspector();
  renderReviewQueue();
  drawPhotoReview();
  reviewStage?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function adjustReviewZoom(multiplier) {
  if (!photoReviewView.focused) return;
  photoReviewView.zoomFactor = Math.max(0.55, Math.min(3, photoReviewView.zoomFactor * multiplier));
  drawPhotoReview();
}

function showReviewOverview() {
  photoReviewView = { focused: false, zoomFactor: 1 };
  renderReviewQueue();
  drawPhotoReview();
}

function finishReviewForNow() {
  showReviewOverview();
  const remaining = reviewSlots().length;
  status.textContent = remaining
    ? `Review paused with ${remaining} unresolved card${remaining === 1 ? "" : "s"}. Unresolved backs will be saved as colour unknown.`
    : "Review complete.";
  showToast(remaining ? "Review paused; unresolved backs stay unknown." : "Review complete.");
  collectionActions?.scrollIntoView({ behavior: "smooth", block: "center" });
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
  return slotNeedsCodeReview(slot) || slotNeedsInsigniaReview(slot);
}

function slotNeedsCodeReview(slot) {
  return Boolean(!slot.code || slot.needs_user_help || slotStatus(slot) !== "matched");
}

function slotNeedsInsigniaReview(slot) {
  if (!isBackScanSlot(slot)) return false;
  if (slot.insignia_review_status) return false;
  return ![SCAN_INSIGNIA_VARIANTS.blue, SCAN_INSIGNIA_VARIANTS.green].includes(slot.back_insignia_type);
}

function isBackScanSlot(slot) {
  return String(slot.requested_side || side?.value || photoOcrSide()).toLowerCase() === "back";
}

function reviewSlots() {
  return photoReviewState.slots.filter((slot) => slotNeedsReview(slot));
}

function reviewQueueSummary(codeCount, insigniaCount) {
  const parts = [];
  if (codeCount) parts.push(`${codeCount} code${codeCount === 1 ? "" : "s"}`);
  if (insigniaCount) parts.push(`${insigniaCount} card back${insigniaCount === 1 ? "" : "s"}`);
  return parts.length ? `${parts.join(" · ")} need review` : "review complete";
}

function slotReviewReason(slot) {
  const code = slotNeedsCodeReview(slot);
  const insignia = slotNeedsInsigniaReview(slot);
  if (code && insignia) return "check code and back";
  if (code) return "check code";
  return "choose back insignia";
}

function formatConfidence(value) {
  return value ? `${Math.round(value * 100)}% confidence` : "confidence unknown";
}

function normalizedCodeCandidates(slot) {
  const rawCandidates = [
    slot.code,
    ...(slot.code_candidates || []),
    ...(slot.candidates || []),
    ...(slot.alternatives || []),
    ...(slot.ocr_candidates || []),
  ];
  const seen = new Set();
  return rawCandidates
    .map((candidate) => typeof candidate === "string" ? { code: candidate } : candidate)
    .map((candidate) => ({
      code: String(candidate?.code || candidate?.label || candidate?.text || "").trim().toUpperCase(),
      score: Number(candidate?.score ?? candidate?.confidence ?? 0),
    }))
    .filter((candidate) => {
      if (!candidate.code || seen.has(candidate.code)) return false;
      seen.add(candidate.code);
      return true;
    })
    .slice(0, 6);
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => { toast.hidden = true; }, 2200);
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

function codeRow(scanCard) {
  const row = document.createElement("li");
  const label = document.createElement("span");
  row.className = `found ${scanCard.status}`;
  if (scanCard.status === SCANNED_CARD_STATUS.NEW_FOR_ALBUM) label.textContent = "New for album";
  if (scanCard.status === SCANNED_CARD_STATUS.NEW_TRADING_CARD) label.textContent = "New trading card · first spare";
  if (scanCard.status === SCANNED_CARD_STATUS.DUPLICATE_TRADING_CARD) {
    const prior = scanCard.priorTradingQuantity;
    label.textContent = `Duplicate trading card · ${prior} spare${prior === 1 ? "" : "s"} already available`;
  }
  const code = document.createElement("strong");
  code.textContent = scanCard.code;
  row.append(code, label);
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
    const selectedSide = side?.value || photoOcrSide();
    if (payload.expected_side && payload.expected_side !== selectedSide) {
      updateBackendStatus(`Backend is ${payload.expected_side} OCR, but this page is set to ${selectedSide}.`, { mirror: true });
      return;
    }
    let message = "OCR backend connected. No token is needed.";
    if (payload.ocr_auth_required) {
      message = ocrToken()
        ? "OCR backend connected. A token is saved on this phone."
        : "OCR backend connected. Enter the laptop OCR token below, then tap Save backend.";
    }
    updateBackendStatus(message, { mirror: true });
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
