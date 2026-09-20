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
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-3da9e0dd8cdb";
import {
  cancelTransaction,
  createTransaction,
  loadLedger,
  saveLedger,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-3da9e0dd8cdb";
import {
  normalizeCollectionCodeList,
  splitCodesByResolvedCollectionModel,
} from "/fifa-sticker-app/v2/assets/collection_model.js?v=build-3da9e0dd8cdb";
import { loadInventoryProjection } from "/fifa-sticker-app/v2/assets/inventory_projection.js?v=build-3da9e0dd8cdb";
import { catalogHasCards, partitionCatalogLines } from "/fifa-sticker-app/v2/assets/catalog_membership.js?v=build-3da9e0dd8cdb";
import { activeProfileId, ensureActiveProfileId } from "/fifa-sticker-app/v2/assets/v2_profile.js?v=build-3da9e0dd8cdb";
import { openCameraCapture } from "/fifa-sticker-app/v2/assets/camera_capture.js?v=build-3da9e0dd8cdb";
import {
  loadLatestPhotoReviewBatch,
  activeCloudPhotoReviewProfileId,
  activePhotoReviewProfileId,
  ReviewStateConflictError,
  savePhotoReviewBatch,
  savePhotoReviewBatchMeta,
  savePhotoReviewState,
} from "/fifa-sticker-app/v2/assets/photo_review_store_v2.js?v=build-3da9e0dd8cdb";
import {
  buildPhotoReviewItems,
  hydratePhotoReviewSlots,
  nextPendingReviewItem,
  reviewCodeCandidates,
  reviewItemKey,
} from "/fifa-sticker-app/v2/assets/photo_review_queue.js?v=build-3da9e0dd8cdb";
import {
  classifyScannedCards,
  compactScannedCardGroupDetail,
  groupScannedCardStatuses,
  summarizeScannedCardStatuses,
} from "/fifa-sticker-app/v2/assets/scan_card_status.js?v=build-3da9e0dd8cdb";
import {
  receivedLinesForScan,
  SCAN_INSIGNIA_VARIANTS,
  scanReceiptSignature,
  summarizeScanInsignias,
} from "/fifa-sticker-app/v2/assets/scan_inventory.js?v=build-3da9e0dd8cdb";

const input = document.querySelector("#photoScannerInput");
const batchInput = document.querySelector("#photoScannerBatchInput");
const side = document.querySelector("#photoScannerSide");
const scanButton = document.querySelector("#photoScannerButton");
const batchButton = document.querySelector("#photoScannerBatchButton");
const cameraButton = document.querySelector("#photoScannerCameraButton");
const cancelButton = document.querySelector("#photoScannerCancelButton");
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
const reviewUnplaced = document.querySelector("#photoReviewUnplaced");
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
const reviewPhotoNav = document.querySelector("#photoReviewPhotoNav");
const reviewPhotoText = document.querySelector("#photoReviewPhotoText");
const reviewPreviousPhotoButton = document.querySelector("#photoReviewPreviousPhoto");
const reviewNextPhotoButton = document.querySelector("#photoReviewNextPhoto");
const reviewEmptyState = document.querySelector("#photoReviewEmptyState");
const openReviewsLink = document.querySelector("#photoOpenReviews");
const toast = document.querySelector("#photoScannerToast");
const backendUrlInput = document.querySelector("[data-ocr-backend-url]");
const backendTokenInput = document.querySelector("[data-ocr-backend-token]");
const backendSaveButton = document.querySelector("[data-ocr-backend-save]");
const backendTestButton = document.querySelector("[data-ocr-backend-test]");
const backendStatus = document.querySelector("[data-ocr-backend-status]");
const reviewsPage = document.body?.dataset.photoReviewMode === "reviews";
let photoReviewState = emptyPhotoReviewState();
let photoReviewView = { focused: false, zoomFactor: 1 };
let latestScanCodes = [];
let latestCollectionSplit = { newCodes: [], inventoryCodes: [] };
let latestScanStatuses = [];
let latestInventoryProjection = null;
let latestAppliedScan = { signature: "", transactionId: "" };
let scanInFlight = false;
let activePhotoScanController = null;
let latestCaptureSummary = "";
let reviewHydrationGeneration = 0;
let cloudReviewSyncCompleted = false;
let reviewWriteChain = Promise.resolve();
const reviewUpdates = typeof BroadcastChannel === "function" ? new BroadcastChannel("panini-photo-review-queue") : null;

applyOcrBackendFromQuery();
initializeBackendSettings();
initializeSideSelection();
initializeReviewExperience();
cameraButton?.addEventListener("click", captureCameraPhoto);
cancelButton?.addEventListener("click", () => activePhotoScanController?.abort());
for (const picker of [input, batchInput]) {
  picker?.addEventListener("input", scanSelectedPhotos);
  picker?.addEventListener("change", scanSelectedPhotos);
}
reviewImage?.addEventListener("load", () => drawPhotoReview());
reviewStage?.addEventListener("click", selectReviewSlotAtEvent);
reviewInspector?.addEventListener("submit", saveInspectorCode);
reviewNextButton?.addEventListener("click", selectNextReviewSlot);
reviewFinishButton?.addEventListener("click", finishReviewForNow);
reviewAllCorrectButton?.addEventListener("click", saveAllReviewSlotsCorrect);
reviewZoomOutButton?.addEventListener("click", () => adjustReviewZoom(1 / 1.35));
reviewZoomInButton?.addEventListener("click", () => adjustReviewZoom(1.35));
reviewOverviewButton?.addEventListener("click", () => showReviewOverview({ announce: true }));
reviewPreviousPhotoButton?.addEventListener("click", () => selectAdjacentPhoto(-1));
reviewNextPhotoButton?.addEventListener("click", () => selectAdjacentPhoto(1));
addCollectionButton?.addEventListener("click", addScanToCollection);
undoCollectionButton?.addEventListener("click", undoLastScanAdd);
window.addEventListener("resize", () => drawPhotoReview());
window.addEventListener("pagehide", releasePhotoReviewUrls);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) hydrateSavedReviewsPage();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") hydrateSavedReviewsPage();
});
reviewUpdates?.addEventListener("message", (event) => {
  if (!reviewsPage || event.data?.profileId !== activePhotoReviewProfileId() || scanInFlight) return;
  const incomingBatchId = String(event.data?.batchId || "");
  const incomingRevision = Number(event.data?.revision || 0);
  const activeBatchChanged = incomingBatchId && incomingBatchId !== photoReviewState.id;
  const activeBatchAdvanced = incomingBatchId === photoReviewState.id && incomingRevision > Number(photoReviewState.revision || 0);
  if (activeBatchChanged || activeBatchAdvanced) hydrateSavedReviewsPage();
});
window.addEventListener("panini:cloud-sync-applied", (event) => {
  if (!reviewsPage || event.detail?.profileId !== activePhotoReviewProfileId() || scanInFlight) return;
  cloudReviewSyncCompleted = true;
  hydrateSavedReviewsPage();
});
window.addEventListener("panini:cloud-sync-status", (event) => {
  if (!reviewsPage || scanInFlight || photoReviewState.id) return;
  const message = String(event.detail?.message || "");
  const severity = String(event.detail?.severity || "");
  if (severity === "warning") showEmptyReviewQueue(message || "Cloud reviews could not be loaded. Try again.");
  else if (severity === "muted" && message.startsWith("Loading encrypted")) showEmptyReviewQueue(message);
  else if (severity === "ok") {
    cloudReviewSyncCompleted = true;
    hydrateSavedReviewsPage();
  }
});
globalThis.PANINI_CLOUD_SYNC_READY?.finally?.(() => {
  if (!reviewsPage || scanInFlight) return;
  cloudReviewSyncCompleted = true;
  hydrateSavedReviewsPage();
});
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

function emptyPhotoReviewState() {
  return {
    id: "",
    profileId: "",
    requestedSide: "back",
    createdAt: 0,
    updatedAt: 0,
    revision: 0,
    photos: [],
    reviewItems: [],
    activePhotoId: "",
    activeReviewKey: "",
    collectionSignature: "",
    collectionTransactionId: "",
    imageUrl: "",
    slots: [],
    selectedSlotId: "",
  };
}

async function initializeReviewExperience() {
  await refreshScannerCollectionProjection();
  latestCollectionSplit = splitCollectionCodes(latestScanCodes);
  latestScanStatuses = classifyCurrentScan();
  renderCollectionActions();
  renderRecognizedCodeRows();
  if (reviewsPage) await hydrateLatestReviewBatch();
  document.body.dataset.photoScannerReady = "true";
}

function hydrateSavedReviewsPage() {
  if (!reviewsPage || scanInFlight) return;
  hydrateLatestReviewBatch();
}

async function hydrateLatestReviewBatch() {
  const generation = ++reviewHydrationGeneration;
  setReviewInteractionDisabled(true);
  try {
    await reviewWriteChain.catch(() => {});
    const stored = await loadLatestPhotoReviewBatch(activePhotoReviewProfileId() || activeProfileId());
    if (generation !== reviewHydrationGeneration) return;
    if (!stored) {
      showEmptyReviewQueue(emptyReviewQueueMessage());
      return;
    }
    installPhotoReviewBatch(stored);
    await updateResultFromReviewSlots();
    showPreferredReviewItem({ persist: false, scroll: false });
  } catch (error) {
    showEmptyReviewQueue(error instanceof Error ? error.message : "Saved reviews could not be loaded.");
  } finally {
    if (generation === reviewHydrationGeneration) setReviewInteractionDisabled(false);
  }
}

function emptyReviewQueueMessage() {
  if (!activeCloudPhotoReviewProfileId()) {
    return "Enter or select a restore code under Load reviews to open the encrypted queue.";
  }
  if (!cloudReviewSyncCompleted) return "Loading encrypted reviews…";
  return "No saved reviews were found for this cloud account.";
}

function setReviewInteractionDisabled(disabled) {
  if (reviewPanel) {
    reviewPanel.inert = disabled;
    reviewPanel.setAttribute("aria-busy", String(disabled));
  }
  if (collectionActions) collectionActions.inert = disabled;
}

function showEmptyReviewQueue(message) {
  releasePhotoReviewUrls();
  photoReviewState = emptyPhotoReviewState();
  if (reviewPanel) reviewPanel.hidden = true;
  if (reviewEmptyState) {
    reviewEmptyState.hidden = false;
    const heading = reviewEmptyState.querySelector("h2");
    const messageNode = reviewEmptyState.querySelector("p");
    if (heading) {
      heading.textContent = message.startsWith("Loading encrypted")
        ? "Loading reviews"
        : /failed|timed out|could not|unavailable/i.test(message)
          ? "Reviews not loaded"
          : "No reviews waiting";
    }
    if (messageNode) messageNode.textContent = message;
  }
  if (status) status.textContent = message;
}

function openPhotoPicker(picker) {
  if (!picker || scanInFlight) return;
  picker.value = "";
  picker.click();
}

async function scanSelectedPhotos(event) {
  if (scanInFlight) return;
  const picker = event?.currentTarget || input;
  const files = [...(picker?.files || [])];
  if (!files.length) return;
  latestCaptureSummary = "";
  if (cameraDiagnostics) cameraDiagnostics.textContent = "Using photo-library image; in-app camera diagnostics do not apply.";
  scanInFlight = true;
  activePhotoScanController = new AbortController();
  try {
    await allowNativePickerToDismiss();
    await scanPhotos(files, activePhotoScanController.signal);
  } finally {
    scanInFlight = false;
    activePhotoScanController = null;
    if (picker) picker.value = "";
  }
}

function allowNativePickerToDismiss() {
  if (typeof requestAnimationFrame !== "function") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function captureCameraPhoto() {
  if (scanInFlight) return;
  const capture = await openCameraCapture({
    invoker: cameraButton,
    onFallback: () => openPhotoPicker(input),
    onStatus: (message) => {
      if (cameraDiagnostics) cameraDiagnostics.textContent = message;
    },
  });
  if (!capture?.file) return;
  latestCaptureSummary = capture.summary;
  if (cameraDiagnostics) cameraDiagnostics.textContent = capture.summary;
  scanInFlight = true;
  activePhotoScanController = new AbortController();
  try {
    await scanPhotos([capture.file], activePhotoScanController.signal);
  } finally {
    scanInFlight = false;
    activePhotoScanController = null;
  }
}

async function scanPhotos(files, signal) {
  if (scannerMode() !== "back-card") {
    status.textContent = "This scanner route is not configured for card backs.";
    return;
  }
  if (!recognitionBaseUrl()) {
    status.textContent = "Recognition backend is not configured for this deployment.";
    return;
  }
  scanButton.disabled = true;
  if (batchButton) batchButton.disabled = true;
  setPhotoPickersBusy(true);
  if (cameraButton) cameraButton.disabled = true;
  if (cancelButton) cancelButton.hidden = false;
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
  const requestedSide = side?.value || photoOcrSide();
  let lastError = null;
  try {
    await refreshScannerCollectionProjection();
    await beginPhotoReviewBatch(selected, requestedSide);
    for (let index = 0; index < photoReviewState.photos.length; index += 1) {
      const photo = photoReviewState.photos[index];
      setScanProgress(`Scanning... ${index + 1}/${selected.length}`);
      photo.status = "scanning";
      photo.error = "";
      await persistReviewPhoto(photo);
      try {
        const job = await createPhotoCodeJob(photo.blob, {
          side: requestedSide,
          onStatus: (message) => { setScanProgress(message); },
          signal,
        });
        const payload = await waitForPhotoCodeJob(job.job_id, {
          onStatus: (message) => { setScanProgress(message); },
          signal,
        });
        const resultPayload = payload.result || payload;
        resultPayload.upload_id ||= payload.upload_id || job.upload_id || "";
        resultPayload.job_id ||= payload.job_id || job.job_id || "";
        photo.payload = resultPayload;
        photo.status = "succeeded";
        photo.slots = reviewSlotsForPayload(resultPayload);
        photo.selectedSlotId = photo.slots.find((slot) => slotNeedsReview(slot))?.id || photo.slots[0]?.id || "";
        photoReviewState.reviewItems.push(...reviewItemsForPhoto(photo));
        await persistReviewPhoto(photo);
      } catch (error) {
        lastError = error;
        photo.status = error?.kind === "cancelled" ? "cancelled" : "failed";
        photo.error = error instanceof Error ? error.message : "Photo recognition failed.";
        await persistReviewPhoto(photo);
        if (error?.kind === "cancelled") {
          for (const remaining of photoReviewState.photos.slice(index + 1)) {
            remaining.status = "cancelled";
            remaining.error = "Scan cancelled before this photo started.";
            await persistReviewPhoto(remaining);
          }
          break;
        }
      }
    }
    photoReviewState.updatedAt = Date.now();
    await persistReviewBatchMeta();
    await renderResults(photoReviewState, { requestedCount: selected.length, lastError });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Photo scan failed.";
    codesList.replaceChildren(emptyRow("No result."));
  } finally {
    scanButton.disabled = false;
    if (batchButton) batchButton.disabled = false;
    setPhotoPickersBusy(false);
    if (cameraButton) cameraButton.disabled = false;
    if (cancelButton) cancelButton.hidden = true;
    scanButton.classList.remove("scanning");
    scanButton.setAttribute("aria-busy", "false");
    scanButton.textContent = "Choose photo";
  }
}

async function beginPhotoReviewBatch(files, requestedSide) {
  await reviewWriteChain.catch(() => {});
  releasePhotoReviewUrls();
  const now = Date.now();
  const batchId = `review_${now.toString(36)}_${randomReviewId()}`;
  photoReviewState = {
    ...emptyPhotoReviewState(),
    id: batchId,
    profileId: activePhotoReviewProfileId() || ensureActiveProfileId(),
    requestedSide,
    createdAt: now,
    updatedAt: now,
    photos: files.map((file, index) => ({
      id: `photo_${index + 1}_${randomReviewId()}`,
      index,
      revision: 0,
      fileName: file.name || `Photo ${index + 1}`,
      mimeType: file.type || "application/octet-stream",
      lastModified: Number(file.lastModified || 0),
      blob: file,
      imageUrl: URL.createObjectURL(file),
      status: "pending",
      error: "",
      payload: null,
      slots: [],
      selectedSlotId: "",
      view: { focused: false, zoomFactor: 1 },
    })),
  };
  await savePhotoReviewBatch(photoReviewState);
  activateReviewPhoto(photoReviewState.photos[0]?.id || "", { render: true });
  if (reviewPanel) reviewPanel.hidden = false;
  if (reviewEmptyState) reviewEmptyState.hidden = true;
  if (reviewSummary) reviewSummary.textContent = `Scanning photo 1 of ${files.length}...`;
}

function randomReviewId() {
  return globalThis.crypto?.randomUUID?.().slice(0, 8)
    || Math.random().toString(36).slice(2, 10);
}

function setPhotoPickersBusy(busy) {
  for (const picker of [input, batchInput]) {
    const control = picker?.closest(".photoPickerControl");
    control?.classList.toggle("isBusy", busy);
    if (busy) control?.setAttribute("aria-disabled", "true");
    else control?.removeAttribute("aria-disabled");
  }
}

function setScanProgress(message) {
  scanButton.textContent = message;
  status.textContent = message;
}

async function renderResults(batch, options = {}) {
  await refreshScannerCollectionProjection();
  const successfulPhotos = batch.photos.filter((photo) => photo.status === "succeeded");
  latestScanCodes = aggregateReviewCodes();
  latestCollectionSplit = splitCollectionCodes(latestScanCodes);
  latestScanStatuses = classifyCurrentScan();
  const text = copyTextForCodes(latestScanCodes);
  result.value = text;
  copyButton.disabled = !text;
  const failedCount = batch.photos.filter((photo) => photo.status === "failed").length;
  const cancelledCount = batch.photos.filter((photo) => photo.status === "cancelled").length;
  const failureText = failedCount ? ` ${failedCount} photo${failedCount === 1 ? "" : "s"} could not be read.` : "";
  const cancellationText = cancelledCount ? ` ${cancelledCount} photo${cancelledCount === 1 ? " was" : "s were"} cancelled.` : "";
  status.textContent = latestScanCodes.length
    ? `${latestScanCodes.length} card${latestScanCodes.length === 1 ? "" : "s"} recognized in ${successfulPhotos.length} photo${successfulPhotos.length === 1 ? "" : "s"}.${failureText}${cancellationText}`
    : options.lastError instanceof Error
      ? options.lastError.message
      : "No cards recognized in those photos.";
  if (latestCaptureSummary && cameraDiagnostics) cameraDiagnostics.textContent = latestCaptureSummary;
  renderCollectionActions();
  renderRecognizedCodeRows();
  showPreferredReviewItem();
  if (openReviewsLink) openReviewsLink.hidden = !batch.photos.length;
}

function showPhotoReviewImage(imageUrl) {
  if (!reviewPanel || !reviewImage) return;
  photoReviewState.imageUrl = imageUrl;
  photoReviewState.slots = [];
  photoReviewState.selectedSlotId = "";
  photoReviewView = { focused: false, zoomFactor: 1 };
  reviewPanel.hidden = false;
  reviewImage.src = imageUrl;
  if (reviewSummary) reviewSummary.textContent = "Waiting for recognizer...";
  renderInspector();
  drawPhotoReview();
}

function renderPhotoReview(payload) {
  const slots = reviewSlotsForPayload(payload);
  photoReviewState.slots = slots;
  const firstReviewSlot = reviewSlots()[0];
  photoReviewState.selectedSlotId = firstReviewSlot?.id || slots[0]?.id || "";
  renderReviewSummary(payload);
  renderReviewQueue();
  renderInspector();
  drawPhotoReview();
  return matchedReviewSlotCodes(slots);
}

function reviewSlotsForPayload(payload) {
  const overview = payload?.overview_map || payload?.overview?.map || payload?.scanner_overview || null;
  return appendUnplacedPayloadCodes(
    normalizeReviewSlots(overview?.slots || payload?.slots || [], payload),
    payload,
  ).map((slot) => ({
    ...slot,
    code_review_status: slotNeedsCodeReview(slot) ? "pending" : "not_needed",
  }));
}

function reviewItemsForPhoto(photo) {
  return buildPhotoReviewItems(photo, {
    needsCodeReview: slotNeedsCodeReview,
    needsInsigniaReview: slotNeedsInsigniaReview,
  });
}

function installPhotoReviewBatch(stored) {
  releasePhotoReviewUrls();
  photoReviewState = {
    ...emptyPhotoReviewState(),
    ...stored,
    photos: (stored.photos || []).map((photo) => ({
      ...photo,
      imageUrl: photo.blob ? URL.createObjectURL(photo.blob) : "",
      slots: hydratePhotoReviewSlots(photo.slots, { photoId: photo.id }),
      view: photo.view || { focused: false, zoomFactor: 1 },
    })),
    reviewItems: Array.isArray(stored.reviewItems) ? stored.reviewItems : [],
  };
  const knownReviewKeys = new Set(photoReviewState.reviewItems.map((item) => item.key));
  for (const item of photoReviewState.photos.flatMap(reviewItemsForPhoto)) {
    if (!knownReviewKeys.has(item.key)) photoReviewState.reviewItems.push(item);
  }
  latestAppliedScan = {
    signature: photoReviewState.collectionSignature || "",
    transactionId: photoReviewState.collectionTransactionId || "",
  };
  reconcileAppliedScanFromLedger();
  if (reviewEmptyState) reviewEmptyState.hidden = true;
  if (reviewPanel) reviewPanel.hidden = false;
}

function releasePhotoReviewUrls() {
  for (const photo of photoReviewState.photos || []) {
    if (photo.imageUrl) URL.revokeObjectURL(photo.imageUrl);
    photo.imageUrl = "";
  }
}

function activeReviewPhoto() {
  return photoReviewState.photos.find((photo) => photo.id === photoReviewState.activePhotoId) || null;
}

function syncActiveReviewPhoto() {
  const photo = activeReviewPhoto();
  if (!photo) return;
  photo.selectedSlotId = photoReviewState.selectedSlotId;
  photo.view = { ...photoReviewView };
}

function activateReviewPhoto(photoId, options = {}) {
  syncActiveReviewPhoto();
  const photo = photoReviewState.photos.find((candidate) => candidate.id === photoId);
  if (!photo) return false;
  photoReviewState.activePhotoId = photo.id;
  photoReviewState.imageUrl = photo.imageUrl || "";
  photoReviewState.slots = photo.slots || [];
  photoReviewState.selectedSlotId = photo.selectedSlotId
    || photo.slots.find((slot) => slotNeedsReview(slot))?.id
    || photo.slots[0]?.id
    || "";
  photoReviewView = { ...(photo.view || { focused: false, zoomFactor: 1 }) };
  if (reviewPanel) reviewPanel.hidden = false;
  if (reviewImage) {
    reviewImage.alt = photo.fileName ? `Review ${photo.fileName}` : "Sticker photo under review";
    reviewImage.src = photo.imageUrl || "";
  }
  if (options.render !== false) renderActiveReviewPhoto();
  return true;
}

function renderActiveReviewPhoto() {
  const photo = activeReviewPhoto();
  renderReviewSummary(photo?.payload || photo?.status === "succeeded");
  renderReviewPhotoNavigation();
  renderReviewQueue();
  renderInspector();
  drawPhotoReview();
}

function persistReviewPhoto(photo = activeReviewPhoto()) {
  const batch = photoReviewState;
  if (!batch.id || !photo) return Promise.resolve();
  return queueReviewWrite(async () => {
    if (photo.id === batch.activePhotoId) syncActiveReviewPhoto();
    batch.updatedAt = Date.now();
    batch.collectionSignature = latestAppliedScan.signature || "";
    batch.collectionTransactionId = latestAppliedScan.transactionId || "";
    await savePhotoReviewState(batch, photo);
    announceReviewUpdate(batch);
  });
}

function persistReviewBatchMeta() {
  const batch = photoReviewState;
  if (!batch.id) return Promise.resolve();
  return queueReviewWrite(async () => {
    syncActiveReviewPhoto();
    batch.updatedAt = Date.now();
    batch.collectionSignature = latestAppliedScan.signature || "";
    batch.collectionTransactionId = latestAppliedScan.transactionId || "";
    await savePhotoReviewBatchMeta(batch);
    announceReviewUpdate(batch);
  });
}

function queueReviewWrite(operation) {
  const write = reviewWriteChain.then(operation);
  reviewWriteChain = write.catch(() => {});
  return write;
}

function announceReviewUpdate(batch) {
  reviewUpdates?.postMessage({ profileId: batch.profileId, batchId: batch.id, revision: batch.revision });
}

function aggregateReviewCodes() {
  const codes = photoReviewState.photos.flatMap((photo) => {
    if (photo.status !== "succeeded") return [];
    const matched = matchedReviewSlotCodes(photo.slots || []);
    if (matched.length) return matched;
    return Array.isArray(photo.payload?.codes) ? photo.payload.codes : [];
  });
  return normalizeCodeList(codes);
}

function renderReviewSummary(payload = true) {
  if (!reviewSummary) return;
  const photo = activeReviewPhoto();
  const photoIndex = photo ? photoReviewState.photos.indexOf(photo) : -1;
  const slots = photoReviewState.slots;
  const matched = slots.filter((slot) => slotStatus(slot) === "matched").length;
  const pending = pendingReviewItems();
  const photoPrefix = photoReviewState.photos.length > 1 && photoIndex >= 0
    ? `Photo ${photoIndex + 1} of ${photoReviewState.photos.length} · `
    : "";
  if (photo?.status === "failed" || photo?.status === "cancelled") {
    reviewSummary.textContent = `${photoPrefix}${photo.error || "Photo unavailable"}`;
    return;
  }
  reviewSummary.textContent = slots.length
    ? `${photoPrefix}${matched}/${slots.length} codes matched · ${pending.length} review task${pending.length === 1 ? "" : "s"} remaining`
    : payload ? `${photoPrefix}No overlay geometry returned by backend.` : `${photoPrefix}No result`;
}

function renderReviewPhotoNavigation() {
  if (!reviewPhotoNav || !reviewPhotoText) return;
  const photos = photoReviewState.photos;
  const active = activeReviewPhoto();
  const index = active ? photos.indexOf(active) : -1;
  reviewPhotoNav.hidden = photos.length < 2;
  reviewPhotoText.textContent = index >= 0
    ? `Photo ${index + 1} of ${photos.length} · ${active.fileName || "Untitled photo"}`
    : "No photo selected";
  if (reviewPreviousPhotoButton) reviewPreviousPhotoButton.disabled = index <= 0;
  if (reviewNextPhotoButton) reviewNextPhotoButton.disabled = index < 0 || index >= photos.length - 1;
}

function selectAdjacentPhoto(offset) {
  const photos = photoReviewState.photos;
  const currentIndex = photos.findIndex((photo) => photo.id === photoReviewState.activePhotoId);
  const next = photos[currentIndex + offset];
  if (!next) return;
  photoReviewState.activeReviewKey = "";
  activateReviewPhoto(next.id);
  persistReviewBatchMeta().catch(reportReviewStorageFailure);
}

function normalizeReviewSlots(slots, payload = {}) {
  return slots
    .map((slot, index) => ({
      ...slot,
      id: String(slot.id || `slot-${index + 1}`),
      code: String(slot.code || "").toUpperCase(),
      name: String(slot.name || reviewSlotCatalogName(slot.code) || "").trim(),
      team: String(slot.team || reviewSlotCatalogCard(slot.code).team || "").trim(),
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
      normalized_back_insignia_box: normalizeBackInsigniaBox(slot),
    }))
    .filter((slot) => slot.code || slot.name || slot.normalized_polygon?.length >= 4 || slot.normalized_code_anchor_box?.length >= 4 || slot.normalized_back_insignia_box?.length >= 4);
}

function appendUnplacedPayloadCodes(slots, payload = {}) {
  const remaining = new Map();
  for (const slot of slots) {
    const code = normalizeCodeList([slot.code])[0] || "";
    if (code) remaining.set(code, (remaining.get(code) || 0) + 1);
  }
  const requestedSide = String(payload?.ocr?.side || side?.value || photoOcrSide());
  const additions = [];
  for (const [index, rawCode] of (Array.isArray(payload?.codes) ? payload.codes : []).entries()) {
    const code = normalizeCodeList([rawCode])[0] || "";
    if (!code) continue;
    const represented = remaining.get(code) || 0;
    if (represented) {
      remaining.set(code, represented - 1);
      continue;
    }
    const catalog = reviewSlotCatalogCard(code);
    additions.push({
      id: `unplaced:${index + 1}:${code}`,
      code,
      name: catalog.name,
      team: catalog.team,
      original_code: code,
      state: "confirmed",
      review_status: "matched",
      geometry_status: "unavailable",
      needs_user_help: true,
      confidence: 0,
      code_candidates: [{ code }],
      requested_side: requestedSide,
      upload_id: String(payload?.upload_id || payload?.ocr?.upload_id || ""),
      job_id: String(payload?.job_id || ""),
      back_insignia_type: "no_clue",
      original_back_insignia_type: "no_clue",
      original_back_insignia_confidence: 0,
      insignia_review_status: "",
      normalized_polygon: [],
      normalized_code_anchor_box: [],
      normalized_back_insignia_box: [],
    });
  }
  return [...slots, ...additions];
}

function normalizeBackInsigniaBox(slot) {
  const polygon = normalizedPolygon(
    slot?.normalized_back_insignia_box
    || slot?.normalized_insignia_box
    || slot?.back_insignia?.normalized_box,
  );
  if (polygon.length >= 4) return polygon;
  const center = slot?.normalized_back_insignia_center || slot?.normalized_insignia_center;
  if (!Array.isArray(center) || center.length < 2) return [];
  const x = Number(center[0]);
  const y = Number(center[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  return [[x - 0.015, y - 0.015], [x + 0.015, y - 0.015], [x + 0.015, y + 0.015], [x - 0.015, y + 0.015]];
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
  const polygon = reviewSlotPolygon(slot);
  if (polygon.length < 4) return baseImageRect;
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
  const polygon = reviewSlotPolygon(slot);
  const points = polygon.map(([x, y]) => [imageRect.x + x * imageRect.width, imageRect.y + y * imageRect.height]);
  if (points.length < 4) return;
  const selected = slot.id === photoReviewState.selectedSlotId;
  const codeReviewRequired = slotNeedsCodeReview(slot);
  const insigniaReviewRequired = slotNeedsInsigniaReview(slot);
  const statusValue = codeReviewRequired || (insigniaReviewRequired && slot.geometry_status !== "estimated")
    ? "review"
    : slotStatus(slot);
  const appearance = reviewSlotAppearance(slot, statusValue);
  const color = appearance.color;
  reviewCtx.save();
  reviewCtx.globalAlpha = appearance.fillAlpha;
  reviewCtx.fillStyle = color;
  reviewCtx.beginPath();
  reviewCtx.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) reviewCtx.lineTo(point[0], point[1]);
  reviewCtx.closePath();
  reviewCtx.fill();
  reviewCtx.globalAlpha = 1;
  const dashPattern = appearance.dashPattern || (appearance.dashed ? [6, 4] : []);
  if (appearance.keylineColor) {
    reviewCtx.lineWidth = selected ? 7 : 5;
    reviewCtx.strokeStyle = appearance.keylineColor;
    reviewCtx.setLineDash(dashPattern);
    reviewCtx.stroke();
  }
  reviewCtx.lineWidth = selected ? 4 : (appearance.lineWidth || 2.5);
  reviewCtx.strokeStyle = color;
  reviewCtx.setLineDash(dashPattern);
  reviewCtx.stroke();
  reviewCtx.setLineDash([]);
  const center = polygonCenter(points);
  const label = reviewSlotLabel(slot, statusValue);
  const labelMetrics = reviewLabelMetrics(points, label.primary, photoReviewView.focused, Boolean(label.secondary));
  if (labelMetrics) {
    reviewCtx.save();
    reviewCtx.clip();
    reviewCtx.textAlign = "center";
    reviewCtx.textBaseline = "middle";
    const primaryFont = `800 ${labelMetrics.fontSize}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    const secondaryFont = `650 ${labelMetrics.secondaryFontSize}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    const primary = fitReviewCanvasText(label.primary, labelMetrics.maxTextWidth, primaryFont);
    const secondary = fitReviewCanvasText(label.secondary, labelMetrics.maxTextWidth, secondaryFont);
    reviewCtx.font = primaryFont;
    const primaryWidth = reviewCtx.measureText(primary).width;
    reviewCtx.font = secondaryFont;
    const secondaryWidth = secondary ? reviewCtx.measureText(secondary).width : 0;
    const backgroundWidth = Math.min(labelMetrics.maxWidth, Math.max(primaryWidth, secondaryWidth) + labelMetrics.paddingX * 2);
    reviewCtx.fillStyle = "rgba(0, 0, 0, 0.74)";
    reviewCtx.fillRect(
      center[0] - backgroundWidth / 2,
      center[1] - labelMetrics.backgroundHeight / 2,
      backgroundWidth,
      labelMetrics.backgroundHeight,
    );
    reviewCtx.fillStyle = "#fff";
    reviewCtx.font = primaryFont;
    const primaryY = secondary ? center[1] - labelMetrics.secondaryFontSize * 0.48 : center[1];
    reviewCtx.fillText(primary, center[0], primaryY, labelMetrics.maxTextWidth);
    if (secondary) {
      reviewCtx.font = secondaryFont;
      reviewCtx.fillStyle = "rgba(255, 255, 255, 0.88)";
      reviewCtx.fillText(secondary, center[0], center[1] + labelMetrics.fontSize * 0.48, labelMetrics.maxTextWidth);
    }
    reviewCtx.restore();
  }
  if (insigniaReviewRequired && !codeReviewRequired && slot.geometry_status === "estimated") {
    drawReviewAttentionBadge(points);
  }
  reviewCtx.restore();
}

function reviewSlotLabel(slot, statusValue = slotStatus(slot)) {
  const primary = String(slot.code || (statusValue === "review" ? "Review" : "Unknown")).trim();
  const name = String(slot.name || "").trim();
  return {
    primary,
    secondary: name && name.toUpperCase() !== primary.toUpperCase() ? name : "",
  };
}

function fitReviewCanvasText(value, maxWidth, font) {
  let text = String(value || "").trim();
  if (!text) return "";
  reviewCtx.font = font;
  if (reviewCtx.measureText(text).width <= maxWidth) return text;
  while (text.length > 4 && reviewCtx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  return `${text.trim()}…`;
}

function drawReviewAttentionBadge(points) {
  const bounds = polygonBounds(points);
  const radius = Math.max(6, Math.min(9, Math.min(bounds.width, bounds.height) * 0.12));
  const [x, y] = reviewAttentionBadgeCenter(points);
  reviewCtx.beginPath();
  reviewCtx.arc(x, y, radius, 0, Math.PI * 2);
  reviewCtx.fillStyle = "rgba(0, 0, 0, 0.82)";
  reviewCtx.fill();
  reviewCtx.lineWidth = 2;
  reviewCtx.strokeStyle = "#ffb000";
  reviewCtx.stroke();
  reviewCtx.fillStyle = "#ffcf70";
  reviewCtx.font = `900 ${Math.max(9, radius * 1.35)}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
  reviewCtx.textAlign = "center";
  reviewCtx.textBaseline = "middle";
  reviewCtx.fillText("!", x, y + 0.5);
}

function reviewAttentionBadgeCenter(points) {
  const center = points.reduce(
    (total, point) => [total[0] + point[0] / points.length, total[1] + point[1] / points.length],
    [0, 0],
  );
  const vertex = points[0] || center;
  return [vertex[0] * 0.55 + center[0] * 0.45, vertex[1] * 0.55 + center[1] * 0.45];
}

function reviewSlotAppearance(slot, statusValue) {
  if (statusValue !== "matched") return { color: "#ffb000", fillAlpha: 0.18, dashed: true };
  if (slot.geometry_status === "estimated") {
    return {
      color: "#ff5cf4",
      fillAlpha: 0.06,
      dashed: true,
      dashPattern: [10, 4, 2, 4],
      keylineColor: "rgba(0, 0, 0, 0.78)",
      lineWidth: 3,
    };
  }
  if (isBackScanSlot(slot) && slot.back_insignia_type === SCAN_INSIGNIA_VARIANTS.blue) {
    return { color: "#3fa9ff", fillAlpha: 0.20, dashed: false };
  }
  if (isBackScanSlot(slot) && slot.back_insignia_type === SCAN_INSIGNIA_VARIANTS.green) {
    return { color: "#35d07f", fillAlpha: 0.20, dashed: false };
  }
  return { color: "#a7b0bd", fillAlpha: 0.16, dashed: false };
}

function reviewSlotPolygon(slot) {
  const card = slot.normalized_polygon?.length >= 4 ? slot.normalized_polygon : [];
  const anchor = slot.normalized_code_anchor_box?.length >= 4 ? slot.normalized_code_anchor_box : [];
  const insignia = slot.normalized_back_insignia_box?.length >= 4 ? slot.normalized_back_insignia_box : [];
  if (slot.geometry_status === "estimated" && card.length >= 4) {
    if (!isPlausibleEstimatedReviewPolygon(card, anchor)) return expandReviewAnchorPolygon(insignia.length ? insignia : anchor);
    const calibrated = calibrateEstimatedReviewPolygon(card, photoReviewState.slots);
    return isPlausibleEstimatedReviewPolygon(calibrated, anchor) ? calibrated : card;
  }
  if (slot.geometry_status !== "resolved" && insignia.length >= 4) return expandReviewAnchorPolygon(insignia);
  if (slot.geometry_status !== "resolved" && anchor.length >= 4) return expandReviewAnchorPolygon(anchor);
  return card.length >= 4 ? card : expandReviewAnchorPolygon(insignia.length ? insignia : anchor);
}

function expandReviewAnchorPolygon(anchor) {
  if (!Array.isArray(anchor) || anchor.length < 4) return [];
  const xs = anchor.map((point) => Number(point?.[0])).filter(Number.isFinite);
  const ys = anchor.map((point) => Number(point?.[1])).filter(Number.isFinite);
  if (xs.length < 4 || ys.length < 4) return [];
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(0.14, (Math.max(...xs) - Math.min(...xs)) * 1.2);
  const height = Math.max(0.07, (Math.max(...ys) - Math.min(...ys)) * 1.2);
  const left = Math.max(0, Math.min(1 - width, centerX - width / 2));
  const top = Math.max(0, Math.min(1 - height, centerY - height / 2));
  return [[left, top], [left + width, top], [left + width, top + height], [left, top + height]];
}

function isPlausibleEstimatedReviewPolygon(card, anchor = []) {
  if (!Array.isArray(card) || card.length !== 4) return false;
  const points = card.map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [NaN, NaN]);
  if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return false;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  if (Math.min(...xs) < -0.05 || Math.max(...xs) > 1.05 || Math.min(...ys) < -0.05 || Math.max(...ys) > 1.05) return false;
  const signedCrosses = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const after = points[(index + 2) % points.length];
    return (next[0] - point[0]) * (after[1] - next[1]) - (next[1] - point[1]) * (after[0] - next[0]);
  });
  const epsilon = 1e-6;
  if (!signedCrosses.every((value) => value > epsilon) && !signedCrosses.every((value) => value < -epsilon)) return false;
  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  const shortest = Math.min(...edges);
  const longest = Math.max(...edges);
  if (shortest < 0.025 || longest / shortest > 2.8) return false;
  const polygonArea = Math.abs(points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
  if (polygonArea < 0.003 || polygonArea > 0.35) return false;
  if (Array.isArray(anchor) && anchor.length >= 4) {
    const anchorPoints = anchor.map((point) => [Number(point[0]), Number(point[1])]);
    if (anchorPoints.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return false;
    const anchorArea = Math.abs(anchorPoints.reduce((total, point, index) => {
      const next = anchorPoints[(index + 1) % anchorPoints.length];
      return total + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2);
    if (anchorArea > 0 && polygonArea < anchorArea * 4) return false;
    const anchorCenter = anchorPoints.reduce(
      (total, point) => [total[0] + point[0] / anchorPoints.length, total[1] + point[1] / anchorPoints.length],
      [0, 0],
    );
    let inside = false;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const current = points[index];
      const prior = points[previous];
      if (((current[1] > anchorCenter[1]) !== (prior[1] > anchorCenter[1]))
        && anchorCenter[0] < ((prior[0] - current[0]) * (anchorCenter[1] - current[1])) / (prior[1] - current[1]) + current[0]) {
        inside = !inside;
      }
    }
    if (!inside) return false;
  }
  return true;
}

function calibrateEstimatedReviewPolygon(card, slots = []) {
  if (!Array.isArray(card) || card.length < 4) return card;
  const area = (points) => Math.abs(points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
  const center = (points) => points.reduce(
    (total, point) => [total[0] + point[0] / points.length, total[1] + point[1] / points.length],
    [0, 0],
  );
  const cardArea = area(card);
  if (cardArea <= 0) return card;
  const cardCenter = center(card);
  const references = slots
    .filter((candidate) => candidate.geometry_status === "resolved" && candidate.normalized_polygon?.length >= 4)
    .map((candidate) => {
      const candidateCenter = center(candidate.normalized_polygon);
      return {
        area: area(candidate.normalized_polygon),
        distance: Math.hypot(candidateCenter[0] - cardCenter[0], candidateCenter[1] - cardCenter[1]),
      };
    })
    .filter((candidate) => candidate.area > 0)
    .sort((first, second) => first.distance - second.distance)
    .slice(0, 4);
  if (references.length < 2) return card;
  const areas = references.map((candidate) => candidate.area).sort((first, second) => first - second);
  const middle = Math.floor(areas.length / 2);
  const targetArea = areas.length % 2 ? areas[middle] : (areas[middle - 1] + areas[middle]) / 2;
  const rawScale = Math.sqrt(targetArea / cardArea);
  if (rawScale >= 0.82 && rawScale <= 1.22) return card;
  const scale = Math.max(0.65, Math.min(1.75, rawScale));
  const scaled = card.map(([x, y]) => [
    cardCenter[0] + (x - cardCenter[0]) * scale,
    cardCenter[1] + (y - cardCenter[1]) * scale,
  ]);
  const xs = scaled.map((point) => point[0]);
  const ys = scaled.map((point) => point[1]);
  const shiftX = Math.max(0, -Math.min(...xs)) + Math.min(0, 1 - Math.max(...xs));
  const shiftY = Math.max(0, -Math.min(...ys)) + Math.min(0, 1 - Math.max(...ys));
  return scaled.map(([x, y]) => [x + shiftX, y + shiftY]);
}

function reviewLabelMetrics(points, label, focused = false, hasSecondary = false) {
  const bounds = polygonBounds(points);
  if (bounds.width < 18 || bounds.height < 18) return null;
  const maxWidth = bounds.width * 0.86;
  const maxHeight = bounds.height * 0.24;
  const characterWidth = Math.max(4, String(label || "").length) * 0.62;
  const fontSize = Math.max(5, Math.min(focused ? 18 : 13, maxHeight / 1.4, maxWidth / characterWidth));
  const secondaryFontSize = Math.max(6, Math.min(focused ? 12 : 9, fontSize * 0.74));
  const paddingX = Math.min(fontSize * 0.38, maxWidth * 0.08);
  const paddingY = Math.max(2, fontSize * 0.18);
  const textHeight = hasSecondary
    ? Math.min(bounds.height * 0.36, fontSize * 1.15 + secondaryFontSize * 1.25 + 3)
    : Math.min(maxHeight, fontSize * 1.4);
  return {
    fontSize,
    secondaryFontSize,
    paddingX,
    paddingY,
    maxWidth,
    maxTextWidth: Math.max(1, maxWidth - paddingX * 2),
    backgroundHeight: Math.min(bounds.height * 0.46, textHeight + paddingY * 2),
  };
}

function polygonBounds(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    width: Math.max(0, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(0, Math.max(...ys) - Math.min(...ys)),
  };
}

function selectReviewSlotAtEvent(event) {
  if (!photoReviewState.slots.length || !reviewCanvas) return;
  const bounds = reviewCanvas.getBoundingClientRect();
  const rect = { width: reviewStage?.clientWidth || reviewCanvas.clientWidth, height: reviewStage?.clientHeight || reviewCanvas.clientHeight };
  const imageRect = reviewImageRect(photoImageRect(rect), rect);
  const point = [event.clientX - bounds.left, event.clientY - bounds.top];
  for (let index = photoReviewState.slots.length - 1; index >= 0; index -= 1) {
    const slot = photoReviewState.slots[index];
    const polygon = reviewSlotPolygon(slot)
      .map(([x, y]) => [imageRect.x + x * imageRect.width, imageRect.y + y * imageRect.height]);
    if (pointInPolygon(point, polygon)) {
      photoReviewState.selectedSlotId = slot.id;
      photoReviewState.activeReviewKey = reviewKeyForSlot(slot, slotNeedsCodeReview(slot) ? "code" : "insignia");
      if (photoReviewView.focused) photoReviewView.zoomFactor = 1;
      renderInspector();
      renderReviewQueue();
      drawPhotoReview();
      return;
    }
  }
}

function renderInspector() {
  renderUnplacedReviewSlots();
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
  for (const candidate of reviewCodeCandidates(slot).candidates) {
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
  input.disabled = isCurrentScanApplied();
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Set";
  save.disabled = isCurrentScanApplied();
  const meta = document.createElement("p");
  meta.textContent = `${slotStatus(slot)} · ${formatConfidence(slot.confidence).replace("confidence", "code OCR")} · ${geometryLabel(slot.geometry_status)}`;
  const inspectorLabel = reviewSlotLabel(slot);
  reviewInspector.replaceChildren(inspectorTitle([inspectorLabel.primary, inspectorLabel.secondary].filter(Boolean).join(" · ")), meta);
  identitySection.append(identityTitle, identityHelp);
  if (choices.childElementCount) identitySection.append(choices);
  identitySection.append(form);
  form.append(input, save);
  reviewInspector.append(identitySection);
  if (isBackScanSlot(slot)) reviewInspector.append(insigniaDecisionSection(slot));
}

function renderUnplacedReviewSlots() {
  if (!reviewUnplaced) return;
  const slots = photoReviewState.slots.filter((slot) => reviewSlotPolygon(slot).length < 4);
  reviewUnplaced.hidden = slots.length === 0;
  if (!slots.length) {
    reviewUnplaced.replaceChildren();
    return;
  }
  const heading = document.createElement("strong");
  heading.textContent = `${slots.length} recognized without a photo location`;
  const help = document.createElement("span");
  help.textContent = "Tap a card to confirm or correct it.";
  const list = document.createElement("div");
  list.className = "photoReviewUnplacedList";
  for (const slot of slots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "photoReviewUnplacedCard";
    button.classList.toggle("selected", slot.id === photoReviewState.selectedSlotId);
    button.setAttribute("aria-pressed", String(slot.id === photoReviewState.selectedSlotId));
    const label = reviewSlotLabel(slot);
    const code = document.createElement("strong");
    code.textContent = label.primary;
    const details = document.createElement("span");
    details.textContent = [label.secondary, slot.team].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ") || "Name unavailable";
    button.append(code, details);
    button.addEventListener("click", () => {
      photoReviewState.selectedSlotId = slot.id;
      photoReviewState.activeReviewKey = reviewKeyForSlot(slot, slotNeedsCodeReview(slot) ? "code" : "insignia");
      photoReviewView = { focused: false, zoomFactor: 1 };
      renderInspector();
      renderReviewQueue();
      drawPhotoReview();
      reviewInspector?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    list.append(button);
  }
  reviewUnplaced.replaceChildren(heading, help, list);
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
    { decision: "blue", variant: SCAN_INSIGNIA_VARIANTS.blue, label: "Blue", detail: "Rest of the World Edition" },
    { decision: "green", variant: SCAN_INSIGNIA_VARIANTS.green, label: "Green", detail: "Swiss Edition" },
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
  const photoId = photoForSlot(slot)?.id || "";
  const slotId = slot.id;
  const previous = {
    back_insignia_type: slot.back_insignia_type,
    insignia_review_status: slot.insignia_review_status,
    insignia_feedback_status: slot.insignia_feedback_status,
    insignia_feedback_error: slot.insignia_feedback_error,
    insignia_decision_revision: Number(slot.insignia_decision_revision || 0),
  };
  const completedReviewKey = reviewKeyForSlot(slot, "insignia");
  const decisionRevision = previous.insignia_decision_revision + 1;
  slot.back_insignia_type = option.variant;
  slot.insignia_review_status = option.decision;
  slot.insignia_feedback_status = "pending";
  slot.insignia_feedback_error = "";
  slot.insignia_decision_revision = decisionRevision;
  setReviewInteractionDisabled(true);
  try {
    await persistReviewPhoto();
  } catch (error) {
    Object.assign(slot, previous);
    renderActiveReviewPhoto();
    reportReviewStorageFailure(error);
    return;
  } finally {
    setReviewInteractionDisabled(false);
  }
  await updateResultFromReviewSlots();
  renderInspector();
  renderReviewQueue();
  renderReviewSummary();
  renderCollectionActions();
  drawPhotoReview();
  if (previous.back_insignia_type !== slot.back_insignia_type || previous.insignia_review_status !== slot.insignia_review_status) {
    selectNextReviewSlot({ afterReviewKey: completedReviewKey });
  }
  let feedbackSaved = true;
  let feedbackError = "";
  try {
    await persistInsigniaReviewLabel(slot, option.decision, { photoId });
  } catch (error) {
    feedbackSaved = false;
    feedbackError = error instanceof Error ? error.message : "Unknown feedback upload error.";
    console.error("Card-back feedback upload failed", {
      photoId,
      slotId,
      code: slot.code || "",
      decision: option.decision,
      decisionRevision,
      error,
    });
  }
  try {
    const live = await persistLiveFeedbackStatus({
      photoId,
      slotId,
      revisionField: "insignia_decision_revision",
      revision: decisionRevision,
      feedbackField: "insignia_feedback_status",
      feedbackStatus: feedbackSaved ? "sent" : "failed",
      errorField: "insignia_feedback_error",
      feedbackError,
    });
    if (!live) return;
    if (feedbackSaved) {
      status.textContent = `${live.slot.code || "Card"} saved as ${option.label}.`;
      showToast(`${option.label} back saved.`);
      return;
    }
    status.textContent = `${live.slot.code || "Card"} was saved as ${option.label}; OCR feedback failed: ${feedbackError}`;
    showToast(`Saved for collection; feedback failed: ${feedbackError}`);
  } catch (error) {
    reportReviewStorageFailure(error);
  }
}

async function persistInsigniaReviewLabel(slot, decision, context = {}) {
  const photoId = context.photoId || photoForSlot(slot)?.id || "";
  const uploadId = String(slot.upload_id || "").trim();
  const sourceBatchId = String(photoReviewState.sourceBatchId || photoReviewState.id || "").trim();
  const slotId = String(slot.id || "").trim();
  const id = uploadId
    ? `photo:${uploadId}:${slotId}`
    : sourceBatchId && photoId && slotId
      ? `photo:retained:${sourceBatchId}:${photoId}:${slotId}`
      : "";
  if (!id) throw new Error("This review has no stable batch, photo, and card identity.");
  await saveBackInsigniaReviewLabel({
    id,
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
  if (value === "estimated") return "code accepted; card outline estimated";
  if (value === "orientation_uncertain") return "card orientation uncertain";
  if (value === "code_only") return "code only; no complete card crop";
  if (value === "unavailable") return "photo location unavailable";
  return value || "geometry unknown";
}

function reviewSlotCatalogCard(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return { name: "", team: "" };
  const card = latestInventoryProjection?.catalog?.cards?.find(
    (candidate) => String(candidate?.code || "").trim().toUpperCase() === normalized,
  );
  return { name: String(card?.name || "").trim(), team: String(card?.team || "").trim() };
}

function reviewSlotCatalogName(code) {
  return reviewSlotCatalogCard(code).name;
}

async function saveInspectorCode(event) {
  event.preventDefault();
  const slot = selectedSlot();
  const input = event.target?.elements?.code;
  if (!slot || !input) return;
  const correctedCode = String(input.value || "").trim().toUpperCase();
  const photoId = photoForSlot(slot)?.id || "";
  const slotId = slot.id;
  const completedReviewKey = reviewKeyForSlot(slot, "code");
  const previous = {
    code: slot.code,
    name: slot.name,
    review_status: slot.review_status,
    needs_user_help: slot.needs_user_help,
    saved_review: slot.saved_review,
    code_review_status: slot.code_review_status,
    code_feedback_status: slot.code_feedback_status,
    code_decision_revision: Number(slot.code_decision_revision || 0),
  };
  const decisionRevision = previous.code_decision_revision + 1;
  const saveButton = event.target.querySelector("button[type='submit']");
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
  }
  try {
    slot.code = correctedCode;
    slot.name = reviewSlotCatalogName(correctedCode);
    slot.review_status = slot.code ? "matched" : "unreadable";
    slot.needs_user_help = false;
    slot.saved_review = true;
    slot.code_review_status = slot.code
      ? slot.code === slot.original_code ? "confirmed" : "corrected"
      : "unreadable";
    slot.code_feedback_status = "pending";
    slot.code_decision_revision = decisionRevision;
    setReviewInteractionDisabled(true);
    try {
      await persistReviewPhoto();
    } catch (error) {
      Object.assign(slot, previous);
      renderActiveReviewPhoto();
      reportReviewStorageFailure(error);
      return;
    } finally {
      setReviewInteractionDisabled(false);
    }
    await updateResultFromReviewSlots();
    renderReviewQueue();
    renderReviewSummary();
    renderInspector();
    drawPhotoReview();
    selectNextReviewSlot({ afterReviewKey: completedReviewKey });
    let feedbackSaved = true;
    try {
      await persistReviewLabel(slot, correctedCode);
    } catch {
      feedbackSaved = false;
    }
    try {
      const live = await persistLiveFeedbackStatus({
        photoId,
        slotId,
        revisionField: "code_decision_revision",
        revision: decisionRevision,
        feedbackField: "code_feedback_status",
        feedbackStatus: feedbackSaved ? "sent" : "failed",
      });
      if (!live) return;
      if (feedbackSaved) {
        status.textContent = live.slot.code ? `Saved correction ${live.slot.code}.` : "Saved unreadable card review.";
        showToast(live.slot.code ? `Saved ${live.slot.code}.` : "Saved unreadable card.");
        return;
      }
      status.textContent = "Decision saved on this phone; OCR feedback could not upload.";
      showToast("Saved locally; feedback upload failed.");
    } catch (error) {
      reportReviewStorageFailure(error);
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Review decision could not be saved on this phone.";
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
    normalized_back_insignia_box: slot.normalized_back_insignia_box || [],
  });
}

async function saveAllReviewSlotsCorrect() {
  const reviewedPhoto = activeReviewPhoto();
  const reviewedPhotoId = reviewedPhoto?.id || "";
  const slots = photoReviewState.slots.filter((slot) => slot.code && slotNeedsCodeReview(slot));
  const previousStates = slots.map((slot) => ({
    slot,
    state: {
      review_status: slot.review_status,
      needs_user_help: slot.needs_user_help,
      saved_review: slot.saved_review,
      code_review_status: slot.code_review_status,
      code_feedback_status: slot.code_feedback_status,
      code_decision_revision: Number(slot.code_decision_revision || 0),
    },
  }));
  if (!slots.length) return;
  if (reviewAllCorrectButton) {
    reviewAllCorrectButton.disabled = true;
    reviewAllCorrectButton.textContent = "Saving...";
  }
  try {
    for (const slot of slots) {
      slot.review_status = "matched";
      slot.needs_user_help = false;
      slot.saved_review = true;
      slot.code_review_status = "confirmed";
      slot.code_feedback_status = "pending";
      slot.code_decision_revision = Number(slot.code_decision_revision || 0) + 1;
    }
    setReviewInteractionDisabled(true);
    try {
      await persistReviewPhoto(reviewedPhoto);
    } catch (error) {
      for (const previous of previousStates) Object.assign(previous.slot, previous.state);
      renderActiveReviewPhoto();
      reportReviewStorageFailure(error);
      return;
    } finally {
      setReviewInteractionDisabled(false);
    }
    await updateResultFromReviewSlots();
    renderReviewQueue();
    renderReviewSummary();
    renderInspector();
    drawPhotoReview();
    selectNextReviewSlot({ afterReviewKey: photoReviewState.activeReviewKey });
    for (const slot of slots) {
      const slotId = slot.id;
      const decisionRevision = slot.code_decision_revision;
      let feedbackStatus = "sent";
      try {
        await persistReviewLabel(slot, slot.code);
      } catch {
        feedbackStatus = "failed";
      }
      await persistLiveFeedbackStatus({
        photoId: reviewedPhotoId,
        slotId,
        revisionField: "code_decision_revision",
        revision: decisionRevision,
        feedbackField: "code_feedback_status",
        feedbackStatus,
      });
    }
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
  latestScanCodes = aggregateReviewCodes();
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
  return { newCodes: [], inventoryCodes: [] };
}

function classifyCurrentScan() {
  return classifyScannedCards(latestScanCodes, latestInventoryProjection?.collectionModel || fallbackCollectionModel());
}

function fallbackCollectionModel() {
  return { byCode: {} };
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
  const received = currentScanReceivedLines();
  const receivedCount = received.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const insignias = summarizeScanInsignias(received);
  const insigniaSummary = [
    insignias.blue ? `${insignias.blue} blue` : "",
    insignias.green ? `${insignias.green} green` : "",
    insignias.unknown ? `${insignias.unknown} colour unknown` : "",
  ].filter(Boolean).join(" · ");
  const applied = isCurrentScanApplied();
  const catalogueReady = catalogHasCards(latestInventoryProjection?.catalog);
  collectionActions.hidden = false;
  addCollectionButton.disabled = applied || !catalogueReady || receivedCount === 0;
  addCollectionButton.textContent = applied ? "Added to collection" : "Add to collection";
  if (undoCollectionButton) {
    undoCollectionButton.hidden = !applied;
    undoCollectionButton.disabled = !applied;
  }
  collectionSummary.textContent = !catalogueReady
    ? "Collection catalogue unavailable. Codes remain in review evidence, but cannot be added safely."
    : applied
    ? `${total} scanned card${total === 1 ? "" : "s"} already added · ${insigniaSummary} · Undo to add again`
    : `${scanSummary.newForAlbum} new for album · ${scanSummary.newTradingCards} new trading card${scanSummary.newTradingCards === 1 ? "" : "s"} · ${scanSummary.duplicateTradingCards} duplicate trading card${scanSummary.duplicateTradingCards === 1 ? "" : "s"}${scanSummary.unrecognizedCards ? ` · ${scanSummary.unrecognizedCards} unrecognized and not added` : ""} · ${insigniaSummary}`;
}

function renderRecognizedCodeRows() {
  const groups = groupScannedCardStatuses(latestScanStatuses);
  const insigniasByCode = scanInsigniasByCode(currentScanReceivedLines());
  codesList.replaceChildren(...(groups.length
    ? groups.map((group) => compactCodeRow(group, insigniasByCode.get(group.code)))
    : [emptyRow("No recognized codes.")]));
}

async function addScanToCollection() {
  const received = currentScanReceivedLines();
  const receivedCount = received.reduce((total, line) => total + line.quantity, 0);
  if (!receivedCount) return;
  if (isCurrentScanApplied()) {
    status.textContent = "This scan was already added. Use Undo before adding it again.";
    showToast("Scan already added.");
    renderCollectionActions();
    return;
  }
  const ledger = loadLedger();
  const transactionPrefix = currentBatchTransactionPrefix();
  const attempt = ledger.transactions.filter((transaction) => transaction.id.startsWith(transactionPrefix)).length + 1;
  const nextLedger = createTransaction(ledger, {
    kind: "received",
    received,
    given: [],
    idFactory: () => `${transactionPrefix}${attempt}`,
  });
  const transactionId = nextLedger.transactions[nextLedger.transactions.length - 1]?.id || "";
  saveLedger(nextLedger);
  ensureActiveProfileId();
  latestAppliedScan = { signature: currentScanSignature(), transactionId };
  renderCollectionActions();
  try {
    await persistReviewBatchMeta();
  } catch (error) {
    reportReviewStorageFailure(error);
  }
  refreshScannerCollectionProjection().then(() => {
    latestCollectionSplit = splitCollectionCodes(latestScanCodes);
    renderCollectionActions();
    renderRecognizedCodeRows();
  });
  status.textContent = `Added ${receivedCount} scanned card${receivedCount === 1 ? "" : "s"} to collection activity with card-back colours.`;
  showToast("Scan added to collection.");
}

async function undoLastScanAdd() {
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
    try {
      await persistReviewBatchMeta();
    } catch (error) {
      reportReviewStorageFailure(error);
    }
    status.textContent = "That scan add was already undone elsewhere.";
    showToast("Already undone.");
    renderCollectionActions();
    return;
  }
  latestAppliedScan = { signature: "", transactionId: "" };
  renderCollectionActions();
  try {
    await persistReviewBatchMeta();
  } catch (error) {
    reportReviewStorageFailure(error);
  }
  refreshScannerCollectionProjection().then(() => {
    latestCollectionSplit = splitCollectionCodes(latestScanCodes);
    renderCollectionActions();
    renderRecognizedCodeRows();
  });
  status.textContent = "Scan add undone. You can add this scan again.";
  showToast("Scan add undone.");
}

function isCurrentScanApplied() {
  reconcileAppliedScanFromLedger();
  return Boolean(latestAppliedScan.transactionId && latestAppliedScan.signature === currentScanSignature());
}

function reconcileAppliedScanFromLedger() {
  if (!photoReviewState.id) return latestAppliedScan;
  const signature = currentScanSignature();
  const completed = loadLedger().transactions
    .filter((transaction) => transaction.id.startsWith(currentBatchTransactionPrefix()) && transaction.status === "completed")
    .reverse()
    .find((transaction) => scanReceiptSignature(transaction.received || []) === signature);
  latestAppliedScan = completed
    ? { signature, transactionId: completed.id }
    : { signature: "", transactionId: "" };
  return latestAppliedScan;
}

function currentBatchTransactionPrefix() {
  return `scan_${photoReviewState.id}_add_`;
}

function currentScanSignature() {
  return scanReceiptSignature(currentScanReceivedLines());
}

function currentScanReceivedLines() {
  const slots = photoReviewState.photos.flatMap((photo) => photo.status === "succeeded"
    ? (photo.slots || []).filter((slot) => slot.code && slotStatus(slot) === "matched")
    : []);
  const lines = receivedLinesForScan({ slots, fallbackCodes: latestScanCodes });
  if (!catalogHasCards(latestInventoryProjection?.catalog)) return [];
  return partitionCatalogLines(lines, latestInventoryProjection.catalog).accepted;
}

function renderReviewQueue() {
  const pending = pendingReviewItems();
  if (!reviewQueue || !reviewQueueText || !reviewNextButton) return;
  const codeCount = pending.filter((item) => item.kind === "code").length;
  const insigniaCount = pending.filter((item) => item.kind === "insignia").length;
  if (reviewAllCorrectButton) {
    const activePhotoCodeCount = photoReviewState.slots.filter((slot) => slot.code && slotNeedsCodeReview(slot)).length;
    reviewAllCorrectButton.hidden = activePhotoCodeCount === 0;
    reviewAllCorrectButton.disabled = activePhotoCodeCount === 0 || isCurrentScanApplied();
    reviewAllCorrectButton.textContent = photoReviewState.photos.length > 1 ? "Confirm codes in this photo" : "Confirm shown codes";
  }
  reviewQueue.hidden = pending.length === 0;
  reviewQueueText.textContent = reviewQueueSummary(codeCount, insigniaCount);
  reviewNextButton.disabled = pending.length === 0;
  reviewNextButton.textContent = photoReviewView.focused ? "Next review" : insigniaCount && !codeCount ? "Review backs" : "Start review";
  const activeItem = reviewItemByKey(photoReviewState.activeReviewKey);
  const activeItemMissing = activeItem && !reviewItemSlot(activeItem);
  const focused = photoReviewView.focused && selectedSlot();
  const total = photoReviewState.reviewItems.length;
  const completed = total - pending.length;
  if (focused && activeItem) reviewQueueText.textContent = `Review ${Math.min(total, completed + 1)} of ${total} · ${focused.code || "Unknown card"} · ${activeItem.kind === "code" ? "check code" : "choose back insignia"}`;
  if (activeItemMissing) reviewQueueText.textContent = "This retained review item could not be linked to its card. It remains in the queue; choose Next review to continue.";
  if (reviewToolbar) reviewToolbar.hidden = !focused;
}

function selectNextReviewSlot(options = {}) {
  const pending = pendingReviewItems();
  if (!pending.length) {
    showReviewOverview();
    renderReviewQueue();
    renderReviewSummary();
    return;
  }
  const currentKey = options.afterReviewKey || photoReviewState.activeReviewKey;
  const next = nextPendingReviewItem(photoReviewState.reviewItems, pending, currentKey);
  activateReviewItem(next);
}

function activateReviewItem(item, options = {}) {
  const located = reviewItemSlot(item);
  if (!located) {
    photoReviewState.activeReviewKey = String(item?.key || "");
    photoReviewState.selectedSlotId = "";
    photoReviewView = { focused: false, zoomFactor: 1 };
    if (reviewInspector) {
      reviewInspector.hidden = true;
      reviewInspector.replaceChildren();
    }
    console.error("Stored review item could not be linked to a retained card slot.", {
      batchId: photoReviewState.id,
      reviewItem: item,
    });
    renderReviewQueue();
    renderReviewSummary();
    if (status) status.textContent = "One retained review item could not be linked to its card. It was kept in the queue; choose Next review to continue.";
    return false;
  }
  photoReviewState.activeReviewKey = item.key;
  activateReviewPhoto(item.photoId, { render: false });
  photoReviewState.selectedSlotId = located.slot.id;
  const hasPhotoLocation = reviewSlotPolygon(located.slot).length >= 4;
  photoReviewView = { focused: hasPhotoLocation, zoomFactor: 1 };
  renderInspector();
  renderReviewQueue();
  renderReviewSummary();
  renderReviewPhotoNavigation();
  drawPhotoReview();
  if (options.persist !== false) persistReviewBatchMeta().catch(reportReviewStorageFailure);
  if (options.scroll !== false) (hasPhotoLocation ? reviewStage : reviewUnplaced)?.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

function showPreferredReviewItem(options = {}) {
  if (!photoReviewState.photos.length) return;
  if (!reviewsPage) {
    const scannerPhoto = photoReviewState.photos.find((photo) => photo.status === "succeeded")
      || photoReviewState.photos[0];
    photoReviewState.activeReviewKey = "";
    activateReviewPhoto(scannerPhoto.id, { render: false });
    showReviewOverview();
    renderActiveReviewPhoto();
    return;
  }
  const activePending = pendingReviewItems().find((item) => item.key === photoReviewState.activeReviewKey);
  if (activePending) {
    activateReviewItem(activePending, options);
    return;
  }
  const firstPending = pendingReviewItems()[0];
  if (firstPending) {
    activateReviewItem(firstPending, options);
    return;
  }
  const preferred = photoReviewState.photos.find((photo) => photo.id === photoReviewState.activePhotoId)
    || photoReviewState.photos.find((photo) => photo.status === "succeeded")
    || photoReviewState.photos[0];
  activateReviewPhoto(preferred.id);
}

function adjustReviewZoom(multiplier) {
  if (!photoReviewView.focused) return;
  photoReviewView.zoomFactor = Math.max(0.55, Math.min(3, photoReviewView.zoomFactor * multiplier));
  drawPhotoReview();
}

function showReviewOverview(options = {}) {
  photoReviewState.activeReviewKey = "";
  photoReviewView = { focused: false, zoomFactor: 1 };
  renderReviewQueue();
  drawPhotoReview();
  if (options.announce) {
    const count = photoReviewState.slots.length;
    showToast(`Showing the full submitted photo with ${count} annotation${count === 1 ? "" : "s"}.`);
  }
}

function finishReviewForNow() {
  showReviewOverview();
  const remaining = pendingReviewItems().length;
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
  if (slot.code_review_status) return slot.code_review_status === "pending";
  const hasNoSourceLocation = !slot.normalized_polygon?.length
    && !slot.normalized_code_anchor_box?.length
    && !slot.normalized_back_insignia_box?.length;
  return Boolean(!slot.code || slot.needs_user_help || (hasNoSourceLocation && !slot.saved_review) || slotStatus(slot) !== "matched");
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

function pendingReviewItems() {
  return photoReviewState.reviewItems.filter((item) => !reviewItemResolved(item));
}

function reviewItemResolved(item) {
  const located = reviewItemSlot(item);
  if (!located) return false;
  if (item.kind === "code") {
    if (located.slot.code_review_status) return located.slot.code_review_status !== "pending";
    return Boolean(located.slot.saved_review && !located.slot.needs_user_help);
  }
  return Boolean(located.slot.insignia_review_status);
}

function reviewItemSlot(item) {
  const photo = photoReviewState.photos.find((candidate) => candidate.id === item?.photoId);
  const slot = photo?.slots?.find((candidate) => candidate.id === item?.slotId);
  return photo && slot ? { photo, slot } : null;
}

function reviewItemByKey(key) {
  return photoReviewState.reviewItems.find((item) => item.key === key) || null;
}

function reviewKeyForSlot(slot, kind) {
  const photo = photoForSlot(slot);
  return photo ? reviewItemKey(photo.id, slot.id, kind) : "";
}

function photoForSlot(slot) {
  return photoReviewState.photos.find((photo) => photo.slots?.includes(slot)) || null;
}

function liveDecisionSlot(photoId, slotId, revisionField, revision) {
  const photo = photoReviewState.photos.find((candidate) => candidate.id === photoId);
  const slot = photo?.slots?.find((candidate) => candidate.id === slotId);
  if (!photo || !slot || Number(slot[revisionField] || 0) !== Number(revision || 0)) return null;
  return { photo, slot };
}

async function persistLiveFeedbackStatus({
  photoId,
  slotId,
  revisionField,
  revision,
  feedbackField,
  feedbackStatus,
  errorField = "",
  feedbackError = "",
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const live = liveDecisionSlot(photoId, slotId, revisionField, revision);
    if (!live) return null;
    const previousStatus = live.slot[feedbackField];
    const previousError = errorField ? live.slot[errorField] : undefined;
    live.slot[feedbackField] = feedbackStatus;
    if (errorField) live.slot[errorField] = feedbackError;
    try {
      await persistReviewPhoto(live.photo);
      return live;
    } catch (error) {
      live.slot[feedbackField] = previousStatus;
      if (errorField) live.slot[errorField] = previousError;
      if (!(error instanceof ReviewStateConflictError) || attempt > 0) throw error;
      await hydrateLatestReviewBatch();
    }
  }
  return null;
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
  if (code && reviewSlotPolygon(slot).length < 4) return "confirm code without photo location";
  if (code) return "check code";
  return "choose back insignia";
}

function formatConfidence(value) {
  return value ? `${Math.round(value * 100)}% confidence` : "confidence unknown";
}

function normalizedCodeCandidates(slot) {
  return reviewCodeCandidates(slot).candidates;
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => { toast.hidden = true; }, 2200);
}

function reportReviewStorageFailure(error) {
  const message = error instanceof Error ? error.message : "Review progress could not be saved on this phone.";
  console.error("Review storage write failed.", {
    name: error?.name || "UnknownError",
    message,
    causeName: error?.cause?.name || "",
    causeMessage: error?.cause?.message || "",
  });
  globalThis.navigator?.storage?.estimate?.().then((estimate) => {
    console.error("Review storage estimate after write failure.", {
      usage: Number(estimate?.usage || 0),
      quota: Number(estimate?.quota || 0),
    });
  }).catch(() => {});
  if (status) status.textContent = message;
  showToast(message);
  if (error instanceof ReviewStateConflictError) hydrateLatestReviewBatch();
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

function compactCodeRow(group, insignias = { blue: 0, green: 0, unknown: 0 }) {
  const row = document.createElement("li");
  row.className = "compactScanResultRow";
  const editionBar = document.createElement("span");
  editionBar.className = "compactScanEditionBar";
  editionBar.setAttribute("aria-hidden", "true");
  appendEditionBarSegment(editionBar, "blue", insignias.blue);
  appendEditionBarSegment(editionBar, "green", insignias.green);
  appendEditionBarSegment(editionBar, "unknown", insignias.unknown);
  const code = document.createElement("strong");
  code.className = "compactScanResultCode";
  code.textContent = group.code;
  if (group.quantity > 1) {
    const quantity = document.createElement("small");
    quantity.textContent = ` ×${group.quantity}`;
    code.append(quantity);
  }
  const editions = document.createElement("span");
  editions.className = "compactScanResultEditions";
  appendEditionMarker(editions, "blue", insignias.blue, "Rest of the World Edition");
  appendEditionMarker(editions, "green", insignias.green, "Swiss Edition");
  appendEditionMarker(editions, "unknown", insignias.unknown, "Edition colour unknown");
  const detail = document.createElement("span");
  detail.className = "compactScanResultDetail";
  detail.textContent = compactScannedCardGroupDetail(group);
  row.append(editionBar, code, editions, detail);
  return row;
}

function appendEditionBarSegment(bar, colour, quantity) {
  if (!quantity) return;
  const segment = document.createElement("span");
  segment.className = `is-${colour}`;
  segment.style.flexGrow = String(quantity);
  bar.append(segment);
}

function appendEditionMarker(container, colour, quantity, meaning) {
  if (!quantity) return;
  const marker = document.createElement("span");
  marker.className = `compactScanEdition is-${colour}`;
  marker.title = meaning;
  marker.setAttribute("aria-label", `${quantity} ${meaning}`);
  const prefix = colour === "blue" ? "B" : colour === "green" ? "G" : "?";
  marker.textContent = `${prefix}${quantity}`;
  container.append(marker);
}

function scanInsigniasByCode(lines) {
  const groups = new Map();
  for (const line of lines) {
    const counts = groups.get(line.code) || { blue: 0, green: 0, unknown: 0 };
    if (line.variant === SCAN_INSIGNIA_VARIANTS.blue) counts.blue += line.quantity;
    else if (line.variant === SCAN_INSIGNIA_VARIANTS.green) counts.green += line.quantity;
    else counts.unknown += line.quantity;
    groups.set(line.code, counts);
  }
  return groups;
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
