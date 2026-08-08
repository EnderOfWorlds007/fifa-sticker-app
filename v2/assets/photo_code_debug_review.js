import {
  applyOcrBackendFromQuery,
  ocrToken,
  recognitionBaseUrl,
  recognitionUrl,
  saveOcrBackendSettings,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-photo-code-debug-1";

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
  selectedSlotId = null;
  await loadImage(payload.selected.image_url);
  const overview = payload.selected.overview || {};
  statusEl.textContent = `${payload.selected.image || "photo"} · ${overview.matched_count ?? 0}/${overview.slot_count ?? 0} matched`;
  renderSlotList();
  renderPanel(null);
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
}

function debugSections(slot) {
  return [
    {
      title: "Identity",
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
      rows: [
        ["Geometry status", slot.geometry_status],
        ["Resolved", yesNo(slot.geometry_resolved)],
        ["Polygon source", slot.source],
        ["Overlay polygon", formatJsonInline(slot.normalized_polygon)],
      ],
    },
    {
      title: "Visual Support",
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
