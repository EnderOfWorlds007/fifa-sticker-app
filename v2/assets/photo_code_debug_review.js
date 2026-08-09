import {
  applyOcrBackendFromQuery,
  ocrToken,
  recognitionBaseUrl,
  recognitionUrl,
  saveOcrBackendSettings,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-photo-code-debug-4";

const statusEl = document.querySelector("#debugStatus");
const tokenPanel = document.querySelector("#tokenPanel");
const tokenInput = document.querySelector("#tokenInput");
const saveToken = document.querySelector("#saveToken");
const changeToken = document.querySelector("#changeToken");
const uploadSelect = document.querySelector("#uploadSelect");
const reloadButton = document.querySelector("#reloadButton");
const canvas = document.querySelector("#photoCanvas");
const ctx = canvas.getContext("2d");
const loadingState = document.querySelector("#loadingState");
const panel = document.querySelector("#slotPanel");
const slotList = document.querySelector("#slotList");
const DEBUG_REVIEW_TOKEN_KEY = "panini.debugReviewToken";

let payload = null;
let selectedSlotId = null;
let image = new Image();
let imageObjectUrl = null;
let drawRect = { x: 0, y: 0, width: 1, height: 1 };
let activeToken = "";
const SNAPSHOTS = [
  {
    id: "full",
    title: "01 Big Photo",
    description: "Full captured photo with the selected card, pill anchor, and OCR text box highlighted.",
  },
  {
    id: "card",
    title: "02 Card Zone",
    description: "Zoom around the selected card overlay. This is the main geometry decision area.",
  },
  {
    id: "pill",
    title: "03 Pill And OCR",
    description: "Tight crop around the code pill and OCR text box used for identity and direction.",
  },
  {
    id: "orientation",
    title: "04 Orientation / Anchors",
    description: "Card-zone view annotated with rotation source, expected top-right check, and geometry state.",
  },
];

applyOcrBackendFromQuery();
activeToken = savedToken();
tokenInput.value = activeToken;
syncTokenPanel();

saveToken.addEventListener("click", () => {
  saveTokenValue(tokenInput.value.trim());
  loadReview(uploadSelect.value || "");
});
changeToken?.addEventListener("click", () => {
  tokenPanel.hidden = false;
  tokenInput.focus();
});
reloadButton.addEventListener("click", () => loadReview(uploadSelect.value || ""));
uploadSelect.addEventListener("change", () => loadReview(uploadSelect.value));
canvas.addEventListener("click", handleCanvasClick);
window.addEventListener("resize", draw);

loadReview("");

async function loadReview(uploadKey) {
  if (!recognitionBaseUrl()) {
    statusEl.textContent = "Open Getting Started once so the laptop backend is saved.";
    loadingState.textContent = "Backend not configured";
    return;
  }
  const token = savedToken();
  if (!token) {
    statusEl.textContent = "Open the scanner once with its saved OCR token, or enter the access token here.";
    tokenPanel.hidden = false;
    return;
  }
  activeToken = token;
  syncTokenPanel();
  setBusy("Loading review payload...");
  const url = uploadKey
    ? `/api/photo-code-debug-review?upload=${encodeURIComponent(uploadKey)}`
    : "/api/photo-code-debug-review";
  const response = await authFetch(url, {
    cache: "no-store",
  });
  if (!response.ok) {
    statusEl.textContent = `Could not load debug review (${response.status}).`;
    if (response.status === 401 || response.status === 403) {
      loadingState.textContent = response.status === 403 ? "Server has no OCR token configured for debug access." : "Access token failed";
      tokenPanel.hidden = false;
    } else {
      loadingState.textContent = "Load failed";
    }
    return;
  }
  payload = await response.json();
  renderUploadOptions();
  if (!payload.selected) {
    statusEl.textContent = "No captured photo uploads found.";
    loadingState.textContent = "No uploads";
    return;
  }
  await loadImage(payload.selected.image_url);
  const overview = payload.selected.overview || {};
  const firstSlot = overview.slots?.[0] || null;
  selectedSlotId = firstSlot?.id || null;
  statusEl.textContent = `${payload.selected.image || "photo"} · ${overview.matched_count ?? 0}/${overview.slot_count ?? 0} matched`;
  renderSlotList();
  renderPanel(firstSlot);
  draw();
}

function renderUploadOptions() {
  const uploads = payload?.uploads || [];
  uploadSelect.replaceChildren(
    ...uploads.map((item) => {
      const option = document.createElement("option");
      option.value = item.key;
      option.textContent = `${formatDate(item.saved_at)} · ${item.code_count ?? "-"} codes · ${item.image}`;
      option.selected = item.key === payload?.selected?.key;
      return option;
    }),
  );
}

async function loadImage(url) {
  if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
  const response = await authFetch(url);
  if (!response.ok) throw new Error(`Image load failed: ${response.status}`);
  imageObjectUrl = URL.createObjectURL(await response.blob());
  image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = imageObjectUrl;
  });
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!payload?.selected || !image.complete || !image.naturalWidth) return;

  drawRect = containedRect(rect.width, rect.height, image.naturalWidth, image.naturalHeight);
  ctx.drawImage(image, drawRect.x, drawRect.y, drawRect.width, drawRect.height);

  const slots = payload.selected.overview?.slots || [];
  for (const slot of slots) drawSlot(slot, slot.id === selectedSlotId);
  const selected = slots.find((slot) => slot.id === selectedSlotId);
  if (selected) drawSnapshots(selected);
  loadingState.textContent = "";
}

function drawSlot(slot, selected) {
  const drawAsCodeOnly = slot.geometry_status !== "resolved" && slot.normalized_code_anchor_box?.length >= 4;
  const primary = drawAsCodeOnly ? slot.normalized_code_anchor_box : slot.normalized_polygon;
  const points = toCanvasPoints(primary);
  if (points.length < 4) return;
  const color = statusColor(slot);
  ctx.save();
  ctx.globalAlpha = drawAsCodeOnly ? 0.52 : 0.26;
  ctx.fillStyle = color;
  path(points);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = selected ? 4 : drawAsCodeOnly ? 3 : 2.5;
  ctx.strokeStyle = selected ? "#f8fafc" : color;
  if (drawAsCodeOnly) ctx.setLineDash([8, 5]);
  path(points);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!drawAsCodeOnly && slot.normalized_code_anchor_box?.length >= 4) {
    ctx.strokeStyle = slot.code_anchor_top_right === false ? "#fb7185" : "#5eead4";
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.setLineDash([5, 4]);
    path(toCanvasPoints(slot.normalized_code_anchor_box));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (slot.normalized_code_text_box?.length >= 4) {
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.setLineDash([3, 3]);
    path(toCanvasPoints(slot.normalized_code_text_box));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const center = polygonCenter(points);
  const label = `${slot.code || "?"}${slot.geometry_status === "resolved" ? "" : " !"}`;
  ctx.font = `${selected ? 800 : 700} 15px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(54, ctx.measureText(label).width + 18);
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.fillRect(center.x - width / 2, center.y - 14, width, 28);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, center.x, center.y);
  ctx.restore();
}

function handleCanvasClick(event) {
  if (!payload?.selected) return;
  const rect = canvas.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const slots = [...(payload.selected.overview?.slots || [])].reverse();
  const hit = slots.find((slot) => {
    const source = slot.geometry_status !== "resolved" && slot.normalized_code_anchor_box?.length >= 4
      ? slot.normalized_code_anchor_box
      : slot.normalized_polygon;
    return pointInPolygon(point, toCanvasPoints(source));
  });
  if (!hit) return;
  selectedSlotId = hit.id;
  renderSlotList();
  renderPanel(hit);
  draw();
}

function renderSlotList() {
  if (!slotList) return;
  const slots = payload?.selected?.overview?.slots || [];
  if (!slots.length) {
    slotList.innerHTML = '<p class="debugSummary">No detected slots in this upload.</p>';
    return;
  }
  slotList.innerHTML = slots.map((slot) => {
    const selected = slot.id === selectedSlotId ? " selected" : "";
    const status = [slot.review_status, slot.geometry_status].filter(Boolean).join(" · ");
    return `
      <button type="button" class="slotListButton${selected}" data-slot-id="${escapeHtml(slot.id)}">
        <span>${escapeHtml(slot.code || slot.id || "?")}</span>
        <small>${escapeHtml(status || "-")}</small>
      </button>
    `;
  }).join("");
  for (const button of slotList.querySelectorAll("[data-slot-id]")) {
    button.addEventListener("click", () => {
      const slot = slots.find((item) => item.id === button.dataset.slotId);
      if (!slot) return;
      selectedSlotId = slot.id;
      renderSlotList();
      renderPanel(slot);
      draw();
    });
  }
}

function renderPanel(slot) {
  if (!slot) {
    panel.innerHTML = `
      <h2>No card selected</h2>
      <p class="debugSummary">Tap an overlay to inspect status, geometry, anchors, and raw slot data.</p>
    `;
    return;
  }
  const debug = slot.debug || {};
  const badges = [
    slot.review_status,
    slot.geometry_status,
    slot.source,
    `conf ${formatNumber(slot.confidence)}`,
  ].filter(Boolean);
  const sections = debugSections(slot);
  panel.innerHTML = `
    <h2>${escapeHtml(slot.code || "Unknown")} ${escapeHtml(slot.name || "")}</h2>
    <p class="debugSummary">${escapeHtml(debug.summary || "")}</p>
    <div class="debugBadges">
      ${badges.map((badge) => `<span class="debugBadge">${escapeHtml(badge)}</span>`).join("")}
    </div>
    <div class="debugChecks">
      ${(debug.checks || []).map(renderCheck).join("")}
    </div>
    <div class="debugSections">
      ${sections.map(renderDebugSection).join("")}
    </div>
    <details>
      <summary>Raw slot JSON</summary>
      <button type="button" id="copyRaw">Copy</button>
      <pre>${escapeHtml(JSON.stringify(debug.raw || slot, null, 2))}</pre>
    </details>
    <details>
      <summary>OCR profile</summary>
      <pre>${escapeHtml(JSON.stringify(payload?.selected?.ocr?.profile || {}, null, 2))}</pre>
    </details>
  `;
  panel.querySelector("#copyRaw")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(JSON.stringify(debug.raw || slot, null, 2));
  });
  requestAnimationFrame(() => drawSnapshots(slot));
}

function renderSnapshotShell(snapshot, { embedded = false } = {}) {
  return `
    <section class="debugSnapshot${embedded ? " embedded" : ""}">
      ${embedded ? "" : `<h3>${escapeHtml(snapshot.title)}</h3>`}
      <canvas data-snapshot="${escapeHtml(snapshot.id)}" width="900" height="540"></canvas>
      <p>${escapeHtml(snapshot.description)}</p>
    </section>
  `;
}

function drawSnapshots(slot) {
  if (!slot || !image.complete || !image.naturalWidth) return;
  for (const canvasEl of panel.querySelectorAll("[data-snapshot]")) {
    drawSnapshot(canvasEl, slot, canvasEl.dataset.snapshot);
  }
}

function drawSnapshot(canvasEl, slot, kind) {
  const snapshotCtx = canvasEl.getContext("2d");
  const crop = snapshotCrop(slot, kind);
  const scale = Math.min(canvasEl.width / crop.width, canvasEl.height / crop.height);
  const width = crop.width * scale;
  const height = crop.height * scale;
  const offsetX = (canvasEl.width - width) / 2;
  const offsetY = (canvasEl.height - height) / 2;

  snapshotCtx.save();
  snapshotCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  snapshotCtx.fillStyle = "#020706";
  snapshotCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  snapshotCtx.drawImage(image, crop.x, crop.y, crop.width, crop.height, offsetX, offsetY, width, height);
  snapshotCtx.strokeStyle = "rgba(148, 163, 184, 0.42)";
  snapshotCtx.lineWidth = 1;
  snapshotCtx.strokeRect(offsetX, offsetY, width, height);

  const transform = ([x, y]) => ({
    x: offsetX + ((x * image.naturalWidth - crop.x) * scale),
    y: offsetY + ((y * image.naturalHeight - crop.y) * scale),
  });

  if (kind === "full") {
    for (const other of payload?.selected?.overview?.slots || []) {
      if (other.id === slot.id) continue;
      drawSnapshotPolygon(snapshotCtx, other.normalized_polygon, transform, "rgba(148, 163, 184, 0.45)", 1.25, [5, 5]);
    }
  }

  drawSnapshotPolygon(snapshotCtx, slot.normalized_polygon, transform, "#facc15", kind === "full" ? 3 : 4);
  drawSnapshotPolygon(snapshotCtx, slot.normalized_code_anchor_box, transform, "#34d399", 3, [7, 4]);
  drawSnapshotPolygon(snapshotCtx, slot.normalized_code_text_box, transform, "#60a5fa", 2.5, [4, 4]);

  if (kind === "orientation") {
    drawSnapshotLabel(snapshotCtx, [
      `${slot.code || slot.id || "card"} · rotation ${formatRotation(slot.code_anchor_rotation)}`,
      `source ${displayValue(slot.code_anchor_source)}`,
      `top-right ${yesNo(slot.code_anchor_top_right)} · geometry ${displayValue(slot.geometry_status)}`,
    ]);
  } else if (kind === "pill") {
    drawSnapshotLabel(snapshotCtx, [
      `${slot.code || slot.id || "card"} pill/OCR`,
      `rotation ${formatRotation(slot.code_anchor_rotation)} · source ${displayValue(slot.code_anchor_source)}`,
    ]);
  } else {
    drawSnapshotLabel(snapshotCtx, [
      `${slot.code || slot.id || "card"} · ${displayValue(slot.review_status)} · ${displayValue(slot.geometry_status)}`,
    ]);
  }
  snapshotCtx.restore();
}

function snapshotCrop(slot, kind) {
  if (kind === "full") return { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  const points = kind === "pill"
    ? [
        ...(slot.normalized_code_anchor_box || []),
        ...(slot.normalized_code_text_box || []),
      ]
    : [
        ...(slot.normalized_polygon || []),
        ...(slot.normalized_code_anchor_box || []),
        ...(slot.normalized_code_text_box || []),
      ];
  return paddedSourceBounds(points.length ? points : slot.normalized_polygon, kind === "pill" ? 0.65 : 0.22);
}

function paddedSourceBounds(points = [], paddingRatio = 0.2) {
  const source = points.length ? points : [[0, 0], [1, 1]];
  const xs = source.map(([x]) => x * image.naturalWidth);
  const ys = source.map(([, y]) => y * image.naturalHeight);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const baseWidth = Math.max(20, maxX - minX);
  const baseHeight = Math.max(20, maxY - minY);
  const pad = Math.max(baseWidth, baseHeight) * paddingRatio;
  const x = clamp(minX - pad, 0, image.naturalWidth - 1);
  const y = clamp(minY - pad, 0, image.naturalHeight - 1);
  const right = clamp(maxX + pad, x + 1, image.naturalWidth);
  const bottom = clamp(maxY + pad, y + 1, image.naturalHeight);
  return { x, y, width: right - x, height: bottom - y };
}

function drawSnapshotPolygon(snapshotCtx, points, transform, color, lineWidth = 2, dash = []) {
  if (!Array.isArray(points) || points.length < 4) return;
  const canvasPoints = points.map(transform);
  snapshotCtx.save();
  snapshotCtx.strokeStyle = color;
  snapshotCtx.lineWidth = lineWidth;
  snapshotCtx.setLineDash(dash);
  snapshotCtx.beginPath();
  snapshotCtx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
  for (const point of canvasPoints.slice(1)) snapshotCtx.lineTo(point.x, point.y);
  snapshotCtx.closePath();
  snapshotCtx.stroke();
  snapshotCtx.restore();
}

function drawSnapshotLabel(snapshotCtx, lines) {
  snapshotCtx.save();
  snapshotCtx.font = "700 22px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  snapshotCtx.textBaseline = "top";
  const padding = 12;
  const lineHeight = 28;
  const widths = lines.map((line) => snapshotCtx.measureText(String(line)).width);
  const boxWidth = Math.min(snapshotCtx.canvas.width - 20, Math.max(...widths, 160) + padding * 2);
  const boxHeight = lines.length * lineHeight + padding * 2;
  snapshotCtx.fillStyle = "rgba(0, 0, 0, 0.72)";
  snapshotCtx.fillRect(10, 10, boxWidth, boxHeight);
  snapshotCtx.fillStyle = "#f8fafc";
  lines.forEach((line, index) => snapshotCtx.fillText(String(line), 10 + padding, 10 + padding + index * lineHeight));
  snapshotCtx.restore();
}

function debugSections(slot) {
  return [
    {
      title: "Identity",
      snapshot: "full",
      rows: [
        ["Code", slot.code],
        ["Name", slot.name],
        ["Team", slot.team],
        ["Review status", slot.review_status],
        ["State", slot.state],
        ["Confidence", formatNumber(slot.confidence)],
        ["Match score", formatNumber(slot.match_score)],
        ["Source", slot.source],
        ["Recognition attempts", slot.recognition_attempts],
      ],
    },
    {
      title: "Pill / Text Anchor",
      snapshot: "pill",
      rows: [
        ["Rotation", formatRotation(slot.code_anchor_rotation)],
        ["Direction source", slot.code_anchor_source],
        ["Expected corner", yesNo(slot.code_anchor_expected_corner)],
        ["Top-right band", yesNo(slot.code_anchor_top_right)],
        ["Local center", formatJsonInline(slot.normalized_code_anchor_local_center)],
        ["Anchor box", formatJsonInline(slot.normalized_code_anchor_box)],
        ["Text box", formatJsonInline(slot.normalized_code_text_box)],
      ],
    },
    {
      title: "Card Geometry",
      snapshot: "card",
      rows: [
        ["Geometry status", slot.geometry_status],
        ["Resolved", yesNo(slot.geometry_resolved)],
        ["Polygon source", slot.source],
        ["Overlay polygon", formatJsonInline(slot.normalized_polygon)],
      ],
    },
    {
      title: "Visual Support",
      snapshot: "orientation",
      rows: [
        ["Back insignia", slot.back_insignia_type],
        ["Insignia confidence", formatNumber(slot.back_insignia_confidence)],
        ["Insignia scores", formatJsonInline(slot.back_insignia_scores)],
        ["Edge support", formatNumber(slot.edge_support_score)],
        ["Supported edge sides", slot.edge_segment_supported_sides],
        ["Adjacent edge sides", yesNo(slot.edge_adjacent_segment_sides)],
        ["Side scores", formatJsonInline(slot.edge_side_scores)],
      ],
    },
  ];
}

function renderDebugSection(section) {
  return `
    <section class="debugSection">
      <h3>${escapeHtml(section.title)}</h3>
      ${section.snapshot ? renderSnapshotShell(snapshotById(section.snapshot), { embedded: true }) : ""}
      <dl>
        ${section.rows.map(([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(displayValue(value))}</dd>
          </div>
        `).join("")}
      </dl>
    </section>
  `;
}

function snapshotById(id) {
  return SNAPSHOTS.find((snapshot) => snapshot.id === id) || SNAPSHOTS[0];
}

function renderCheck(check) {
  return `
    <div class="debugCheck">
      <strong>
        <span>${escapeHtml(check.label)}</span>
        <span class="state-${escapeHtml(check.state)}">${escapeHtml(check.state)}</span>
      </strong>
      <p>${escapeHtml(check.detail)}</p>
    </div>
  `;
}

function setBusy(text) {
  statusEl.textContent = text;
  loadingState.textContent = text;
}

function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (activeToken && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${activeToken}`);
  const requestUrl = /^https?:\/\//i.test(String(url)) ? url : recognitionUrl(url);
  return fetch(requestUrl, { ...options, headers });
}

function savedToken() {
  return ocrToken() || localStorage.getItem(DEBUG_REVIEW_TOKEN_KEY) || "";
}

function saveTokenValue(token) {
  activeToken = token;
  tokenInput.value = token;
  if (token) {
    saveOcrBackendSettings({ baseUrl: recognitionBaseUrl(), token });
    localStorage.setItem(DEBUG_REVIEW_TOKEN_KEY, token);
  } else {
    saveOcrBackendSettings({ baseUrl: recognitionBaseUrl(), token: "" });
    localStorage.removeItem(DEBUG_REVIEW_TOKEN_KEY);
  }
  syncTokenPanel();
}

function syncTokenPanel() {
  const hasToken = Boolean(activeToken);
  if (tokenPanel) tokenPanel.hidden = hasToken;
  if (changeToken) changeToken.hidden = !hasToken;
}

function containedRect(containerWidth, containerHeight, imageWidth, imageHeight) {
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

function toCanvasPoints(points = []) {
  return points.map(([x, y]) => ({
    x: drawRect.x + x * drawRect.width,
    y: drawRect.y + y * drawRect.height,
  }));
}

function path(points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

function polygonCenter(points) {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function pointInPolygon(point, polygon) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersect = a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function statusColor(slot) {
  if (slot.review_status === "matched" && slot.geometry_status === "resolved") return "#00be00";
  if (slot.review_status === "matched") return "#fbbf24";
  if (slot.review_status === "unconfirmed") return "#ffb000";
  if (slot.review_status === "not_matched") return "#ff4d4f";
  if (slot.review_status === "unreadable") return "#9aa4b2";
  return "#58a6ff";
}

function formatDate(value) {
  if (!value) return "unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toFixed(3);
}

function formatRotation(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${value} degrees`;
}

function yesNo(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "-";
}

function formatJsonInline(value) {
  if (value === null || value === undefined || value === "") return "-";
  return JSON.stringify(value);
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
