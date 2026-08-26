import {
  compareParsedCodes,
  extractDirectedCodeOccurrences,
  extractCodeOccurrences,
  loadLedger,
  mergeCompareResults,
  resolveCompareDirection,
  sortCode,
  transactionSummary,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-b7e3d4f6a219";
import { loadInventoryProjection } from "/fifa-sticker-app/v2/assets/inventory_projection.js?v=build-b7e3d4f6a219";
import { mountTradePasteBox } from "/fifa-sticker-app/v2/assets/trade_paste_box.js?v=build-b7e3d4f6a219";

const STARTING_MISSING = {
  RSA: [10],
  CZE: [13],
  BIH: [2],
  QAT: [19],
  SUI: [13],
  HAI: [3, 4],
  SCO: [10],
  PAR: [2],
  AUS: [13, 14, 16, 18],
  GER: [14, 15],
  CIV: [17],
  NED: [15],
  TUN: [8],
  IRN: [6],
  URU: [19],
  FRA: [1],
  IRQ: [9],
  ARG: [10],
  ALG: [12],
  AUT: [18],
  JOR: [6],
  ENG: [13],
};

const TRADE_SEED_KEY = "panini.pendingTradeSeed.v1";

mountTradePasteBox('[data-trade-paste-box="compare"]', {
  label: "Their message or card list",
  textareaId: "compareText",
  rows: 7,
  autofocus: true,
  placeholder: "Example: I need ENG13 and can offer MEX7, CZE 5, FRA-19.",
  capabilities: { photo: true, voice: true },
});

const text = document.querySelector("#compareText");
const buildTradeButton = document.querySelector("#buildTradeButton");
const clearButton = document.querySelector("#clearCompareButton");
const summary = document.querySelector("#compareSummary");
const tradeBuildHint = document.querySelector("#tradeBuildHint");
const compareDirectionHint = document.querySelector("#compareDirectionHint");
const ambiguousAsWantsButton = document.querySelector("#ambiguousAsWantsButton");
const ambiguousAsOffersButton = document.querySelector("#ambiguousAsOffersButton");
const ambiguousAsBothButton = document.querySelector("#ambiguousAsBothButton");
const compareResultsPanel = document.querySelector("#compareResultsPanel");
const otherParsedPanel = document.querySelector("#otherParsedPanel");
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
let compareRequestId = 0;

async function compare(mode = "offers") {
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
  compareDirectionMode = mode;
  const requestId = compareRequestId + 1;
  compareRequestId = requestId;
  const comparedValue = value;
  setDirectionButtonsDisabled(true);
  summary.textContent = "Loading adjusted inventory...";
  try {
    const projection = await loadInventory();
    if (requestId !== compareRequestId || text.value.trim() !== comparedValue) return;
    lastInventoryPayload = projection.inventoryPayload;
    const adjusted = projection.adjustedInventory;
    const missing = missingCodes(projection);
    const directed = extractDirectedCodeOccurrences(value);
    const direction = resolveCompareDirection(directed, compareDirectionMode);
    const giveResult = compareParsedCodes(direction.wants, adjusted, new Set());
    const needResult = compareParsedCodes(direction.offers, { cards: {} }, missing);
    const ambiguousResult = compareParsedCodes(directed.ambiguous, adjusted, missing);
    const result = annotateIncomingTradeRows(
      mergeCompareResults(giveResult, needResult, ambiguousResult, direction.hasResolvedDirection),
    );
    const mentionCount = [...extractCodeOccurrences(value).values()].reduce((sum, count) => sum + count, 0);
    const incomingCount = incomingTradeMatchCount(result);
    updateDirectionChooser(direction);
    summary.textContent = [
      `${result.canGive.length} you can give`,
      `${result.needFromThem.length} you need`,
      incomingCount ? `${incomingCount} already incoming` : "",
      `${mentionCount} mentions parsed`,
      projection.inventorySource?.label,
    ].filter(Boolean).join(" · ");
    canGiveResults.replaceChildren(...rows(result.canGive, "give"));
    needFromThemResults.replaceChildren(...rows(result.needFromThem, "need"));
    otherResults.replaceChildren(...rows(result.other, "other"));
    compareResultsPanel.hidden = false;
    otherParsedPanel.hidden = !result.other.length;
    replyText.value = replyFor(result);
    copyReply.hidden = false;
    copyReplyButton.disabled = false;
    lastCompareResult = result;
    updateTradeBuildAction(result);
    resetTradeDraft();
  } catch {
    if (requestId === compareRequestId && text.value.trim() === comparedValue) {
      summary.textContent = "Could not read saved inventory.";
      clearResults();
    }
  } finally {
    if (requestId === compareRequestId) setDirectionButtonsDisabled(false);
  }
}

function handleInputChanged() {
  if (text.value.trim() === lastComparedText) return;
  compareRequestId += 1;
  setDirectionButtonsDisabled(false);
  clearResults();
  summary.textContent = text.value.trim()
    ? "Choose how to compare this pasted list."
    : "Paste a list, then choose how to compare it.";
}

function updateTradeBuildAction(result) {
  const hasGive = Boolean(result.canGive.length);
  const hasNeed = Boolean(result.needFromThem.length);
  const hasUsefulMatch = hasGive || hasNeed;
  buildTradeButton.textContent = "Start trade";
  buildTradeButton.hidden = !hasUsefulMatch;
  buildTradeButton.disabled = !hasUsefulMatch;
  if (!hasUsefulMatch) {
    tradeBuildHint.textContent = "";
  } else if (!hasGive) {
    tradeBuildHint.textContent = "Start a trade from what you need? Then paste what you can give them.";
  } else if (!hasNeed) {
    tradeBuildHint.textContent = "Start a trade from what you can give? Then paste what you want from them.";
  } else {
    tradeBuildHint.textContent = "Start a trade with these matches?";
  }
}

function updateDirectionChooser(direction) {
  const active = direction.selectedMode;
  compareDirectionHint.textContent = direction.showDirectionChooser
    ? `Showing this list as ${directionLabel(active)}. You can switch it any time.`
    : "Using the direction found in the pasted message.";
  for (const [button, mode] of [
    [ambiguousAsWantsButton, "wants"],
    [ambiguousAsOffersButton, "offers"],
    [ambiguousAsBothButton, "both"],
  ]) {
    button.setAttribute("aria-pressed", String(active === mode));
    button.classList.toggle("selected", active === mode);
  }
}

function directionLabel(mode) {
  if (mode === "wants") return "cards they need";
  if (mode === "both") return "both directions";
  return "cards they offer";
}

function setDirectionButtonsDisabled(disabled) {
  ambiguousAsWantsButton.disabled = disabled;
  ambiguousAsOffersButton.disabled = disabled;
  ambiguousAsBothButton.disabled = disabled;
}

async function loadInventory() {
  return loadInventoryProjection();
}

function missingCodes(projection) {
  const model = projection.collectionModel;
  const missing = new Set();
  for (const card of model.cards.filter((item) => item.missing)) {
    missing.add(card.code);
    for (const alias of card.aliases || []) missing.add(alias);
  }
  return missing;
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
    const detail = rowDetail(item, type);
    row.innerHTML = `<strong>${item.code}</strong><span>${detail}</span>`;
    return row;
  });
}

function rowDetail(item, type) {
  const parts = [];
  if (type === "give") parts.push(`${item.available} available`);
  else if (type === "need") parts.push(item.incomingTradeQuantity ? "Still missing, but incoming" : "Still missing");
  else parts.push(item.incomingTradeQuantity ? "Parsed; incoming in another trade" : "Parsed but not available or needed");
  if (item.mentions > 1) parts.push(`mentioned ${item.mentions}x`);
  if (item.incomingTradeQuantity) parts.push(incomingTradeDetail(item));
  return parts.join(" · ");
}

function incomingTradeDetail(item) {
  const statuses = Object.entries(item.incomingTradeStatuses || {})
    .filter(([, quantity]) => Number(quantity || 0) > 0)
    .map(([status, quantity]) => `${quantity} ${status}`);
  return statuses.length
    ? `incoming ${item.incomingTradeQuantity} (${statuses.join(", ")})`
    : `incoming ${item.incomingTradeQuantity}`;
}

function annotateIncomingTradeRows(result) {
  const incoming = pendingIncomingByCode();
  const annotate = (rows) => rows.map((row) => {
    const match = incoming.get(row.code);
    return match ? { ...row, incomingTradeQuantity: match.quantity, incomingTradeStatuses: match.statuses } : row;
  });
  return {
    canGive: annotate(result.canGive || []),
    needFromThem: annotate(result.needFromThem || []),
    other: annotate(result.other || []),
  };
}

function incomingTradeMatchCount(result) {
  return [...(result.canGive || []), ...(result.needFromThem || []), ...(result.other || [])]
    .filter((row) => Number(row.incomingTradeQuantity || 0) > 0)
    .length;
}

function pendingIncomingByCode() {
  const incoming = new Map();
  for (const transaction of transactionSummary(loadLedger())) {
    if (transaction.kind !== "trade" || !["draft", "reserved"].includes(transaction.status)) continue;
    for (const line of transaction.received || []) {
      const code = String(line.code || "").toUpperCase();
      if (!code) continue;
      const current = incoming.get(code) || { quantity: 0, statuses: {} };
      const quantity = Math.max(0, Number(line.quantity || 0));
      current.quantity += quantity;
      current.statuses[transaction.status] = (current.statuses[transaction.status] || 0) + quantity;
      incoming.set(code, current);
    }
  }
  return incoming;
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
  compareResultsPanel.hidden = true;
  otherParsedPanel.hidden = true;
  updateDirectionChooser({ selectedMode: "auto", showDirectionChooser: true });
  compareDirectionHint.textContent = "Choose how to read the pasted list.";
  replyText.value = "";
  copyReply.hidden = true;
  copyReplyButton.disabled = true;
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
  window.location.assign("/fifa-sticker-app/v2/trade/?v=build-b7e3d4f6a219");
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
  summary.textContent = "Paste a list, then choose how to compare it.";
  clearResults();
  text.focus();
});
ambiguousAsWantsButton.addEventListener("click", () => {
  compare("wants");
});
ambiguousAsOffersButton.addEventListener("click", () => {
  compare("offers");
});
ambiguousAsBothButton.addEventListener("click", () => {
  compare("both");
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
text.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") compare("offers");
});
text.addEventListener("input", handleInputChanged);
clearResults();
renderPendingTrades();
