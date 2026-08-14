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
  const slots = Array.isArray(result.slots) ? result.slots : [];
  const counts = countSlotStates(slots);
  const changes = albumPageInventoryChanges(result);
  card.innerHTML = `
    <div class="albumParseHeader">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${counts.filled} filled · ${counts.empty} empty · ${counts.unknown} review</p>
      </div>
    </div>
    ${imageUrl ? `<div class="albumParseImageFrame"><img class="albumParseImage" alt=""><span class="albumParseImageStatus">Loading photo...</span></div>` : ""}
    <pre class="albumParseSummary"></pre>
    <div class="tradeLookupActions albumInventoryActions">
      <button class="secondaryButton" data-apply-album-result type="button"${changes.length ? "" : " disabled"}>Apply to inventory</button>
      <span class="hint" data-album-inventory-status>${changes.length} ready · ${counts.unknown} review</span>
    </div>
    <ol class="albumSlotList"></ol>
  `;
  card.querySelector(".albumParseSummary").textContent = result.summary_text || "";
  card.querySelector("[data-apply-album-result]")?.addEventListener("click", (event) => applyAlbumResult(result, event.currentTarget, card));
  const list = card.querySelector(".albumSlotList");
  list.replaceChildren(...slots.map(slotRow));
  albumParseList.prepend(card);
  if (imageUrl) loadAlbumResultImage(card, imageUrl);
}

async function loadAlbumResultImage(card, path) {
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

function slotRow(slot) {
  const row = document.createElement("li");
  row.dataset.state = slot.state || "unknown";
  const label = slot.code || `Slot ${slot.ordinal}`;
  row.innerHTML = `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(slot.state || "unknown")}</span>`;
  return row;
}

function countSlotStates(slots) {
  return slots.reduce((counts, slot) => {
    const state = slot.state === "filled" || slot.state === "empty" ? slot.state : "unknown";
    counts[state] += 1;
    return counts;
  }, { filled: 0, empty: 0, unknown: 0 });
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
