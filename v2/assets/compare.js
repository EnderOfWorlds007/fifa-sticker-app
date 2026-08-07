import {
  adjustedInventoryPayload,
  compareParsedCodes,
  deriveCollectionCodes,
  deriveCollectionModel,
  extractDirectedCodeOccurrences,
  extractCodeOccurrences,
  loadLedger,
  mergeCompareResults,
  sortCode,
  transactionSummary,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-eea91a46959f";
import { loadCollectionCatalog } from "/fifa-sticker-app/v2/assets/catalog_source.js?v=build-eea91a46959f";
import { loadInventoryPayload } from "/fifa-sticker-app/v2/assets/inventory_source.js?v=build-eea91a46959f";
import { mountTradePasteBox } from "/fifa-sticker-app/v2/assets/trade_paste_box.js?v=build-eea91a46959f";

const STARTING_MISSING = {
  MEX: [7, 12, 15, 17],
  RSA: [6, 10],
  CZE: [5, 8, 13],
  CAN: [4, 16],
  BIH: [2, 3, 9, 14, 16],
  SUI: [9, 13],
  HAI: [3, 4, 7, 17],
  SCO: [10, 13],
  MAR: [15],
  BRA: [10],
  QAT: [16, 19, 20],
  USA: [2, 7],
  CUW: [15],
  NED: [15],
  ECU: [5, 7, 8, 15],
  CIV: [2, 8, 12, 17],
  GER: [3, 14, 15, 16],
  AUS: [8, 11, 13, 14, 16, 18],
  PAR: [2, 6, 18],
  JPN: [9, 10],
  SWE: [3, 5],
  TUN: [3, 8, 9, 10],
  EGY: [12],
  IRN: [6],
  NZL: [10],
  ESP: [7],
  CPV: [14],
  KSA: [7],
  URU: [19],
  SEN: [9, 13],
  NOR: [3, 20],
  AUT: [2, 18],
  POR: [3, 8],
  JOR: [6, 10],
  ALG: [12, 17],
  ARG: [8, 10, 15, 16, 17],
  IRQ: [2, 9, 13, 16],
  FRA: [1, 17, 19],
  COD: [1, 2, 10, 15, 16, 20],
  UZB: [2],
  GHA: [16, 20],
  CRO: [13],
  ENG: [4, 13, 19],
  FWC: [1, 12],
  CC: [1, 3],
};

const COLLECTION_KEY = "panini.collectionTracker.v1";
const TRADE_SEED_KEY = "panini.pendingTradeSeed.v1";

mountTradePasteBox('[data-trade-paste-box="compare"]', {
  label: "Their message or card list",
  textareaId: "compareText",
  rows: 7,
  autofocus: true,
  placeholder: "Example: I need ENG13 and can offer MEX7, CZE 5, FRA-19.",
  capabilities: { photo: true, voice: true },
  actions: [
    { id: "compareButton", label: "Compare" },
    { id: "buildTradeButton", label: "Build trade", secondary: true, hidden: true },
    { id: "clearCompareButton", label: "Clear", secondary: true },
    { id: "copyCompareReplyButton", label: "Copy reply", secondary: true },
  ],
  hint: { id: "tradeBuildHint", text: "", ariaLive: "polite" },
  summary: {
    id: "compareSummary",
    text: "Paste once to check both directions. Adjusted inventory includes reserved and completed local trade activity on this phone.",
  },
});

const text = document.querySelector("#compareText");
const button = document.querySelector("#compareButton");
const buildTradeButton = document.querySelector("#buildTradeButton");
const clearButton = document.querySelector("#clearCompareButton");
const summary = document.querySelector("#compareSummary");
const tradeBuildHint = document.querySelector("#tradeBuildHint");
const ambiguousDirectionPanel = document.querySelector("#ambiguousDirectionPanel");
const ambiguousAsWantsButton = document.querySelector("#ambiguousAsWantsButton");
const ambiguousAsOffersButton = document.querySelector("#ambiguousAsOffersButton");
const ambiguousAsBothButton = document.querySelector("#ambiguousAsBothButton");
const canGiveResults = document.querySelector("#canGiveResults");
const needFromThemResults = document.querySelector("#needFromThemResults");
const otherResults = document.querySelector("#otherCompareResults");
const copyReply = document.querySelector("#compareCopyReply");
const replyText = document.querySelector("#compareReplyText");
const copyReplyButton = document.querySelector("#copyCompareReplyButton");
const pendingTradeList = document.querySelector("#pendingTradeList");

let lastCompareResult = { canGive: [], needFromThem: [], other: [] };
let lastInventoryPayload = null;
let lastComparedText = "";
let compareDirectionMode = "auto";
let collectionCatalog = null;

async function compare() {
  const value = text.value.trim();
  if (!value) {
    summary.textContent = "Paste at least one card code first.";
    clearResults();
    return;
  }
  if (value !== lastComparedText) {
    compareDirectionMode = "auto";
    lastComparedText = value;
  }
  button.disabled = true;
  summary.textContent = "Loading adjusted inventory...";
  try {
    const { payload, source } = await loadInventory();
    const catalog = await loadCatalogue();
    lastInventoryPayload = payload;
    const adjusted = adjustedInventoryPayload(payload, loadLedger(), { catalog, legacyCollected: loadLegacyCollected() });
    const missing = missingCodes(catalog, payload);
    const directed = extractDirectedCodeOccurrences(value);
    const hasDirectedSections = Boolean(directed.wants.size || directed.offers.size);
    const needsClassification = !hasDirectedSections && directed.ambiguous.size && compareDirectionMode === "auto";
    const wants = directed.wants.size
      ? directed.wants
      : !hasDirectedSections && ["wants", "both"].includes(compareDirectionMode)
        ? directed.ambiguous
        : new Map();
    const offers = directed.offers.size
      ? directed.offers
      : !hasDirectedSections && ["offers", "both"].includes(compareDirectionMode)
        ? directed.ambiguous
        : new Map();
    const giveResult = compareParsedCodes(wants, adjusted, new Set());
    const needResult = compareParsedCodes(offers, { cards: {} }, missing);
    const ambiguousResult = compareParsedCodes(directed.ambiguous, adjusted, missing);
    const result = needsClassification
      ? { canGive: [], needFromThem: [], other: allParsedRows(directed.ambiguous) }
      : mergeCompareResults(giveResult, needResult, ambiguousResult, hasDirectedSections || compareDirectionMode !== "auto");
    const mentionCount = [...extractCodeOccurrences(value).values()].reduce((sum, count) => sum + count, 0);
    ambiguousDirectionPanel.hidden = !needsClassification;
    const directionHint = needsClassification ? " · choose how to read this list" : "";
    summary.textContent = `${result.canGive.length} you can give · ${result.needFromThem.length} you need · ${mentionCount} mentions parsed · ${source.label}${directionHint}`;
    canGiveResults.replaceChildren(...rows(result.canGive, "give"));
    needFromThemResults.replaceChildren(...rows(result.needFromThem, "need"));
    otherResults.replaceChildren(...rows(result.other, "other"));
    replyText.value = replyFor(result);
    copyReply.hidden = false;
    lastCompareResult = result;
    updateTradeBuildAction(result, hasDirectedSections || compareDirectionMode !== "auto", needsClassification);
    resetTradeDraft();
  } catch {
    summary.textContent = "Could not read saved inventory.";
    clearResults();
  } finally {
    button.disabled = false;
  }
}

function updateTradeBuildAction(result, hasDirectedSections, needsClassification = false) {
  const hasGive = Boolean(result.canGive.length);
  const hasNeed = Boolean(result.needFromThem.length);
  const hasUsefulMatch = hasGive || hasNeed;
  buildTradeButton.textContent = "Start trade";
  buildTradeButton.hidden = needsClassification || !hasUsefulMatch;
  buildTradeButton.disabled = needsClassification || !hasUsefulMatch;
  if (needsClassification) {
    tradeBuildHint.textContent = "Choose how to read this list before starting a trade.";
  } else if (!hasUsefulMatch) {
    tradeBuildHint.textContent = "";
  } else if (!hasGive) {
    tradeBuildHint.textContent = "Start a trade from what you need? Then paste what you can give them.";
  } else if (!hasNeed) {
    tradeBuildHint.textContent = "Start a trade from what you can give? Then paste what you want from them.";
  } else {
    tradeBuildHint.textContent = "Start a trade with these matches?";
  }
}

function allParsedRows(occurrences) {
  return [...occurrences.entries()].map(([code, mentions]) => ({
    code,
    mentions,
  })).sort((a, b) => sortCode(a.code, b.code));
}

async function loadInventory() {
  return loadInventoryPayload();
}

async function loadCatalogue() {
  if (collectionCatalog) return collectionCatalog;
  collectionCatalog = await loadCollectionCatalog();
  return collectionCatalog;
}

function missingCodes(catalog, inventory) {
  let collected = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLECTION_KEY) || "{}");
    collected = Array.isArray(parsed.collected) ? parsed.collected : [];
  } catch {
    collected = [];
  }
  const model = deriveCollectionModel({ catalog, legacyCollected: collected, ledger: loadLedger(), inventory });
  const missing = new Set();
  for (const card of model.cards.filter((item) => item.missing)) {
    missing.add(card.code);
    for (const alias of card.aliases || []) missing.add(alias);
  }
  return missing;
}

function loadLegacyCollected() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLECTION_KEY) || "{}");
    return Array.isArray(parsed.collected) ? parsed.collected : [];
  } catch {
    return [];
  }
}

function rows(items, type) {
  if (!items.length) {
    const row = document.createElement("li");
    row.className = "empty";
    row.textContent = "No matching cards in this section.";
    return [row];
  }
  return items.sort((a, b) => sortCode(a.code, b.code)).map((item) => {
    const row = document.createElement("li");
    row.className = type === "other" ? "missing" : "found";
    const detail = type === "give"
      ? `${item.available} available${item.mentions > 1 ? ` · mentioned ${item.mentions}x` : ""}`
      : type === "need"
        ? `Still missing${item.mentions > 1 ? ` · mentioned ${item.mentions}x` : ""}`
        : `Parsed but not available or needed${item.mentions > 1 ? ` · mentioned ${item.mentions}x` : ""}`;
    row.innerHTML = `<strong>${item.code}</strong><span>${detail}</span>`;
    return row;
  });
}

function replyFor(result) {
  const parts = [];
  if (result.canGive.length) {
    parts.push(`I can give: ${groupCodes(result.canGive.map((item) => item.code))}.`);
  }
  if (result.needFromThem.length) {
    parts.push(`I need: ${groupCodes(result.needFromThem.map((item) => item.code))}.`);
  }
  return parts.length ? parts.join("\n") : "I do not see any matches from that list.";
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

function clearResults() {
  canGiveResults.replaceChildren();
  needFromThemResults.replaceChildren();
  otherResults.replaceChildren();
  ambiguousDirectionPanel.hidden = true;
  replyText.value = "";
  copyReply.hidden = true;
  buildTradeButton.hidden = true;
  buildTradeButton.disabled = false;
  tradeBuildHint.textContent = "";
  lastCompareResult = { canGive: [], needFromThem: [], other: [] };
  lastInventoryPayload = null;
  lastComparedText = "";
  compareDirectionMode = "auto";
  resetTradeDraft();
}

function buildTradeDraft() {
  const given = lastCompareResult.canGive.map((item) => ({
    code: item.code,
    quantity: Math.max(1, Math.min(Number(item.mentions || 1), Number(item.available || 1))),
    available: item.available,
    owned: Number(lastInventoryPayload?.cards?.[item.code]?.count || item.available || 0),
    reserved: reservedQuantity(item.code),
  }));
  const received = lastCompareResult.needFromThem.map((item) => ({
    code: item.code,
    quantity: Math.max(1, Number(item.mentions || 1)),
  }));
  if (!given.length && !received.length) {
    tradeBuildHint.textContent = "No trade matches to add yet.";
    return;
  }
  sessionStorage.setItem(TRADE_SEED_KEY, JSON.stringify({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    given,
    received,
    inventorySnapshot: lastInventoryPayload || {},
  }));
  window.location.assign("/fifa-sticker-app/v2/trade/?v=build-eea91a46959f");
}

function reservedQuantity(code) {
  return transactionSummary(loadLedger())
    .filter((transaction) => transaction.status === "reserved")
    .flatMap((transaction) => transaction.given)
    .filter((line) => line.code === code)
    .reduce((sum, line) => sum + line.quantity, 0);
}

function resetTradeDraft() {
  renderPendingTrades();
}

function renderPendingTrades() {
  const pending = transactionSummary(loadLedger())
    .filter((transaction) => transaction.kind === "trade" && ["draft", "reserved"].includes(transaction.status));
  if (!pending.length) {
    const row = document.createElement("li");
    row.className = "empty";
    row.textContent = "No pending trades.";
    pendingTradeList.replaceChildren(row);
    return;
  }
  pendingTradeList.replaceChildren(...pending.map((transaction) => {
    const row = document.createElement("li");
    row.className = transaction.status === "reserved" ? "found" : "missing";
    const status = document.createElement("strong");
    status.textContent = transaction.status;
    const label = document.createElement("span");
    label.textContent = transactionLabel(transaction);
    const open = document.createElement("a");
    open.className = "buttonLike secondary";
    open.href = `/fifa-sticker-app/v2/trade/#trade=${encodeURIComponent(transaction.id)}`;
    open.textContent = "Open";
    row.append(status, label, open);
    return row;
  }));
}

function transactionLabel(transaction) {
  const received = transaction.received.reduce((sum, line) => sum + line.quantity, 0);
  const given = transaction.given.reduce((sum, line) => sum + line.quantity, 0);
  return `Receive ${received}, give ${given}`;
}

clearButton.addEventListener("click", () => {
  text.value = "";
  summary.textContent = "Paste once to check both directions. Adjusted inventory includes reserved and completed local trade activity on this phone.";
  clearResults();
  text.focus();
});
ambiguousAsWantsButton.addEventListener("click", () => {
  compareDirectionMode = "wants";
  compare();
});
ambiguousAsOffersButton.addEventListener("click", () => {
  compareDirectionMode = "offers";
  compare();
});
ambiguousAsBothButton.addEventListener("click", () => {
  compareDirectionMode = "both";
  compare();
});
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
buildTradeButton.addEventListener("click", buildTradeDraft);
button.addEventListener("click", compare);
text.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") compare();
});
renderPendingTrades();
