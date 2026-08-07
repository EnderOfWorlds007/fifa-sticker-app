import {
  applyOcrBackendFromQuery,
  createAlbumPageJob,
  ocrToken,
  recognitionBaseUrl,
  recognitionUrl,
  saveOcrBackendSettings,
  waitForAlbumPageJob,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-682d67b32ef4";
import { mountTradePasteBox } from "/fifa-sticker-app/v2/assets/trade_paste_box.js?v=build-682d67b32ef4";

const status = document.querySelector("#gettingStartedStatus");
const albumPhotoButton = document.querySelector("#albumPhotoButton");
const albumPhotoInput = document.querySelector("#albumPhotoInput");
const albumParseList = document.querySelector("#albumParseList");
const copyButton = document.querySelector("#copyGettingStartedText");
const backendUrlInput = document.querySelector("[data-ocr-backend-url]");
const backendTokenInput = document.querySelector("[data-ocr-backend-token]");
const backendSaveButton = document.querySelector("[data-ocr-backend-save]");
const backendTestButton = document.querySelector("[data-ocr-backend-test]");
const backendStatus = document.querySelector("[data-ocr-backend-status]");

applyOcrBackendFromQuery();
const pasteBox = mountTradePasteBox('[data-trade-paste-box="getting-started"]', {
  label: "Starting notes and album inventory",
  textareaId: "gettingStartedText",
  rows: 8,
  autofocus: true,
  placeholder: "Paste notes, dictate what you have, or scan album pages. Album scans append filled / empty / needs-review slots here.",
  capabilities: { voice: true },
  hint: {
    id: "gettingStartedHint",
    text: "Album photos should show two facing roster pages. The laptop backend crops, orients, and estimates filled vs empty slots.",
  },
});

initializeBackendSettings();
albumPhotoButton?.addEventListener("click", () => albumPhotoInput?.click());
albumPhotoInput?.addEventListener("change", () => scanAlbumPhotos());
copyButton?.addEventListener("click", async () => {
  const text = pasteBox?.textarea?.value || "";
  if (!text) return;
  await navigator.clipboard?.writeText(text);
  setStatus("Text copied.");
});

async function scanAlbumPhotos() {
  const files = [...(albumPhotoInput?.files || [])];
  if (!files.length) return;
  if (!recognitionBaseUrl()) {
    setStatus("Add the laptop OCR backend URL before scanning album pages.");
    return;
  }
  albumPhotoButton.disabled = true;
  albumPhotoButton.setAttribute("aria-busy", "true");
  try {
    const summaries = [];
    for (let index = 0; index < files.length; index += 1) {
      setStatus(`Preparing album photo ${index + 1}/${files.length}...`);
      const uploadFile = await albumUploadFile(files[index]);
      setStatus(`Uploading album photo ${index + 1}/${files.length}...`);
      const job = await createAlbumPageJob(uploadFile);
      const payload = job.status === "done"
        ? job
        : await waitForAlbumPageJob(job.job_id, {
          onStatus: (message) => setStatus(`${message} ${index + 1}/${files.length}`),
        });
      const result = payload.result || payload;
      summaries.push(String(result.summary_text || "").trim());
      renderAlbumResult(result, files[index].name);
    }
    appendText(summaries.filter(Boolean).join("\n\n"));
    setStatus(`Parsed ${files.length} album photo${files.length === 1 ? "" : "s"}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Album page scan failed.");
  } finally {
    albumPhotoButton.disabled = false;
    albumPhotoButton.setAttribute("aria-busy", "false");
    albumPhotoInput.value = "";
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
  const imageUrl = result.focused_image_url ? recognitionUrl(result.focused_image_url) : "";
  const slots = Array.isArray(result.slots) ? result.slots : [];
  const counts = countSlotStates(slots);
  card.innerHTML = `
    <div class="albumParseHeader">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${counts.filled} filled · ${counts.empty} empty · ${counts.unknown} review</p>
      </div>
    </div>
    ${imageUrl ? `<img class="albumParseImage" src="${escapeAttribute(imageUrl)}" alt="">` : ""}
    <pre class="albumParseSummary"></pre>
    <ol class="albumSlotList"></ol>
  `;
  card.querySelector(".albumParseSummary").textContent = result.summary_text || "";
  const list = card.querySelector(".albumSlotList");
  list.replaceChildren(...slots.map(slotRow));
  albumParseList.prepend(card);
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
    const response = await fetch(recognitionUrl("/readyz"), { cache: "no-store" });
    if (!response.ok) throw new Error(`Backend check failed (${response.status}).`);
    updateBackendStatus("Backend ready.");
  } catch {
    updateBackendStatus("Could not reach that backend.");
  } finally {
    backendTestButton.disabled = false;
  }
}

function updateBackendStatus(message) {
  if (!backendStatus) return;
  backendStatus.textContent = message || (recognitionBaseUrl() ? `Using ${recognitionBaseUrl()}` : "Recognition backend is not configured.");
}

function setStatus(message) {
  if (status) status.textContent = message;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function escapeAttribute(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
