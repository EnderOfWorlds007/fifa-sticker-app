import {
  applyOcrBackendFromQuery,
  ocrToken,
  recognitionBaseUrl,
  recognitionUrl,
  saveOcrBackendSettings,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-photo-code-debug-13";

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
  {
    id: "landmarks",
    title: "05 Physical Landmarks",
    description: "Card-zone view annotated with the four physical anchors: code text, FIFA header, legal copy, and Panini box.",
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
  const drawAsCodeOnly = !hasCardBoundary(slot) && hasPillMarker(slot);
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

  if (!drawAsCodeOnly && hasPillMarker(slot)) {
    ctx.strokeStyle = slot.code_anchor_top_right === false ? "#fb7185" : "#5eead4";
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.setLineDash([5, 4]);
    path(toCanvasPoints(slot.normalized_code_anchor_box));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (hasOcrTextBox(slot)) {
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
    const source = !hasCardBoundary(slot) && hasPillMarker(slot)
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
  panel.innerHTML = `
    <h2>${escapeHtml(slot.code || "Unknown")} ${escapeHtml(slot.name || "")}</h2>
    <p class="debugSummary">${escapeHtml(debug.summary || "")}</p>
    <div class="debugBadges">
      ${badges.map((badge) => `<span class="debugBadge">${escapeHtml(badge)}</span>`).join("")}
    </div>
    ${renderAlgorithmTrace(slot)}
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

function renderSnapshotShell(snapshot, { embedded = false, compact = false, slot = null, showTitle = false } = {}) {
  const imageMarkup = slot && image?.complete && image.naturalWidth
    ? renderSnapshotDataImage(slot, snapshot.id)
    : `<canvas data-snapshot="${escapeHtml(snapshot.id)}" width="900" height="540"></canvas>`;
  return `
    <section class="debugSnapshot${embedded ? " embedded" : ""}${compact ? " compact" : ""}">
      ${embedded && !showTitle ? "" : `<h3>${escapeHtml(snapshot.title)}</h3>`}
      ${imageMarkup}
      ${renderOverlayLegend(slot)}
      ${renderSnapshotExplanation(snapshot.id, slot)}
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
      if (hasCardBoundary(other)) {
        drawSnapshotPolygon(snapshotCtx, other.normalized_polygon, transform, "rgba(148, 163, 184, 0.45)", 1.25, [5, 5]);
      }
    }
  }

  if (hasCardBoundary(slot)) {
    drawSnapshotPolygon(snapshotCtx, slot.normalized_polygon, transform, "#facc15", kind === "full" ? 3 : 4);
  }
  if (hasPillMarker(slot)) {
    drawSnapshotPolygon(snapshotCtx, slot.normalized_code_anchor_box, transform, "#34d399", 3, [7, 4]);
  }
  if (hasOcrTextBox(slot)) {
    drawSnapshotPolygon(snapshotCtx, slot.normalized_code_text_box, transform, "#60a5fa", 2.5, [4, 4]);
  }
  if (kind === "landmarks") {
    drawPhysicalLandmarkPoints(snapshotCtx, slot, transform);
  }

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
  } else if (kind === "landmarks") {
    const landmarkDebug = slot.back_landmark_debug || {};
    drawSnapshotLabel(snapshotCtx, [
      `${slot.code || slot.id || "card"} physical landmarks`,
      `${landmarkDebug.ran ? "ran" : "skipped"} · ${displayValue(landmarkDebug.reason)}`,
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
  if (kind === "landmarks") {
    const landmarkPoints = (slot.back_landmark_debug?.landmarks || [])
      .flatMap((item) => [item.expected_normalized_point, item.observed_normalized_point])
      .filter((point) => Array.isArray(point) && point.length === 2);
    return paddedSourceBounds([
      ...(slot.normalized_polygon || []),
      ...(slot.normalized_code_anchor_box || []),
      ...landmarkPoints,
    ], 0.24);
  }
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

function drawPhysicalLandmarkPoints(snapshotCtx, slot, transform) {
  const landmarks = slot.back_landmark_debug?.landmarks || [];
  for (const landmark of landmarks) {
    if (Array.isArray(landmark.expected_normalized_point)) {
      drawSnapshotPoint(snapshotCtx, landmark.expected_normalized_point, transform, "#f97316", `${landmark.name} expected`);
    }
    if (Array.isArray(landmark.observed_normalized_point)) {
      drawSnapshotPoint(snapshotCtx, landmark.observed_normalized_point, transform, "#e879f9", `${landmark.name} observed`);
    }
  }
}

function drawSnapshotPoint(snapshotCtx, point, transform, color, label) {
  const canvasPoint = transform(point);
  snapshotCtx.save();
  snapshotCtx.strokeStyle = color;
  snapshotCtx.fillStyle = "rgba(0, 0, 0, 0.76)";
  snapshotCtx.lineWidth = 3;
  snapshotCtx.beginPath();
  snapshotCtx.arc(canvasPoint.x, canvasPoint.y, 8, 0, Math.PI * 2);
  snapshotCtx.stroke();
  snapshotCtx.beginPath();
  snapshotCtx.moveTo(canvasPoint.x - 12, canvasPoint.y);
  snapshotCtx.lineTo(canvasPoint.x + 12, canvasPoint.y);
  snapshotCtx.moveTo(canvasPoint.x, canvasPoint.y - 12);
  snapshotCtx.lineTo(canvasPoint.x, canvasPoint.y + 12);
  snapshotCtx.stroke();
  snapshotCtx.font = "700 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const text = String(label);
  const textWidth = snapshotCtx.measureText(text).width;
  const x = Math.min(snapshotCtx.canvas.width - textWidth - 14, Math.max(6, canvasPoint.x + 11));
  const y = Math.min(snapshotCtx.canvas.height - 26, Math.max(6, canvasPoint.y - 18));
  snapshotCtx.fillRect(x - 5, y - 3, textWidth + 10, 23);
  snapshotCtx.fillStyle = color;
  snapshotCtx.fillText(text, x, y);
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

function renderAlgorithmTrace(slot) {
  const steps = algorithmSteps(slot);
  return `
    <section class="algorithmTrace" aria-label="Algorithm trace">
      <h3>Algorithm trace</h3>
      ${steps.map((step, index) => renderAlgorithmStep(step, index + 1, slot)).join("")}
    </section>
  `;
}

function algorithmSteps(slot) {
  const identityCheck = findCheck(slot, "identity");
  const textDirectionCheck = findCheck(slot, "text direction");
  const anchorCornerCheck = findCheck(slot, "anchor corner");
  const topRightBandCheck = findCheck(slot, "top-right band");
  const insigniaCheck = findCheck(slot, "insignia");
  const edgeCheck = findCheck(slot, "edge");
  const geometryCheck = findCheck(slot, "geometry");
  const renderingFacts = [
    ["yellow card boundary", hasCardBoundary(slot) ? "shown: full-card geometry resolved" : "hidden: full-card geometry not resolved"],
    ["green pill marker", hasPillMarker(slot) ? "shown: pill box computed" : "hidden: pill box missing"],
    ["blue OCR text", hasOcrTextBox(slot) ? "shown: OCR text box computed" : "hidden: OCR text box missing"],
  ];

  return [
    {
      title: "Start from the photo",
      fork: "The backend starts with the full capture and the selected code candidate.",
      decision: `candidate ${displayValue(slot.code || slot.id)} from ${displayValue(slot.source)}`,
      snapshot: "full",
      rows: [
        ["code", slot.code],
        ["name", slot.name],
        ["team", slot.team],
        ["source", slot.source],
        ["recognition attempts", slot.recognition_attempts],
      ],
    },
    {
      title: "Read and match the code",
      fork: "If OCR/code matching is weak, the card identity is not trusted. If it passes, later geometry checks decide how much overlay to draw.",
      decision: identityCheck?.state || slot.review_status,
      check: identityCheck,
      snapshot: "pill",
      rows: [
        ["review status", slot.review_status],
        ["state", slot.state],
        ["confidence", formatNumber(slot.confidence)],
        ["match score", formatNumber(slot.match_score)],
      ],
    },
    {
      title: "Infer text direction",
      fork: "The pill text direction proposes a rotation. Weak direction evidence should not force a card boundary by itself.",
      decision: textDirectionCheck?.state || formatRotation(slot.code_anchor_rotation),
      check: textDirectionCheck,
      snapshot: "orientation",
      rows: [
        ["rotation", formatRotation(slot.code_anchor_rotation)],
        ["direction source", slot.code_anchor_source],
        ["selected anchor", selectedAnchorDirection(slot)],
      ],
    },
    {
      title: "Check code-pill placement",
      fork: "This fork checks whether the selected pill lands where a real back-card code should land.",
      decision: anchorForkDecision(slot, anchorCornerCheck, topRightBandCheck),
      checks: [anchorCornerCheck, topRightBandCheck].filter(Boolean),
      snapshot: "pill",
      rows: [
        ["expected corner", yesNo(slot.code_anchor_expected_corner)],
        ["top-right band", yesNo(slot.code_anchor_top_right)],
        ["local center", formatJsonInline(slot.normalized_code_anchor_local_center)],
      ],
      after: renderAnchorLogic(slot),
    },
    {
      title: "Check physical card landmarks",
      fork: "After code geometry exists, the backend looks for the other stable printed anchors: FIFA header, legal copy, and Panini box. These support or explain the full-card outline.",
      decision: physicalLandmarkDecision(slot),
      snapshot: "landmarks",
      rows: physicalLandmarkRows(slot),
      after: renderPhysicalLandmarkLogic(slot),
    },
    {
      title: "Look for supporting card evidence",
      fork: "The backend checks whether the surrounding image looks like a real card back and whether edges support a full-card rectangle.",
      decision: visualSupportDecision(slot, insigniaCheck, edgeCheck),
      checks: [insigniaCheck, edgeCheck].filter(Boolean),
      snapshot: "card",
      rows: [
        ["back insignia", slot.back_insignia_type],
        ["insignia confidence", formatNumber(slot.back_insignia_confidence)],
        ["edge support", formatNumber(slot.edge_support_score)],
        ["supported edge sides", slot.edge_segment_supported_sides],
        ["adjacent edge sides", yesNo(slot.edge_adjacent_segment_sides)],
      ],
    },
    {
      title: "Decide geometry level",
      fork: "If the previous evidence is coherent, the backend resolves a full-card polygon. Otherwise it keeps only safer evidence such as the code pill.",
      decision: geometryCheck?.state || slot.geometry_status,
      check: geometryCheck,
      snapshot: "card",
      rows: [
        ["geometry status", slot.geometry_status],
        ["resolved", yesNo(slot.geometry_resolved)],
        ["polygon source", slot.source],
        ["overlay polygon", formatJsonInline(hasCardBoundary(slot) ? slot.normalized_polygon : null)],
      ],
    },
    {
      title: "Render only computed overlays",
      fork: "The frontend now draws each graphical hint only if that specific backend result exists.",
      decision: hasCardBoundary(slot) ? "draw full card + evidence" : "draw evidence only",
      snapshot: "card",
      rows: renderingFacts,
    },
  ];
}

function renderAlgorithmStep(step, number, slot) {
  const checkBlocks = [step.check, ...(step.checks || [])].filter(Boolean).map((check) => renderCheckDetail(check, slot)).join("");
  return `
    <article class="algorithmStep">
      <header>
        <span class="stepNumber">${number}</span>
        <div>
          <h4>${escapeHtml(step.title)}</h4>
          <p>${escapeHtml(step.fork)}</p>
        </div>
      </header>
      ${step.snapshot ? renderSnapshotShell(snapshotById(step.snapshot), { embedded: true, slot, showTitle: true }) : ""}
      <div class="stepDecision">
        <strong>Decision</strong>
        <span>${escapeHtml(displayValue(step.decision))}</span>
      </div>
      ${renderKeyValueList(step.rows || [])}
      ${step.after || ""}
      ${checkBlocks ? `
        <details class="backendChecks">
          <summary>Backend check details</summary>
          ${checkBlocks}
        </details>
      ` : ""}
    </article>
  `;
}

function renderCheckDetail(check, slot) {
  const snapshot = checkSnapshotKind(check);
  const imageSnippet = snapshot ? renderSnapshotImage(slot, snapshot) : "";
  return `
    <div class="debugCheck compactCheck">
      <strong>
        <span>${escapeHtml(check.label)}</span>
        <span class="state-${escapeHtml(check.state)}">${escapeHtml(check.state)}</span>
      </strong>
      ${imageSnippet}
      ${renderCheckExplanation(check, slot, snapshot)}
      <p>${escapeHtml(check.detail)}</p>
    </div>
  `;
}

function findCheck(slot, needle) {
  const checks = slot.debug?.checks || [];
  const lowerNeedle = needle.toLowerCase();
  return checks.find((check) => `${check.label || ""} ${check.detail || ""}`.toLowerCase().includes(lowerNeedle));
}

function selectedAnchorDirection(slot) {
  const anchor = slot.anchor_debug?.selected_code_anchor;
  if (!anchor) return slot.code_anchor_source;
  const direction = anchor.direction || {};
  return `${displayValue(direction.label || direction.rotation_claim || anchor.rotation)} · score ${displayValue(formatNumber(direction.score))}`;
}

function anchorForkDecision(slot, anchorCornerCheck, topRightBandCheck) {
  if (anchorCornerCheck?.state === "pass" && topRightBandCheck?.state === "pass") return "anchor placement trusted";
  if (slot.code_anchor_expected_corner === false || slot.code_anchor_top_right === false) return "anchor placement rejected";
  return [anchorCornerCheck?.state, topRightBandCheck?.state].filter(Boolean).join(" / ") || "anchor evidence incomplete";
}

function visualSupportDecision(slot, insigniaCheck, edgeCheck) {
  const states = [insigniaCheck?.state, edgeCheck?.state].filter(Boolean);
  if (!states.length) return "visual support not attached";
  if (states.every((state) => state === "pass")) return "visual support passes";
  if (states.includes("fail")) return "visual support rejects full geometry";
  return `visual support ${states.join(" / ")}`;
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

function renderDebugSection(section, slot) {
  return `
    <section class="debugSection">
      <h3>${escapeHtml(section.title)}</h3>
      ${section.snapshot ? renderSnapshotShell(snapshotById(section.snapshot), { embedded: true, slot }) : ""}
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

function renderCheck(check, slot) {
  const snapshot = checkSnapshotKind(check);
  const imageSnippet = snapshot ? renderSnapshotImage(slot, snapshot) : "";
  return `
    <div class="debugCheck">
      <strong>
        <span>${escapeHtml(check.label)}</span>
        <span class="state-${escapeHtml(check.state)}">${escapeHtml(check.state)}</span>
      </strong>
      ${imageSnippet}
      ${renderCheckExplanation(check, slot, snapshot)}
      <p>${escapeHtml(check.detail)}</p>
    </div>
  `;
}

function renderSnapshotImage(slot, kind) {
  const snapshot = snapshotById(kind);
  const imageMarkup = renderSnapshotDataImage(slot, snapshot.id);
  return `
    <figure class="debugSnapshot embedded compact">
      ${imageMarkup}
      ${renderOverlayLegend(slot)}
    </figure>
  `;
}

function renderSnapshotDataImage(slot, kind) {
  const snapshot = snapshotById(kind);
  const canvasEl = document.createElement("canvas");
  canvasEl.width = 900;
  canvasEl.height = 540;
  drawSnapshot(canvasEl, slot, snapshot.id);
  return `<img src="${canvasEl.toDataURL("image/jpeg", 0.86)}" alt="${escapeHtml(snapshot.description)}">`;
}

function renderOverlayLegend(slot = null) {
  const entries = [];
  if (!slot || hasCardBoundary(slot)) {
    entries.push('<span><i class="legendCard"></i>yellow card boundary</span>');
  }
  if (!slot || hasPillMarker(slot)) {
    entries.push('<span><i class="legendPill"></i>green pill marker</span>');
  }
  if (!slot || hasOcrTextBox(slot)) {
    entries.push('<span><i class="legendText"></i>blue OCR text</span>');
  }
  if (!slot || (slot.back_landmark_debug?.landmarks || []).length) {
    entries.push('<span><i class="legendExpected"></i>orange expected landmark</span>');
    entries.push('<span><i class="legendObserved"></i>purple observed landmark</span>');
  }
  if (!entries.length) return "";
  return `
    <div class="overlayLegend" aria-label="Overlay legend">
      ${entries.join("")}
    </div>
  `;
}

function renderSnapshotExplanation(kind, slot = null) {
  const boundaryText = !slot || hasCardBoundary(slot)
    ? "Yellow is the computed full-card boundary."
    : "No yellow card boundary is shown because the backend did not resolve full-card geometry for this slot.";
  const descriptions = {
    full: `Shows the full photo context. Gray dashed boxes are other cards with resolved geometry. ${boundaryText} Green and blue appear only when pill/OCR boxes were computed.`,
    card: `Shows the card geometry decision. ${boundaryText}`,
    pill: "Shows the OCR anchor. Green is the dark code pill used for position/orientation; blue is the tighter text box used to read the code.",
    orientation: "Shows the same evidence with the rotation and top-right checks attached, so a weak orientation decision is visible.",
    landmarks: "Shows physical card-landmark evidence. Orange crosshairs are expected positions from the current card polygon; purple crosshairs are observed printed landmarks when projection is valid.",
  };
  return `
    <details class="debugExplain">
      <summary>What this image means</summary>
      <p>${escapeHtml(descriptions[kind] || "Shows the visual evidence used by this debug step.")}</p>
    </details>
  `;
}

function hasCardBoundary(slot) {
  return Boolean((slot?.geometry_resolved === true || slot?.geometry_status === "resolved")
    && Array.isArray(slot?.normalized_polygon)
    && slot.normalized_polygon.length >= 4);
}

function hasPillMarker(slot) {
  return Boolean(Array.isArray(slot?.normalized_code_anchor_box) && slot.normalized_code_anchor_box.length >= 4);
}

function hasOcrTextBox(slot) {
  return Boolean(Array.isArray(slot?.normalized_code_text_box) && slot.normalized_code_text_box.length >= 4);
}

function renderCheckExplanation(check, slot, snapshot) {
  const title = String(check.label || "");
  const text = `${title} ${check.detail || ""}`.toLowerCase();
  const anchorBlock = text.includes("anchor") || text.includes("band") || text.includes("text direction")
    ? renderAnchorLogic(slot)
    : "";
  return `
    <details class="debugExplain">
      <summary>What this step means</summary>
      ${renderStepExplanation(title, slot, snapshot)}
      ${anchorBlock}
    </details>
  `;
}

function renderStepExplanation(title, slot, snapshot) {
  const lower = title.toLowerCase();
  if (lower.includes("identity")) {
    return `
      <p>The backend decided whether this card identity is usable. It combines OCR/code matching, review labels, and confidence.</p>
      ${renderKeyValueList([
        ["decision", slot.review_status],
        ["state", slot.state],
        ["confidence", formatNumber(slot.confidence)],
        ["match score", formatNumber(slot.match_score)],
      ])}
    `;
  }
  if (lower.includes("geometry")) {
    return `
      <p>The backend decided whether it trusts a full-card outline. If this is <code>code_only</code>, the code is kept but only the pill marker should be drawn.</p>
      ${renderKeyValueList([
        ["geometry status", slot.geometry_status],
        ["resolved", yesNo(slot.geometry_resolved)],
        ["source", slot.source],
        ["image used", snapshotById(snapshot || "card").title],
      ])}
    `;
  }
  if (lower.includes("anchor corner")) {
    return `
      <p>This checks whether the selected pill sits in the expected corner of the reconstructed card. For normal back cards, the code pill should land at the card top-right.</p>
      ${renderSelectedAnchorSummary(slot)}
    `;
  }
  if (lower.includes("top-right band")) {
    return `
      <p>This is a stricter calibrated check. It asks whether the pill center is inside the narrow top-right band learned for the physical back-card layout.</p>
      ${renderSelectedAnchorSummary(slot)}
    `;
  }
  if (lower.includes("text direction")) {
    return `
      <p>This explains the orientation classifier vote. A low score means the rotation claim is weak and should not beat geometry by itself.</p>
      ${renderSelectedAnchorSummary(slot)}
    `;
  }
  if (lower.includes("insignia")) {
    return `
      <p>This checks the center graphic on the card back. It helps distinguish real card backs from wrong crops or background texture.</p>
      ${renderKeyValueList([
        ["insignia type", slot.back_insignia_type],
        ["confidence", formatNumber(slot.back_insignia_confidence)],
        ["scores", formatJsonInline(slot.back_insignia_scores)],
      ])}
    `;
  }
  if (lower.includes("edge")) {
    return `
      <p>This checks whether image edges support the proposed card boundary. Low edge support means the yellow card outline is probably speculative.</p>
      ${renderKeyValueList([
        ["edge score", formatNumber(slot.edge_support_score)],
        ["supported sides", slot.edge_segment_supported_sides],
        ["adjacent sides", yesNo(slot.edge_adjacent_segment_sides)],
      ])}
    `;
  }
  return `<p>This step shows the backend evidence and the decision derived from it.</p>`;
}

function physicalLandmarkDecision(slot) {
  const debug = slot.back_landmark_debug;
  if (!debug) return "not attached to saved result";
  if (!debug.ran) return debug.reason || "skipped";
  const detected = (debug.landmarks || []).filter((item) => item.detected).length;
  return `${debug.projection_applied ? "projected" : "not projected"} · ${detected}/4 detected`;
}

function physicalLandmarkRows(slot) {
  const debug = slot.back_landmark_debug || {};
  const score = debug.score || {};
  return [
    ["ran", yesNo(debug.ran)],
    ["reason", debug.reason],
    ["crop size", formatJsonInline(debug.crop_size)],
    ["score", formatNumber(score.confidence)],
    ["score rotation", formatRotation(score.rotation)],
    ["threshold", formatNumber(debug.threshold)],
    ["projection applied", yesNo(debug.projection_applied)],
  ];
}

function renderPhysicalLandmarkLogic(slot) {
  const debug = slot.back_landmark_debug;
  if (!debug) {
    return `<p class="debugMuted">No physical landmark trace was attached to this saved result. Reprocess the photo after backend deployment.</p>`;
  }
  const landmarks = debug.landmarks || [];
  return `
    <div class="anchorLogic">
      <h4>Physical card anchors</h4>
      <p class="debugMuted">Expected points come from the current card polygon and fixed millimetre coordinates. Observed points come from the printed-landmark detector only when that detector ran and agreed with OCR direction.</p>
      ${renderKeyValueList([
        ["stage", debug.stage],
        ["reason", debug.reason],
        ["header score", formatNumber(debug.score?.header_score)],
        ["legal score", formatNumber(debug.score?.legal_score)],
        ["panini score", formatNumber(debug.score?.panini_score)],
      ])}
      <details class="anchorList" open>
        <summary>Landmarks (${landmarks.length})</summary>
        ${landmarks.map(renderPhysicalLandmarkCard).join("")}
      </details>
    </div>
  `;
}

function renderPhysicalLandmarkCard(landmark) {
  return `
    <section class="anchorCard">
      <h5>${escapeHtml(landmarkTitle(landmark.name))}</h5>
      ${renderKeyValueList([
        ["corner owner", landmark.corner],
        ["source", landmark.source],
        ["detected", yesNo(landmark.detected)],
        ["expected point", formatJsonInline(landmark.expected_normalized_point)],
        ["observed point", formatJsonInline(landmark.observed_normalized_point)],
      ])}
    </section>
  `;
}

function landmarkTitle(name) {
  const titles = {
    code_text: "Code pill/text",
    header: "FIFA World Cup 2026 header",
    legal: "Legal/copyright paragraph",
    panini: "Panini footer box",
  };
  return titles[name] || displayValue(name);
}

function renderSelectedAnchorSummary(slot) {
  const anchor = slot.anchor_debug?.selected_code_anchor;
  if (!anchor) return `<p>No structured anchor debug was attached to this saved result. Reprocess the photo to get anchor details.</p>`;
  const direction = anchor.direction || {};
  return renderKeyValueList([
    ["rotation claim", formatRotation(anchor.rotation)],
    ["direction score", formatNumber(direction.score)],
    ["direction label", direction.label],
    ["local center", formatJsonInline(anchor.local_center)],
    ["expected corner", yesNo(anchor.expected_corner)],
    ["top-right in card", yesNo(anchor.top_right_in_card)],
    ["calibrated band", yesNo(anchor.calibrated_top_right_band)],
  ]);
}

function renderAnchorLogic(slot) {
  const anchor = slot.anchor_debug?.selected_code_anchor;
  const observed = slot.anchor_debug?.observed_code_anchors || [];
  const nearby = slot.anchor_debug?.nearby_code_anchors || [];
  if (!anchor && !observed.length && !nearby.length) return "";
  const checks = [
    ["1 direction", anchor?.direction?.rotation_claim ?? anchor?.rotation, anchor?.direction?.score],
    ["2 expected corner", anchor?.expected_corner, null],
    ["3 top-right position", anchor?.top_right_in_card, null],
    ["4 calibrated band", anchor?.calibrated_top_right_band, null],
  ];
  return `
    <div class="anchorLogic">
      <h4>Code-pill placement checks</h4>
      ${anchor ? renderAnchorCard("Selected anchor", anchor) : ""}
      <ol>
        ${checks.map(([name, value, score]) => `
          <li>
            <strong>${escapeHtml(name)}</strong>
            <span>${escapeHtml(displayValue(value))}${score == null ? "" : ` · score ${escapeHtml(formatNumber(score))}`}</span>
          </li>
        `).join("")}
      </ol>
      ${renderAnchorList("Observed anchors", observed)}
      ${renderAnchorList("Nearby anchors", nearby)}
    </div>
  `;
}

function renderAnchorList(title, anchors) {
  if (!anchors.length) return `<p class="debugMuted">${escapeHtml(title)}: none attached.</p>`;
  return `
    <details class="anchorList">
      <summary>${escapeHtml(title)} (${anchors.length})</summary>
      ${anchors.map((anchor, index) => renderAnchorCard(`${title.slice(0, -1)} ${index + 1}`, anchor)).join("")}
    </details>
  `;
}

function renderAnchorCard(title, anchor) {
  return `
    <section class="anchorCard">
      <h5>${escapeHtml(title)}</h5>
      ${renderAnchorImage(anchor)}
      ${renderKeyValueList([
        ["code", anchor.code],
        ["rotation", formatRotation(anchor.rotation)],
        ["direction", anchor.direction?.label],
        ["score", formatNumber(anchor.direction?.score ?? anchor.confidence)],
        ["expected corner", yesNo(anchor.expected_corner ?? anchor.expected_corner_in_this_slot)],
        ["top-right", yesNo(anchor.top_right_in_card ?? anchor.top_right_in_this_slot)],
        ["calibrated band", yesNo(anchor.calibrated_top_right_band ?? anchor.calibrated_top_right_band_in_this_slot)],
        ["local center", formatJsonInline(anchor.local_center ?? anchor.local_center_in_this_slot)],
      ])}
    </section>
  `;
}

function renderAnchorImage(anchor) {
  const box = anchor.normalized_box;
  if (!image?.complete || !image.naturalWidth || !Array.isArray(box) || box.length < 4) {
    return `<p class="debugMuted">Anchor image unavailable for this saved record.</p>`;
  }
  const canvasEl = document.createElement("canvas");
  canvasEl.width = 720;
  canvasEl.height = 360;
  drawAnchorSnapshot(canvasEl, anchor);
  return `
    <figure class="anchorImage">
      <img src="${canvasEl.toDataURL("image/jpeg", 0.88)}" alt="${escapeHtml(displayValue(anchor.code))} anchor crop">
      <figcaption>${escapeHtml(anchor.source || anchor.direction?.raw || "anchor evidence")}</figcaption>
    </figure>
  `;
}

function drawAnchorSnapshot(canvasEl, anchor) {
  const snapshotCtx = canvasEl.getContext("2d");
  const points = [
    ...(anchor.normalized_box || []),
    ...(anchor.normalized_text_box || []),
  ];
  const crop = paddedSourceBounds(points.length ? points : anchor.normalized_box, 1.4);
  const scale = Math.min(canvasEl.width / crop.width, canvasEl.height / crop.height);
  const width = crop.width * scale;
  const height = crop.height * scale;
  const offsetX = (canvasEl.width - width) / 2;
  const offsetY = (canvasEl.height - height) / 2;
  const transform = ([x, y]) => ({
    x: offsetX + ((x * image.naturalWidth - crop.x) * scale),
    y: offsetY + ((y * image.naturalHeight - crop.y) * scale),
  });

  snapshotCtx.save();
  snapshotCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  snapshotCtx.fillStyle = "#020706";
  snapshotCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  snapshotCtx.drawImage(image, crop.x, crop.y, crop.width, crop.height, offsetX, offsetY, width, height);
  drawSnapshotPolygon(snapshotCtx, anchor.normalized_box, transform, "#34d399", 4, [8, 5]);
  drawSnapshotPolygon(snapshotCtx, anchor.normalized_text_box, transform, "#60a5fa", 3, [4, 4]);
  drawSnapshotLabel(snapshotCtx, [
    `${anchor.code || "anchor"} · rotation ${formatRotation(anchor.rotation)}`,
    `score ${formatNumber(anchor.direction?.score ?? anchor.confidence)} · ${anchor.direction?.label || "direction"}`,
  ]);
  snapshotCtx.restore();
}

function renderKeyValueList(rows) {
  return `
    <dl class="explainFacts">
      ${rows.map(([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(displayValue(value))}</dd>
        </div>
      `).join("")}
    </dl>
  `;
}

function checkSnapshotKind(check) {
  const text = `${check.label || ""} ${check.detail || ""}`.toLowerCase();
  if (text.includes("identity")) return "pill";
  if (text.includes("geometry")) return "card";
  if (text.includes("anchor")) return "pill";
  if (text.includes("band")) return "pill";
  if (text.includes("text direction")) return "pill";
  if (text.includes("insignia")) return "card";
  if (text.includes("edge")) return "card";
  return "orientation";
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
