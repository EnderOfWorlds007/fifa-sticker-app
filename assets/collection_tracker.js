import { extractCodeOccurrences as parseCodeOccurrences, normalizeCodeInput } from "./card_parser.js?v=voice-lang-1";
import { attachVoiceInput } from "./voice_input.js?v=voice-lang-1";

const STORAGE_KEY = "panini.collectionTracker.v2";
const TRADED_AWAY_KEY = "panini.tradeInventoryRemoved.v1";
const COLLECTION_SOURCES = [
  { url: "/fifa-sticker-app/api/collection-inventory", label: "local scanner server" },
  { url: "/fifa-sticker-app/data/collection_inventory.json", label: "static snapshot" },
];

const teamList = document.querySelector("#teamList");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const updateText = document.querySelector("#collectionUpdateText");
const status = document.querySelector("#collectionStatus");
const missingCount = document.querySelector("#missingCount");
const collectedCount = document.querySelector("#collectedCount");
const teamCount = document.querySelector("#teamCount");
const progressCount = document.querySelector("#progressCount");
const neededPlainList = document.querySelector("#neededPlainList");
const copyMissingButton = document.querySelector("#copyMissingButton");
const photoInput = document.querySelector("#collectionPhotoInput");
const photoButton = document.querySelector("#collectionPhotoButton");
const photoStatus = document.querySelector("#collectionPhotoStatus");
const voiceButton = document.querySelector("#collectionVoiceButton");
const voiceStatus = document.querySelector("#collectionVoiceStatus");
const gotCardsButton = document.querySelector("#gotCardsButton");
const tradedAwayButton = document.querySelector("#tradedAwayButton");
const resetButton = document.querySelector("#resetButton");
const filterButtons = [...document.querySelectorAll("[data-filter]")];

let state = loadState();
let cards = [];
let stats = {};
let collectionSourceLabel = "static snapshot";
let photoScanRunning = false;
let lastPhotoSelectionSignature = "";

function recognitionUrl(path) {
  const base = String(window.PANINI_CONFIG?.recognitionBaseUrl || "").replace(/\/$/, "");
  return `${base}${path}`;
}

async function scanPhoto(file) {
  const response = await fetch(recognitionUrl("/api/photo-codes"), {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) throw new Error("photo OCR unavailable");
  return response.json();
}

function setPhotoProgress(scanText) {
  photoButton.textContent = scanText;
  photoButton.classList.add("scanning");
  photoStatus.hidden = false;
  photoStatus.lastChild.textContent = scanText;
}

function resetPhotoProgress() {
  photoButton.classList.remove("scanning");
  photoButton.textContent = "Use Photos";
  photoStatus.hidden = true;
  photoStatus.lastChild.textContent = "Scanning...";
}

async function fillFromPhotos(files) {
  const selected = [...(files || [])];
  if (!selected.length) return;
  const selectionSignature = selected.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
  if (selectionSignature === lastPhotoSelectionSignature) return;
  lastPhotoSelectionSignature = selectionSignature;
  if (photoScanRunning) return;
  photoScanRunning = true;
  gotCardsButton.disabled = true;
  tradedAwayButton.disabled = true;
  const recognized = [];
  setPhotoProgress("Preparing photos...");
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const scanText = `Scanning... ${index + 1}/${selected.length}`;
      setPhotoProgress(scanText);
      const payload = await scanPhoto(selected[index]);
      if (payload.grouped_text) recognized.push(payload.grouped_text);
    }
    if (!recognized.length) {
      status.textContent = "No card numbers were found in those photos.";
      return;
    }
    updateText.value = [updateText.value.trim(), ...recognized].filter(Boolean).join("\n");
    status.textContent = `Filled card codes from ${recognized.length}/${selected.length} photo${selected.length === 1 ? "" : "s"}.`;
    updateText.focus();
  } catch {
    status.textContent = "Could not read those photos. Make sure the scanner backend tunnel is running.";
  } finally {
    photoScanRunning = false;
    gotCardsButton.disabled = false;
    tradedAwayButton.disabled = false;
    resetPhotoProgress();
    photoInput.value = "";
  }
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      filter: ["missing", "all", "collected"].includes(parsed.filter) ? parsed.filter : "missing",
      collected: Array.isArray(parsed.collected) ? parsed.collected.map(normalizeCode).filter(Boolean) : [],
    };
  } catch {
    return { filter: "missing", collected: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadCollection() {
  status.textContent = "Loading collection snapshot...";
  try {
    const { payload, source } = await loadCollectionPayload();
    collectionSourceLabel = source.label;
    stats = payload.stats ?? {};
    cards = (payload.cards ?? []).map(normalizeCard).filter((card) => card.code).sort((a, b) => sortCode(a.code, b.code));
    localStorage.setItem("panini.collectionSnapshot.v1", JSON.stringify(payload));
    render();
  } catch {
    try {
      const cached = JSON.parse(localStorage.getItem("panini.collectionSnapshot.v1") || "{}");
      collectionSourceLabel = "browser cache";
      stats = cached.stats ?? {};
      cards = (cached.cards ?? []).map(normalizeCard).filter((card) => card.code).sort((a, b) => sortCode(a.code, b.code));
      render();
    } catch {
      cards = [];
      stats = {};
      render();
      status.textContent = "Collection snapshot unavailable.";
    }
  }
}

async function loadCollectionPayload() {
  let lastError = null;
  for (const source of COLLECTION_SOURCES) {
    try {
      const response = await fetch(source.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${source.label} unavailable`);
      return { payload: await response.json(), source };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("collection unavailable");
}

function normalizeCard(card) {
  return {
    ...card,
    code: normalizeCode(card.code),
    team: String(card.team || "Unknown"),
    name: String(card.name || ""),
    owned: Boolean(card.owned),
    tradeable_count: Number(card.tradeable_count || 0),
  };
}

function normalizeCode(value) {
  return String(value || "").trim().replace(/[\s_-]/g, "").toUpperCase();
}

function localCollectedSet() {
  return new Set(state.collected.map(normalizeCode));
}

function isOwned(card) {
  return Boolean(card.owned) || localCollectedSet().has(card.code);
}

function cardNumber(code) {
  const match = normalizeCode(code).match(/(\d+)(S)?$/);
  return match ? `${match[1]}${match[2] ? "s" : ""}` : normalizeCode(code);
}

function trackedCodeSet() {
  return new Set(cards.map((card) => card.code));
}

function extractCodeOccurrences(value) {
  const upper = value.toUpperCase();
  const occurrences = new Map();
  const inlineSpans = [];
  const add = (team, number) => {
    const normalizedNumber = Number(number);
    if (normalizedNumber < 1 || normalizedNumber > 20) return;
    const code = `${team}${normalizedNumber}`;
    occurrences.set(code, (occurrences.get(code) || 0) + 1);
  };
  const inlinePattern = /(?<![A-Z0-9])([A-Z]{2,4})\s*[-–—_./]?\s*(\d{1,2})(?![A-Z0-9])/g;
  for (const match of upper.matchAll(inlinePattern)) {
    add(match[1], match[2]);
    inlineSpans.push([match.index, match.index + match[0].length]);
  }
  const groupedPattern = /^\s*([A-Z]{2,4})(?:\s+[^:\d\n]+)?\s*:\s*([0-9][0-9\s,;/&+.-]*)/gm;
  for (const match of upper.matchAll(groupedPattern)) {
    const start = match.index;
    if (inlineSpans.some(([spanStart, spanEnd]) => spanStart <= start && start < spanEnd)) continue;
    for (const number of match[2].match(/\d{1,2}/g) || []) add(match[1], number);
  }
  return occurrences;
}

function parsedUpdateCodes() {
  const value = updateText.value.trim();
  if (!value) {
    status.textContent = "Paste some card text first.";
    return null;
  }
  const occurrences = parseCodeOccurrences(value);
  if (!occurrences.size) {
    status.textContent = "No card codes found in that text.";
    return null;
  }
  return occurrences;
}

function markGotCards() {
  const occurrences = parsedUpdateCodes();
  if (!occurrences) return;
  const tracked = trackedCodeSet();
  const locallyCollected = localCollectedSet();
  const changed = [];
  const ignored = [];
  for (const code of occurrences.keys()) {
    if (!tracked.has(code)) {
      ignored.push(code);
      continue;
    }
    const card = cards.find((candidate) => candidate.code === code);
    if (card && !isOwned(card)) changed.push(code);
    locallyCollected.add(code);
  }
  state.collected = [...locallyCollected].sort(sortCode);
  saveState();
  render();
  const ignoredText = ignored.length ? ` · ignored ${ignored.length} untracked` : "";
  status.textContent = changed.length
    ? `Marked ${changed.length} needed card${changed.length === 1 ? "" : "s"} as received${ignoredText}.`
    : `Those cards were already owned or not in the need list${ignoredText}.`;
}

function loadTradedAwayCounts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADED_AWAY_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveTradedAwayCounts(counts) {
  localStorage.setItem(TRADED_AWAY_KEY, JSON.stringify(counts));
}

function markTradedAway() {
  const occurrences = parsedUpdateCodes();
  if (!occurrences) return;
  const counts = loadTradedAwayCounts();
  let total = 0;
  for (const [code, count] of occurrences.entries()) {
    counts[code] = Math.max(0, Number(counts[code] || 0)) + count;
    total += count;
  }
  saveTradedAwayCounts(counts);
  status.textContent = `Removed ${total} traded-away card${total === 1 ? "" : "s"} from Cards I Can Give on this phone.`;
}

function sortCode(a, b) {
  const aMatch = normalizeCode(a).match(/^([A-Z]+)(\d+)(S)?$/);
  const bMatch = normalizeCode(b).match(/^([A-Z]+)(\d+)(S)?$/);
  if (!aMatch || !bMatch) return normalizeCode(a).localeCompare(normalizeCode(b));
  return (
    aMatch[1].localeCompare(bMatch[1]) ||
    Number(aMatch[2]) - Number(bMatch[2]) ||
    String(aMatch[3] || "").localeCompare(String(bMatch[3] || ""))
  );
}

function visibleCards() {
  const query = searchInput.value.trim().toUpperCase().replace(/[-_]/g, " ");
  const compactQuery = query.replace(/\s+/g, "");
  return cards.filter((card) => {
    const owned = isOwned(card);
    if (state.filter === "missing" && owned) return false;
    if (state.filter === "collected" && !owned) return false;
    if (!query) return true;
    return (
      card.team.toUpperCase().includes(query) ||
      card.name.toUpperCase().includes(query) ||
      card.code.includes(compactQuery)
    );
  });
}

function groupedByTeam(items) {
  return items.reduce((groups, card) => {
    const team = card.team || "Unknown";
    if (!groups.has(team)) groups.set(team, []);
    groups.get(team).push(card);
    return groups;
  }, new Map());
}

function currentMissingCards() {
  return cards.filter((card) => !isOwned(card));
}

function currentOwnedCount() {
  return cards.filter(isOwned).length;
}

function render() {
  const visible = visibleCards();
  const groups = groupedByTeam(visible);
  const catalogCount = stats.catalog_count ?? cards.length;
  const owned = currentOwnedCount();
  const missing = currentMissingCards().length;
  const progress = catalogCount ? Math.round((owned / catalogCount) * 100) : 0;

  missingCount.textContent = String(missing);
  collectedCount.textContent = String(owned);
  teamCount.textContent = String(new Set(cards.map((card) => card.team || "Unknown")).size);
  progressCount.textContent = `${progress}%`;
  status.textContent = `${visible.length} cards shown from ${catalogCount} catalogue cards · ${stats.tradeable_card_count ?? 0} loose cards available for trading · ${collectionSourceLabel}.`;

  filterButtons.forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  renderNeededPlainList();
  teamList.replaceChildren(
    ...[...groups.entries()].map(([team, teamCards]) => teamSection(team, teamCards)),
  );
  emptyState.hidden = visible.length > 0;
}

function renderNeededPlainList() {
  const groups = groupedByTeam(currentMissingCards());
  if (!groups.size) {
    neededPlainList.textContent = "Nothing currently missing.";
    return;
  }
  neededPlainList.replaceChildren(...[...groups.entries()].map(([team, teamCards]) => {
    const row = document.createElement("div");
    row.className = "neededGroup";
    const label = document.createElement("strong");
    label.textContent = team;
    const codes = document.createElement("span");
    codes.textContent = teamCards.map((card) => card.code).join(", ");
    row.append(label, codes);
    return row;
  }));
}

function teamSection(team, teamCards) {
  const section = document.createElement("section");
  section.className = "collectionTeam";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = team;
  const meta = document.createElement("span");
  const missing = teamCards.filter((card) => !isOwned(card)).length;
  meta.textContent = `${missing} missing`;
  header.append(title, meta);

  const list = document.createElement("div");
  list.className = "collectionCards";
  list.append(...teamCards.map(cardButton));

  section.append(header, list);
  return section;
}

function cardButton(card) {
  const owned = isOwned(card);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "collectionCard";
  button.classList.toggle("collected", owned);
  button.setAttribute("aria-pressed", String(owned));
  button.setAttribute("aria-label", `${card.code}, ${card.name}, ${cardLabel(card)}`);
  button.title = `${card.code} · ${card.name} · ${cardLabel(card)}`;
  button.innerHTML = `<strong>${cardNumber(card.code)}</strong><span>${cardLabel(card)}</span>`;
  return button;
}

function cardLabel(card) {
  if (!isOwned(card)) return "Need";
  if (!card.owned) return "Got";
  if (card.source === "album") return "Album";
  if (card.source === "album_and_trade") return `Album + ${card.tradeable_count} trade`;
  if (card.tradeable_count > 0) return `${card.tradeable_count} trade`;
  return "Have";
}

function missingText() {
  return [...groupedByTeam(currentMissingCards()).entries()]
    .map(([team, teamCards]) => `${team}: ${teamCards.map((card) => cardNumber(card.code)).join(", ")}`)
    .join("\n");
}

async function copyMissingList() {
  const text = missingText();
  if (!text) {
    status.textContent = "Everything in the catalogue is marked collected.";
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Missing list copied.";
  } catch {
    status.textContent = text;
  }
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    saveState();
    render();
  });
});

searchInput.addEventListener("input", render);
copyMissingButton.addEventListener("click", copyMissingList);
photoButton.addEventListener("click", () => {
  lastPhotoSelectionSignature = "";
  photoInput.click();
});
photoInput.addEventListener("input", () => fillFromPhotos(photoInput.files));
photoInput.addEventListener("change", () => fillFromPhotos(photoInput.files));
attachVoiceInput({
  button: voiceButton,
  textarea: updateText,
  statusElement: voiceStatus,
  transformTranscript: normalizeCodeInput,
});
gotCardsButton.addEventListener("click", markGotCards);
tradedAwayButton.addEventListener("click", markTradedAway);
updateText.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") markGotCards();
});
resetButton.textContent = "Reset local changes";
resetButton.addEventListener("click", () => {
  if (!window.confirm("Reset received-card marks made on this phone?")) return;
  state = { filter: "missing", collected: [] };
  saveState();
  searchInput.value = "";
  render();
});

loadCollection();
