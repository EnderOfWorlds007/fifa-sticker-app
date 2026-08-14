import {
  albumPageBackendReadiness,
  applyOcrBackendFromQuery,
  createAlbumPageJob,
  ocrToken,
  recognitionBaseUrl,
  recognitionUrl,
  saveOcrBackendSettings,
  waitForAlbumPageJob,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-2c133a7da1c4";
import {
  albumPageInventoryChanges,
  applyAlbumPageResultToInventory,
} from "/fifa-sticker-app/v2/assets/album_inventory_state.js?v=build-2c133a7da1c4";
import { mountTradePasteBox } from "/fifa-sticker-app/v2/assets/trade_paste_box.js?v=build-2c133a7da1c4";

const status = document.querySelector("#gettingStartedStatus");
const scanActions = document.querySelector(".gettingStartedScanActions");
const albumPhotoButton = document.querySelector("#albumPhotoButton");
const albumPhotoInput = document.querySelector("#albumPhotoInput");
const albumPhotoStatus = document.querySelector("#albumPhotoStatus");
const albumParseList = document.querySelector("#albumParseList");
const copyButton = document.querySelector("#copyGettingStartedText");
const backendUrlInput = document.querySelector("[data-ocr-backend-url]");
const backendTokenInput = document.querySelector("[data-ocr-backend-token]");
const backendSaveButton = document.querySelector("[data-ocr-backend-save]");
const backendTestButton = document.querySelector("[data-ocr-backend-test]");
const backendStatus = document.querySelector("[data-ocr-backend-status]");
let albumScanRunning = false;
let lastAlbumSelectionSignature = "";

applyOcrBackendFromQuery();
const pasteBox = mountTradePasteBox('[data-trade-paste-box="getting-started"]', {
  label: "Starting notes and album inventory",
  textareaId: "gettingStartedText",
  rows: 8,
  autofocus: true,
  placeholder: "Paste a card list, dictate card codes, scan album pages, or scan loose card backs. Recognized cards are added here before you save them.",
  capabilities: { voice: true },
  hint: {
    id: "gettingStartedHint",
    text: "Album photos should show two facing roster pages. The laptop backend crops, orients, and estimates filled vs empty slots.",
  },
});

placeScanActionsBeforeVoice();
initializeBackendSettings();
albumPhotoButton?.addEventListener("click", () => {
  lastAlbumSelectionSignature = "";
  albumPhotoInput?.click();
});
albumPhotoInput?.addEventListener("input", handleAlbumPhotoSelection);
albumPhotoInput?.addEventListener("change", handleAlbumPhotoSelection);
copyButton?.addEventListener("click", async () => {
  const text = pasteBox?.textarea?.value || "";
  if (!text) return;
  await navigator.clipboard?.writeText(text);
  setStatus("Text copied.");
});

function handleAlbumPhotoSelection() {
  const files = [...(albumPhotoInput?.files || [])];
  if (!files.length) return;
  const signature = files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
  if (!signature || signature === lastAlbumSelectionSignature) return;
  lastAlbumSelectionSignature = signature;
  if (albumScanRunning) return;
  albumScanRunning = true;
  scanAlbumPhotos(files).finally(() => {
    albumScanRunning = false;
    if (albumPhotoInput) albumPhotoInput.value = "";
  });
}

async function scanAlbumPhotos(files) {
  const selected = [...(files || [])];
  if (!selected.length) return;
  if (!recognitionBaseUrl()) {
    showAlbumScanMessage("Album scan", "Add the laptop OCR backend URL before scanning album pages.");
    return;
  }
  const summaries = [];
  let failureCount = 0;
  let lastError = null;
  setAlbumScanProgress(`Preparing album photos...`);
  try {
    const readiness = await ensureAlbumBackendReady();
    if (!readiness) return;
    for (let index = 0; index < selected.length; index += 1) {
      setAlbumScanProgress(`Scanning album page... ${index + 1}/${selected.length}`);
      try {
        const uploadFile = await albumUploadFile(selected[index]);
        const job = await createAlbumPageJob(uploadFile);
        const payload = job.status === "done"
          ? job
          : await waitForAlbumPageJob(job.job_id, {
            onStatus: (message) => setAlbumScanProgress(`${message} ${index + 1}/${selected.length}`),
          });
        const result = payload.result || payload;
        summaries.push(String(result.summary_text || "").trim());
        renderAlbumResult(result, selected[index].name);
      } catch (error) {
        failureCount += 1;
        lastError = error;
      }
    }
    appendText(summaries.filter(Boolean).join("\n\n"));
    if (!summaries.length) {
      showAlbumScanMessage("Album scan", albumScanErrorMessage(lastError));
      return;
    }
    const success = `Parsed ${summaries.length}/${selected.length} album photo${selected.length === 1 ? "" : "s"}.`;
    const failures = failureCount ? ` ${failureCount} photo${failureCount === 1 ? "" : "s"} could not be read.` : "";
    showAlbumScanMessage("Album scan", `${success}${failures}`);
  } catch (error) {
    showAlbumScanMessage("Album scan", albumScanErrorMessage(error));
  } finally {
    resetAlbumScanButton();
  }
}

async function albumUploadFile(file) {
  if (!file || !window.createImageBitmap || !document.createElement) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 2200;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return file;
    const baseName = String(file.name || "album-photo").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function renderAlbumResult(result, filename) {
  const card = document.createElement("article");
  card.className = "albumParseCard";
  const template = result.template || {};
  const title = template.team || template.page_label || filename || "Album page";
  const imageUrl = result.focused_image_url || "";
  const slots = Array.isArray(result.slots) ? result.slots.map((slot) => ({ ...slot })) : [];
  const editableResult = { ...result, slots };
  const counts = countSlotStates(slots);
  const changes = albumPageInventoryChanges(editableResult);
  card.innerHTML = `
    <div class="albumParseHeader">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p data-album-counts>${albumCountsText(counts)}</p>
      </div>
    </div>
    ${imageUrl ? `<div class="albumParseImageFrame"><img class="albumParseImage" alt=""><canvas class="albumParseOverlay"></canvas><span class="albumParseImageStatus">Loading photo...</span></div>` : ""}
    <pre class="albumParseSummary"></pre>
    <div class="tradeLookupActions albumInventoryActions">
      <button class="secondaryButton" data-apply-album-result type="button"${changes.length ? "" : " disabled"}>Apply to inventory</button>
      <span class="hint" data-album-inventory-status>${changes.length} ready · ${counts.unknown} review</span>
    </div>
    <ol class="albumSlotList"></ol>
  `;
  card.querySelector("[data-apply-album-result]")?.addEventListener("click", (event) => applyAlbumResult(editableResult, event.currentTarget, card));
  albumParseList.prepend(card);
  updateAlbumResultCard(card, editableResult);
  card.querySelector(".albumSlotList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-slot-index]");
    if (!row) return;
    toggleAlbumSlot(editableResult, Number(row.dataset.slotIndex), card);
  });
  if (imageUrl) {
    card.querySelector(".albumParseOverlay")?.addEventListener("click", (event) => handleAlbumOverlayTap(event, editableResult, card));
    installAlbumOverlayResizeRedraw(card, editableResult);
    loadAlbumResultImage(card, imageUrl, editableResult);
  }
}

async function loadAlbumResultImage(card, path, result) {
  const image = card.querySelector(".albumParseImage");
  const statusNode = card.querySelector(".albumParseImageStatus");
  if (!image) return;
  try {
    const response = await fetch(backendAssetUrl(path), withBackendAuth({ cache: "no-store" }));
    if (!response.ok) throw new Error(`Image load failed (${response.status})`);
    const objectUrl = URL.createObjectURL(await response.blob());
    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      if (statusNode) statusNode.remove();
      drawAlbumOverlay(card, result);
    }, { once: true });
    image.src = objectUrl;
  } catch {
    if (statusNode) statusNode.textContent = "Could not load photo preview.";
  }
}

function backendAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(String(path))) return path;
  return recognitionUrl(path);
}

function withBackendAuth(options = {}) {
  const headers = new Headers(options.headers || {});
  const token = ocrToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return { ...options, headers };
}

function applyAlbumResult(result, button, card) {
  if (!button) return;
  button.disabled = true;
  try {
    const applied = applyAlbumPageResultToInventory(result);
    const statusNode = card?.querySelector("[data-album-inventory-status]");
    const message = applied.applied
      ? `Saved ${applied.filled} in album · ${applied.empty} empty · ${applied.skipped} skipped`
      : `Nothing saved · ${applied.skipped} needs review`;
    if (statusNode) statusNode.textContent = message;
    setStatus(`${message}. Collection and Compare now use this inventory.`);
  } catch {
    button.disabled = false;
    const statusNode = card?.querySelector("[data-album-inventory-status]");
    if (statusNode) statusNode.textContent = "Could not save album page.";
    setStatus("Could not save album page to inventory.");
  }
}

function updateAlbumResultCard(card, result) {
  const slots = Array.isArray(result.slots) ? result.slots : [];
  const counts = countSlotStates(slots);
  const changes = albumPageInventoryChanges(result);
  const countsNode = card.querySelector("[data-album-counts]");
  if (countsNode) countsNode.textContent = albumCountsText(counts);
  const summaryNode = card.querySelector(".albumParseSummary");
  if (summaryNode) summaryNode.textContent = albumSummaryText(result);
  const applyButton = card.querySelector("[data-apply-album-result]");
  if (applyButton) applyButton.disabled = changes.length === 0;
  const statusNode = card.querySelector("[data-album-inventory-status]");
  if (statusNode) statusNode.textContent = `${changes.length} ready · ${counts.unknown} review`;
  const list = card.querySelector(".albumSlotList");
  list?.replaceChildren(...slots.map((slot, index) => slotRow(slot, index)));
  drawAlbumOverlay(card, result);
}

function slotRow(slot, index) {
  const row = document.createElement("li");
  row.dataset.slotIndex = String(index);
  row.dataset.state = normalizedSlotState(slot);
  row.dataset.review = String(slot.review_required === true);
  const label = slot.code || `Slot ${slot.ordinal}`;
  row.innerHTML = `<strong>${escapeHtml(label)}</strong><span>${slotStatusText(slot)}</span>`;
  return row;
}

function countSlotStates(slots) {
  return slots.reduce((counts, slot) => {
    const state = displaySlotState(slot);
    counts[state] += 1;
    return counts;
  }, { filled: 0, empty: 0, unknown: 0 });
}

function normalizedSlotState(slot) {
  return slot?.state === "filled" || slot?.state === "empty" ? slot.state : "unknown";
}

function displaySlotState(slot) {
  if (slot?.review_required === true) return "unknown";
  return normalizedSlotState(slot);
}

function slotStatusText(slot) {
  const state = displaySlotState(slot);
  return state === "unknown" ? "review" : state;
}

function albumCountsText(counts) {
  return `${counts.filled} filled · ${counts.empty} empty · ${counts.unknown} review`;
}

function albumSummaryText(result) {
  const slots = Array.isArray(result.slots) ? result.slots : [];
  const filled = slots.filter((slot) => normalizedSlotState(slot) === "filled" && slot.review_required !== true);
  const empty = slots.filter((slot) => normalizedSlotState(slot) === "empty" && slot.review_required !== true);
  const review = slots.filter((slot) => slot.review_required === true || normalizedSlotState(slot) === "unknown");
  const title = result?.template?.team || result?.template?.page_label || "Album page";
  return [
    `${title}:`,
    `Filled: ${albumSlotLabels(filled)}`,
    `Empty: ${albumSlotLabels(empty)}`,
    `Needs review: ${albumSlotLabels(review)}`,
  ].join("\n");
}

function albumSlotLabels(slots) {
  return slots.map((slot) => slot.code || slot.ordinal).filter(Boolean).join(", ") || "None";
}

function toggleAlbumSlot(result, index, card) {
  const slot = result?.slots?.[index];
  if (!slot) return;
  const current = normalizedSlotState(slot);
  const next = slot.review_required === true || current === "unknown"
    ? "filled"
    : current === "filled"
      ? "empty"
      : "filled";
  slot.state = next;
  slot.review_required = false;
  slot.confidence = Math.max(Number(slot.confidence || 0), 0.99);
  updateAlbumResultCard(card, result);
}

function handleAlbumOverlayTap(event, result, card) {
  const overlay = card.querySelector(".albumParseOverlay");
  if (!overlay || !Array.isArray(result?.slots)) return;
  const rect = overlay.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  for (let index = result.slots.length - 1; index >= 0; index -= 1) {
    const polygon = slotPolygon(result.slots[index]).map(([x, y]) => transformAlbumPoint(x, y, rect));
    if (pointInPolygon(point, polygon)) {
      toggleAlbumSlot(result, index, card);
      return;
    }
  }
}

function drawAlbumOverlay(card, result) {
  const image = card.querySelector(".albumParseImage");
  const overlay = card.querySelector(".albumParseOverlay");
  if (!image || !overlay || !image.complete || !image.naturalWidth) return;
  const rect = overlay.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  overlay.width = Math.max(1, Math.round(rect.width * ratio));
  overlay.height = Math.max(1, Math.round(rect.height * ratio));
  const ctx = overlay.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const slots = Array.isArray(result?.slots) ? result.slots : [];
  for (const slot of slots) drawAlbumSlotOverlay(ctx, slot, rect);
}

function installAlbumOverlayResizeRedraw(card, result) {
  const frame = card.querySelector(".albumParseImageFrame");
  if (!frame) return;
  const redraw = () => drawAlbumOverlay(card, result);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(redraw);
    observer.observe(frame);
  } else {
    window.addEventListener("resize", redraw);
  }
}

function drawAlbumSlotOverlay(ctx, slot, rect) {
  const points = slotPolygon(slot).map(([x, y]) => transformAlbumPoint(x, y, rect));
  if (points.length < 3) return;
  const state = displaySlotState(slot);
  const review = state === "unknown";
  const color = review ? "#f1be59" : state === "filled" ? "#28d17c" : "#63a9ff";
  ctx.beginPath();
  points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
  ctx.closePath();
  ctx.fillStyle = review ? "rgba(241, 190, 89, 0.13)" : state === "filled" ? "rgba(40, 209, 124, 0.14)" : "rgba(99, 169, 255, 0.13)";
  ctx.strokeStyle = color;
  ctx.lineWidth = review ? 3 : 2;
  ctx.setLineDash(review ? [6, 4] : state === "empty" ? [8, 5] : []);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  const center = points.reduce((acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }), { x: 0, y: 0 });
  const label = slot.code || slot.ordinal || "";
  const stateLetter = review ? "?" : state === "filled" ? "F" : "E";
  const text = `${label} ${stateLetter}`.trim();
  ctx.font = "800 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const width = Math.max(34, ctx.measureText(text).width + 12);
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.fillRect(center.x - width / 2, center.y - 12, width, 24);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, center.x, center.y);
}

function slotPolygon(slot) {
  return Array.isArray(slot?.polygon) ? slot.polygon : [];
}

function transformAlbumPoint(x, y, rect) {
  return { x: Number(x) * rect.width, y: Number(y) * rect.height };
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

function appendText(text) {
  if (!text || !pasteBox?.textarea) return;
  const current = pasteBox.textarea.value.trim();
  pasteBox.textarea.value = current ? `${current}\n\n${text}` : text;
  pasteBox.textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function initializeBackendSettings() {
  if (backendUrlInput) backendUrlInput.value = recognitionBaseUrl();
  if (backendTokenInput) backendTokenInput.value = ocrToken();
  updateBackendStatus();
  backendSaveButton?.addEventListener("click", saveBackendSettings);
  backendTestButton?.addEventListener("click", () => testBackend());
}

function saveBackendSettings() {
  const saved = saveOcrBackendSettings({
    baseUrl: backendUrlInput?.value || "",
    token: backendTokenInput?.value || "",
  });
  if (backendUrlInput) backendUrlInput.value = saved.baseUrl;
  updateBackendStatus("Backend saved.");
}

async function testBackend() {
  saveBackendSettings();
  const base = recognitionBaseUrl();
  if (!base) {
    updateBackendStatus("Add a laptop URL first.");
    return;
  }
  backendTestButton.disabled = true;
  updateBackendStatus("Testing backend...");
  try {
    const readiness = await albumPageBackendReadiness();
    if (!readiness.available) {
      updateBackendStatus("Backend is reachable, but album-page scanning is not enabled.");
      return;
    }
    if (readiness.authRequired && !ocrToken()) {
      updateBackendStatus("Backend needs the OCR token. Open the test URL with token=... or paste the token here.");
      return;
    }
    updateBackendStatus("Backend ready for album pages.");
  } catch (error) {
    updateBackendStatus(backendReachabilityErrorMessage(error));
  } finally {
    backendTestButton.disabled = false;
  }
}

function updateBackendStatus(message) {
  if (!backendStatus) return;
  backendStatus.textContent = message || (recognitionBaseUrl() ? `Using ${recognitionBaseUrl()}` : "Recognition backend is not configured.");
}

async function ensureAlbumBackendReady() {
  try {
    const readiness = await albumPageBackendReadiness();
    if (!readiness.available) {
      showAlbumScanMessage("Album scan", "The laptop backend is reachable, but album-page scanning is not enabled.");
      return null;
    }
    if (readiness.authRequired && !ocrToken()) {
      showAlbumScanMessage("Album scan", "This laptop backend needs the OCR token. Open the test URL with token=... or paste the token in OCR backend.");
      return null;
    }
    return readiness;
  } catch (error) {
    showAlbumScanMessage("Album scan", backendReachabilityErrorMessage(error));
    return null;
  }
}

function backendReachabilityErrorMessage(error) {
  if (error?.name === "AbortError") return "Backend check timed out. Make sure the laptop is awake and Tailscale Funnel is online.";
  return "Could not reach the laptop OCR backend.";
}

function placeScanActionsBeforeVoice() {
  if (!scanActions || !pasteBox?.root) return;
  const voiceBlock = pasteBox.root.querySelector(".liveTranscriptPanel, .pasteCapabilityActions");
  if (voiceBlock) {
    pasteBox.root.insertBefore(scanActions, voiceBlock);
    if (albumPhotoStatus) pasteBox.root.insertBefore(albumPhotoStatus, voiceBlock);
    return;
  }
  pasteBox.root.append(scanActions);
  if (albumPhotoStatus) pasteBox.root.append(albumPhotoStatus);
}

function setStatus(message) {
  if (status) status.textContent = message;
}

function setAlbumScanProgress(message) {
  if (albumPhotoButton) {
    albumPhotoButton.disabled = true;
    albumPhotoButton.classList.add("scanning");
    albumPhotoButton.setAttribute("aria-busy", "true");
    albumPhotoButton.textContent = message;
  }
  if (copyButton) copyButton.disabled = true;
  const scanCardsButton = document.querySelector("#scanCardsButton");
  scanCardsButton?.setAttribute("aria-disabled", "true");
  showAlbumScanMessage("Album scan", message, { busy: true });
}

function resetAlbumScanButton() {
  if (albumPhotoButton) {
    albumPhotoButton.disabled = false;
    albumPhotoButton.classList.remove("scanning");
    albumPhotoButton.setAttribute("aria-busy", "false");
    albumPhotoButton.textContent = "Scan album pages";
  }
  if (copyButton) copyButton.disabled = false;
  const scanCardsButton = document.querySelector("#scanCardsButton");
  scanCardsButton?.removeAttribute("aria-disabled");
  if (albumPhotoStatus) albumPhotoStatus.setAttribute("aria-busy", "false");
}

function showAlbumScanMessage(label, text, { busy = false } = {}) {
  setStatus(text);
  if (!albumPhotoStatus) return;
  albumPhotoStatus.hidden = false;
  albumPhotoStatus.setAttribute("aria-busy", String(busy));
  albumPhotoStatus.innerHTML = `<span class="pasteCapabilityStatusLabel">${escapeHtml(label)}</span><span class="pasteCapabilityStatusText">${escapeHtml(text)}</span>`;
}

function albumScanErrorMessage(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("(404)")) {
    return "Album scanning reached the laptop backend, but that backend does not expose album-page scanning yet. Restart/update the backend, then try again.";
  }
  return message || "Album page scan failed.";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function escapeAttribute(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
