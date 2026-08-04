import { extractCodeOccurrences as parseCodeOccurrences, formatCodeInput } from "./card_parser.js";
import { attachVoiceInput } from "./voice_input.js";

const text = document.querySelector("#lookupText");
const button = document.querySelector("#lookupButton");
const clearButton = document.querySelector("#clearLookupButton");
const summary = document.querySelector("#lookupSummary");
const results = document.querySelector("#lookupResults");
const copyReply = document.querySelector("#copyReply");
const replyText = document.querySelector("#replyText");
const copyReplyButton = document.querySelector("#copyReplyButton");
const photoInput = document.querySelector("#lookupPhotoInput");
const photoButton = document.querySelector("label[for='lookupPhotoInput']");
const photoStatus = document.querySelector("#lookupPhotoStatus");
const voiceButton = document.querySelector("#lookupVoiceButton");
const TRADED_AWAY_KEY = "panini.tradeInventoryRemoved.v1";
const INVENTORY_SOURCES = [
  { url: "/fifa-sticker-app/api/trade-inventory", label: "local scanner server" },
  { url: "/fifa-sticker-app/data/trade_inventory.json", label: "static snapshot" },
];

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

function insigniaLabel(type) {
  if (type === "united_edition") return "Green card";
  if (type === "standard_fifa_licensed") return "Blue card";
  if (type === "mixed") return "Mixed colours";
  return "Colour unknown";
}

async function lookup() {
  const value = text.value.trim();
  if (!value) {
    summary.textContent = "Paste at least one card code first.";
    results.replaceChildren();
    return;
  }
  button.disabled = true;
  summary.textContent = "Checking saved inventory…";
  try {
    const { payload: inventory, source } = await loadInventory();
    const payload = lookupText(value, inventory);
    const found = payload.results.filter((item) => item.found).length;
    summary.textContent = `${found}/${payload.unique_code_count} unique codes found · ${payload.parsed_count} code mentions parsed · ${source.label}`;
    results.replaceChildren(...payload.results.map((item) => {
      const row = document.createElement("li");
      row.className = item.found ? "found" : "missing";
      const detail = item.found
        ? `${item.count} available · ${item.card_colour_counts || insigniaLabel(item.back_insignia_type)}${item.name ? ` · ${item.name}` : ""}${item.team ? ` (${item.team})` : ""}`
        : "Not in your saved inventory";
      row.innerHTML = `<strong>${item.code}</strong><span>${detail}${item.occurrences > 1 ? ` · mentioned ${item.occurrences}×` : ""}</span>`;
      return row;
    }));
    replyText.value = payload.copy_text;
    copyReply.hidden = !payload.copy_text;
  } catch {
    summary.textContent = "Could not read the saved inventory.";
    results.replaceChildren();
    copyReply.hidden = true;
  } finally {
    button.disabled = false;
  }
}

async function loadInventory() {
  let lastError = null;
  for (const source of INVENTORY_SOURCES) {
    try {
      const response = await fetch(source.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${source.label} unavailable`);
      const payload = await response.json();
      localStorage.setItem("panini.inventorySnapshot.v1", JSON.stringify(payload));
      return { payload, source };
    } catch (error) {
      lastError = error;
    }
  }
  try {
    return {
      payload: JSON.parse(localStorage.getItem("panini.inventorySnapshot.v1") || "{}"),
      source: { label: "browser cache" },
    };
  } catch {
    throw lastError ?? new Error("inventory unavailable");
  }
}

function lookupText(value, inventory) {
  const occurrences = parseCodeOccurrences(value);
  const cards = adjustedInventoryCards(inventory.cards ?? {});
  const results = [...occurrences.entries()].sort(([a], [b]) => sortCode(a, b)).map(([code, occurrences]) => {
    const card = cards[code];
    const result = {
      code,
      occurrences,
      found: Boolean(card),
      count: card ? Number(card.count || 0) : 0,
      name: card?.name ?? null,
      team: card?.team ?? null,
      back_insignia_type: card?.back_insignia_type ?? null,
      card_colour: card ? insigniaLabel(card.back_insignia_type) : null,
    };
    if (card?.back_insignia_counts) result.card_colour_counts = cardColourCountsText(card);
    return result;
  });
  const available = results.filter((item) => item.found);
  return {
    input: value,
    parsed_count: [...occurrences.values()].reduce((sum, count) => sum + count, 0),
    unique_code_count: results.length,
    results,
    copy_text: available.length
      ? `We have: ${available.map((item) => `${item.code} ×${item.count} (${item.card_colour_counts || item.card_colour})`).join(", ")}.`
      : "We do not have any of those cards.",
  };
}

function adjustedInventoryCards(cards) {
  const tradedAway = loadTradedAwayCounts();
  if (!Object.keys(tradedAway).length) return cards;
  const adjusted = {};
  for (const [code, card] of Object.entries(cards)) {
    const removed = Math.max(0, Number(tradedAway[code] || 0));
    const originalCount = Number(card?.count || 0);
    const nextCount = Math.max(0, originalCount - removed);
    if (!nextCount) continue;
    adjusted[code] = {
      ...card,
      count: nextCount,
      back_insignia_counts: adjustColourCounts(card?.back_insignia_counts, removed),
    };
  }
  return adjusted;
}

function adjustColourCounts(counts, removed) {
  if (!counts || typeof counts !== "object" || removed <= 0) return counts;
  const adjusted = { ...counts };
  for (const key of ["standard_fifa_licensed", "united_edition", "no_clue"]) {
    const value = Math.max(0, Number(adjusted[key] || 0));
    const take = Math.min(value, removed);
    adjusted[key] = value - take;
    removed -= take;
    if (!removed) break;
  }
  return adjusted;
}

function loadTradedAwayCounts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADED_AWAY_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
  const inlinePattern = /(?<![A-Z0-9])([A-Z]{2,3})\s*[-–—_./]?\s*(\d{1,2})(?![A-Z0-9])/g;
  for (const match of upper.matchAll(inlinePattern)) {
    add(match[1], match[2]);
    inlineSpans.push([match.index, match.index + match[0].length]);
  }
  const groupedPattern = /^\s*([A-Z]{2,3})(?:\s+[^:\d\n]+)?\s*:\s*([0-9][0-9\s,;/&+.-]*)/gm;
  for (const match of upper.matchAll(groupedPattern)) {
    const start = match.index;
    if (inlineSpans.some(([spanStart, spanEnd]) => spanStart <= start && start < spanEnd)) continue;
    for (const number of match[2].match(/\d{1,2}/g) || []) add(match[1], number);
  }
  return occurrences;
}

function sortCode(a, b) {
  const aMatch = String(a || "").match(/^([A-Z]+)(\d+)$/);
  const bMatch = String(b || "").match(/^([A-Z]+)(\d+)$/);
  if (!aMatch || !bMatch) return String(a || "").localeCompare(String(b || ""));
  return aMatch[1].localeCompare(bMatch[1]) || Number(aMatch[2]) - Number(bMatch[2]);
}

function cardColourCountsText(card) {
  const counts = card.back_insignia_counts ?? {};
  const parts = [];
  if (counts.standard_fifa_licensed) parts.push(`Blue ×${counts.standard_fifa_licensed}`);
  if (counts.united_edition) parts.push(`Green ×${counts.united_edition}`);
  if (counts.no_clue) parts.push(`Unknown ×${counts.no_clue}`);
  return parts.join(", ");
}

function clearLookup() {
  text.value = "";
  summary.textContent = "Paste a list, then check it against your saved cards.";
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

button.addEventListener("click", lookup);
clearButton.addEventListener("click", clearLookup);
photoInput.addEventListener("change", () => fillFromPhotos(photoInput.files));
attachVoiceInput({
  button: voiceButton,
  textarea: text,
  transformTranscript: formatCodeInput,
  onTranscript: lookup,
  setMessage: (message) => { summary.textContent = message; },
});
text.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") lookup();
});
