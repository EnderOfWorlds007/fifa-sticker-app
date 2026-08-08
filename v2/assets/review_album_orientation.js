import { applyOcrBackendFromQuery, ocrToken, recognitionBaseUrl, recognitionUrl } from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-960000000004";

const status = document.querySelector("#orientationStatus");
const photoSelect = document.querySelector("#orientationPhotoSelect");
const previousButton = document.querySelector("#orientationPrevious");
const nextButton = document.querySelector("#orientationNext");
const badge = document.querySelector("#orientationBadge");
const headline = document.querySelector("#orientationHeadline");
const reason = document.querySelector("#orientationReason");
const okButton = document.querySelector("#orientationOk");
const wrongButton = document.querySelector("#orientationWrong");
const recommended = document.querySelector("#orientationRecommended");
const candidates = document.querySelector("#orientationCandidates");
const diagnosticSteps = document.querySelector("#orientationDiagnosticSteps");

const ALBUM_REVIEW_PATH = ["", "api", "album-review"].join("/");
const ALBUM_REVIEW_LABELS_PATH = ["", "api", "album-review", "labels"].join("/");
const ROTATIONS = [0, 90, 180, 270];

let photos = [];
let currentPhoto = null;
let objectUrls = [];
let saveInFlight = false;

init();

async function init() {
  applyOcrBackendFromQuery();
  if (!recognitionBaseUrl()) {
    status.textContent = "Open this from Getting Started once so the laptop backend is saved.";
    return;
  }
  bindControls();
  const response = await apiFetch(ALBUM_REVIEW_PATH, { cache: "no-store" });
  if (!response.ok) {
    status.textContent = "Could not load album review data.";
    return;
  }
  const payload = await response.json();
  photos = payload.photos || [];
  photoSelect.replaceChildren(...photos.map((photo) => option(photo.id, `${String(photo.index).padStart(2, "0")} ${photo.source_name}`)));
  const requested = new URLSearchParams(window.location.search).get("photo");
  setPhoto(requested || photos[0]?.id || "");
}

function bindControls() {
  photoSelect.addEventListener("change", () => setPhoto(photoSelect.value));
  previousButton.addEventListener("click", () => movePhoto(-1));
  nextButton.addEventListener("click", () => movePhoto(1));
  okButton.addEventListener("click", () => saveOrientationDecision("ok"));
  wrongButton.addEventListener("click", () => saveOrientationDecision("wrong"));
  window.addEventListener("pagehide", clearObjectUrls);
}

function setPhoto(id) {
  currentPhoto = photos.find((photo) => photo.id === id) || photos[0] || null;
  clearObjectUrls();
  if (!currentPhoto) {
    status.textContent = "No album photos found.";
    return;
  }
  photoSelect.value = currentPhoto.id;
  const model = orientationModel(currentPhoto);
  renderDecision(model);
  renderRecommended(model);
  renderCandidates(model);
  renderDiagnostics(currentPhoto.focus?.debug_steps || []);
  const index = photos.indexOf(currentPhoto);
  previousButton.disabled = index <= 0;
  nextButton.disabled = index < 0 || index >= photos.length - 1;
}

function movePhoto(delta) {
  const index = photos.indexOf(currentPhoto);
  const next = photos[index + delta];
  if (next) setPhoto(next.id);
}

function orientationModel(photo) {
  const steps = photo.focus?.debug_steps || [];
  const v2Step = steps.find((step) => /orientation decision v2/i.test(step.title || ""));
  const v1Step = steps.find((step) => /orientation decision v1/i.test(step.title || ""));
  const decision = objectOutcome(v2Step) || objectOutcome(v1Step) || {};
  const candidateSteps = new Map();
  for (const step of steps) {
    const match = String(step.title || "").match(/rotation candidate\s+(\d+)\s+degrees/i);
    if (match && step.url) candidateSteps.set(Number(match[1]), step);
  }
  const selected = numberOrNull(decision.selected_rotation_degrees);
  const candidate = numberOrNull(decision.candidate_rotation_degrees);
  const legacy = numberOrNull(decision.legacy_rotation_degrees ?? decision.source_crop_rotation_degrees);
  const rotation = selected ?? candidate ?? legacy ?? 0;
  return {
    photo,
    decision,
    rotation,
    selected,
    candidate,
    legacy,
    status: String(decision.status || (selected === null ? "needs_review" : "selected")),
    support: numberOrNull(decision.support),
    margin: numberOrNull(decision.margin),
    candidateSteps,
    originalUrl: photo.review_image?.url || photo.url,
  };
}

function renderDecision(model) {
  const isFinal = model.selected !== null && model.status !== "needs_review";
  const support = model.support === null ? "" : ` · support ${model.support.toFixed(2)}`;
  const margin = model.margin === null ? "" : ` · margin ${model.margin.toFixed(2)}`;
  badge.textContent = `${model.photo.source_name} · ${model.status}${support}${margin}`;
  badge.className = `orientationBadge ${isFinal ? "trusted" : "review"}`;
  headline.textContent = `Recommended: ${model.rotation} degrees`;
  reason.textContent = model.status === "needs_review"
    ? "Confirm this only if the page title and player cards are readable in the big image below."
    : "The backend is confident, but you can still mark it wrong if the big image is upside down or sideways.";
  status.textContent = `${model.photo.source_name} · compare the big image first`;
}

function renderRecommended(model) {
  recommended.replaceChildren(renderCandidateCard(model, model.rotation, { featured: true, title: "Look at this first" }));
}

function renderCandidates(model) {
  candidates.replaceChildren(
    ...ROTATIONS.map((rotation) => renderCandidateCard(model, rotation, { featured: false, title: `${rotation} degrees` })),
  );
}

function renderCandidateCard(model, rotation, { featured, title }) {
  const card = document.createElement("article");
  card.className = `orientationCandidate${featured ? " featured" : ""}`;
  const header = document.createElement("div");
  header.className = "orientationCandidateHeader";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const action = document.createElement("button");
  action.type = "button";
  action.textContent = featured ? "Use this" : "Use";
  action.addEventListener("click", () => saveOrientationDecision("use_rotation", rotation, action));
  header.append(h2, action);
  const img = document.createElement("img");
  img.alt = `${model.photo.source_name} rotated ${rotation} degrees`;
  const step = model.candidateSteps.get(rotation);
  const fallback = model.originalUrl;
  loadBackendImageObjectUrl(step?.url || fallback)
    .then((objectUrl) => {
      objectUrls.push(objectUrl);
      img.src = objectUrl;
      if (!step?.url && rotation) img.style.transform = `rotate(${rotation}deg)`;
    })
    .catch(() => {
      img.replaceWith(errorText("Could not load this orientation image."));
    });
  const meta = document.createElement("p");
  meta.textContent = candidateMeta(model, rotation);
  card.append(header, img, meta);
  return card;
}

function candidateMeta(model, rotation) {
  if (rotation === model.selected) return "Backend selected this orientation.";
  if (rotation === model.candidate) return "Backend recommends reviewing this orientation.";
  if (rotation === model.legacy) return "Legacy pipeline orientation.";
  return "Alternative orientation.";
}

function renderDiagnostics(steps) {
  diagnosticSteps.replaceChildren(
    ...steps.map((step, index) => {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `${String(index + 1).padStart(2, "0")} ${step.title || "Step"}`;
      const body = document.createElement("pre");
      body.textContent = typeof step.outcome === "string" ? step.outcome : JSON.stringify(step.outcome || {}, null, 2);
      details.append(summary, body);
      return details;
    }),
  );
}

async function saveOrientationDecision(decision, rotation = null, button = null) {
  if (!currentPhoto || saveInFlight) return;
  const model = orientationModel(currentPhoto);
  const activeButton = button || (decision === "ok" ? okButton : wrongButton);
  const original = activeButton.textContent;
  saveInFlight = true;
  activeButton.disabled = true;
  activeButton.textContent = "Saving...";
  try {
    const response = await apiFetch(ALBUM_REVIEW_LABELS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label_type: "orientation",
        photo_id: currentPhoto.id,
        source_name: currentPhoto.source_name,
        decision,
        chosen_rotation_degrees: rotation ?? model.rotation,
        suggested_rotation_degrees: model.rotation,
        status: model.status,
        support: model.support,
        margin: model.margin,
      }),
    });
    if (!response.ok) throw new Error(`save failed ${response.status}`);
    status.textContent = `${currentPhoto.source_name} · saved ${decision} ${rotation ?? model.rotation} degrees`;
  } catch {
    status.textContent = `${currentPhoto.source_name} · could not save orientation decision`;
  } finally {
    saveInFlight = false;
    activeButton.disabled = false;
    activeButton.textContent = original;
  }
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function objectOutcome(step) {
  return step?.outcome && typeof step.outcome === "object" ? step.outcome : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function errorText(text) {
  const item = document.createElement("p");
  item.textContent = text;
  return item;
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

function backendAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(String(path))) return path;
  return recognitionUrl(path);
}

function clearObjectUrls() {
  for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
  objectUrls = [];
}
