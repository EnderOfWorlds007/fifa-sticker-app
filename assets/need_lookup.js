import { extractCodeOccurrences as parseCodeOccurrences } from "./card_parser.js";
import { attachVoiceInput } from "./voice_input.js";

const STORAGE_KEY = "panini.collectionTracker.v2";
const COLLECTION_SOURCES = [
  { url: "/fifa-sticker-app/api/collection-inventory", label: "local scanner server" },
  { url: "/fifa-sticker-app/data/collection_inventory.json", label: "static snapshot" },
];

const text = document.querySelector("#needLookupText");
const button = document.querySelector("#needLookupButton");
const clearButton = document.querySelector("#clearNeedLookupButton");
const summary = document.querySelector("#needLookupSummary");
const results = document.querySelector("#needLookupResults");
const copyReply = document.querySelector("#needCopyReply");
const replyText = document.querySelector("#needReplyText");
const copyReplyButton = document.querySelector("#copyNeedReplyButton");
const photoInput = document.querySelector("#needPhotoInput");
const photoButton = document.querySelector("label[for='needPhotoInput']");
const photoStatus = document.querySelector("#needPhotoStatus");
const voiceButton = document.querySelector("#needVoiceButton");

let collectionCards = [];
let collectionSourceLabel = "static snapshot";

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
  button.disabled = true;
  const recognized = [];
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const scanText = `Scanning... ${index + 1}/${selected.length}`;
      setPhotoProgress(scanText);
      const payload = await scanPhoto(selected[index]);
      if (payload.grouped_text) recognized.push(payload.grouped_text);
    }
    if (!recognized.length) {
      summary.textContent = "No card numbers were found in those photos.";
      return;
    }
    text.value = [text.value.trim(), ...recognized].filter(Boolean).join("\n");
    summary.textContent = `Filled card codes from ${recognized.length}/${selected.length} photo${selected.length === 1 ? "" : "s"}.`;
    text.focus();
  } catch {
    summary.textContent = "Could not read those photos. Make sure the scanner backend tunnel is running.";
  } finally {
    button.disabled = false;
    resetPhotoProgress();
    photoInput.value = "";
  }
}

async function loadCollection() {
  const { payload, source } = await loadCollectionPayload();
  collectionSourceLabel = source.label;
  collectionCards = (payload.cards ?? []).map((card) => ({
    code: normalizeCode(card.code),
    owned: Boolean(card.owned),
  })).filter((card) => card.code);
  localStorage.setItem("panini.collectionSnapshot.v1", JSON.stringify(payload));
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
  try {
    return {
      payload: JSON.parse(localStorage.getItem("panini.collectionSnapshot.v1") || "{}"),
      source: { label: "browser cache" },
    };
  } catch {
    throw lastError ?? new Error("collection unavailable");
  }
}

async function lookupNeeds() {
  const value = text.value.trim();
  if (!value) {
    summary.textContent = "Paste at least one card code first.";
    results.replaceChildren();
    copyReply.hidden = true;
    return;
  }

  button.disabled = true;
  summary.textContent = "Checking the collection...";
  try {
    if (!collectionCards.length) await loadCollection();
    const occurrences = parseCodeOccurrences(value);
    const owned = ownedCodeSet();
    const tracked = new Set(collectionCards.map((card) => card.code));
    const parsed = [...occurrences.entries()].sort(([a], [b]) => sortCode(a, b));
    const rows = parsed.map(([code, occurrences]) => {
      const known = tracked.has(code);
      const needed = known && !owned.has(code);
      return {
        code,
        occurrences,
        needed,
        status: needed ? "need" : known ? "already" : "notTracked",
      };
    });
    const neededRows = rows.filter((row) => row.needed);

    summary.textContent = `${neededRows.length}/${rows.length} unique codes are still needed · ${[...occurrences.values()].reduce((sum, count) => sum + count, 0)} code mentions parsed · ${collectionSourceLabel}`;
    results.replaceChildren(...rows.map(resultRow));
    replyText.value = neededRows.length
      ? `I need: ${groupCodes(neededRows.map((row) => row.code))}.`
      : "I do not need any of those cards.";
    copyReply.hidden = false;
  } catch {
    summary.textContent = "Could not read the collection snapshot.";
    results.replaceChildren();
    copyReply.hidden = true;
  } finally {
    button.disabled = false;
  }
}

function resultRow(item) {
  const row = document.createElement("li");
  row.className = item.needed ? "found" : "missing";
  const detail = item.needed
    ? "Still missing from your collection"
    : item.status === "already"
      ? "Already owned"
      : "Not in the catalogue snapshot";
  row.innerHTML = `<strong>${item.code}</strong><span>${detail}${item.occurrences > 1 ? ` · mentioned ${item.occurrences}x` : ""}</span>`;
  return row;
}

function ownedCodeSet() {
  const local = localCollectedSet();
  return new Set(collectionCards.filter((card) => card.owned || local.has(card.code)).map((card) => card.code));
}

function localCollectedSet() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return new Set(Array.isArray(parsed.collected) ? parsed.collected.map(normalizeCode) : []);
  } catch {
    return new Set();
  }
}

function normalizeCode(value) {
  return String(value || "").trim().replace(/[\s_-]/g, "").toUpperCase();
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

function groupCodes(codes) {
  const groups = codes.sort(sortCode).reduce((acc, code) => {
    const match = code.match(/^([A-Z]+)(\d+)$/);
    if (!match) return acc;
    if (!acc.has(match[1])) acc.set(match[1], []);
    acc.get(match[1]).push(Number(match[2]));
    return acc;
  }, new Map());
  return [...groups.entries()].map(([team, numbers]) => `${team}: ${numbers.join(", ")}`).join("; ");
}

function sortCode(a, b) {
  const aMatch = String(a || "").match(/^([A-Z]+)(\d+)$/);
  const bMatch = String(b || "").match(/^([A-Z]+)(\d+)$/);
  if (!aMatch || !bMatch) return String(a || "").localeCompare(String(b || ""));
  return aMatch[1].localeCompare(bMatch[1]) || Number(aMatch[2]) - Number(bMatch[2]);
}

function clearLookup() {
  text.value = "";
  summary.textContent = "Paste their available cards, then check them against your missing list.";
  results.replaceChildren();
  replyText.value = "";
  copyReply.hidden = true;
  text.focus();
}

copyReplyButton.addEventListener("click", async () => {
  if (!replyText.value) return;
  try {
    await navigator.clipboard.writeText(replyText.value);
    copyReplyButton.textContent = "Copied";
    window.setTimeout(() => { copyReplyButton.textContent = "Copy reply"; }, 1200);
  } catch {
    replyText.focus();
    replyText.select();
  }
});

button.addEventListener("click", lookupNeeds);
clearButton.addEventListener("click", clearLookup);
photoInput.addEventListener("change", () => fillFromPhotos(photoInput.files));
attachVoiceInput({
  button: voiceButton,
  textarea: text,
  onTranscript: lookupNeeds,
  setMessage: (message) => { summary.textContent = message; },
});
text.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") lookupNeeds();
});

loadCollection().catch(() => {
  summary.textContent = "Collection snapshot will load when you check a list.";
});
