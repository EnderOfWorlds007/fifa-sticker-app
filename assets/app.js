const video = document.querySelector("#video");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const stage = document.querySelector("#stage");
const statusLine = document.querySelector("#statusLine");
const systemStatus = document.querySelector("#systemStatus");
const sessionCount = document.querySelector("#sessionCount");
const inventoryCardCount = document.querySelector("#inventoryCardCount");
const inventoryCodeCount = document.querySelector("#inventoryCodeCount");
const captureCount = document.querySelector("#captureCount");
const trackList = document.querySelector("#trackList");
const recognizedList = document.querySelector("#recognizedList");
const reviewList = document.querySelector("#reviewList");
const unrecognizedList = document.querySelector("#unrecognizedList");
const cameraControls = document.querySelector("#cameraControls");
const cameraHint = document.querySelector("#cameraHint");
const captureHint = document.querySelector("#captureHint");
const connectionSummary = document.querySelector("#connectionSummary");
const accessUrls = document.querySelector("#accessUrls");
const startCameraButton = document.querySelector("#startCamera");
const captureOverviewButton = document.querySelector("#captureOverview");
const overviewPhotoInput = document.querySelector("#overviewPhotoInput");
const inventorySummary = document.querySelector("#inventorySummary");
const inventoryList = document.querySelector("#inventoryList");
const toggleTorchButton = document.querySelector("#toggleTorch");
const overviewStage = document.querySelector(".overviewStage");
const overviewImage = document.querySelector("#overviewImage");
const overviewCanvas = document.querySelector("#overviewOverlay");
const overviewCtx = overviewCanvas.getContext("2d");
const overviewQuickActions = document.querySelector("#overviewQuickActions");
const overviewStatus = document.querySelector("#overviewStatus");
const zoomOverviewOutButton = document.querySelector("#zoomOverviewOut");
const zoomOverviewInButton = document.querySelector("#zoomOverviewIn");
const resetOverviewViewButton = document.querySelector("#resetOverviewView");
const backToCameraButton = document.querySelector("#backToCamera");
const overviewComputing = document.querySelector("#overviewComputing");
const overviewHelpList = document.querySelector("#overviewHelpList");
const cardCodeOptions = document.querySelector("#cardCodeOptions");
const overviewSampleSelect = document.querySelector("#overviewSampleSelect");
const loadOverviewSampleButton = document.querySelector("#loadOverviewSample");
const reviewToolButtons = [...document.querySelectorAll("[data-review-tool]")];
const saveCorrectionsButton = document.querySelector("#saveCorrections");
const exportCorrectionsButton = document.querySelector("#exportCorrections");
const overviewInspector = document.querySelector("#overviewInspector");

let mode = "camera";
let eventSource = null;
let cameraStream = null;
let cameraImageCapture = null;
let cameraVideoTrack = null;
let cameraCaptureProfile = null;
let torchSupported = false;
let torchEnabled = false;
let cameraTimer = null;
let cameraBusy = false;
let overviewBusy = false;
let captureCanvas = null;
let captureContext = null;
let sessionId = null;
let displaySize = [1080, 1920];
let latestTracks = [];
let rememberedCards = [];
let surfaceCards = new Map();
let overviewMap = null;
let overviewImageReady = false;
let overviewReviewMode = false;
let overviewCaptureInfo = null;
let overviewViewport = { scale: 1, panX: 0, panY: 0 };
let overviewPointers = new Map();
let overviewGesture = null;
let overviewReviewTool = "inspect";
let overviewEditGesture = null;
let overviewDraftCorrection = null;
let selectedOverviewTarget = null;
let overviewCorrections = createOverviewCorrections();
let scanHistory = createScanHistory();
let drawnLabelBoxes = [];
let catalogCards = [];
let overviewSamples = [];
let activeOverviewPairId = null;
let pendingOverviewLighting = null;
let pendingNoFlashCapture = null;

init();

async function init() {
  document.body.dataset.mode = mode;
  bindControls();
  await loadStatus();
  await loadCatalogCards();
  await loadOverviewSamples();
  await loadTradeInventory();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("resize", () => {
    resizeOverviewCanvas();
    drawOverviewMap();
  });
  requestAnimationFrame(draw);
}

function bindControls() {
  document.querySelector("#startCamera").addEventListener("click", startCamera);
  document.querySelector("#stopCamera").addEventListener("click", stopCamera);
  captureOverviewButton.addEventListener("click", captureOverviewPair);
  overviewPhotoInput?.addEventListener("change", handleOverviewPhotoInputChange);
  toggleTorchButton.addEventListener("click", toggleTorch);
  zoomOverviewOutButton.addEventListener("click", () => zoomOverviewAtCenter(0.75));
  zoomOverviewInButton.addEventListener("click", () => zoomOverviewAtCenter(1.35));
  resetOverviewViewButton.addEventListener("click", resetOverviewView);
  backToCameraButton.addEventListener("click", returnToCameraFromOverview);
  loadOverviewSampleButton?.addEventListener("click", loadSelectedOverviewSample);
  for (const button of reviewToolButtons) {
    button.addEventListener("click", () => setOverviewReviewTool(button.dataset.reviewTool));
  }
  saveCorrectionsButton?.addEventListener("click", saveOverviewCorrections);
  exportCorrectionsButton?.addEventListener("click", exportOverviewCorrections);
  overviewInspector?.addEventListener("click", handleOverviewInspectorClick);
  overviewInspector?.addEventListener("submit", handleOverviewInspectorSubmit);
  overviewQuickActions?.addEventListener("click", handleOverviewInspectorClick);
  overviewHelpList.addEventListener("click", handleOverviewHelpClick);
  overviewHelpList.addEventListener("submit", handleOverviewHelpSubmit);
  video.addEventListener("loadedmetadata", resizeCanvas);
  overviewImage.addEventListener("load", () => {
    overviewImageReady = true;
    resetOverviewView();
    resizeOverviewCanvas();
    drawOverviewMap();
  });
  bindOverviewGestures();
}

function bindOverviewGestures() {
  overviewStage.addEventListener("wheel", handleOverviewWheel, { passive: false });
  overviewStage.addEventListener("pointerdown", handleOverviewPointerDown);
  overviewStage.addEventListener("pointermove", handleOverviewPointerMove);
  overviewStage.addEventListener("pointerup", handleOverviewPointerEnd);
  overviewStage.addEventListener("pointercancel", handleOverviewPointerEnd);
  overviewStage.addEventListener("dblclick", handleOverviewDoubleClick);
}

function handleOverviewDoubleClick(event) {
  if (isOverviewControlEvent(event)) return;
  if (!overviewImageReady) return;
  const point = screenToOverviewPoint(event.clientX, event.clientY);
  if (point) {
    const local = localCorrectionAtNormalizedPoint(point);
    if (local?.type === "missed_pill") {
      event.preventDefault();
      overviewCorrections.missed_pills = overviewCorrections.missed_pills.filter(
        (item) => item.id !== local.id,
      );
      selectedOverviewTarget = null;
      updateCorrectionButtons();
      renderOverviewInspector();
      drawOverviewMap();
      statusLine.textContent = "Missed pill removed";
      return;
    }
  }
  resetOverviewView();
}

function handleOverviewWheel(event) {
  if (isOverviewControlEvent(event)) return;
  if (!overviewImageReady) return;
  event.preventDefault();
  const rect = overviewStage.getBoundingClientRect();
  const factor = Math.exp(-event.deltaY * 0.0012);
  zoomOverviewAt(factor, event.clientX - rect.left, event.clientY - rect.top);
}

function handleOverviewPointerDown(event) {
  if (isOverviewControlEvent(event)) return;
  if (!overviewImageReady) return;
  const point = screenToOverviewPoint(event.clientX, event.clientY);
  if (overviewReviewMode && overviewReviewTool !== "inspect") {
    if (!point) return;
    event.preventDefault();
    overviewStage.setPointerCapture?.(event.pointerId);
    overviewEditGesture = {
      pointerId: event.pointerId,
      tool: overviewReviewTool,
      start: point,
      current: point,
      moved: false,
    };
    overviewDraftCorrection = draftCorrectionFromGesture(overviewEditGesture);
    return;
  }
  if (overviewReviewMode && overviewReviewTool === "inspect" && point) {
    const local = localCorrectionAtNormalizedPoint(point);
    if (local) {
      event.preventDefault();
      overviewStage.setPointerCapture?.(event.pointerId);
      selectedOverviewTarget = local;
      overviewEditGesture = {
        pointerId: event.pointerId,
        tool: "move-correction",
        target: local,
        start: point,
        current: point,
        originalPolygon: selectedCorrectionPolygon(local),
        moved: false,
      };
      renderOverviewInspector();
      drawOverviewMap();
      return;
    }
  }
  if (!overviewMap?.enabled) return;
  overviewStage.setPointerCapture?.(event.pointerId);
  overviewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  overviewGesture = overviewGestureSnapshot();
}

function handleOverviewPointerMove(event) {
  if (isOverviewControlEvent(event)) return;
  if (overviewEditGesture?.pointerId === event.pointerId) {
    const point = screenToOverviewPoint(event.clientX, event.clientY, { allowOutside: true });
    if (!point) return;
    event.preventDefault();
    overviewEditGesture.current = point;
    overviewEditGesture.moved =
      overviewEditGesture.moved ||
      Math.hypot(point.x - overviewEditGesture.start.x, point.y - overviewEditGesture.start.y) > 0.01;
    if (overviewEditGesture.tool === "move-correction") {
      moveSelectedCorrection(overviewEditGesture);
    } else {
      overviewDraftCorrection = draftCorrectionFromGesture(overviewEditGesture);
    }
    drawOverviewMap();
    return;
  }
  if (!overviewGesture || !overviewPointers.has(event.pointerId)) return;
  event.preventDefault();
  overviewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (overviewPointers.size >= 2 && overviewGesture.distance > 0) {
    const current = overviewGestureSnapshot();
    const rect = overviewStage.getBoundingClientRect();
    overviewViewport.scale = clamp(
      overviewGesture.scale * (current.distance / overviewGesture.distance),
      1,
      8,
    );
    overviewViewport.panX = overviewGesture.panX + current.center.x - overviewGesture.center.x;
    overviewViewport.panY = overviewGesture.panY + current.center.y - overviewGesture.center.y;
    overviewViewport.panX += (current.center.x - rect.left - rect.width / 2) * 0.04;
    overviewViewport.panY += (current.center.y - rect.top - rect.height / 2) * 0.04;
  } else {
    const current = [...overviewPointers.values()][0];
    const start = overviewGesture.points[0];
    overviewViewport.panX = overviewGesture.panX + current.x - start.x;
    overviewViewport.panY = overviewGesture.panY + current.y - start.y;
  }
  constrainOverviewViewport();
  drawOverviewMap();
}

function handleOverviewPointerEnd(event) {
  if (isOverviewControlEvent(event)) return;
  if (overviewEditGesture?.pointerId === event.pointerId) {
    event.preventDefault();
    const point = screenToOverviewPoint(event.clientX, event.clientY, { allowOutside: true });
    if (point) overviewEditGesture.current = point;
    if (overviewEditGesture.tool === "move-correction") {
      updateCorrectionButtons();
    } else {
      commitOverviewEditGesture(overviewEditGesture);
    }
    overviewStage.releasePointerCapture?.(event.pointerId);
    overviewEditGesture = null;
    overviewDraftCorrection = null;
    drawOverviewMap();
    renderOverviewInspector();
    return;
  }
  const gesture = overviewGesture;
  overviewStage.releasePointerCapture?.(event.pointerId);
  overviewPointers.delete(event.pointerId);
  overviewGesture = overviewPointers.size ? overviewGestureSnapshot() : null;
  if (
    overviewReviewMode &&
    overviewReviewTool === "inspect" &&
    gesture?.points?.length === 1 &&
    Math.hypot(event.clientX - gesture.points[0].x, event.clientY - gesture.points[0].y) <= 24
  ) {
    selectOverviewTargetAt(event.clientX, event.clientY);
  }
}

function isOverviewControlEvent(event) {
  return Boolean(event.target?.closest?.("#overviewQuickActions, button, input, select, textarea"));
}

function overviewGestureSnapshot() {
  const points = [...overviewPointers.values()];
  const center = points.reduce(
    (acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  const distance = points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  return {
    points,
    center,
    distance,
    scale: overviewViewport.scale,
    panX: overviewViewport.panX,
    panY: overviewViewport.panY,
  };
}

function zoomOverviewAt(factor, x, y) {
  const previousScale = overviewViewport.scale;
  const nextScale = clamp(previousScale * factor, 1, 8);
  if (nextScale === previousScale) return;
  const rect = overviewStage.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  overviewViewport.panX = x - centerX - ((x - centerX - overviewViewport.panX) * nextScale) / previousScale;
  overviewViewport.panY = y - centerY - ((y - centerY - overviewViewport.panY) * nextScale) / previousScale;
  overviewViewport.scale = nextScale;
  constrainOverviewViewport();
  drawOverviewMap();
}

function zoomOverviewAtCenter(factor) {
  if (!overviewMap?.enabled || !overviewImageReady) return;
  const rect = overviewStage.getBoundingClientRect();
  zoomOverviewAt(factor, rect.width / 2, rect.height / 2);
}

function resetOverviewView() {
  overviewViewport = { scale: 1, panX: 0, panY: 0 };
  overviewPointers.clear();
  overviewGesture = null;
  constrainOverviewViewport();
  drawOverviewMap();
}

function setOverviewReviewTool(tool) {
  overviewReviewTool = tool || "inspect";
  for (const button of reviewToolButtons) {
    button.classList.toggle("active", button.dataset.reviewTool === overviewReviewTool);
  }
  overviewEditGesture = null;
  overviewDraftCorrection = null;
  statusLine.textContent = overviewReviewTool === "inspect"
    ? "Inspect overview"
    : overviewReviewTool === "phantom"
      ? "Tap a false card to mark it phantom"
      : overviewReviewTool === "add-card"
        ? "Drag around a missed card"
        : "Drag around a missed code pill";
  drawOverviewMap();
}

function createOverviewCorrections() {
  return {
    phantoms: [],
    missed_cards: [],
    missed_pills: [],
    rotations: [],
    code_corrections: [],
  };
}

function resetOverviewCorrections() {
  overviewCorrections = createOverviewCorrections();
  selectedOverviewTarget = null;
  updateCorrectionButtons();
  renderOverviewInspector();
}

function updateCorrectionButtons() {
  const hasOverview = Boolean(overviewImageReady);
  const count = overviewCorrectionCount();
  if (saveCorrectionsButton) saveCorrectionsButton.disabled = !hasOverview || count === 0 || !sessionId;
  if (exportCorrectionsButton) exportCorrectionsButton.disabled = !hasOverview || count === 0;
}

function overviewCorrectionCount() {
  return Object.values(overviewCorrections).reduce((total, items) => total + items.length, 0);
}

function screenToOverviewPoint(clientX, clientY, options = {}) {
  const rect = overviewCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const { offsetX, offsetY, drawnWidth, drawnHeight } = overviewImageRect(rect);
  const x = (clientX - rect.left - offsetX) / Math.max(1, drawnWidth);
  const y = (clientY - rect.top - offsetY) / Math.max(1, drawnHeight);
  const tolerance = options.allowOutside ? 1 : 0.03;
  if (x < -tolerance || x > 1 + tolerance || y < -tolerance || y > 1 + tolerance) return null;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

function draftCorrectionFromGesture(gesture) {
  if (!gesture || gesture.tool === "phantom") return null;
  let polygon = axisAlignedPolygon(gesture.start, gesture.current);
  const minimumArea = gesture.tool === "add-pill" ? 0.00012 : 0.0008;
  if (normalizedPolygonArea(polygon) < minimumArea) {
    polygon = defaultCorrectionPolygon(gesture.start, gesture.tool);
  }
  return {
    id: "draft",
    kind: gesture.tool === "add-pill" ? "missed_pill" : "missed_card",
    normalized_polygon: polygon,
  };
}

function commitOverviewEditGesture(gesture) {
  if (!gesture) return;
  if (gesture.tool === "phantom") {
    markPhantomAtNormalizedPoint(gesture.current);
    return;
  }
  const correction = draftCorrectionFromGesture(gesture);
  if (!correction) return;
  if (gesture.tool === "add-pill") {
    const item = {
      id: nextCorrectionId("pill"),
      normalized_box: correction.normalized_polygon,
      code: "",
      note: "missed pill",
    };
    overviewCorrections.missed_pills.push(item);
    selectedOverviewTarget = { type: "missed_pill", id: item.id };
  } else {
    const item = {
      id: nextCorrectionId("card"),
      normalized_polygon: correction.normalized_polygon,
      code: "",
      orientation_degrees: 0,
      note: "missed card",
    };
    overviewCorrections.missed_cards.push(item);
    selectedOverviewTarget = { type: "missed_card", id: item.id };
  }
  setOverviewReviewTool("inspect");
  updateCorrectionButtons();
}

function markPhantomAtNormalizedPoint(point) {
  const slot = slotAtNormalizedPoint(point);
  if (!slot) {
    statusLine.textContent = "No detection under tap";
    return;
  }
  if (!overviewCorrections.phantoms.some((item) => item.slot_id === slot.id)) {
    overviewCorrections.phantoms.push({
      id: nextCorrectionId("phantom"),
      slot_id: slot.id,
      normalized_polygon: slot.normalized_polygon,
      previous_code: slot.code ?? null,
      note: "phantom card",
    });
  }
  selectedOverviewTarget = { type: "slot", id: slot.id };
  setOverviewReviewTool("inspect");
  updateCorrectionButtons();
}

function selectOverviewTargetAt(clientX, clientY) {
  const point = screenToOverviewPoint(clientX, clientY);
  if (!point) return;
  const slot = slotAtNormalizedPoint(point);
  if (slot) {
    selectedOverviewTarget = { type: "slot", id: slot.id };
    renderOverviewInspector();
    drawOverviewMap();
    statusLine.textContent = `Selected ${overviewSlotCodeLabel(slot)}`;
    return;
  }
  const local = localCorrectionAtNormalizedPoint(point);
  selectedOverviewTarget = local;
  renderOverviewInspector();
  drawOverviewMap();
  if (local) statusLine.textContent = `Selected ${local.id}`;
}

function slotAtNormalizedPoint(point) {
  const slots = overviewMap?.slots ?? [];
  const candidates = slots
    .map((slot) => slotHitCandidate(point, slot))
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);
  return candidates[0]?.slot ?? null;
}

function slotHitCandidate(point, slot) {
  const polygon = slot.normalized_polygon ?? [];
  if (!Array.isArray(polygon) || polygon.length < 4) return null;
  const target = [point.x, point.y];
  const area = Math.max(0.00001, normalizedPolygonArea(polygon));
  const center = normalizedPolygonCenter(polygon);
  const centerDistance = Math.hypot(point.x - center[0], point.y - center[1]);
  const edgeDistance = pointToPolygonDistance(target, polygon);
  const inside = pointInPolygon(target, polygon);
  const nearEdge = edgeDistance <= Math.max(0.006, Math.sqrt(area) * 0.08);
  const anchorBox = slot.normalized_code_anchor_box ?? [];
  const onCodeAnchor = Array.isArray(anchorBox) && anchorBox.length >= 4 && pointInPolygon(target, anchorBox);
  if (!inside && !nearEdge && !onCodeAnchor) return null;
  const normalizedDistance = centerDistance / Math.max(0.0001, Math.sqrt(area));
  const areaPenalty = area * 0.18;
  const edgePenalty = inside ? 0 : 0.45;
  const anchorBonus = onCodeAnchor ? -1.5 : 0;
  return {
    slot,
    score: normalizedDistance + areaPenalty + edgePenalty + anchorBonus,
  };
}

function localCorrectionAtNormalizedPoint(point) {
  for (const item of [...overviewCorrections.missed_pills].reverse()) {
    if (pointInPolygon([point.x, point.y], item.normalized_box ?? [])) return { type: "missed_pill", id: item.id };
  }
  for (const item of [...overviewCorrections.missed_cards].reverse()) {
    if (pointInPolygon([point.x, point.y], item.normalized_polygon ?? [])) return { type: "missed_card", id: item.id };
  }
  return null;
}

function axisAlignedPolygon(a, b) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

function defaultCorrectionPolygon(center, tool) {
  const size = defaultCorrectionSize(tool);
  const width = size.width;
  const height = size.height;
  return clampedPolygon([
    [center.x - width / 2, center.y - height / 2],
    [center.x + width / 2, center.y - height / 2],
    [center.x + width / 2, center.y + height / 2],
    [center.x - width / 2, center.y + height / 2],
  ]);
}

function defaultCorrectionSize(tool) {
  const cardSize = medianOverviewCardSize();
  if (tool === "add-pill") {
    if (cardSize) {
      return {
        width: clamp(cardSize.shortSide * 0.28, 0.025, 0.12),
        height: clamp(cardSize.shortSide * 0.105, 0.010, 0.045),
      };
    }
    return defaultScreenSizedCorrection(86, 34);
  }
  if (cardSize) {
    return {
      width: clamp(cardSize.shortSide, 0.08, 0.22),
      height: clamp(cardSize.longSide, 0.11, 0.32),
    };
  }
  return defaultScreenSizedCorrection(140, 190);
}

function medianOverviewCardSize() {
  const sizes = (overviewMap?.slots ?? [])
    .map((slot) => normalizedPolygonSize(slot.normalized_polygon ?? []))
    .filter((size) => size.shortSide > 0.02 && size.longSide > 0.03);
  if (sizes.length === 0) return null;
  return {
    shortSide: median(sizes.map((size) => size.shortSide)),
    longSide: median(sizes.map((size) => size.longSide)),
  };
}

function normalizedPolygonSize(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 4) return { shortSide: 0, longSide: 0 };
  const sides = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    sides.push(Math.hypot(next[0] - current[0], next[1] - current[1]));
  }
  const sorted = sides.sort((a, b) => a - b);
  return {
    shortSide: (sorted[0] + sorted[1]) / 2,
    longSide: (sorted[2] + sorted[3]) / 2,
  };
}

function defaultScreenSizedCorrection(pixelWidth, pixelHeight) {
  const rect = overviewCanvas.getBoundingClientRect();
  const { drawnWidth, drawnHeight } = overviewImageRect(rect);
  return {
    width: clamp(pixelWidth / Math.max(1, drawnWidth), 0.01, 0.16),
    height: clamp(pixelHeight / Math.max(1, drawnHeight), 0.006, 0.18),
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function selectedCorrectionPolygon(target) {
  if (!target) return null;
  if (target.type === "missed_pill") {
    const item = overviewCorrections.missed_pills.find((correction) => correction.id === target.id);
    return item?.normalized_box?.map((point) => [...point]) ?? null;
  }
  if (target.type === "missed_card") {
    const item = overviewCorrections.missed_cards.find((correction) => correction.id === target.id);
    return item?.normalized_polygon?.map((point) => [...point]) ?? null;
  }
  return null;
}

function moveSelectedCorrection(gesture) {
  if (!gesture?.target || !gesture.originalPolygon) return;
  const dx = gesture.current.x - gesture.start.x;
  const dy = gesture.current.y - gesture.start.y;
  const moved = translateNormalizedPolygon(gesture.originalPolygon, dx, dy);
  if (gesture.target.type === "missed_pill") {
    const item = overviewCorrections.missed_pills.find((correction) => correction.id === gesture.target.id);
    if (item) item.normalized_box = moved;
  } else if (gesture.target.type === "missed_card") {
    const item = overviewCorrections.missed_cards.find((correction) => correction.id === gesture.target.id);
    if (item) item.normalized_polygon = moved;
  }
}

function translateNormalizedPolygon(polygon, dx, dy) {
  const xs = polygon.map((point) => point[0] + dx);
  const ys = polygon.map((point) => point[1] + dy);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const shiftX = minX < 0 ? -minX : maxX > 1 ? 1 - maxX : 0;
  const shiftY = minY < 0 ? -minY : maxY > 1 ? 1 - maxY : 0;
  return clampedPolygon(polygon.map(([x, y]) => [x + dx + shiftX, y + dy + shiftY]));
}

function clampedPolygon(polygon) {
  return polygon.map(([x, y]) => [roundNormalized(clamp(x, 0, 1)), roundNormalized(clamp(y, 0, 1))]);
}

function roundNormalized(value) {
  return Math.round(value * 100000) / 100000;
}

function nextCorrectionId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function loadStatus() {
  const response = await fetch("/fifa-sticker-app/api/status");
  const status = await response.json();
  const sideLabel = status.expected_side === "back" ? "Back-card" : "Front-card";
  systemStatus.textContent = status.model_exists && status.catalog_exists
    ? `${sideLabel} model and catalogue loaded`
    : "Model or catalogue missing";
  const secure = window.isSecureContext;
  cameraHint.textContent = secure
    ? "Camera access is available in this browser context."
    : "Camera access needs HTTPS. Replay mode still works over local HTTP.";
  startCameraButton.disabled = !secure || !navigator.mediaDevices?.getUserMedia;
  connectionSummary.textContent = status.https_enabled
    ? "Open one of these HTTPS URLs on a phone on the same Wi-Fi."
    : "Replay mode can use HTTP. Camera mode needs the server launched with --phone or --https.";
  accessUrls.replaceChildren(
    ...(status.access_urls ?? []).map((url) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = url;
      link.textContent = url;
      item.append(link);
      return item;
    }),
  );
  if (status.certificate_url) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = status.certificate_url;
    link.textContent = "Download development certificate";
    item.append(link);
    accessUrls.append(item);
  }
}

async function loadVideos() {
  const response = await fetch("/fifa-sticker-app/api/videos");
  const payload = await response.json();
  videoSelect.replaceChildren(
    ...payload.videos.map((item) => {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = item.name;
      return option;
    }),
  );
  if (payload.videos.length > 0) {
    video.src = payload.videos[0].url;
  }
  videoSelect.addEventListener("change", () => {
    stopReplay();
    const selected = payload.videos.find((item) => item.name === videoSelect.value);
    video.src = selected?.url ?? "";
    latestTracks = [];
    rememberedCards = [];
    surfaceCards = new Map();
    resetOverviewMap();
    scanHistory = createScanHistory();
    updateHud({});
  });
}

async function loadCatalogCards() {
  try {
    const response = await fetch("/fifa-sticker-app/api/catalog/cards");
    const payload = await response.json();
    catalogCards = payload.cards ?? [];
    cardCodeOptions.replaceChildren(
      ...catalogCards.map((card) => {
        const option = document.createElement("option");
        option.value = card.code;
        option.label = `${card.code} ${card.name} · ${card.team}`;
        return option;
      }),
    );
  } catch {
    catalogCards = [];
  }
}

async function loadOverviewSamples() {
  if (!overviewSampleSelect || !loadOverviewSampleButton) return;
  try {
    const response = await fetch("/fifa-sticker-app/api/overview/samples");
    const payload = await response.json();
    overviewSamples = payload.samples ?? [];
  } catch {
    overviewSamples = [];
  }
  overviewSampleSelect.replaceChildren(
    ...overviewSamples.map((item) => {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = item.label ?? item.name;
      return option;
    }),
  );
  // Keep the current phone capture one tap away while retaining all fixtures
  // in the picker for comparison.
  const latestFlash = overviewSamples.find((item) => item.name === "latest_phone_flash.jpg");
  if (latestFlash) overviewSampleSelect.value = latestFlash.name;
  loadOverviewSampleButton.disabled = overviewSamples.length === 0;
}

async function ensureSession() {
  if (sessionId) return sessionId;
  const response = await fetch("/fifa-sticker-app/api/sessions", { method: "POST" });
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  sessionId = payload.session_id;
  captureOverviewButton.disabled = false;
  return sessionId;
}

async function loadSelectedOverviewSample() {
  if (!overviewSampleSelect || overviewBusy) return;
  const sample = overviewSamples.find((item) => item.name === overviewSampleSelect.value);
  if (!sample) return;
  overviewBusy = true;
  loadOverviewSampleButton.disabled = true;
  captureOverviewButton.disabled = true;
  statusLine.textContent = `Loading ${sample.label ?? sample.name}`;
  try {
    await ensureSession();
    const response = await fetch(sample.url);
    if (!response.ok) {
      statusLine.textContent = `Could not load sample: ${await response.text()}`;
      return;
    }
    const blob = await response.blob();
    const measured = await measureImageBlob(blob);
    await submitOverviewCapture({
      blob,
      source: `sample:${sample.name}`,
      width: measured?.width ?? 0,
      height: measured?.height ?? 0,
    });
  } catch (error) {
    statusLine.textContent = `Could not load sample: ${error}`;
  } finally {
    overviewBusy = false;
    loadOverviewSampleButton.disabled = overviewSamples.length === 0;
    captureOverviewButton.disabled = !sessionId;
    drawOverviewMap();
  }
}

function setMode(nextMode) {
  if (mode === nextMode) return;
  stopReplay();
  stopCamera();
  mode = nextMode;
  document.body.dataset.mode = mode;
  document.querySelector("#replayMode").classList.toggle("active", mode === "replay");
  document.querySelector("#cameraMode").classList.toggle("active", mode === "camera");
  replayControls.classList.toggle("hidden", mode !== "replay");
  cameraControls.classList.toggle("hidden", mode !== "camera");
  video.controls = mode === "replay";
  latestTracks = [];
  rememberedCards = [];
  surfaceCards = new Map();
  resetOverviewMap();
  scanHistory = createScanHistory();
  statusLine.textContent = "Idle";
  updateHud({});
}

async function startReplay() {
  stopReplay();
  stopCamera();
  const selectedName = videoSelect.value;
  const selectedUrl = `/media/sample_videos/${encodeURIComponent(selectedName)}`;
  video.src = selectedUrl;
  video.currentTime = 0;
  latestTracks = [];
  rememberedCards = [];
  surfaceCards = new Map();
  resetOverviewMap();
  scanHistory = createScanHistory();
  updateHud({});
  statusLine.textContent = "Starting replay";
  await video.play().catch(() => {});
  eventSource = new EventSource(`/api/replay?video=${encodeURIComponent(selectedName)}&frame_stride=6`);
  eventSource.addEventListener("meta", (event) => {
    const payload = JSON.parse(event.data);
    displaySize = payload.display_size;
    statusLine.textContent = `${payload.video} · streaming`;
    resizeCanvas();
  });
  eventSource.addEventListener("frame", (event) => {
    const payload = JSON.parse(event.data);
    latestTracks = payload.tracks ?? [];
    rememberedCards = payload.remembered_cards ?? rememberedCards;
    displaySize = payload.display_size ?? displaySize;
    updateSurfaceCards(payload);
    updateOverviewMap(payload);
    updateHud(payload);
  });
  eventSource.addEventListener("done", () => {
    statusLine.textContent = "Replay complete";
    stopReplay(false);
  });
  eventSource.onerror = () => {
    statusLine.textContent = "Replay connection closed";
    stopReplay(false);
  };
}

function stopReplay(pauseVideo = true) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (pauseVideo && mode === "replay") {
    video.pause();
  }
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    statusLine.textContent = "Camera requires HTTPS on this device";
    return;
  }
  stopReplay();
  stopCamera();
  latestTracks = [];
  rememberedCards = [];
  surfaceCards = new Map();
  resetOverviewMap();
  scanHistory = createScanHistory();
  updateHud({});
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 4096 },
        height: { ideal: 3072 },
        frameRate: { ideal: 15, max: 30 },
      },
      audio: false,
    });
    const [videoTrack] = cameraStream.getVideoTracks();
    cameraVideoTrack = videoTrack ?? null;
    await applyBestCameraResolution(videoTrack);
    cameraImageCapture = window.ImageCapture && videoTrack ? new ImageCapture(videoTrack) : null;
    cameraCaptureProfile = await cameraCaptureMetadata(videoTrack);
    updateTorchSupport(videoTrack);
    video.srcObject = cameraStream;
    video.controls = false;
    await video.play();
    const response = await fetch("/fifa-sticker-app/api/sessions", { method: "POST" });
    const payload = await response.json();
    sessionId = payload.session_id;
    displaySize = [video.videoWidth || 1280, video.videoHeight || 720];
    const width = cameraCaptureProfile?.track_settings?.width ?? video.videoWidth ?? 0;
    const height = cameraCaptureProfile?.track_settings?.height ?? video.videoHeight ?? 0;
    statusLine.textContent = width && height ? `Camera streaming · ${width}×${height}` : "Camera streaming";
    document.body.dataset.cameraRunning = "true";
    captureOverviewButton.disabled = false;
    cameraTimer = window.setInterval(captureCameraFrame, 280);
  } catch (error) {
    stopCamera();
    statusLine.textContent = `Camera failed: ${error?.name ?? "permission denied"}`;
  }
}

function stopCamera() {
  const stoppedSessionId = sessionId;
  if (cameraTimer) {
    window.clearInterval(cameraTimer);
    cameraTimer = null;
  }
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    cameraStream = null;
  }
  cameraVideoTrack = null;
  cameraImageCapture = null;
  cameraCaptureProfile = null;
  torchSupported = false;
  torchEnabled = false;
  updateTorchButton();
  sessionId = null;
  captureOverviewButton.disabled = true;
  if (stoppedSessionId) {
    fetch(`/api/sessions/${stoppedSessionId}/stop`, { method: "POST" }).catch(() => {});
  }
  document.body.dataset.cameraRunning = "false";
  exitOverviewReviewMode();
  if (mode === "camera") {
    video.srcObject = null;
    latestTracks = [];
    rememberedCards = [];
    updateHud({});
  }
}

async function captureOverviewPair() {
  if (overviewBusy || !sessionId || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  if (!activeOverviewPairId) activeOverviewPairId = createOverviewPairId();
  if (shouldUseFileOverviewCapture()) {
    openNativeOverviewCamera(pendingOverviewLighting ?? "no_flash");
    return;
  }
  const noFlash = await captureOverview("no_flash", activeOverviewPairId);
  const flash = await captureOverview("flash_on", activeOverviewPairId);
  if (noFlash?.blob && flash?.blob) await processCapturedPair(noFlash, flash);
  activeOverviewPairId = null;
}

function openNativeOverviewCamera(lighting) {
  pendingOverviewLighting = lighting;
  statusLine.textContent = `Opening high-res camera · set ${lighting === "flash_on" ? "Flash On" : "Flash Off"}`;
  overviewPhotoInput.value = "";
  overviewPhotoInput.click();
}

async function captureOverview(lighting, pairId) {
  if (overviewBusy || !sessionId) return null;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  overviewBusy = true;
  captureOverviewButton.disabled = true;
  statusLine.textContent = `Capturing ${lighting === "flash_on" ? "flash" : "no-flash"} overview`;
  const restoreTorch = await enableTorchForOverview(lighting);
  try {
    const capture = await captureOverviewBlob(width, height, lighting);
    if (!capture?.blob) return null;
    capture.lighting = lighting;
    capture.pairId = pairId;
    return capture;
  } finally {
    await restoreTorch();
    overviewBusy = false;
    captureOverviewButton.disabled = !sessionId;
    drawOverviewMap();
  }
}

async function handleOverviewPhotoInputChange(event) {
  const file = event.target.files?.[0];
  if (!file || overviewBusy || !sessionId) return;
  overviewBusy = true;
  captureOverviewButton.disabled = true;
  statusLine.textContent = "Loading overview photo";
  try {
    const measured = await measureImageBlob(file);
    const capture = {
      blob: file,
      source: "file-photo-native",
      width: measured?.width ?? 0,
      height: measured?.height ?? 0,
      metadata: await captureMetadataForFile(file, measured),
      lighting: pendingOverviewLighting,
      pairId: activeOverviewPairId,
    };
    if (pendingOverviewLighting === "no_flash") {
      pendingNoFlashCapture = capture;
    } else if (pendingNoFlashCapture) {
      await processCapturedPair(pendingNoFlashCapture, capture);
      pendingNoFlashCapture = null;
    }
  } finally {
    overviewBusy = false;
    captureOverviewButton.disabled = !sessionId;
    event.target.value = "";
    drawOverviewMap();
  }
  if (pendingOverviewLighting === "no_flash" && activeOverviewPairId) {
    pendingOverviewLighting = "flash_on";
    captureOverviewButton.textContent = "Capture flash photo";
    statusLine.textContent = "No-flash photo saved · now set Flash On and tap Capture flash photo";
    return;
  }
  pendingOverviewLighting = null;
  activeOverviewPairId = null;
  captureOverviewButton.textContent = "Capture pair: no flash → flash";
}

async function processCapturedPair(noFlash, flash) {
  overviewBusy = true;
  captureOverviewButton.disabled = true;
  statusLine.textContent = "Photos captured · matching flash photo";
  try {
    const first = await submitOverviewCapture(flash);
    if (overviewHasEveryCardMatched(first?.overview_map)) {
      await archiveOverviewWithoutRecognition(noFlash);
      statusLine.textContent = "Flash photo fully matched · no-flash photo saved without processing";
      return;
    }
    statusLine.textContent = "Flash needs help · matching no-flash photo";
    await submitOverviewCapture(noFlash);
  } finally {
    overviewBusy = false;
    captureOverviewButton.disabled = !sessionId;
    drawOverviewMap();
  }
}

function overviewHasEveryCardMatched(map) {
  const slots = map?.slots ?? [];
  return Boolean(map?.accepted) && slots.length > 0 && slots.every((slot) => overviewSlotStatus(slot) === "matched");
}

async function archiveOverviewWithoutRecognition(capture) {
  const response = await fetch(`/api/sessions/${sessionId}/overview/raw`, {
    method: "POST",
    headers: {
      "Content-Type": capture.blob.type || "image/jpeg",
      "X-Capture-Source": capture.source,
      "X-Capture-Width": String(capture.width ?? 0),
      "X-Capture-Height": String(capture.height ?? 0),
      "X-Capture-Metadata": encodeCaptureMetadata(capture.metadata),
      "X-Capture-Lighting": capture.lighting ?? "single",
      "X-Capture-Pair-Id": capture.pairId ?? "",
    },
    body: capture.blob,
  });
  if (!response.ok) throw new Error(await response.text());
  await loadTradeInventory();
  return response.json();
}

async function submitOverviewCapture(capture) {
  overviewCaptureInfo = capture;
  showCapturedOverview(capture.blob);

  const response = await fetch(`/api/sessions/${sessionId}/overview`, {
    method: "POST",
    headers: {
      "Content-Type": capture.blob.type || "image/jpeg",
      "X-Capture-Source": capture.source,
      "X-Capture-Width": String(capture.width ?? 0),
      "X-Capture-Height": String(capture.height ?? 0),
      "X-Capture-Metadata": encodeCaptureMetadata(capture.metadata),
      "X-Capture-Lighting": capture.lighting ?? "single",
      "X-Capture-Pair-Id": capture.pairId ?? "",
    },
    body: capture.blob,
  });
  if (!response.ok) {
    statusLine.textContent = `Overview rejected · ${await response.text()}`;
    return null;
  }
  const payload = await response.json();
  await loadTradeInventory();
  if (!payload.overview_map?.accepted) {
    updateOverviewMap(payload);
    updateHud(payload);
    const count = payload.overview_map?.detected_slot_count ?? 0;
    const reason = payload.overview_map?.rejected_reason ?? "not enough slots";
    statusLine.textContent = `Overview rejected · ${count} slots · ${reason}`;
    return payload;
  }
  updateOverviewMap(payload);
  updateHud(payload);
  const matched = overviewMap?.matched_count ?? overviewMap?.confirmed_count ?? 0;
  const needsHelp =
    (overviewMap?.unconfirmed_count ?? 0) +
    (overviewMap?.not_matched_count ?? 0) +
    (overviewMap?.unreadable_count ?? 0);
  const captureLabel = formatCaptureInfo(capture, payload.display_size);
  statusLine.textContent = `Overview captured · ${captureLabel} · ${matched}/${overviewMap?.slot_count ?? 0} matched · ${needsHelp} need help`;
  return payload;
}

function showCapturedOverview(blob) {
  const previousUrl = overviewImage.src;
  resetOverviewCorrections();
  overviewMap = null;
  overviewImageReady = false;
  overviewReviewMode = true;
  document.body.dataset.overviewReview = "true";
  document.body.dataset.overviewReady = "true";
  latestTracks = [];
  surfaceCards = new Map();
  overviewImage.src = URL.createObjectURL(blob);
  if (previousUrl?.startsWith("blob:")) URL.revokeObjectURL(previousUrl);
  overviewStatus.textContent = "Computing...";
  statusLine.textContent = "Computing overview";
  backToCameraButton.hidden = false;
  drawOverviewMap();
  updateHud({ overview_map: null, active_track_count: 0, confirmed_count: 0, candidate_count: 0 });
}

function returnToCameraFromOverview() {
  exitOverviewReviewMode();
  statusLine.textContent = sessionId ? "Camera streaming" : "Idle";
}

function exitOverviewReviewMode() {
  overviewReviewMode = false;
  delete document.body.dataset.overviewReview;
  backToCameraButton.hidden = true;
  drawOverviewMap();
}

async function enableTorchForOverview(lighting) {
  if (lighting !== "flash_on" || !torchSupported || torchEnabled) return async () => {};
  const turnedOn = await setTorch(true);
  if (!turnedOn) return async () => {};
  statusLine.textContent = "Capturing overview · torch on";
  await sleep(280);
  return async () => {
    await setTorch(false);
  };
}

async function toggleTorch() {
  if (!torchSupported) return;
  const next = !torchEnabled;
  const changed = await setTorch(next);
  if (changed) {
    statusLine.textContent = next ? "Torch on" : "Torch off";
  }
}

function updateTorchSupport(track) {
  const capabilities = track?.getCapabilities?.() ?? {};
  torchSupported = Boolean(capabilities.torch);
  torchEnabled = false;
  updateTorchButton();
}

function updateTorchButton() {
  toggleTorchButton.hidden = !cameraVideoTrack || !torchSupported;
  toggleTorchButton.disabled = !cameraVideoTrack || !torchSupported;
  toggleTorchButton.classList.toggle("active", torchEnabled);
  toggleTorchButton.textContent = torchEnabled ? "Torch on" : "Torch";
}

async function setTorch(enabled) {
  if (!cameraVideoTrack?.applyConstraints) return false;
  try {
    await cameraVideoTrack.applyConstraints({ advanced: [{ torch: enabled }] });
    torchEnabled = enabled;
    updateTorchButton();
    return true;
  } catch {
    torchSupported = false;
    torchEnabled = false;
    updateTorchButton();
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function captureOverviewBlob(width, height, lighting) {
  const native = await captureNativeOverviewPhoto(lighting);
  if (native) return native;

  if (!captureCanvas) {
    captureCanvas = document.createElement("canvas");
    captureContext = captureCanvas.getContext("2d");
  }
  const maxEdge = 8192;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const captureWidth = Math.max(1, Math.round(width * scale));
  const captureHeight = Math.max(1, Math.round(height * scale));
  captureCanvas.width = captureWidth;
  captureCanvas.height = captureHeight;
  captureContext.drawImage(video, 0, 0, captureWidth, captureHeight);
  const blob = await new Promise((resolve) => captureCanvas.toBlob(resolve, "image/jpeg", 0.97));
  return blob?.size
    ? {
      blob,
      source: "video-frame",
      width: captureWidth,
      height: captureHeight,
      metadata: captureMetadata({ capture_width: captureWidth, capture_height: captureHeight }),
    }
    : null;
}

function shouldUseFileOverviewCapture() {
  if (!overviewPhotoInput) return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.maxTouchPoints > 1) return true;
  if (cameraImageCapture?.takePhoto) return false;
  return false;
}

async function captureNativeOverviewPhoto(lighting) {
  if (!cameraImageCapture?.takePhoto) return null;
  try {
    const capabilities = cameraImageCapture.getPhotoCapabilities
      ? await cameraImageCapture.getPhotoCapabilities()
      : null;
    const settings = {};
    const maxWidth = capabilities?.imageWidth?.max;
    const maxHeight = capabilities?.imageHeight?.max;
    if (maxWidth && maxHeight) {
      settings.imageWidth = maxWidth;
      settings.imageHeight = maxHeight;
    }
    const modes = capabilities?.fillLightMode ?? [];
    const requestedMode = lighting === "flash_on" ? "flash" : "off";
    if (Array.isArray(modes) && modes.includes(requestedMode)) settings.fillLightMode = requestedMode;
    const blob = await cameraImageCapture.takePhoto(settings);
    if (!blob?.size) return null;
    const measured = await measureImageBlob(blob);
    return {
      blob,
      source: "native-photo",
      width: measured?.width ?? maxWidth ?? 0,
      height: measured?.height ?? maxHeight ?? 0,
      metadata: captureMetadata({
        photo_capabilities: compactPhotoCapabilities(capabilities),
        requested_lighting: lighting,
        requested_fill_light_mode: settings.fillLightMode ?? null,
        capture_width: measured?.width ?? maxWidth ?? 0,
        capture_height: measured?.height ?? maxHeight ?? 0,
      }),
    };
  } catch {
    return null;
  }
}

async function cameraCaptureMetadata(track) {
  let photoCapabilities = null;
  try {
    photoCapabilities = cameraImageCapture?.getPhotoCapabilities
      ? await cameraImageCapture.getPhotoCapabilities()
      : null;
  } catch {
    // Optional browser capability; capture remains usable without it.
  }
  return captureMetadata({ photo_capabilities: compactPhotoCapabilities(photoCapabilities) }, track);
}

function captureMetadata(extra = {}, track = cameraVideoTrack) {
  return {
    captured_at: new Date().toISOString(),
    source_context: "in_app_overview",
    secure_context: window.isSecureContext,
    user_agent: navigator.userAgent,
    screen: { width: window.screen?.width ?? 0, height: window.screen?.height ?? 0, pixel_ratio: window.devicePixelRatio ?? 1 },
    track_settings: compactCameraFields(track?.getSettings?.()),
    track_capabilities: compactCameraFields(track?.getCapabilities?.()),
    torch_requested: Boolean(torchEnabled),
    ...extra,
  };
}

function createOverviewPairId() {
  return window.crypto?.randomUUID?.() ?? `pair_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function loadTradeInventory() {
  if (!inventorySummary || !inventoryList) return;
  try {
    const response = await fetch("/fifa-sticker-app/api/trade-inventory");
    if (!response.ok) throw new Error("inventory unavailable");
    const payload = await response.json();
    const cards = Object.values(payload.cards ?? {}).sort((a, b) => a.code.localeCompare(b.code));
    const stats = payload.stats ?? {};
    const total = stats.matched_card_count ?? cards.reduce((sum, card) => sum + (card.count ?? 0), 0);
    inventorySummary.textContent = `${stats.session_count ?? 0} sessions · ${total} cards · ${stats.unique_code_count ?? cards.length} codes · ${stats.photo_count ?? 0} saved photos`;
    sessionCount.textContent = stats.session_count ?? 0;
    inventoryCardCount.textContent = total;
    inventoryCodeCount.textContent = stats.unique_code_count ?? cards.length;
    captureCount.textContent = stats.photo_count ?? 0;
    inventoryList.replaceChildren(...cards.slice(0, 20).map((card) => {
      const item = document.createElement("li");
      const insignia = card.back_insignia_type === "united_edition"
        ? "Green card"
        : card.back_insignia_type === "standard_fifa_licensed"
          ? "Blue card"
          : "colour unknown";
      item.textContent = `${card.code} ×${card.count} · ${insignia}`;
      return item;
    }));
  } catch {
    inventorySummary.textContent = "Saved inventory unavailable";
  }
}

async function captureMetadataForFile(file, measured) {
  return captureMetadata({
    file: {
      name: file.name || null,
      type: file.type || null,
      bytes: file.size || 0,
      last_modified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    },
    capture_width: measured?.width ?? 0,
    capture_height: measured?.height ?? 0,
    native_camera_flow: true,
  });
}

function compactCameraFields(values) {
  if (!values) return null;
  const fields = ["width", "height", "imageWidth", "imageHeight", "aspectRatio", "frameRate", "facingMode", "resizeMode", "torch", "zoom", "focusMode", "exposureMode", "whiteBalanceMode"];
  return Object.fromEntries(fields.filter((field) => values[field] !== undefined).map((field) => [field, values[field]]));
}

function compactPhotoCapabilities(values) {
  if (!values) return null;
  return compactCameraFields(values);
}

function encodeCaptureMetadata(metadata) {
  if (!metadata) return "";
  const encoded = encodeURIComponent(JSON.stringify(metadata));
  // Keep this diagnostic header safely below normal proxy/header limits.
  return encoded.length <= 7000 ? encoded : "";
}

async function applyBestCameraResolution(track) {
  if (!track?.applyConstraints || !track.getCapabilities) return;
  const capabilities = track.getCapabilities();
  const maxWidth = capabilities.width?.max;
  const maxHeight = capabilities.height?.max;
  if (!maxWidth || !maxHeight) return;
  try {
    await track.applyConstraints({
      width: { ideal: maxWidth },
      height: { ideal: maxHeight },
      resizeMode: "none",
    });
  } catch {
    // Browsers are allowed to reject exact high-resolution constraints.
  }
}

function measureImageBlob(blob) {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(size);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function formatCaptureInfo(capture, decodedSize) {
  const width = decodedSize?.[0] || capture?.width || 0;
  const height = decodedSize?.[1] || capture?.height || 0;
  const source =
    capture?.source === "native-photo"
      ? "photo"
      : capture?.source === "file-photo"
        ? "file photo"
        : "video frame";
  return width && height ? `${source} ${width}x${height}` : source;
}

async function captureCameraFrame() {
  if (overviewBusy) return;
  if (overviewReviewMode) return;
  if (cameraBusy) return;
  if (!sessionId || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;
  cameraBusy = true;
  if (!captureCanvas) {
    captureCanvas = document.createElement("canvas");
    captureContext = captureCanvas.getContext("2d");
  }
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const captureWidth = Math.max(1, Math.round(width * scale));
  const captureHeight = Math.max(1, Math.round(height * scale));
  captureCanvas.width = captureWidth;
  captureCanvas.height = captureHeight;
  captureContext.drawImage(video, 0, 0, captureWidth, captureHeight);
  try {
    const blob = await new Promise((resolve) => captureCanvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) return;
    const response = await fetch(`/api/sessions/${sessionId}/frame`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    if (!response.ok) {
      statusLine.textContent = `Frame rejected · ${await response.text()}`;
      return;
    }
    const payload = await response.json();
    latestTracks = payload.tracks ?? [];
    rememberedCards = payload.remembered_cards ?? rememberedCards;
    displaySize = payload.display_size ?? [width, height];
    updateSurfaceCards(payload);
    updateOverviewMap(payload);
    updateHud(payload);
  } finally {
    cameraBusy = false;
  }
}

function updateHud(payload) {
  updateScanHistory(payload);
  const visibleLiveTracks = latestTracks
    .filter((track) => track.state !== "detected")
    .filter((track) => !track.code || !rememberedCards.some((card) => card.code === track.code));
  const items = [
    ...rememberedCards.slice(0, 16).map((card) => {
      const item = document.createElement("li");
      item.className = card.confirmed ? "confirmed" : "candidate";
      item.textContent = `${card.code} ${card.name}`;
      return item;
    }),
    ...visibleLiveTracks.slice(0, 6).map((track) => {
      const item = document.createElement("li");
      item.className = track.state;
      item.textContent = `#${track.track_id} ${track.label}`;
      return item;
    }),
  ];
  trackList.replaceChildren(...items);
  renderReviewLists();
}

function updateSurfaceCards(payload) {
  if (Array.isArray(payload.surface_cards)) {
    surfaceCards = new Map(
      payload.surface_cards
        .filter((card) => card.normalized_polygon)
        .filter((card) => (card.map_alignment_quality ?? 0) >= 0.7)
        .map((card) => [
          card.id,
          {
            key: card.id,
            code: card.code,
            label: `${card.code} ${card.name}`,
            normalized_polygon: card.normalized_polygon,
            state: card.state,
            color: card.color,
            score: card.confidence ?? 0,
            mapAlignmentMode: card.map_alignment_mode,
            mapAlignmentQuality: card.map_alignment_quality ?? 0,
            firstSeen: card.first_seen ?? payload.frame_index ?? 0,
            lastSeen: card.last_seen ?? payload.frame_index ?? 0,
          },
        ]),
    );
    return;
  }
  const frameIndex = payload.frame_index ?? 0;
  for (const track of latestTracks) {
    if (!shouldRememberSurfaceTrack(track)) continue;
    const key = track.code ? `code:${track.code}` : `track:${track.track_id}`;
    const remembered = track.code
      ? rememberedCards.find((card) => card.code === track.code)
      : null;
    const existing = surfaceCards.get(key);
    if (existing && isSurfaceGeometryJump(existing.normalized_polygon, track.normalized_polygon)) {
      continue;
    }
    surfaceCards.set(key, {
      key,
      code: track.code,
      label: remembered?.name ?? labelForTrack(track),
      normalized_polygon: track.normalized_polygon,
      state: "confirmed",
      color: "#00be00",
      score: track.score ?? 0,
      firstSeen: existing?.firstSeen ?? frameIndex,
      lastSeen: frameIndex,
    });
  }
  pruneSurfaceCards(frameIndex);
}

function updateOverviewMap(payload) {
  if (!payload.overview_map) return;
  overviewMap = payload.overview_map;
  document.body.dataset.overviewReady = overviewMap?.enabled ? "true" : "false";
  updateCorrectionButtons();
  drawOverviewMap();
  renderOverviewHelp();
  renderOverviewInspector();
}

function resetOverviewMap() {
  overviewMap = null;
  overviewImageReady = false;
  overviewReviewMode = false;
  resetOverviewCorrections();
  overviewViewport = { scale: 1, panX: 0, panY: 0 };
  overviewPointers.clear();
  overviewGesture = null;
  document.body.dataset.overviewReady = "false";
  delete document.body.dataset.overviewReview;
  backToCameraButton.hidden = true;
  const previousUrl = overviewImage.src;
  overviewImage.removeAttribute("src");
  if (previousUrl?.startsWith("blob:")) URL.revokeObjectURL(previousUrl);
  renderOverviewHelp();
  drawOverviewMap();
}

function resizeOverviewCanvas() {
  const box = overviewCanvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  overviewCanvas.width = Math.max(1, Math.round(box.width * scale));
  overviewCanvas.height = Math.max(1, Math.round(box.height * scale));
  overviewCtx.setTransform(scale, 0, 0, scale, 0, 0);
}

function drawOverviewMap() {
  resizeOverviewCanvas();
  const rect = overviewCanvas.getBoundingClientRect();
  overviewCtx.clearRect(0, 0, rect.width, rect.height);
  overviewComputing.hidden = !(overviewReviewMode && overviewBusy);
  if (overviewReviewMode && overviewImageReady && !overviewMap?.enabled) {
    overviewStatus.textContent = overviewBusy ? "Computing..." : "Overview captured";
    zoomOverviewOutButton.disabled = overviewViewport.scale <= 1.01;
    zoomOverviewInButton.disabled = overviewViewport.scale >= 7.99;
    resetOverviewViewButton.disabled = false;
    backToCameraButton.hidden = false;
    constrainOverviewViewport();
    const { offsetX, offsetY, drawnWidth, drawnHeight } = overviewImageRect(rect);
    overviewImage.style.left = `${offsetX}px`;
    overviewImage.style.top = `${offsetY}px`;
    overviewImage.style.width = `${drawnWidth}px`;
    overviewImage.style.height = `${drawnHeight}px`;
    return;
  }
  if (!overviewMap?.enabled || !overviewImageReady) {
    overviewStatus.textContent = "No overview";
    zoomOverviewOutButton.disabled = true;
    zoomOverviewInButton.disabled = true;
    resetOverviewViewButton.disabled = true;
    backToCameraButton.hidden = !overviewReviewMode;
    renderOverviewHelp();
    overviewImage.style.removeProperty("left");
    overviewImage.style.removeProperty("top");
    overviewImage.style.removeProperty("width");
    overviewImage.style.removeProperty("height");
    return;
  }
  const slots = overviewMap.slots ?? [];
  const matched = overviewMap.matched_count ?? overviewMap.confirmed_count ?? 0;
  const needsHelp =
    (overviewMap.unconfirmed_count ?? 0) +
    (overviewMap.not_matched_count ?? 0) +
    (overviewMap.unreadable_count ?? 0);
  const zoom = overviewViewport.scale > 1.01 ? ` · ${overviewViewport.scale.toFixed(1)}x` : "";
  overviewStatus.textContent = `${matched}/${overviewMap.slot_count ?? slots.length} matched · ${needsHelp} need help${zoom}`;
  zoomOverviewOutButton.disabled = overviewViewport.scale <= 1.01;
  zoomOverviewInButton.disabled = overviewViewport.scale >= 7.99;
  resetOverviewViewButton.disabled = false;
  backToCameraButton.hidden = !overviewReviewMode;
  renderOverviewHelp();
  constrainOverviewViewport();
  const { offsetX, offsetY, drawnWidth, drawnHeight } = overviewImageRect(rect);
  overviewImage.style.left = `${offsetX}px`;
  overviewImage.style.top = `${offsetY}px`;
  overviewImage.style.width = `${drawnWidth}px`;
  overviewImage.style.height = `${drawnHeight}px`;
  for (const slot of slots) {
    drawOverviewSlot(slot, offsetX, offsetY, drawnWidth, drawnHeight);
  }
  drawOverviewCorrections(offsetX, offsetY, drawnWidth, drawnHeight);
}

function overviewImageRect(rect = overviewCanvas.getBoundingClientRect()) {
  const imageWidth = overviewImage.naturalWidth || rect.width;
  const imageHeight = overviewImage.naturalHeight || rect.height;
  const baseScale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
  const drawnWidth = imageWidth * baseScale * overviewViewport.scale;
  const drawnHeight = imageHeight * baseScale * overviewViewport.scale;
  const offsetX = rect.width / 2 - drawnWidth / 2 + overviewViewport.panX;
  const offsetY = rect.height / 2 - drawnHeight / 2 + overviewViewport.panY;
  return { offsetX, offsetY, drawnWidth, drawnHeight };
}

function constrainOverviewViewport() {
  const rect = overviewCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const { drawnWidth, drawnHeight } = overviewImageRect(rect);
  const baseLeft = rect.width / 2 - drawnWidth / 2;
  const baseTop = rect.height / 2 - drawnHeight / 2;
  const edgeMarginX = Math.min(48, rect.width * 0.16);
  const edgeMarginY = Math.min(64, rect.height * 0.16);
  const [minPanX, maxPanX] = overviewPanBounds(rect.width, drawnWidth, baseLeft, edgeMarginX);
  const [minPanY, maxPanY] = overviewPanBounds(rect.height, drawnHeight, baseTop, edgeMarginY);
  overviewViewport.panX = clamp(overviewViewport.panX, minPanX, maxPanX);
  overviewViewport.panY = clamp(overviewViewport.panY, minPanY, maxPanY);
}

function overviewPanBounds(viewportSize, imageSize, baseOffset, edgeMargin) {
  if (imageSize <= viewportSize) {
    const slack = Math.max(edgeMargin, (viewportSize - imageSize) / 2);
    return [-slack, slack];
  }
  const minPan = viewportSize - edgeMargin - imageSize - baseOffset;
  const maxPan = edgeMargin - baseOffset;
  return [minPan, maxPan];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawOverviewSlot(slot, offsetX, offsetY, drawnWidth, drawnHeight) {
  const drawAsCodeAnchor = shouldDrawOverviewSlotAsCodeAnchor(slot);
  const sourcePolygon = drawAsCodeAnchor ? slot.normalized_code_anchor_box : slot.normalized_polygon;
  const points = (sourcePolygon ?? []).map(([x, y]) => [
    offsetX + x * drawnWidth,
    offsetY + y * drawnHeight,
  ]);
  if (points.length < 4) return;
  const phantom = isSlotMarkedPhantom(slot.id);
  const status = phantom ? "phantom" : overviewSlotStatus(slot);
  const color = overviewStatusColor(status);
  const confirmed = status === "matched";
  const selected = selectedOverviewTarget?.type === "slot" && selectedOverviewTarget.id === slot.id;
  overviewCtx.save();
  overviewCtx.globalAlpha = confirmed ? 0.24 : status === "not_matched" ? 0.18 : status === "unreadable" ? 0.12 : 0.13;
  overviewCtx.fillStyle = color;
  overviewCtx.beginPath();
  overviewCtx.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) overviewCtx.lineTo(point[0], point[1]);
  overviewCtx.closePath();
  overviewCtx.fill();
  overviewCtx.globalAlpha = 1;
  overviewCtx.lineWidth = selected ? 4 : confirmed ? 3 : status === "not_matched" ? 2.5 : status === "unreadable" ? 2 : 2;
  if (status === "unreadable") overviewCtx.setLineDash([7, 5]);
  overviewCtx.strokeStyle = color;
  overviewCtx.stroke();
  overviewCtx.setLineDash([]);
  if (
    !drawAsCodeAnchor &&
    slot.normalized_code_anchor_box &&
    (selected || overviewViewport.scale >= 2.2 || slot.code_anchor_top_right === false)
  ) {
    drawOverviewCodeAnchor(slot, points, offsetX, offsetY, drawnWidth, drawnHeight, selected);
  }
  if (phantom) {
    overviewCtx.lineWidth = 3;
    overviewCtx.strokeStyle = "#ff4d4f";
    overviewCtx.beginPath();
    overviewCtx.moveTo(points[0][0], points[0][1]);
    overviewCtx.lineTo(points[2][0], points[2][1]);
    overviewCtx.moveTo(points[1][0], points[1][1]);
    overviewCtx.lineTo(points[3][0], points[3][1]);
    overviewCtx.stroke();
  }
  if (status !== "recognizing") {
    const center = overviewSlotLabelAnchor(slot, points, offsetX, offsetY, drawnWidth, drawnHeight);
    const label = phantom ? "Phantom" : overviewSlotLabel(slot, status);
    overviewCtx.font = "700 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    overviewCtx.textAlign = "center";
    overviewCtx.fillStyle = "rgba(0, 0, 0, 0.72)";
    overviewCtx.fillRect(center[0] - 52, center[1] - 10, 104, 20);
    overviewCtx.fillStyle = "#ffffff";
    overviewCtx.fillText(label, center[0], center[1] + 4);
    const rotation = rotationCorrectionForSlot(slot.id);
    if (rotation?.wrong_orientation || (rotation?.orientation_degrees ?? 0) !== 0) {
      const badge = rotation.wrong_orientation ? "wrong way" : `rot${rotation.orientation_degrees}`;
      overviewCtx.font = "700 10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      overviewCtx.fillStyle = "rgba(255, 176, 0, 0.86)";
      overviewCtx.fillRect(center[0] - 38, center[1] + 13, 76, 18);
      overviewCtx.fillStyle = "#101215";
      overviewCtx.fillText(badge, center[0], center[1] + 26);
    }
  }
  overviewCtx.restore();
}

function overviewSlotLabelAnchor(slot, slotPoints, offsetX, offsetY, drawnWidth, drawnHeight) {
  if (overviewViewport.scale >= 1.6 && slot?.normalized_code_anchor_box?.length >= 4) {
    const anchorPoints = slot.normalized_code_anchor_box.map(([x, y]) => [
      offsetX + x * drawnWidth,
      offsetY + y * drawnHeight,
    ]);
    return polygonCenter(anchorPoints);
  }
  return polygonCenter(slotPoints);
}

function shouldDrawOverviewSlotAsCodeAnchor(slot) {
  return Boolean(
    slot?.normalized_code_anchor_box?.length >= 4 &&
      // A code match is still valuable, but an unresolved rectangle is not
      // a trustworthy card boundary.  Draw the observed pill instead of
      // suggesting a card size or attachment we have not actually resolved.
      slot.geometry_status !== "resolved"
  );
}

function drawOverviewCodeAnchor(slot, slotPoints, offsetX, offsetY, drawnWidth, drawnHeight, selected) {
  const anchorPoints = (slot.normalized_code_anchor_box ?? []).map(([x, y]) => [
    offsetX + x * drawnWidth,
    offsetY + y * drawnHeight,
  ]);
  if (anchorPoints.length < 4 || slotPoints.length < 4) return;
  const anchorOk = slot.code_anchor_top_right !== false;
  const markerColor = anchorOk ? "#5eead4" : "#ff4d4f";
  const anchorCenter = polygonCenter(anchorPoints);
  const topRight = slotPoints[1];
  overviewCtx.save();
  overviewCtx.lineWidth = selected ? 2.5 : 1.75;
  overviewCtx.strokeStyle = markerColor;
  overviewCtx.setLineDash([5, 4]);
  overviewCtx.beginPath();
  overviewCtx.moveTo(anchorPoints[0][0], anchorPoints[0][1]);
  for (const point of anchorPoints.slice(1)) overviewCtx.lineTo(point[0], point[1]);
  overviewCtx.closePath();
  overviewCtx.stroke();
  overviewCtx.setLineDash([]);
  overviewCtx.globalAlpha = selected ? 0.92 : 0.72;
  overviewCtx.beginPath();
  overviewCtx.moveTo(anchorCenter[0], anchorCenter[1]);
  overviewCtx.lineTo(topRight[0], topRight[1]);
  overviewCtx.stroke();
  overviewCtx.fillStyle = markerColor;
  overviewCtx.beginPath();
  overviewCtx.arc(topRight[0], topRight[1], selected ? 5.5 : 4.25, 0, Math.PI * 2);
  overviewCtx.fill();
  if (selected) {
    overviewCtx.font = "800 9px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    overviewCtx.textAlign = "center";
    overviewCtx.fillStyle = "rgba(0, 0, 0, 0.72)";
    overviewCtx.fillRect(topRight[0] - 13, topRight[1] - 24, 26, 16);
    overviewCtx.fillStyle = "#ffffff";
    overviewCtx.fillText("TR", topRight[0], topRight[1] - 12);
  }
  overviewCtx.restore();
}

function drawOverviewCorrections(offsetX, offsetY, drawnWidth, drawnHeight) {
  for (const item of overviewCorrections.missed_cards) {
    drawReviewCorrectionPolygon(
      item.normalized_polygon,
      item.code ? `Card ${item.code}` : "Missed card",
      "#58a6ff",
      selectedOverviewTarget?.type === "missed_card" && selectedOverviewTarget.id === item.id,
      offsetX,
      offsetY,
      drawnWidth,
      drawnHeight,
    );
  }
  for (const item of overviewCorrections.missed_pills) {
    drawReviewCorrectionPolygon(
      item.normalized_box,
      item.code ? `Pill ${item.code}` : "Missed pill",
      "#c084fc",
      selectedOverviewTarget?.type === "missed_pill" && selectedOverviewTarget.id === item.id,
      offsetX,
      offsetY,
      drawnWidth,
      drawnHeight,
    );
  }
  if (overviewDraftCorrection) {
    drawReviewCorrectionPolygon(
      overviewDraftCorrection.normalized_polygon,
      overviewDraftCorrection.kind === "missed_pill" ? "New pill" : "New card",
      overviewDraftCorrection.kind === "missed_pill" ? "#c084fc" : "#58a6ff",
      true,
      offsetX,
      offsetY,
      drawnWidth,
      drawnHeight,
    );
  }
}

function drawReviewCorrectionPolygon(normalizedPolygon, label, color, selected, offsetX, offsetY, drawnWidth, drawnHeight) {
  const points = (normalizedPolygon ?? []).map(([x, y]) => [
    offsetX + x * drawnWidth,
    offsetY + y * drawnHeight,
  ]);
  if (points.length < 4) return;
  overviewCtx.save();
  overviewCtx.globalAlpha = 0.18;
  overviewCtx.fillStyle = color;
  overviewCtx.beginPath();
  overviewCtx.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) overviewCtx.lineTo(point[0], point[1]);
  overviewCtx.closePath();
  overviewCtx.fill();
  overviewCtx.globalAlpha = 1;
  overviewCtx.strokeStyle = color;
  overviewCtx.lineWidth = selected ? 4 : 2.5;
  overviewCtx.setLineDash([8, 5]);
  overviewCtx.stroke();
  overviewCtx.setLineDash([]);
  const center = polygonCenter(points);
  overviewCtx.font = "700 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  overviewCtx.textAlign = "center";
  overviewCtx.fillStyle = "rgba(0, 0, 0, 0.72)";
  overviewCtx.fillRect(center[0] - 54, center[1] - 10, 108, 20);
  overviewCtx.fillStyle = "#ffffff";
  overviewCtx.fillText(label.slice(0, 22), center[0], center[1] + 4);
  overviewCtx.restore();
}

function overviewSlotStatus(slot) {
  if (slot.review_status) return slot.review_status;
  if (slot.state === "confirmed") return "matched";
  if (slot.state === "candidate") return "unconfirmed";
  return "recognizing";
}

function overviewStatusColor(status) {
  if (status === "matched") return "#00be00";
  if (status === "unconfirmed") return "#ffb000";
  if (status === "not_matched") return "#ff4d4f";
  if (status === "unreadable") return "#9aa4b2";
  if (status === "phantom") return "#ff4d4f";
  return "#58a6ff";
}

function overviewSlotLabel(slot, status) {
  if (status === "not_matched") return "Need help";
  if (status === "unreadable") {
    if (slot.back_insignia_type === "united_edition") return "Green card";
    if (slot.back_insignia_type === "standard_fifa_licensed") return "Blue card";
    return "No clue";
  }
  const label = overviewSlotCodeLabel(slot);
  if (status === "unconfirmed") return `Check ${label}`.slice(0, 18);
  return label.slice(0, 12);
}

function overviewSlotCodeLabel(slot) {
  return slot.code || slot.team || slot.id || "Card";
}

function renderOverviewInspector() {
  if (!overviewInspector) return;
  updateCorrectionButtons();
  if (!overviewImageReady) {
    overviewInspector.hidden = true;
    overviewInspector.replaceChildren();
    renderOverviewQuickActions(null);
    return;
  }
  overviewInspector.hidden = false;
  const target = selectedOverviewItem();
  renderOverviewQuickActions(target);
  if (!target) {
    overviewInspector.replaceChildren(
      inspectorTitle("Review tools"),
      inspectorMeta(
        "Inspect: tap a detection. Phantom: tap a false card. Add card/pill: drag a box. Corrections are saved as ground truth.",
      ),
      correctionSummaryNode(),
    );
    return;
  }

  const form = document.createElement("form");
  form.className = "overviewInspectorControls";
  form.dataset.targetType = target.type;
  form.dataset.targetId = target.id;

  const input = document.createElement("input");
  input.name = "code";
  input.placeholder = "BEL19";
  input.autocapitalize = "characters";
  input.autocomplete = "off";
  input.inputMode = "text";
  input.setAttribute("list", "cardCodeOptions");
  input.value = target.code ?? "";

  const set = document.createElement("button");
  set.type = "submit";
  set.textContent = "Set";

  const rotate = document.createElement("button");
  rotate.type = "button";
  rotate.dataset.action = "rotateSelected";
  rotate.textContent = "Rotate 90";

  const wrongWay = document.createElement("button");
  wrongWay.type = "button";
  wrongWay.dataset.action = target.wrongOrientation ? "markOrientationCorrect" : "markOrientationWrong";
  wrongWay.textContent = target.wrongOrientation ? "Correct way" : "Wrong way";

  const action = document.createElement("button");
  action.type = "button";
  if (target.type === "slot") {
    const phantom = isSlotMarkedPhantom(target.id);
    action.dataset.action = phantom ? "clearPhantom" : "markPhantom";
    action.textContent = phantom ? "Undo phantom" : "Phantom";
  } else {
    action.dataset.action = "removeCorrection";
    action.textContent = "Remove";
  }

  form.append(input, set, rotate, wrongWay, action);
  overviewInspector.replaceChildren(
    inspectorTitle(target.title),
    inspectorMeta(target.meta),
    form,
    correctionSummaryNode(),
  );
}

function renderOverviewQuickActions(target) {
  if (!overviewQuickActions) return;
  if (!target || !["slot", "missed_card"].includes(target.type)) {
    overviewQuickActions.hidden = true;
    overviewQuickActions.replaceChildren();
    return;
  }
  overviewQuickActions.hidden = false;

  const title = document.createElement("span");
  title.className = "overviewQuickActionsTitle";
  title.textContent = target.code || target.id;

  const rotate = document.createElement("button");
  rotate.type = "button";
  rotate.dataset.action = "rotateSelected";
  rotate.textContent = "Rotate 90";

  const wrongWay = document.createElement("button");
  wrongWay.type = "button";
  wrongWay.dataset.action = target.wrongOrientation ? "markOrientationCorrect" : "markOrientationWrong";
  wrongWay.textContent = target.wrongOrientation ? "Correct way" : "Wrong way";

  overviewQuickActions.replaceChildren(title, rotate, wrongWay);
}

function inspectorTitle(text) {
  const node = document.createElement("div");
  node.className = "overviewInspectorTitle";
  node.textContent = text;
  return node;
}

function inspectorMeta(text) {
  const node = document.createElement("div");
  node.className = "overviewInspectorMeta";
  node.textContent = text;
  return node;
}

function correctionSummaryNode() {
  const wrap = document.createElement("div");
  wrap.className = "overviewCorrectionList";
  const summary = document.createElement("div");
  summary.className = "overviewInspectorMeta";
  summary.textContent = `${overviewCorrectionCount()} corrections · ${overviewCorrections.phantoms.length} phantoms · ${overviewCorrections.missed_cards.length} cards · ${overviewCorrections.missed_pills.length} pills · ${overviewCorrections.rotations.length} orientation`;
  wrap.append(summary);
  for (const item of correctionListItems().slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "overviewCorrectionListItem";
    const label = document.createElement("span");
    label.textContent = item.label;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = "selectCorrection";
    button.dataset.targetType = item.type;
    button.dataset.targetId = item.id;
    button.textContent = "View";
    row.append(label, button);
    wrap.append(row);
  }
  return wrap;
}

function correctionListItems() {
  return [
    ...overviewCorrections.phantoms.map((item) => ({
      type: "slot",
      id: item.slot_id,
      label: `${item.slot_id} phantom`,
    })),
    ...overviewCorrections.missed_cards.map((item) => ({
      type: "missed_card",
      id: item.id,
      label: `${item.id} missed card ${item.code || ""}`.trim(),
    })),
    ...overviewCorrections.missed_pills.map((item) => ({
      type: "missed_pill",
      id: item.id,
      label: `${item.id} missed pill ${item.code || ""}`.trim(),
    })),
    ...overviewCorrections.rotations.map((item) => ({
      type: "slot",
      id: item.slot_id,
      label: `${item.slot_id} ${item.wrong_orientation ? "wrong way" : "rotate"} ${item.orientation_degrees} deg`,
    })),
  ];
}

function selectedOverviewItem() {
  if (!selectedOverviewTarget) return null;
  if (selectedOverviewTarget.type === "slot") {
    const slot = (overviewMap?.slots ?? []).find((item) => item.id === selectedOverviewTarget.id);
    if (!slot) return null;
    const rotation = overviewCorrections.rotations.find((item) => item.slot_id === slot.id);
    return {
      type: "slot",
      id: slot.id,
      code: slot.code ?? "",
      title: `${slot.id} · ${overviewSlotCodeLabel(slot)}`,
      meta: `status ${overviewSlotStatus(slot)} · source ${slot.source ?? "unknown"} · rotation ${rotation?.orientation_degrees ?? 0} deg${rotation?.wrong_orientation ? " · marked wrong way" : ""}`,
      wrongOrientation: Boolean(rotation?.wrong_orientation),
    };
  }
  if (selectedOverviewTarget.type === "missed_card") {
    const item = overviewCorrections.missed_cards.find((correction) => correction.id === selectedOverviewTarget.id);
    if (!item) return null;
    return {
      type: "missed_card",
      id: item.id,
      code: item.code ?? "",
      title: `${item.id} · missed card`,
      meta: `manual card · rotation ${item.orientation_degrees ?? 0} deg${item.wrong_orientation ? " · marked wrong way" : ""}`,
      wrongOrientation: Boolean(item.wrong_orientation),
    };
  }
  if (selectedOverviewTarget.type === "missed_pill") {
    const item = overviewCorrections.missed_pills.find((correction) => correction.id === selectedOverviewTarget.id);
    if (!item) return null;
    return {
      type: "missed_pill",
      id: item.id,
      code: item.code ?? "",
      title: `${item.id} · missed pill`,
      meta: "manual code-pill box",
    };
  }
  return null;
}

async function handleOverviewInspectorSubmit(event) {
  event.preventDefault();
  const form = event.target.closest("form[data-target-type][data-target-id]");
  if (!form) return;
  await applyOverviewInspectorCode(form.dataset.targetType, form.dataset.targetId, form.elements.code.value);
}

async function handleOverviewInspectorClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "selectCorrection") {
    selectedOverviewTarget = { type: button.dataset.targetType, id: button.dataset.targetId };
  } else if (action === "rotateSelected") {
    rotateSelectedOverviewTarget();
  } else if (action === "markOrientationWrong") {
    markSelectedOrientationWrong(true);
  } else if (action === "markOrientationCorrect") {
    markSelectedOrientationWrong(false);
  } else if (action === "markPhantom") {
    markSelectedSlotPhantom();
  } else if (action === "clearPhantom") {
    clearSelectedSlotPhantom();
  } else if (action === "removeCorrection") {
    removeSelectedOverviewCorrection();
  }
  updateCorrectionButtons();
  renderOverviewInspector();
  drawOverviewMap();
}

async function applyOverviewInspectorCode(type, id, rawCode) {
  const code = normalizeManualCode(rawCode);
  if (!code) return;
  if (type === "slot") {
    await resolveOverviewSlot(id, code, "inspector");
    return;
  }
  const collection = type === "missed_pill" ? overviewCorrections.missed_pills : overviewCorrections.missed_cards;
  const item = collection.find((correction) => correction.id === id);
  if (item) item.code = code;
  updateCorrectionButtons();
  renderOverviewInspector();
  drawOverviewMap();
}

function rotateSelectedOverviewTarget() {
  const target = selectedOverviewTarget;
  if (!target) return;
  if (target.type === "slot") {
    const existing = rotationCorrectionForSlot(target.id, { create: true });
    existing.orientation_degrees = (existing.orientation_degrees + 90) % 360;
    return;
  }
  if (target.type === "missed_card") {
    const item = overviewCorrections.missed_cards.find((correction) => correction.id === target.id);
    if (item) item.orientation_degrees = ((item.orientation_degrees ?? 0) + 90) % 360;
  }
}

function markSelectedOrientationWrong(wrong) {
  const target = selectedOverviewTarget;
  if (!target) return;
  if (target.type === "slot") {
    const correction = rotationCorrectionForSlot(target.id, { create: true });
    correction.wrong_orientation = wrong;
    correction.note = wrong ? "marked wrong orientation" : "marked correct orientation";
    return;
  }
  if (target.type === "missed_card") {
    const item = overviewCorrections.missed_cards.find((correction) => correction.id === target.id);
    if (item) item.wrong_orientation = wrong;
  }
}

function rotationCorrectionForSlot(slotId, options = {}) {
  let correction = overviewCorrections.rotations.find((item) => item.slot_id === slotId);
  if (!correction && options.create) {
    const slot = (overviewMap?.slots ?? []).find((item) => item.id === slotId);
    correction = {
      id: nextCorrectionId("rotation"),
      slot_id: slotId,
      code: slot?.code ?? null,
      normalized_polygon: slot?.normalized_polygon ?? null,
      code_anchor_rotation: slot?.code_anchor_rotation ?? null,
      normalized_code_anchor_box: slot?.normalized_code_anchor_box ?? null,
      orientation_degrees: 0,
      wrong_orientation: false,
    };
    overviewCorrections.rotations.push(correction);
  }
  return correction;
}

function markSelectedSlotPhantom() {
  if (selectedOverviewTarget?.type !== "slot") return;
  const slot = (overviewMap?.slots ?? []).find((item) => item.id === selectedOverviewTarget.id);
  if (!slot) return;
  if (isSlotMarkedPhantom(slot.id)) return;
  overviewCorrections.phantoms.push({
    id: nextCorrectionId("phantom"),
    slot_id: slot.id,
    normalized_polygon: slot.normalized_polygon,
    previous_code: slot.code ?? null,
    note: "phantom card",
  });
}

function clearSelectedSlotPhantom() {
  if (selectedOverviewTarget?.type !== "slot") return;
  overviewCorrections.phantoms = overviewCorrections.phantoms.filter(
    (item) => item.slot_id !== selectedOverviewTarget.id,
  );
}

function removeSelectedOverviewCorrection() {
  if (!selectedOverviewTarget) return;
  if (selectedOverviewTarget.type === "missed_card") {
    overviewCorrections.missed_cards = overviewCorrections.missed_cards.filter(
      (item) => item.id !== selectedOverviewTarget.id,
    );
  } else if (selectedOverviewTarget.type === "missed_pill") {
    overviewCorrections.missed_pills = overviewCorrections.missed_pills.filter(
      (item) => item.id !== selectedOverviewTarget.id,
    );
  }
  selectedOverviewTarget = null;
}

function recordOverviewCodeCorrection(slotId, code, source) {
  const existing = overviewCorrections.code_corrections.find((item) => item.slot_id === slotId);
  if (existing) {
    existing.code = code;
    existing.source = source;
    return;
  }
  overviewCorrections.code_corrections.push({
    id: nextCorrectionId("code"),
    slot_id: slotId,
    code,
    source,
  });
}

function isSlotMarkedPhantom(slotId) {
  return overviewCorrections.phantoms.some((item) => item.slot_id === slotId);
}

function renderOverviewHelp() {
  const slots = (overviewMap?.slots ?? []).filter((slot) => slot.needs_user_help);
  if (!overviewHelpList) return;
  if (!overviewMap?.enabled || slots.length === 0) {
    const item = document.createElement("p");
    item.className = "empty";
    item.textContent = overviewMap?.enabled ? "No cards need help" : "Capture an overview first";
    overviewHelpList.replaceChildren(item);
    return;
  }
  overviewHelpList.replaceChildren(
    ...slots.map((slot) => {
      const card = catalogCards.find((item) => item.code === slot.code);
      const row = document.createElement("form");
      row.className = "overviewHelpRow";
      row.dataset.slotId = slot.id;

      const label = document.createElement("div");
      label.className = "overviewHelpLabel";
      label.textContent = slot.code
        ? `${slot.id} · maybe ${slot.code} ${slot.name ?? ""}`.trim()
        : `${slot.id} · type code`;

      const input = document.createElement("input");
      input.name = "code";
      input.placeholder = "FRA7";
      input.autocapitalize = "characters";
      input.autocomplete = "off";
      input.inputMode = "text";
      input.setAttribute("list", "cardCodeOptions");
      input.value = slot.code ?? "";

      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Set";

      row.append(label);
      if (card) {
        const accept = document.createElement("button");
        accept.type = "button";
        accept.className = "secondary";
        accept.dataset.action = "acceptCandidate";
        accept.dataset.slotId = slot.id;
        accept.dataset.code = card.code;
        accept.textContent = "Accept";
        row.append(accept);
      }
      row.append(input, submit);
      return row;
    }),
  );
}

async function handleOverviewHelpClick(event) {
  const button = event.target.closest("button[data-action='acceptCandidate']");
  if (!button) return;
  await resolveOverviewSlot(button.dataset.slotId, button.dataset.code);
}

async function handleOverviewHelpSubmit(event) {
  event.preventDefault();
  const form = event.target.closest("form[data-slot-id]");
  if (!form) return;
  const input = form.elements.code;
  await resolveOverviewSlot(form.dataset.slotId, input.value);
}

async function resolveOverviewSlot(slotId, rawCode, source = "manual") {
  if (!sessionId || !slotId) return;
  const code = normalizeManualCode(rawCode);
  if (!code) return;
  statusLine.textContent = `Resolving ${slotId} as ${code}`;
  const response = await fetch(`/api/sessions/${sessionId}/overview/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot_id: slotId, code }),
  });
  if (!response.ok) {
    statusLine.textContent = `Could not resolve ${slotId}: ${await response.text()}`;
    return;
  }
  const payload = await response.json();
  recordOverviewCodeCorrection(slotId, code, source);
  updateCorrectionButtons();
  updateOverviewMap(payload);
  updateHud(payload);
  statusLine.textContent = `${slotId} set to ${code}`;
}

function overviewCorrectionsPayload() {
  return {
    captured_at: new Date().toISOString(),
    capture: overviewCaptureInfo
      ? {
          source: overviewCaptureInfo.source,
          width: overviewCaptureInfo.width ?? 0,
          height: overviewCaptureInfo.height ?? 0,
        }
      : null,
    image: {
      width: overviewImage.naturalWidth || 0,
      height: overviewImage.naturalHeight || 0,
    },
    scanner_overview: overviewMap,
    corrections: overviewCorrections,
  };
}

async function saveOverviewCorrections() {
  if (!sessionId || overviewCorrectionCount() === 0) return;
  const response = await fetch(`/api/sessions/${sessionId}/overview/corrections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overviewCorrectionsPayload()),
  });
  if (!response.ok) {
    statusLine.textContent = `Could not save corrections: ${await response.text()}`;
    return;
  }
  const payload = await response.json();
  statusLine.textContent = `Corrections saved · ${payload.path ?? "session"}`;
}

function exportOverviewCorrections() {
  if (overviewCorrectionCount() === 0) return;
  const blob = new Blob([JSON.stringify(overviewCorrectionsPayload(), null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `panini-overview-corrections-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  statusLine.textContent = "Corrections exported";
}

function normalizeManualCode(value) {
  return String(value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function createScanHistory() {
  return {
    recognized: new Map(),
    review: new Map(),
    unrecognized: new Map(),
  };
}

function updateScanHistory(payload) {
  const frameIndex = payload.frame_index ?? 0;
  const map = payload.overview_map ?? overviewMap;
  for (const slot of map?.slots ?? []) {
    const status = overviewSlotStatus(slot);
    scanHistory.unrecognized.delete(slot.id);
    if (status === "not_matched" || status === "unreadable") {
      const key = slot.id;
      scanHistory.unrecognized.set(key, {
        key,
        label: status === "unreadable" ? `${slot.id} no code read` : `${slot.id} need user help`,
        confidence: 0,
        lastSeen: frameIndex,
        firstSeen: frameIndex,
        count: slot.recognition_attempts ?? 1,
      });
      continue;
    }
    if (!slot.code || !slot.name) continue;
    const entry = {
      key: slot.code,
      label: `${slot.code} ${slot.name}`,
      confidence: slot.confidence ?? 0,
      lastSeen: frameIndex,
      firstSeen: frameIndex,
      count: slot.observations ?? 1,
    };
    if (status === "matched") {
      scanHistory.review.delete(slot.code);
      scanHistory.recognized.set(slot.code, entry);
    } else if (status === "unconfirmed" && !scanHistory.recognized.has(slot.code)) {
      scanHistory.review.set(slot.code, entry);
    }
  }

  for (const card of payload.remembered_cards ?? rememberedCards) {
    const key = card.code;
    const entry = {
      key,
      label: `${card.code} ${card.name}`,
      confidence: card.confidence ?? 0,
      lastSeen: card.last_seen ?? frameIndex,
      firstSeen: card.first_seen ?? frameIndex,
      count: 1,
    };
    if (card.confirmed) {
      scanHistory.review.delete(key);
      scanHistory.recognized.set(key, entry);
    } else if (!scanHistory.recognized.has(key)) {
      scanHistory.review.set(key, entry);
    }
  }

  for (const track of latestTracks) {
    if (track.code && scanHistory.recognized.has(track.code)) continue;
    if (track.state === "candidate" && track.code) {
      const key = track.code;
      if (!scanHistory.recognized.has(key)) {
        scanHistory.review.set(key, {
          key,
          label: `${track.code} ${track.label}`,
          confidence: track.score ?? 0,
          lastSeen: frameIndex,
          firstSeen: frameIndex,
          count: 1,
        });
      }
      continue;
    }
    if (track.state === "collecting") {
      const key = `track-${track.track_id}`;
      const existing = scanHistory.unrecognized.get(key);
      scanHistory.unrecognized.set(key, {
        key,
        label: `Unrecognized card #${track.track_id}`,
        confidence: 0,
        lastSeen: frameIndex,
        firstSeen: existing?.firstSeen ?? frameIndex,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  pruneMap(scanHistory.review, 24);
  pruneMap(scanHistory.unrecognized, 10);
}

function shouldRememberSurfaceTrack(track) {
  if (!track.confirmed || !track.code || !track.normalized_polygon) return false;
  const metrics = surfacePolygonMetrics(track.normalized_polygon);
  if (metrics.area < 0.006 || metrics.area > 0.18) return false;
  if (metrics.aspect < 1.08 || metrics.aspect > 2.05) return false;
  return metrics.minX >= 0.015
    && metrics.minY >= 0.015
    && metrics.maxX <= 0.985
    && metrics.maxY <= 0.985;
}

function renderReviewLists() {
  renderHistoryList(recognizedList, [...scanHistory.recognized.values()], "No confirmed cards yet");
  renderHistoryList(reviewList, [...scanHistory.review.values()], "No review candidates");
  renderHistoryList(
    unrecognizedList,
    [...scanHistory.unrecognized.values()].filter((item) => item.count >= 4),
    "No unresolved sightings",
  );
}

function renderHistoryList(list, entries, emptyText) {
  const sorted = entries
    .sort((a, b) => b.lastSeen - a.lastSeen || b.confidence - a.confidence)
    .slice(0, 24);
  if (sorted.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = emptyText;
    list.replaceChildren(item);
    return;
  }
  list.replaceChildren(
    ...sorted.map((entry) => {
      const item = document.createElement("li");
      item.textContent = entry.confidence
        ? `${entry.label} ${entry.confidence.toFixed(2)}`
        : entry.label;
      return item;
    }),
  );
}

function pruneMap(map, limit) {
  if (map.size <= limit) return;
  const sorted = [...map.entries()].sort((a, b) => b[1].lastSeen - a[1].lastSeen);
  map.clear();
  for (const [key, value] of sorted.slice(0, limit)) {
    map.set(key, value);
  }
}

function resizeCanvas() {
  const box = stage.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawnLabelBoxes = [];
  const rect = canvas.getBoundingClientRect();
  const [sourceWidth, sourceHeight] = displaySize;
  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  const offsetX = (rect.width - drawnWidth) / 2;
  const offsetY = (rect.height - drawnHeight) / 2;

  const activeKeys = new Set();
  for (const track of latestTracks) {
    if (track.code) activeKeys.add(`code:${track.code}`);
    activeKeys.add(`track:${track.track_id}`);
    drawTrack(track, offsetX, offsetY, scale);
  }
  for (const card of surfaceCards.values()) {
    if (activeKeys.has(card.key)) continue;
    if (surfaceCardOverlapsLiveTrack(card)) continue;
    drawSurfaceCard(card, offsetX, offsetY, scale);
  }
  requestAnimationFrame(draw);
}

function drawTrack(track, offsetX, offsetY, scale) {
  if (track.state === "detected") return;
  const rememberedSurface = rememberedSurfaceForTrack(track);
  const displayTrack = rememberedSurface
    ? {
        ...track,
        label: rememberedSurface.label,
        state: "confirmed",
        color: "#00be00",
        confirmed: true,
      }
    : track;
  const [sourceWidth, sourceHeight] = displaySize;
  const normalized = displayTrack.normalized_polygon;
  const points = normalized
    ? normalized.map(([x, y]) => [
        offsetX + x * sourceWidth * scale,
        offsetY + y * sourceHeight * scale,
      ])
    : displayTrack.polygon.map(([x, y]) => [offsetX + x * scale, offsetY + y * scale]);
  if (points.length < 4) return;
  drawPolygon(shrinkPolygon(points, 0.9), displayTrack.color, displayTrack.confirmed ? 4 : 3);

  if (!shouldDrawTrackLabel(displayTrack)) return;

  const displayPoints = shrinkPolygon(points, 0.9);
  const anchor = displayTrack.confirmed
    ? labelAnchorForConfirmedTrack(displayPoints)
    : polygonCenter(displayPoints);
  drawLabel(labelForTrack(displayTrack), anchor[0], anchor[1], displayTrack.color);
}

function drawSurfaceCard(card, offsetX, offsetY, scale) {
  const [sourceWidth, sourceHeight] = displaySize;
  const points = card.normalized_polygon.map(([x, y]) => [
    offsetX + x * sourceWidth * scale,
    offsetY + y * sourceHeight * scale,
  ]);
  if (points.length < 4) return;
  const displayPoints = shrinkPolygon(points, 0.9);
  ctx.save();
  ctx.globalAlpha = 0.34;
  drawPolygon(displayPoints, card.color, 2, false);
  ctx.restore();
  drawStatusDot(displayPoints, card.color);
}

function drawPolygon(points, color, lineWidth, fill = shouldFillTrackPolygons()) {
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.10)";
    ctx.fill();
  }
  ctx.stroke();
}

function drawStatusDot(points, color) {
  const center = polygonCenter(points);
  const radius = Math.max(5, Math.min(9, Math.sqrt(polygonArea(points)) * 0.045));
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center[0], center[1], radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function shrinkPolygon(points, factor) {
  const center = polygonCenter(points);
  return points.map(([x, y]) => [
    center[0] + (x - center[0]) * factor,
    center[1] + (y - center[1]) * factor,
  ]);
}

function shouldDrawTrackLabel(track) {
  if (window.matchMedia("(min-width: 801px)").matches) return true;
  return track.confirmed && track.normalized_polygon
    && normalizedPolygonArea(track.normalized_polygon) >= 0.018;
}

function shouldFillTrackPolygons() {
  return window.matchMedia("(min-width: 801px)").matches;
}

function labelForTrack(track) {
  const remembered = track.code
    ? rememberedCards.find((card) => card.code === track.code)
    : null;
  if (remembered?.name) return remembered.name;
  return track.label.replace(/\s+\d(?:\.\d+)?$/, "");
}

function rememberedSurfaceForTrack(track) {
  if (!track.normalized_polygon) return null;
  const trackBox = polygonBounds(track.normalized_polygon);
  let best = null;
  for (const card of surfaceCards.values()) {
    if (!card.normalized_polygon) continue;
    if (track.code && card.code && track.code !== card.code) continue;
    const overlap = boxIntersectionRatio(trackBox, polygonBounds(card.normalized_polygon));
    if (overlap < 0.45) continue;
    if (!best || overlap > best.overlap) best = { card, overlap };
  }
  return best?.card ?? null;
}

function surfaceCardOverlapsLiveTrack(card) {
  if (!card.normalized_polygon) return false;
  const cardBox = polygonBounds(card.normalized_polygon);
  return latestTracks.some((track) => {
    if (track.state === "detected" || !track.normalized_polygon) return false;
    if (track.code && card.code && track.code === card.code) return false;
    return boxIntersectionRatio(cardBox, polygonBounds(track.normalized_polygon)) >= 0.18;
  });
}

function polygonBounds(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function boxIntersectionRatio(a, b) {
  const width = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const height = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const intersection = width * height;
  if (intersection <= 0) return 0;
  const aArea = Math.max(0, a.maxX - a.minX) * Math.max(0, a.maxY - a.minY);
  const bArea = Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
  return intersection / Math.max(0.00001, Math.min(aArea, bArea));
}

function isSurfaceGeometryJump(existingPolygon, nextPolygon) {
  const existingCenter = normalizedPolygonCenter(existingPolygon);
  const nextCenter = normalizedPolygonCenter(nextPolygon);
  const existingArea = normalizedPolygonArea(existingPolygon);
  const nextArea = normalizedPolygonArea(nextPolygon);
  if (existingArea <= 0 || nextArea <= 0) return true;
  const distance = Math.hypot(existingCenter[0] - nextCenter[0], existingCenter[1] - nextCenter[1]);
  const ratio = nextArea / existingArea;
  return distance > 0.18 || ratio < 0.45 || ratio > 2.2;
}

function surfacePolygonMetrics(points) {
  const scaled = points.map(([x, y]) => [x * displaySize[0], y * displaySize[1]]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const scaledXs = scaled.map(([x]) => x);
  const scaledYs = scaled.map(([, y]) => y);
  const width = Math.max(...scaledXs) - Math.min(...scaledXs);
  const height = Math.max(...scaledYs) - Math.min(...scaledYs);
  return {
    area: normalizedPolygonArea(points),
    aspect: Math.max(width, height) / Math.max(1, Math.min(width, height)),
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function normalizedPolygonCenter(points) {
  return points
    .reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0])
    .map((value) => value / points.length);
}

function normalizedPolygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) / 2;
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const last = polygon[previous];
    const crosses = (current[1] > point[1]) !== (last[1] > point[1]);
    if (!crosses) continue;
    const atX =
      ((last[0] - current[0]) * (point[1] - current[1])) /
        Math.max(1e-9, last[1] - current[1]) +
      current[0];
    if (point[0] < atX) inside = !inside;
  }
  return inside;
}

function pointToPolygonDistance(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 2) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    best = Math.min(best, pointToSegmentDistance(point, current, next));
  }
  return best;
}

function pointToSegmentDistance(point, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = point[0] - a[0];
  const wy = point[1] - a[1];
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared <= 1e-12) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = clamp((wx * vx + wy * vy) / lengthSquared, 0, 1);
  return Math.hypot(point[0] - (a[0] + t * vx), point[1] - (a[1] + t * vy));
}

function pruneSurfaceCards(frameIndex) {
  for (const [key, card] of surfaceCards.entries()) {
    if (frameIndex - card.lastSeen > 240) {
      surfaceCards.delete(key);
    }
  }
  if (surfaceCards.size <= 80) return;
  const sorted = [...surfaceCards.entries()].sort((a, b) => b[1].lastSeen - a[1].lastSeen);
  surfaceCards = new Map(sorted.slice(0, 80));
}

function polygonCenter(points) {
  return points
    .reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0])
    .map((value) => value / points.length);
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) / 2;
}

function labelAnchorForConfirmedTrack(points) {
  const sortedByY = [...points].sort((a, b) => b[1] - a[1]);
  const lowerEdge = sortedByY.slice(0, 2);
  return [
    (lowerEdge[0][0] + lowerEdge[1][0]) / 2,
    (lowerEdge[0][1] + lowerEdge[1][1]) / 2 - 18,
  ];
}

function drawLabel(text, centerX, centerY, color) {
  const label = text.length > 28 ? `${text.slice(0, 25)}...` : text;
  ctx.font = "600 14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const metrics = ctx.measureText(label);
  const width = metrics.width + 16;
  const height = 28;
  const x = Math.max(8, Math.min(centerX - width / 2, canvas.clientWidth - width - 8));
  const y = Math.max(8, Math.min(centerY - height / 2, canvas.clientHeight - height - 8));
  const box = { x, y, width, height };
  if (drawnLabelBoxes.some((existing) => boxesOverlap(existing, box))) return;
  drawnLabelBoxes.push(box);
  ctx.fillStyle = "rgba(17, 17, 17, 0.86)";
  roundRect(x, y, width, height, 6);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, x + 8, y + 19);
}

function boxesOverlap(a, b) {
  const padding = 6;
  return a.x < b.x + b.width + padding
    && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding
    && a.y + a.height + padding > b.y;
}

function roundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
