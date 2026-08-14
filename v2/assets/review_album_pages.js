import { applyOcrBackendFromQuery, ocrToken, recognitionBaseUrl, recognitionUrl } from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-932283f24986";

const status = document.querySelector("#albumReviewStatus");
const photoSelect = document.querySelector("#albumPhotoSelect");
const templateSelect = document.querySelector("#albumTemplateSelect");
const scaleInput = document.querySelector("#albumScale");
const offsetXInput = document.querySelector("#albumOffsetX");
const offsetYInput = document.querySelector("#albumOffsetY");
const rotateSelect = document.querySelector("#albumRotate");
const resetTransformButton = document.querySelector("#resetAlbumTransform");
const stage = document.querySelector("#albumStage");
const stageSurface = document.querySelector("#albumStageSurface");
const imageFrame = document.querySelector("#albumImageFrame");
const image = document.querySelector("#albumImage");
const overlay = document.querySelector("#albumOverlay");
const registrationBadge = document.querySelector("#albumRegistrationBadge");
const ctx = overlay.getContext("2d");
const slotTitle = document.querySelector("#albumSlotTitle");
const slotName = document.querySelector("#albumSlotName");
const slotProgress = document.querySelector("#albumSlotProgress");
const reviewQueue = document.querySelector("#albumReviewQueue");
const reviewQueueText = document.querySelector("#albumReviewQueueText");
const reviewLowConfidence = document.querySelector("#reviewLowConfidence");
const toggleViewRotationButton = document.querySelector("#toggleAlbumViewRotation");
const showProcessingButton = document.querySelector("#showAlbumProcessing");
const debugPanel = document.querySelector("#albumDebugPanel");
const debugSummary = document.querySelector("#albumDebugSummary");
const debugSteps = document.querySelector("#albumDebugSteps");
const closeProcessingButton = document.querySelector("#closeAlbumProcessing");
const reasonInput = document.querySelector("#albumReasonInput");
const slotList = document.querySelector("#albumSlotList");
const previousPhoto = document.querySelector("#previousPhoto");
const approvePhoto = document.querySelector("#approvePhoto");
const markBadPhoto = document.querySelector("#markBadPhoto");
const flipSlotsInput = document.querySelector("#albumFlipSlotsInput");
const flipTypedSlots = document.querySelector("#flipTypedSlots");
const markFilled = document.querySelector("#markFilled");
const markEmpty = document.querySelector("#markEmpty");
const markUnknown = document.querySelector("#markUnknown");
const previousSlot = document.querySelector("#previousSlot");
const nextSlot = document.querySelector("#nextSlot");

const ALBUM_REVIEW_PATH = ["", "api", "album-review"].join('/');
const ALBUM_REVIEW_LABELS_PATH = ["", "api", "album-review", "labels"].join('/');
const ALBUM_REVIEW_OCR_PREDICTIONS_PATH = ["", "api", "album-review", "ocr-predictions"].join('/');

let photos = [];
let templates = [];
let labels = {};
let predictions = {};
let currentPhoto = null;
let currentTemplate = null;
let currentSlotIndex = 0;
let swipeStart = null;
let suppressNextStageClick = false;
let ocrPredictionRequestId = 0;
let lowConfidenceReviewMode = false;
let viewRotated = false;
let viewRotationPinned = false;
let autoOpenedDebugPhotoId = null;
let imageLoadRequestId = 0;
let currentImageObjectUrl = "";
let debugObjectUrls = [];
let saveInFlight = false;
let activeSaveButton = null;
let saveDisabledStates = new Map();
const sampler = document.createElement("canvas");
const samplerCtx = sampler.getContext("2d", { willReadFrequently: true });
const compactLayoutMedia = window.matchMedia?.("(max-width: 900px), (hover: none) and (pointer: coarse)");

init();

async function init() {
  applyOcrBackendFromQuery();
  if (!recognitionBaseUrl()) {
    status.textContent = "Add ?ocr=https://your-laptop-backend to this URL, or save the laptop backend from Getting Started first.";
    return;
  }
  const response = await apiFetch(ALBUM_REVIEW_PATH, { cache: "no-store" });
  if (!response.ok) {
    status.textContent = "Could not load album review data.";
    return;
  }
  const payload = await response.json();
  photos = payload.photos || [];
  templates = payload.templates || [];
  labels = payload.latest_labels || {};
  populateSelectors();
  bindControls();
  selectInitial();
}

function populateSelectors() {
  photoSelect.replaceChildren(...photos.map((photo) => option(photo.id, `${String(photo.index).padStart(2, "0")} ${photo.source_name}`)));
  templateSelect.replaceChildren(option("", "Pick page"), ...templates.map((template) => option(template.template_id, `${template.catalog_prefix} · ${template.team}`)));
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function bindControls() {
  photoSelect.addEventListener("change", () => setPhoto(photoSelect.value));
  templateSelect.addEventListener("change", () => setTemplate(templateSelect.value));
  for (const input of [scaleInput, offsetXInput, offsetYInput, rotateSelect]) {
    input.addEventListener("input", handleTransformChanged);
    input.addEventListener("change", handleTransformChanged);
  }
  resetTransformButton.addEventListener("click", resetTransform);
  image.addEventListener("load", () => {
    updateReviewLayoutMode();
    seedPredictions();
    refreshOcrPredictions();
    resizeOverlay();
    draw();
    renderSlot();
  });
  window.addEventListener("resize", () => {
    updateReviewLayoutMode();
    if (!viewRotationPinned) {
      viewRotated = shouldRotatePhotoView();
      applyPhotoViewRotation();
    }
    resizeOverlay();
    draw();
  });
  markFilled.addEventListener("click", () => saveLabel("filled", markFilled));
  markEmpty.addEventListener("click", () => saveLabel("empty", markEmpty));
  markUnknown.addEventListener("click", () => saveLabel("unknown", markUnknown));
  reviewLowConfidence.addEventListener("click", startLowConfidenceReview);
  toggleViewRotationButton?.addEventListener("click", togglePhotoViewRotation);
  showProcessingButton?.addEventListener("click", openProcessingDebug);
  closeProcessingButton?.addEventListener("click", closeProcessingDebug);
  window.addEventListener("pagehide", () => {
    if (currentImageObjectUrl) URL.revokeObjectURL(currentImageObjectUrl);
    clearDebugObjectUrls();
  });
  previousPhoto.addEventListener("click", () => movePhoto(-1));
  approvePhoto.addEventListener("click", () => approveCurrentPhoto(approvePhoto));
  markBadPhoto.addEventListener("click", () => markCurrentPhotoBad(markBadPhoto));
  flipTypedSlots.addEventListener("click", flipTypedSlotList);
  flipSlotsInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") flipTypedSlotList();
  });
  previousSlot.addEventListener("click", () => moveSlot(-1));
  nextSlot.addEventListener("click", () => moveSlot(1));
  stageSurface.addEventListener("click", handleStageTap);
  stageSurface.addEventListener("pointerdown", handleStagePointerDown);
  stageSurface.addEventListener("pointerup", handleStagePointerUp);
  stageSurface.addEventListener("pointercancel", () => {
    swipeStart = null;
  });
  stageSurface.addEventListener("touchstart", handleStageTouchStart, { passive: true });
  stageSurface.addEventListener("touchend", handleStageTouchEnd, { passive: true });
  compactLayoutMedia?.addEventListener?.("change", () => {
    updateReviewLayoutMode();
    viewRotated = shouldRotatePhotoView();
    applyPhotoViewRotation();
    resizeOverlay();
    draw();
  });
  slotList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-slot-index]");
    if (!button) return;
    currentSlotIndex = Number(button.dataset.slotIndex);
    renderSlot();
    draw();
  });
}

function selectInitial() {
  if (!photos.length || !templates.length) {
    status.textContent = "No album photos or roster templates found.";
    return;
  }
  const requestedPhotoId = new URLSearchParams(window.location.search).get("photo");
  const initialPhoto = photos.find((photo) => photo.id === requestedPhotoId) || photos[0];
  setPhoto(initialPhoto.id);
  const guessed = guessTemplateForPhoto(initialPhoto);
  if (guessed) setTemplate(guessed);
}

function setPhoto(id) {
  currentPhoto = photos.find((photo) => photo.id === id) || photos[0] || null;
  if (!currentPhoto) return;
  lowConfidenceReviewMode = false;
  viewRotationPinned = false;
  updateReviewLayoutMode();
  photoSelect.value = currentPhoto.id;
  const guessed = guessTemplateForPhoto(currentPhoto);
  if (guessed && templateSelect.value !== guessed) {
    setTemplate(guessed, { keepPhoto: true });
  } else if (!guessed) {
    setTemplate("");
  }
  applyPhotoAlignmentHint();
  stage.classList.toggle("landscapePhoto", Number(currentPhoto.width || 0) > Number(currentPhoto.height || 0));
  viewRotated = shouldRotatePhotoView();
  applyPhotoViewRotation();
  loadCurrentPhotoImage(currentPhoto);
  currentSlotIndex = 0;
  renderSlot();
  updatePhotoNavControls();
}

async function loadCurrentPhotoImage(photo) {
  const requestId = ++imageLoadRequestId;
  image.removeAttribute("src");
  status.textContent = `${photo.source_name || "Photo"} · loading image`;
  try {
    const objectUrl = await loadBackendImageObjectUrl(photo.url);
    if (requestId !== imageLoadRequestId || currentPhoto?.id !== photo.id) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    if (currentImageObjectUrl) URL.revokeObjectURL(currentImageObjectUrl);
    currentImageObjectUrl = objectUrl;
    image.src = objectUrl;
  } catch {
    if (requestId !== imageLoadRequestId || currentPhoto?.id !== photo.id) return;
    status.textContent = `Could not load ${photo.source_name || "photo"} from the recognition backend.`;
  }
}

function setTemplate(id, _options = {}) {
  currentTemplate = templates.find((template) => template.template_id === id) || null;
  templateSelect.value = currentTemplate?.template_id || "";
  lowConfidenceReviewMode = false;
  if (!currentTemplate) {
    status.textContent = `${currentPhoto?.source_name || "Photo"} · pick the roster page`;
    slotTitle.textContent = "Pick page";
    slotName.textContent = "Select the page shown in the photo before reviewing slots.";
    slotProgress.textContent = "-";
    slotList.replaceChildren();
    renderReviewQueue();
    draw();
    return;
  }
  currentSlotIndex = Math.min(currentSlotIndex, currentTemplate.slots.length - 1);
  seedPredictions();
  refreshOcrPredictions();
  renderSlot();
  draw();
}

function guessTemplateForPhoto(photo) {
  if (photo.template_hint) return photo.template_hint;
  const haystack = `${photo.source_name} ${photo.id}`.toLowerCase();
  const hit = templates.find((template) => haystack.includes(String(template.team || "").toLowerCase()) || haystack.includes(String(template.catalog_prefix || "").toLowerCase()));
  return hit?.template_id || null;
}

function shouldRotatePhotoView() {
  if (!currentPhoto) return false;
  if (isCompactReviewLayout()) return false;
  const isLandscape = Number(currentPhoto.width || 0) > Number(currentPhoto.height || 0);
  const isPhonePortrait = window.matchMedia?.("(max-width: 720px) and (orientation: portrait)")?.matches;
  return Boolean(isLandscape && isPhonePortrait);
}

function isCompactReviewLayout() {
  return Boolean(compactLayoutMedia?.matches || window.innerWidth <= 900);
}

function updateReviewLayoutMode() {
  const compact = isCompactReviewLayout();
  document.body.classList.toggle("albumReviewCompact", compact);
  if (!compact) {
    document.documentElement.style.removeProperty("--album-review-tray-height");
    return;
  }
  const tray = document.querySelector(".albumSlotPanel");
  const trayHeight = Math.ceil(tray?.getBoundingClientRect?.().height || 96);
  document.documentElement.style.setProperty("--album-review-tray-height", `${Math.max(72, trayHeight)}px`);
}

function applyPhotoViewRotation() {
  stage.classList.toggle("viewRotated", viewRotated);
  if (!toggleViewRotationButton) return;
  toggleViewRotationButton.textContent = viewRotated ? "Unrotate view" : "Rotate view";
  toggleViewRotationButton.setAttribute("aria-pressed", viewRotated ? "true" : "false");
}

function togglePhotoViewRotation() {
  viewRotationPinned = true;
  viewRotated = !viewRotated;
  applyPhotoViewRotation();
  requestAnimationFrame(() => {
    resizeOverlay();
    draw();
  });
}

function resetTransform() {
  applyPhotoAlignmentHint();
  handleTransformChanged();
}

function applyPhotoAlignmentHint() {
  const hint = currentPhoto?.alignment_hint || {};
  scaleInput.value = "1";
  offsetXInput.value = "0";
  offsetYInput.value = "0";
  rotateSelect.value = "0";
  if (Number.isFinite(Number(hint.scale))) scaleInput.value = String(hint.scale);
  if (Number.isFinite(Number(hint.offset_x))) offsetXInput.value = String(hint.offset_x);
  if (Number.isFinite(Number(hint.offset_y))) offsetYInput.value = String(hint.offset_y);
  if ([0, 90, 180, 270].includes(Number(hint.rotate_degrees))) rotateSelect.value = String(hint.rotate_degrees);
}

function handleTransformChanged() {
  if (currentPhoto && currentTemplate) {
    for (const slot of currentTemplate.slots) {
      const key = labelKey(slot);
      if (!labels[key]) delete predictions[key];
    }
  }
  seedPredictions();
  renderSlot();
  draw();
}

function resizeOverlay() {
  const rect = updateImageFrameLayout();
  overlay.width = Math.max(1, Math.round(rect.width * window.devicePixelRatio));
  overlay.height = Math.max(1, Math.round(rect.height * window.devicePixelRatio));
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function draw() {
  resizeOverlay();
  const rect = surfaceRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!currentTemplate?.slots?.length || !image.complete) return;
  if (registrationIsInvalid()) {
    drawOverlayTrustMessage(rect, "Alignment invalid - open Processing");
    return;
  }
  if (overlayTrustLevel() === "untrusted") {
    drawOverlayTrustMessage(rect, "Overlay untrusted - open Processing");
    return;
  }
  const imageRect = drawnImageRect(rect);
  for (let i = 0; i < currentTemplate.slots.length; i++) {
    drawSlot(currentTemplate.slots[i], i, imageRect);
  }
}

function registrationIsInvalid() {
  return currentPhoto?.focus?.registration?.state === "invalid";
}

function overlayTrustLevel() {
  return currentPhoto?.focus?.overlay_trust?.level || currentPhoto?.focus?.registration?.overlay_trust?.level || "trusted";
}

function overlayTrustReasons() {
  return currentPhoto?.focus?.overlay_trust?.reasons || currentPhoto?.focus?.registration?.overlay_trust?.reasons || [];
}

function drawOverlayTrustMessage(rect, text) {
  ctx.font = "800 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const width = Math.min(rect.width - 24, Math.max(260, ctx.measureText(text).width + 28));
  ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
  ctx.fillRect((rect.width - width) / 2, Math.max(20, rect.height * 0.08), width, 42);
  ctx.strokeStyle = "#f1be59";
  ctx.lineWidth = 2;
  ctx.strokeRect((rect.width - width) / 2, Math.max(20, rect.height * 0.08), width, 42);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, rect.width / 2, Math.max(20, rect.height * 0.08) + 21);
}

function surfaceRect() {
  return {
    width: Math.max(1, imageFrame.clientWidth),
    height: Math.max(1, imageFrame.clientHeight),
  };
}

function updateImageFrameLayout() {
  updateReviewLayoutMode();
  const stageWidth = Math.max(1, stageSurface.clientWidth);
  const stageHeight = Math.max(1, stageSurface.clientHeight);
  const naturalW = image.naturalWidth || Number(currentPhoto?.width || 0) || 1;
  const naturalH = image.naturalHeight || Number(currentPhoto?.height || 0) || 1;
  const scale = Math.min(stageWidth / naturalW, stageHeight / naturalH);
  const width = Math.max(1, naturalW * scale);
  const height = Math.max(1, naturalH * scale);
  const x = (stageWidth - width) / 2;
  const y = isCompactReviewLayout() ? 0 : (stageHeight - height) / 2;
  imageFrame.style.left = `${x}px`;
  imageFrame.style.top = `${y}px`;
  imageFrame.style.width = `${width}px`;
  imageFrame.style.height = `${height}px`;
  return {
    width,
    height,
  };
}

function drawnImageRect(rect) {
  return {
    x: 0,
    y: 0,
    width: rect.width,
    height: rect.height,
  };
}

function drawSlot(slot, index, imageRect) {
  const points = slotPolygon(slot).map((point) => transformPoint(point[0], point[1], imageRect));
  const key = labelKey(slot);
  const saved = labels[key];
  const state = slotState(slot);
  const review = slotReviewRequired(slot);
  const active = index === currentSlotIndex;
  const trust = overlayTrustLevel();
  const color =
    trust === "diagnostic"
      ? "#f1be59"
      : state === "filled"
        ? "#28d17c"
        : state === "empty"
          ? "#63a9ff"
          : state === "unknown"
            ? "#f1be59"
            : "#ffffff";
  ctx.beginPath();
  points.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
  ctx.closePath();
  ctx.lineWidth = active ? 4 : review || trust === "diagnostic" ? 3 : 2;
  ctx.strokeStyle = color;
  ctx.globalAlpha = trust === "diagnostic" ? 0.72 : 1;
  ctx.setLineDash(trust === "diagnostic" ? [7, 5] : review ? [6, 4] : state === "empty" ? [8, 5] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  if (active) {
    ctx.fillStyle = trust === "diagnostic" ? "rgba(241, 190, 89, 0.12)" : "rgba(0, 194, 168, 0.16)";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const center = points.reduce((acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }), { x: 0, y: 0 });
  const stateLetter = state === "filled" ? "F" : state === "empty" ? "E" : "?";
  const label = `${slot.ordinal} ${stateLetter}${review || trust === "diagnostic" ? " !" : ""}`;
  const labelWidth = Math.max(50, ctx.measureText(label).width + 18);
  ctx.fillStyle = trust === "diagnostic" ? "rgba(36, 28, 15, 0.74)" : saved ? "rgba(0, 0, 0, 0.86)" : "rgba(0, 0, 0, 0.64)";
  ctx.fillRect(center.x - labelWidth / 2, center.y - 15, labelWidth, 30);
  ctx.fillStyle = trust === "diagnostic" ? "#ffe2a3" : "#fff";
  ctx.font = "700 14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, center.x, center.y);
}

function transformPoint(x, y, imageRect) {
  let px = x - 0.5;
  let py = y - 0.5;
  const angle = Number(rotateSelect.value || 0);
  if (angle === 90) [px, py] = [py, -px];
  if (angle === 180) [px, py] = [-px, -py];
  if (angle === 270) [px, py] = [-py, px];
  const scale = Number(scaleInput.value || 1);
  const scaleX = Number(currentPhoto?.alignment_hint?.scale_x || scale);
  const scaleY = Number(currentPhoto?.alignment_hint?.scale_y || scale);
  const dx = Number(offsetXInput.value || 0);
  const dy = Number(offsetYInput.value || 0);
  return {
    x: imageRect.x + (0.5 + px * scaleX + dx) * imageRect.width,
    y: imageRect.y + (0.5 + py * scaleY + dy) * imageRect.height,
  };
}

function renderSlot() {
  if (!currentPhoto || !currentTemplate?.slots?.length) {
    if (currentPhoto) status.textContent = `${currentPhoto.source_name} · pick the roster page`;
    renderRegistrationBadge();
    renderProcessingDebugControls();
    return;
  }
  const slot = currentTemplate.slots[currentSlotIndex];
  const saved = labels[labelKey(slot)];
  const state = slotState(slot);
  const reviewed = currentTemplate.slots.filter((item) => labels[labelKey(item)]?.label && labels[labelKey(item)]?.label !== "skip").length;
  const registrationState = currentPhoto.focus?.registration?.state || (currentPhoto.focus ? "needs_review" : "raw");
  const trust = overlayTrustLevel();
  const registrationText = trust !== "trusted" ? `${trust} overlay` : registrationState === "valid" ? "registered" : registrationState.replaceAll("_", " ");
  status.textContent = `${currentPhoto.source_name} · ${currentTemplate.page_label} · ${registrationText}`;
  slotTitle.textContent = `${slot.code} · ${state}`;
  slotName.textContent = `${slot.name} · ${slot.team}${saved ? " · reviewed" : " · predicted"}`;
  slotProgress.textContent = `${reviewed}/${currentTemplate.slots.length} labelled`;
  reasonInput.value = saved?.reason || "";
  updatePhotoNavControls();
  renderRegistrationBadge();
  renderReviewQueue();
  renderProcessingDebugControls();
  renderSlotList();
}

function renderRegistrationBadge() {
  if (!registrationBadge) return;
  if (!currentPhoto) {
    registrationBadge.hidden = true;
    return;
  }
  const registration = currentPhoto.focus?.registration;
  const state = registration?.state || (currentPhoto.focus ? "needs_review" : "raw");
  const trust = overlayTrustLevel();
  const version = currentPhoto.focus?.registration?.version || "raw";
  const label = currentTemplate?.catalog_prefix || currentPhoto.template_hint?.split("_")[0]?.toUpperCase() || "?";
  registrationBadge.hidden = false;
  registrationBadge.dataset.state = state;
  registrationBadge.dataset.trust = trust;
  registrationBadge.textContent = `${currentPhoto.source_name} · ${label} · ${version} · ${trust === "trusted" ? state.replaceAll("_", " ") : trust}`;
}

function renderProcessingDebugControls() {
  if (!showProcessingButton) return;
  const registrationState = currentPhoto?.focus?.registration?.state || (currentPhoto?.focus ? "needs_review" : "raw");
  const trust = overlayTrustLevel();
  const hasSteps = Array.isArray(currentPhoto?.focus?.debug_steps) && currentPhoto.focus.debug_steps.length > 0;
  showProcessingButton.hidden = !hasSteps;
  if (!showProcessingButton.hidden) {
    showProcessingButton.textContent = trust === "untrusted" ? "Processing: untrusted" : registrationState === "invalid" ? "Processing: invalid" : "Processing";
  }
  if ((registrationState === "invalid" || trust === "untrusted") && currentPhoto?.id && autoOpenedDebugPhotoId !== currentPhoto.id) {
    autoOpenedDebugPhotoId = currentPhoto.id;
    requestAnimationFrame(openProcessingDebug);
  }
}

function openProcessingDebug() {
  if (!debugPanel || !debugSummary || !debugSteps || !currentPhoto) return;
  clearDebugObjectUrls();
  const steps = currentPhoto.focus?.debug_steps || [];
  if (!steps.length) return;
  const registration = currentPhoto.focus?.registration || {};
  const trust = overlayTrustLevel();
  const trustReasons = overlayTrustReasons();
  debugSummary.textContent = `${currentPhoto.source_name} · ${registration.state || "unknown"} · ${trust} · ${trustReasons.join(", ") || (registration.warnings || []).join(", ") || "no warnings"}`;
  debugSteps.replaceChildren(
    ...steps.map((step, index) => {
      const card = document.createElement("article");
      const heading = document.createElement("div");
      const title = document.createElement("h2");
      const outcome = document.createElement("p");
      const serializedOutcome = typeof step.outcome === "string" ? step.outcome : JSON.stringify(step.outcome || {}, null, 2);
      title.textContent = `${String(index + 1).padStart(2, "0")} ${step.title || "Step"}`;
      heading.className = "albumDebugStepHeader";
      heading.append(title);
      if (step.kind === "json" || serializedOutcome) {
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.textContent = "Copy";
        copyButton.addEventListener("click", () => copyProcessingText(copyButton, serializedOutcome));
        heading.append(copyButton);
      }
      outcome.textContent = serializedOutcome;
      card.append(heading);
      if (step.kind === "image" && step.url) {
        const image = document.createElement("img");
        image.alt = step.title || "Processing step";
        loadBackendImageObjectUrl(step.url)
          .then((objectUrl) => {
            debugObjectUrls.push(objectUrl);
            image.src = objectUrl;
          })
          .catch(() => {
            const error = document.createElement("p");
            error.textContent = "Could not load this debug image from the recognition backend.";
            image.replaceWith(error);
          });
        card.append(image);
        card.append(outcome);
      } else if (step.kind === "json") {
        const pre = document.createElement("pre");
        pre.textContent = serializedOutcome;
        card.append(pre);
      } else {
        card.append(outcome);
      }
      return card;
    }),
  );
  debugPanel.hidden = false;
}

async function copyProcessingText(button, text) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.append(scratch);
    scratch.select();
    document.execCommand("copy");
    scratch.remove();
    button.textContent = "Copied";
  }
  window.setTimeout(() => {
    button.textContent = original || "Copy";
  }, 1200);
}

function closeProcessingDebug() {
  if (debugPanel) debugPanel.hidden = true;
  clearDebugObjectUrls();
}

function renderSlotList() {
  slotList.replaceChildren(
    ...currentTemplate.slots.map((slot, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const saved = labels[labelKey(slot)];
      const state = slotState(slot);
      const review = slotReviewRequired(slot);
      button.type = "button";
      button.dataset.slotIndex = String(index);
      button.className = [index === currentSlotIndex ? "active" : "", state, saved ? "reviewed" : "predicted", review ? "needsReview" : ""].filter(Boolean).join(" ");
      button.innerHTML = `<strong>${slot.code}</strong><span>${saved ? state : review ? `review: ${state}` : `guess: ${state}`}</span>`;
      item.append(button);
      return item;
    }),
  );
}

function renderReviewQueue() {
  if (!reviewQueue || !reviewQueueText || !reviewLowConfidence) return;
  const slots = reviewRequiredSlots();
  const remaining = slots.filter((slot) => !labels[labelKey(slot)]).length;
  const total = slots.length;
  if (!currentTemplate?.slots?.length || total === 0) {
    reviewQueue.hidden = true;
    lowConfidenceReviewMode = false;
    return;
  }
  reviewQueue.hidden = false;
  reviewQueue.dataset.active = lowConfidenceReviewMode ? "true" : "false";
  reviewQueueText.textContent = remaining > 0 ? `${remaining} uncertain slot${remaining === 1 ? "" : "s"} to validate` : `${total} uncertain slot${total === 1 ? "" : "s"} reviewed`;
  reviewLowConfidence.disabled = remaining === 0;
  reviewLowConfidence.textContent = lowConfidenceReviewMode ? "Reviewing" : "Review uncertain";
}

function startLowConfidenceReview() {
  lowConfidenceReviewMode = true;
  const next = firstReviewSlotIndex();
  if (next >= 0) {
    currentSlotIndex = next;
    renderSlot();
    draw();
  } else {
    renderReviewQueue();
  }
}

async function saveLabel(label, button = null) {
  if (saveInFlight || !currentPhoto || !currentTemplate?.slots?.length) return;
  const slot = currentTemplate.slots[currentSlotIndex];
  await withSavingState(button, () => saveSlotLabel(slot, label, { reason: reasonInput.value.trim(), advance: true }));
}

async function saveSlotLabel(slot, label, options = {}) {
  const payload = {
    photo_id: currentPhoto.id,
    source_name: currentPhoto.source_name,
    template_id: currentTemplate.template_id,
    slot_id: slot.id,
    code: slot.code,
    name: slot.name,
    team: slot.team,
    label,
    reason: options.reason || "",
    transform: currentTransform(),
  };
  const response = await apiFetch(ALBUM_REVIEW_LABELS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    status.textContent = "Save failed. Try again.";
    return false;
  }
  labels[labelKey(slot)] = payload;
  renderSlot();
  draw();
  if (options.advance) {
    if (lowConfidenceReviewMode) {
      const next = nextReviewSlotIndex();
      if (next >= 0) {
        currentSlotIndex = next;
        renderSlot();
        draw();
      } else {
        lowConfidenceReviewMode = false;
        renderSlot();
      }
    } else {
      moveSlot(1);
    }
  }
  return true;
}

function currentTransform() {
  return {
    scale: Number(scaleInput.value || 1),
    scale_x: Number(currentPhoto?.alignment_hint?.scale_x || scaleInput.value || 1),
    scale_y: Number(currentPhoto?.alignment_hint?.scale_y || scaleInput.value || 1),
    offset_x: Number(offsetXInput.value || 0),
    offset_y: Number(offsetYInput.value || 0),
    rotate_degrees: Number(rotateSelect.value || 0),
  };
}

function moveSlot(delta) {
  if (!currentTemplate?.slots?.length) return;
  currentSlotIndex = Math.max(0, Math.min(currentTemplate.slots.length - 1, currentSlotIndex + delta));
  renderSlot();
  draw();
}

function labelKey(slot) {
  return `${currentPhoto?.id}:${currentTemplate?.template_id}:${slot.id}`;
}

function slotState(slot) {
  return labels[labelKey(slot)]?.label || predictions[labelKey(slot)] || "unknown";
}

function slotPrediction(slot) {
  return currentPhoto?.slot_predictions?.[currentTemplate?.template_id]?.[slot.id] || null;
}

function slotReviewRequired(slot) {
  const prediction = slotPrediction(slot);
  return !labels[labelKey(slot)] && Boolean(prediction?.review_required);
}

function reviewRequiredSlots() {
  if (!currentTemplate?.slots?.length) return [];
  return currentTemplate.slots.filter((slot) => Boolean(slotPrediction(slot)?.review_required));
}

function nextReviewSlotIndex() {
  if (!currentTemplate?.slots?.length) return -1;
  const slots = currentTemplate.slots;
  for (let offset = 1; offset <= slots.length; offset++) {
    const index = (currentSlotIndex + offset) % slots.length;
    if (slotReviewRequired(slots[index])) return index;
  }
  return -1;
}

function firstReviewSlotIndex() {
  if (!currentTemplate?.slots?.length) return -1;
  return currentTemplate.slots.findIndex((slot) => slotReviewRequired(slot));
}

function slotPolygon(slot) {
  return currentPhoto?.slot_polygon_overrides?.[String(slot.ordinal)] || slot.polygon;
}

function flippedState(state) {
  if (state === "filled") return "empty";
  if (state === "empty") return "filled";
  return "filled";
}

async function flipSlot(index) {
  if (saveInFlight || !currentTemplate?.slots?.[index]) return;
  currentSlotIndex = index;
  const slot = currentTemplate.slots[index];
  await withSavingState(null, () => saveSlotLabel(slot, flippedState(slotState(slot)), { reason: "flip" }));
}

async function approveCurrentPhoto(button = null) {
  if (saveInFlight || !currentTemplate?.slots?.length) return;
  await withSavingState(button, async () => {
    for (const slot of currentTemplate.slots) {
      await saveSlotLabel(slot, slotState(slot), { reason: "photo_good" });
    }
    movePhoto(1);
  });
}

async function markCurrentPhotoBad(button = null) {
  if (saveInFlight || !currentTemplate?.slots?.length) return;
  await withSavingState(button, async () => {
    for (const slot of currentTemplate.slots) {
      await saveSlotLabel(slot, "unknown", { reason: "photo_bad" });
    }
    movePhoto(1);
  });
}

async function withSavingState(button, task) {
  if (saveInFlight) return false;
  saveInFlight = true;
  activeSaveButton = button || null;
  updateSavingControls();
  const originalLabel = button?.textContent;
  if (button) {
    button.dataset.originalLabel = originalLabel || "";
    button.textContent = "Saving";
  }
  try {
    return await task();
  } finally {
    saveInFlight = false;
    if (button) {
      button.textContent = button.dataset.originalLabel || originalLabel || "";
      delete button.dataset.originalLabel;
    }
    activeSaveButton = null;
    restoreSavingControls();
    updateSavingControls();
  }
}

function updateSavingControls() {
  const controls = [markFilled, markEmpty, markUnknown, approvePhoto, markBadPhoto, flipTypedSlots, previousSlot, nextSlot, previousPhoto];
  for (const control of controls) {
    if (!control) continue;
    if (saveInFlight && !saveDisabledStates.has(control)) saveDisabledStates.set(control, control.disabled);
    control.disabled = saveInFlight || Boolean(saveDisabledStates.get(control));
    control.classList.toggle("saving", saveInFlight && control === activeSaveButton);
    control.setAttribute("aria-busy", saveInFlight && control === activeSaveButton ? "true" : "false");
  }
  slotList?.classList.toggle("saving", saveInFlight);
}

function restoreSavingControls() {
  for (const [control, disabled] of saveDisabledStates.entries()) {
    control.disabled = disabled;
    control.classList.remove("saving");
    control.setAttribute("aria-busy", "false");
  }
  saveDisabledStates = new Map();
  updatePhotoNavControls();
}

function movePhoto(delta) {
  if (!photos.length) return;
  const index = Math.max(0, Math.min(photos.length - 1, photos.findIndex((photo) => photo.id === currentPhoto.id) + delta));
  setPhoto(photos[index].id);
}

function updatePhotoNavControls() {
  const index = currentPhoto ? photos.findIndex((photo) => photo.id === currentPhoto.id) : -1;
  previousPhoto.disabled = index <= 0;
}

function handleStagePointerDown(event) {
  rememberSwipeStart(event.clientX, event.clientY);
}

function handleStagePointerUp(event) {
  finishSwipe(event.clientX, event.clientY);
}

function handleStageTouchStart(event) {
  const touch = event.changedTouches[0];
  if (touch) rememberSwipeStart(touch.clientX, touch.clientY);
}

function handleStageTouchEnd(event) {
  const touch = event.changedTouches[0];
  if (touch) finishSwipe(touch.clientX, touch.clientY);
}

function rememberSwipeStart(x, y) {
  swipeStart = {
    x,
    y,
    time: Date.now(),
  };
}

function finishSwipe(x, y) {
  if (!swipeStart) return;
  const dx = x - swipeStart.x;
  const dy = y - swipeStart.y;
  const elapsed = Date.now() - swipeStart.time;
  swipeStart = null;
  if (elapsed > 900 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
  suppressNextStageClick = true;
  movePhoto(dx < 0 ? 1 : -1);
}

async function flipTypedSlotList() {
  if (!currentTemplate?.slots?.length) return;
  const tokens = flipSlotsInput.value.split(/[,\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const token of tokens) {
    const index = currentTemplate.slots.findIndex((slot) => String(slot.ordinal) === token || String(slot.code).toLowerCase() === token);
    if (index >= 0) await flipSlot(index);
  }
  flipSlotsInput.value = "";
}

function handleStageTap(event) {
  if (!currentTemplate?.slots?.length) return;
  if (registrationIsInvalid()) {
    openProcessingDebug();
    return;
  }
  if (suppressNextStageClick) {
    suppressNextStageClick = false;
    return;
  }
  const rect = surfaceRect();
  const imageRect = drawnImageRect(rect);
  const overlayRect = overlay.getBoundingClientRect();
  const point = {
    x: event.clientX - overlayRect.left,
    y: event.clientY - overlayRect.top,
  };
  if (point.x < 0 || point.y < 0 || point.x > overlayRect.width || point.y > overlayRect.height) return;
  for (let i = currentTemplate.slots.length - 1; i >= 0; i--) {
    const polygon = slotPolygon(currentTemplate.slots[i]).map((item) => transformPoint(item[0], item[1], imageRect));
    if (pointInPolygon(point, polygon)) {
      flipSlot(i);
      return;
    }
  }
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const crosses = pi.y > point.y !== pj.y > point.y && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function seedPredictions() {
  if (!currentPhoto || !currentTemplate?.slots?.length || !image.complete || !image.naturalWidth) return;
  sampler.width = image.naturalWidth;
  sampler.height = image.naturalHeight;
  try {
    samplerCtx.drawImage(image, 0, 0, sampler.width, sampler.height);
  } catch {
    status.textContent = "Could not sample this image. Check backend media access and CORS.";
    return;
  }
  for (const slot of currentTemplate.slots) {
    const key = labelKey(slot);
    if (labels[key]) continue;
    predictions[key] = serverSlotPrediction(slot) || estimateSlotState(slot);
  }
}

async function refreshOcrPredictions() {
  if (!currentPhoto || !currentTemplate?.slots?.length || !image.complete || !currentPhoto.focus) return;
  const requestId = ++ocrPredictionRequestId;
  const params = new URLSearchParams({ photo_id: currentPhoto.id, template_id: currentTemplate.template_id });
  const response = await apiFetch(`${ALBUM_REVIEW_OCR_PREDICTIONS_PATH}?${params}`, { cache: "no-store" }).catch(() => null);
  if (requestId !== ocrPredictionRequestId || !response?.ok) return;
  const payload = await response.json().catch(() => null);
  if (requestId !== ocrPredictionRequestId || !payload?.predictions) return;
  currentPhoto.slot_predictions ||= {};
  currentPhoto.slot_predictions[currentTemplate.template_id] ||= {};
  Object.assign(currentPhoto.slot_predictions[currentTemplate.template_id], payload.predictions);
  for (const slot of currentTemplate.slots) {
    const key = labelKey(slot);
    if (!labels[key] && payload.predictions[slot.id]) predictions[key] = payload.predictions[slot.id].label;
  }
  renderSlot();
  draw();
}

function serverSlotPrediction(slot) {
  const prediction = slotPrediction(slot);
  return prediction?.label || null;
}

function estimateSlotState(slot) {
  const points = slotPolygon(slot).map((point) => transformNaturalPoint(point[0], point[1]));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(sampler.width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(sampler.height - 1, Math.ceil(Math.max(...ys)));
  const step = Math.max(2, Math.floor(Math.max(maxX - minX, maxY - minY) / 18));
  const values = [];
  const saturations = [];
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (!pointInPolygon({ x, y }, points)) continue;
      const pixel = samplerCtx.getImageData(x, y, 1, 1).data;
      const r = pixel[0];
      const g = pixel[1];
      const b = pixel[2];
      values.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      saturations.push(max === 0 ? 0 : (max - min) / max);
    }
  }
  if (values.length < 8) return "unknown";
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const saturation = saturations.reduce((sum, value) => sum + value, 0) / saturations.length;
  if (mean > 145 && saturation < 0.18) return "empty";
  if (saturation > 0.22 || mean < 128 || Math.sqrt(variance) > 48) return "filled";
  return "unknown";
}

function transformNaturalPoint(x, y) {
  let px = x - 0.5;
  let py = y - 0.5;
  const angle = Number(rotateSelect.value || 0);
  if (angle === 90) [px, py] = [py, -px];
  if (angle === 180) [px, py] = [-px, -py];
  if (angle === 270) [px, py] = [-py, px];
  const scale = Number(scaleInput.value || 1);
  const scaleX = Number(currentPhoto?.alignment_hint?.scale_x || scale);
  const scaleY = Number(currentPhoto?.alignment_hint?.scale_y || scale);
  const dx = Number(offsetXInput.value || 0);
  const dy = Number(offsetYInput.value || 0);
  return {
    x: (0.5 + px * scaleX + dx) * sampler.width,
    y: (0.5 + py * scaleY + dy) * sampler.height,
  };
}

function apiFetch(path, options = {}) {
  return fetch(recognitionUrl(path), withBackendAuth(options));
}

async function loadBackendImageObjectUrl(path) {
  const response = await fetch(backendAssetUrl(path), withBackendAuth({ cache: "no-store" }));
  if (!response.ok) throw new Error(`Image load failed (${response.status})`);
  return URL.createObjectURL(await response.blob());
}

function withBackendAuth(options = {}) {
  const headers = new Headers(options.headers || {});
  const token = ocrToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return { ...options, headers };
}

function clearDebugObjectUrls() {
  for (const objectUrl of debugObjectUrls) URL.revokeObjectURL(objectUrl);
  debugObjectUrls = [];
}

function backendAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(String(path))) return path;
  return recognitionUrl(path);
}
