import {
  applyOcrBackendFromQuery,
  ocrToken,
  recognitionUrl,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-e05aae07cfc2";

const input = document.querySelector("#debugPhotoInput");
const analyzeButton = document.querySelector("#debugAnalyzeButton");
const status = document.querySelector("#debugStatus");
const canvas = document.querySelector("#photoCanvas");
const ctx = canvas?.getContext("2d");
const legend = document.querySelector("#overlayLegend");
const explanation = document.querySelector("#debugExplain");
const trace = document.querySelector("#algorithmTrace");

const SNAPSHOTS = [
  { id: "photo", title: "01 Big Photo" },
  { id: "card", title: "02 Card Zone" },
  { id: "pill", title: "03 Pill And OCR" },
  { id: "orientation", title: "04 Orientation / Anchors" },
];

applyOcrBackendFromQuery();

analyzeButton?.addEventListener("click", () => input?.click());
input?.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file) analyzePhoto(file);
});

async function analyzePhoto(file) {
  if (!ctx || !canvas) return;
  status.textContent = "Uploading photo for debug review...";
  analyzeButton.disabled = true;
  try {
    const payload = await postDebugPhoto(file);
    const result = payload.result || payload;
    await drawImageFile(file);
    const slot = firstDebugSlot(result);
    drawSnapshots(slot);
    renderOverlayLegend(slot);
    renderAlgorithmTrace(slot);
    renderAnchorLogic(slot);
    status.textContent = slot?.code ? `Debug loaded for ${slot.code}.` : "Debug loaded. No confident code found.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not inspect this photo.";
  } finally {
    analyzeButton.disabled = false;
    if (input) input.value = "";
  }
}

async function postDebugPhoto(file) {
  const activeToken = ocrToken();
  const headers = new Headers({ "Content-Type": file.type || "application/octet-stream" });
  if (activeToken) headers.set("Authorization", `Bearer ${activeToken}`);
  const url = "/api/photo-code-debug";
  const response = await fetch(recognitionUrl(url), {
    method: "POST",
    headers,
    body: file,
  });
  if (response.status === 401 || response.status === 403) throw new Error("Laptop OCR token is missing or incorrect.");
  if (!response.ok) throw new Error(`Debug analysis failed (${response.status}).`);
  return response.json();
}

async function drawImageFile(file) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = objectUrl;
    });
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || 900));
    const height = Math.max(1, Math.round(rect.height || 540));
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function firstDebugSlot(payload) {
  const slots = payload?.overview_map?.slots || payload?.slots || [];
  return slots[0] || payload?.slot || null;
}

function drawSnapshots(slot) {
  if (!explanation) return;
  const sections = SNAPSHOTS.map((snapshot) => renderSnapshotShell(snapshot, { embedded: true, slot, showTitle: true }));
  explanation.innerHTML = sections.join("");
}

function renderAlgorithmTrace(slot) {
  if (!trace) return;
  trace.innerHTML = algorithmSteps(slot)
    .map((step, index) => renderAlgorithmStep(step, index + 1, slot))
    .join("");
}

function algorithmSteps(slot) {
  return [
    { title: "Start from the photo", decision: "Use the full image before applying crop assumptions.", snapshot: "photo" },
    { title: "Check the four anchors", decision: "Compare selected_code_anchor with observed_code_anchors and nearby_code_anchors.", snapshot: "orientation" },
    { title: "Read the pill", decision: "Use the normalized_code_text_box before accepting OCR text.", snapshot: "pill" },
    { title: "Render only computed overlays", decision: hasCardBoundary(slot) ? "Card boundary available." : "No yellow card boundary is shown when the backend did not compute one.", snapshot: "card" },
  ];
}

function renderAlgorithmStep(step, number, slot) {
  const section = { ...step, title: `${number}. ${step.title}` };
  const snapshotHtml = section.snapshot
    ? renderSnapshotShell(snapshotById(section.snapshot), { embedded: true, slot })
    : "";
  return `<article class="algorithmStep"><strong>${escapeHtml(section.title)}</strong><span class="stepDecision">${escapeHtml(section.decision)}</span>${snapshotHtml}</article>`;
}

function renderSnapshotShell(snapshot, { embedded = false, slot, showTitle = true } = {}) {
  const imageSnippet = snapshot ? renderSnapshotImage(slot, snapshot) : "";
  const className = embedded ? "debugCheck embedded" : "debugCheck";
  const title = showTitle ? `<h2>${escapeHtml(snapshot?.title || "Debug snapshot")}</h2>` : "";
  return `<section class="${className}">${title}${imageSnippet}${renderCheckExplanation(snapshot, slot, snapshot)}</section>`;
}

function renderSnapshotImage(slot, kind) {
  const snapshot = kind;
  const src = renderSnapshotDataImage(slot, snapshot.id);
  return src ? `<img class="debugImage" src="${src}" alt="${escapeHtml(snapshot.title)}">` : "<p>No snapshot image returned.</p>";
}

function renderSnapshotDataImage(slot, kind) {
  const data = slot?.debug_images?.[kind] || slot?.snapshots?.[kind] || slot?.[`${kind}_image`];
  if (!data) return "";
  if (String(data).startsWith("data:")) return data;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = 1;
  canvasEl.height = 1;
  return canvasEl.toDataURL("image/jpeg", 0.86);
}

function renderOverlayLegend(slot = null) {
  if (!legend) return "";
  let boundaryLabel = "No yellow card boundary is shown";
  if (hasCardBoundary(slot)) {
    boundaryLabel = "Yellow: card boundary";
  }
  const labels = [
    "Green: accepted OCR/code",
    boundaryLabel,
    "Blue: normalized code text box",
  ];
  legend.replaceChildren(...labels.map((label) => {
    const item = document.createElement("span");
    item.textContent = label;
    return item;
  }));
  return labels.join(" · ");
}

function hasCardBoundary(slot) {
  return Boolean(slot?.card_boundary || slot?.card_polygon || slot?.normalized_card_box);
}

function renderCheckExplanation(check, slot, snapshot) {
  const kind = checkSnapshotKind(check || snapshot);
  return `<p>${escapeHtml(kind)} · ${escapeHtml(slot?.code || "no code selected")}</p>`;
}

function renderAnchorLogic(slot) {
  if (!explanation) return;
  const anchors = [
    renderAnchorCard("Selected anchor", slot?.selected_code_anchor),
    renderAnchorCard("Observed anchors", slot?.observed_code_anchors),
    renderAnchorCard("Nearby anchors", slot?.nearby_code_anchors),
  ].join("");
  explanation.insertAdjacentHTML("beforeend", `<section class="anchorLogic"><h2>Anchor logic</h2><ol><li>Find selected_code_anchor.</li><li>Compare observed_code_anchors.</li><li>Check nearby_code_anchors.</li></ol>${anchors}</section>`);
}

function renderAnchorCard(title, anchor) {
  const normalizedBox = anchor ? anchor.normalized_box : null;
  return `<article class="anchorCard"><h3>${escapeHtml(title)}</h3>${renderAnchorImage(anchor)}<p>${escapeHtml(JSON.stringify(normalizedBox || anchor || null))}</p></article>`;
}

function renderAnchorImage(anchor) {
  const src = anchor?.image || anchor?.data_url || "";
  return src ? `<img class="anchorImage" src="${src}" alt="anchor crop">` : '<div class="anchorImage">No anchor image</div>';
}

function drawAnchorSnapshot(canvasEl, anchor) {
  const context = canvasEl?.getContext?.("2d");
  if (!context) return;
  context.clearRect(0, 0, canvasEl.width, canvasEl.height);
  context.fillStyle = anchor?.normalized_box ? "#00c2a8" : "#3a414a";
  context.fillRect(0, 0, canvasEl.width, canvasEl.height);
}

function snapshotById(id) {
  return SNAPSHOTS.find((snapshot) => snapshot.id === id) || null;
}

function checkSnapshotKind(check) {
  if (!check) return "no check";
  if (check.id === "pill") return "normalized_code_text_box";
  if (check.id === "orientation") return "selected_code_anchor";
  return check.id || "photo";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
