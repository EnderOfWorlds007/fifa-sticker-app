import {
  createTradeDraft,
  extractCodeOccurrences,
  loadLedger,
  partitionOutgoingLinesByAvailability,
  saveLedger,
  sortCode,
  tradeAvailabilityIssues,
  tradeIssueSummary,
  tradeLineQuantityTotal,
  transactionSummary,
  transitionTransactionStatus,
  updateTradeLines,
  variantLabel,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-90e1e19dc443";
import {
  buildInventoryProjection,
  loadInventoryProjection,
} from "/fifa-sticker-app/v2/assets/inventory_projection.js?v=build-90e1e19dc443";
import { mountTradePasteBox } from "/fifa-sticker-app/v2/assets/trade_paste_box.js?v=build-90e1e19dc443";

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

mountTradePasteBox('[data-trade-paste-box="trade-builder"]', {
  label: "Add cards to this trade",
  labelId: "tradeOtherSideLabel",
  textareaId: "tradeOtherSideText",
  rows: 5,
  placeholder: "Paste card codes, e.g. BIH 16, CIV 12, SWE 3",
  capabilities: { photo: true, voice: true },
  actions: [
    { id: "addTradeGiveButton", label: "Add to I give", secondary: true },
    { id: "addTradeReceiveButton", label: "Add to I receive", secondary: true },
  ],
  notices: [
    {
      id: "giveIgnoredNotice",
      summaryId: "giveIgnoredSummary",
      buttonId: "addIgnoredGiveButton",
      buttonLabel: "Add all anyway",
    },
    {
      id: "receiveIgnoredNotice",
      summaryId: "receiveIgnoredSummary",
      buttonId: "addIgnoredReceiveButton",
      buttonLabel: "Add all anyway",
    },
  ],
});

const status = document.querySelector("#tradeDraftStatus");
const tradeGiveList = document.querySelector("#tradeGiveList");
const tradeReceiveList = document.querySelector("#tradeReceiveList");
const tradeOtherSidePanel = document.querySelector("#tradeOtherSidePanel");
const tradeOtherSideLabel = document.querySelector("#tradeOtherSideLabel");
const tradeOtherSideText = document.querySelector("#tradeOtherSideText");
const addTradeGiveButton = document.querySelector("#addTradeGiveButton");
const addTradeReceiveButton = document.querySelector("#addTradeReceiveButton");
const giveIgnoredNotice = document.querySelector("#giveIgnoredNotice");
const giveIgnoredSummary = document.querySelector("#giveIgnoredSummary");
const addIgnoredGiveButton = document.querySelector("#addIgnoredGiveButton");
const receiveIgnoredNotice = document.querySelector("#receiveIgnoredNotice");
const receiveIgnoredSummary = document.querySelector("#receiveIgnoredSummary");
const addIgnoredReceiveButton = document.querySelector("#addIgnoredReceiveButton");
const setAllGreenButton = document.querySelector("#setAllGreenButton");
const setAllBlueButton = document.querySelector("#setAllBlueButton");
const tradeGiveCount = document.querySelector("#tradeGiveCount");
const tradeReceiveCount = document.querySelector("#tradeReceiveCount");
const tradeBalanceDelta = document.querySelector("#tradeBalanceDelta");
const tradeReadiness = document.querySelector("#tradeReadiness");
const tradeReadinessTitle = document.querySelector("#tradeReadinessTitle");
const tradeReadinessDetail = document.querySelector("#tradeReadinessDetail");
const tradeIssueList = document.querySelector("#tradeIssueList");
const saveTradeDraftButton = document.querySelector("#saveTradeDraftButton");
const reserveTradeButton = document.querySelector("#reserveTradeButton");
const completeTradeButton = document.querySelector("#completeTradeButton");
const cancelTradeButton = document.querySelector("#cancelTradeButton");

let inventorySnapshot = null;
let inventoryProjection = null;
let activeTradeId = null;
let activeTradeStatus = null;
let pendingIgnoredGivenLines = [];
let pendingIgnoredReceivedLines = [];

function loadTradeSeed() {
  const match = String(location.hash || "").match(/^#trade=(.+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const transaction = transactionSummary(loadLedger()).find((item) => item.id === id);
    if (transaction) {
      activeTradeId = transaction.id;
      activeTradeStatus = transaction.status;
      return {
        given: transaction.given.map((line) => ({
          ...line,
          owned: "saved",
          reserved: transaction.status === "reserved" ? line.quantity : 0,
          available: "saved",
        })),
        received: transaction.received,
        inventorySnapshot: null,
        savedStatus: transaction.status,
      };
    }
  }
  try {
    const seed = JSON.parse(sessionStorage.getItem(TRADE_SEED_KEY) || "{}");
    return {
      given: Array.isArray(seed.given) ? seed.given : [],
      received: Array.isArray(seed.received) ? seed.received : [],
      inventorySnapshot: seed.inventorySnapshot || null,
    };
  } catch {
    return { given: [], received: [], inventorySnapshot: null };
  }
}

async function loadInventory() {
  inventoryProjection = await loadInventoryProjection({
    inventoryPayload: inventorySnapshot || undefined,
    inventorySource: inventorySnapshot ? { label: "trade seed inventory" } : undefined,
    excludeTransactionId: activeTradeId,
  });
  inventorySnapshot = inventoryProjection.inventoryPayload;
  return inventorySnapshot;
}

function currentInventoryProjection() {
  return buildInventoryProjection({
    catalog: inventoryProjection?.catalog || fallbackCatalog(),
    collectionState: inventoryProjection?.collectionState || { collected: [] },
    ledger: loadLedger(),
    inventoryPayload: inventorySnapshot || {},
    inventorySource: inventoryProjection?.inventorySource || { label: inventorySnapshot ? "trade seed inventory" : "unloaded inventory" },
    inventoryCacheMeta: inventoryProjection?.inventoryCacheMeta || {},
    excludeTransactionId: activeTradeId,
  });
}

function fallbackCatalog() {
  return {
    cards: Object.entries(STARTING_MISSING)
      .flatMap(([team, numbers]) => numbers.map((number) => ({ code: `${team}${number}`, team, name: "" }))),
    aliases: {},
  };
}

function renderSeed(seed) {
  inventorySnapshot = seed.inventorySnapshot || inventorySnapshot;
  activeTradeStatus = seed.savedStatus || activeTradeStatus;
  tradeGiveList.replaceChildren(...basketRows(seed.given, "given"));
  tradeReceiveList.replaceChildren(...basketRows(seed.received, "received"));
  updateTradeBalance();
  updateTradeControls();
  const editable = isActiveTradeEditable();
  setBasketControlsDisabled(!editable && Boolean(activeTradeId));
  status.textContent = activeTradeId
    ? editable
      ? `${seed.savedStatus || "saved"} trade loaded. You can edit it, then save changes.`
      : `${seed.savedStatus || "saved"} trade loaded from this phone.`
    : seed.given.length || seed.received.length
      ? "Review this trade, then add the missing side if needed."
      : "No trade data was passed from Compare. Go back and start from a compare result.";
  saveTradeDraftButton.textContent = activeTradeId ? "Save changes" : "Save draft";
  saveTradeDraftButton.disabled = activeTradeId ? !editable : saveTradeDraftButton.disabled;
  reserveTradeButton.disabled = !activeTradeId || activeTradeStatus !== "draft";
  completeTradeButton.disabled = !activeTradeId || activeTradeStatus === "completed" || activeTradeStatus === "cancelled";
  cancelTradeButton.disabled = !activeTradeId || activeTradeStatus === "cancelled";
}

function isActiveTradeEditable() {
  return !activeTradeId || ["draft", "reserved"].includes(activeTradeStatus);
}

function basketRows(items, side) {
  if (!items.length) {
    const row = document.createElement("li");
    row.className = "empty";
    row.textContent = side === "given" ? "Nothing outgoing." : "Nothing incoming.";
    return [row];
  }
  return items.sort((a, b) => sortCode(a.code, b.code)).map((item) => {
    const row = document.createElement("li");
    row.className = side === "given" ? "found" : "missing";
    const suffix = side === "given"
      ? `owned ${item.owned ?? "saved"} · reserved ${item.reserved ?? "saved"} · available ${item.available ?? "saved"}`
      : "";
    const code = document.createElement("strong");
    code.textContent = item.code;
    const label = document.createElement("label");
    const hiddenLabel = document.createElement("span");
    hiddenLabel.className = "srOnly";
    hiddenLabel.textContent = `Quantity for ${item.code}`;
    const input = document.createElement("input");
    input.dataset.tradeSide = side;
    input.dataset.code = item.code;
    if (item.variant) input.dataset.variant = item.variant;
    input.type = "number";
    input.min = "1";
    input.max = "99";
    input.value = item.quantity;
    const detail = document.createElement("span");
    detail.textContent = item.variant ? `${item.variant}${suffix ? ` · ${suffix}` : ""}` : suffix;
    const variantOptions = side === "given" ? variantOptionsForLine(item) : [];
    const variantSelect = variantOptions.length > 1 ? variantSelectFor(item, variantOptions) : null;
    const remove = document.createElement("button");
    remove.className = "secondaryButton";
    remove.type = "button";
    remove.dataset.removeTradeLine = "true";
    remove.textContent = "Remove";
    label.append(hiddenLabel, input, detail);
    row.append(code, label);
    if (variantSelect) row.append(variantSelect);
    row.append(remove);
    return row;
  });
}

function variantOptionsForLine(item) {
  const counts = inventorySnapshot?.cards?.[item.code]?.back_insignia_counts;
  if (!counts || typeof counts !== "object") return item.variant ? [item.variant] : [];
  const options = Object.entries(counts)
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([variant]) => variant)
    .sort();
  if (item.variant && !options.includes(item.variant)) options.unshift(item.variant);
  return options;
}

function variantSelectFor(item, options) {
  const select = document.createElement("select");
  select.className = "tradeVariantSelect";
  select.dataset.tradeVariant = "true";
  select.dataset.code = item.code;
  for (const variant of options) {
    const option = document.createElement("option");
    option.value = variant;
    option.textContent = variantLabel(variant);
    select.append(option);
  }
  select.value = item.variant || preferredVariant(options);
  return select;
}

function preferredVariant(options) {
  if (options.includes("standard_fifa_licensed")) return "standard_fifa_licensed";
  if (options.includes("united_edition")) return "united_edition";
  return options[0] || "";
}

function currentTradeLines(side) {
  return [...document.querySelectorAll(`input[data-trade-side="${side}"]`)]
    .map((input) => {
      const select = input.closest("li")?.querySelector("select[data-trade-variant]");
      return {
        code: input.dataset.code,
        quantity: Math.max(1, Number(input.value || 1)),
        variant: select?.value || input.dataset.variant || undefined,
      };
    })
    .filter((line) => line.code);
}

function configureOtherSidePrompt() {
  const given = currentTradeLines("given");
  const received = currentTradeLines("received");
  saveTradeDraftButton.disabled = !given.length || !received.length;
  tradeOtherSideLabel.textContent = !given.length && !received.length
    ? "Paste either side of the trade"
    : "Keep adding cards to either side";
}

function updateTradeBalance() {
  const givenTotal = tradeLineQuantityTotal(currentTradeLines("given"));
  const receivedTotal = tradeLineQuantityTotal(currentTradeLines("received"));
  const delta = receivedTotal - givenTotal;
  tradeGiveCount.textContent = String(givenTotal);
  tradeReceiveCount.textContent = String(receivedTotal);
  tradeBalanceDelta.textContent = delta === 0 ? "Even" : delta > 0 ? `+${delta} receive` : `+${Math.abs(delta)} give`;
  tradeBalanceDelta.dataset.balance = delta === 0 ? "even" : "uneven";
}

function updateTradeControls() {
  configureOtherSidePrompt();
  updateTradeBalance();
  const given = currentTradeLines("given");
  const received = currentTradeLines("received");
  if (!given.length || !received.length) {
    renderTradeIssues([]);
    updateIncompleteTradeReadiness(given, received);
    return;
  }
  if (inventorySnapshot) {
    const issues = tradeAvailabilityIssues(
      given,
      currentInventoryProjection().adjustedInventory,
    );
    renderTradeIssues(issues);
    updateTradeReadiness(issues);
  } else {
    renderTradeIssues([]);
    updateTradeReadiness([], { checked: false });
  }
}

async function addTradeSide(side) {
  const occurrences = extractCodeOccurrences(tradeOtherSideText.value);
  if (!side || !occurrences.size) {
    status.textContent = "Paste card codes before adding them to a trade side.";
    return;
  }
  await loadInventory();
  let additions = side === "given" ? parsedGivenLines(occurrences) : parsedReceivedLines(occurrences);
  if (side === "given") {
    const split = splitGivenLines(additions, currentTradeLines("given"));
    additions = split.added;
    pendingIgnoredGivenLines = split.ignored;
    renderGiveIgnoredNotice(split.added, split.ignored);
    clearReceiveIgnoredNotice();
  } else if (side === "received") {
    const split = splitReceivedLines(additions);
    additions = split.added;
    pendingIgnoredReceivedLines = split.ignored;
    renderReceiveIgnoredNotice(split.added, split.ignored);
    clearGiveIgnoredNotice();
  }
  if (!additions.length) {
    status.textContent = side === "given"
      ? pendingIgnoredGivenLines.length
        ? "Those cards were skipped because you do not have them. Use Add all anyway only if you still want to draft them."
        : "No outgoing card codes found."
      : pendingIgnoredReceivedLines.length
        ? "Those cards are already in your collection. Use Add all anyway if this trade should still receive them."
        : "No incoming card codes found.";
    return;
  }
  addLinesToSide(side, additions);
  tradeOtherSideText.value = "";
  updateTradeControls();
  status.textContent = side === "given"
    ? pendingIgnoredGivenLines.length
      ? `${tradeLineQuantityTotal(additions)} cards added, ${tradeLineQuantityTotal(pendingIgnoredGivenLines)} skipped because you do not have them.`
      : "Added outgoing cards. Review the balance, then keep adding or save."
    : pendingIgnoredReceivedLines.length
      ? `${tradeLineQuantityTotal(additions)} cards added, ${tradeLineQuantityTotal(pendingIgnoredReceivedLines)} ignored because you have them already.`
      : "Added incoming cards. Review the balance, then keep adding or save.";
}

function parsedGivenLines(occurrences) {
  const adjusted = currentInventoryProjection().adjustedInventory;
  const cards = adjusted.cards || {};
  return [...occurrences.entries()].map(([code, mentions]) => {
    const available = Number(cards[code]?.count || 0);
    return {
      code,
      quantity: Math.max(1, Number(mentions || 1)),
      available,
      owned: Number(inventorySnapshot?.cards?.[code]?.count || available || 0),
      reserved: reservedQuantity(code),
    };
  }).sort((a, b) => sortCode(a.code, b.code));
}

function parsedReceivedLines(occurrences) {
  return [...occurrences.entries()].map(([code, mentions]) => ({
    code,
    quantity: Math.max(1, Number(mentions || 1)),
  }));
}

function splitGivenLines(lines, existing = []) {
  const adjusted = currentInventoryProjection().adjustedInventory;
  return partitionOutgoingLinesByAvailability({ additions: lines, existing, inventory: adjusted });
}

function splitReceivedLines(lines) {
  const missing = missingCodes();
  return lines.reduce((result, line) => {
    if (missing.has(line.code)) result.added.push(line);
    else result.ignored.push(line);
    return result;
  }, { added: [], ignored: [] });
}

function renderGiveIgnoredNotice(added, ignored) {
  if (!ignored.length) {
    clearGiveIgnoredNotice();
    return;
  }
  giveIgnoredSummary.textContent = `${tradeLineQuantityTotal(added)} cards added, ${tradeLineQuantityTotal(ignored)} skipped because you do not have them.`;
  giveIgnoredNotice.hidden = false;
}

function clearGiveIgnoredNotice() {
  pendingIgnoredGivenLines = [];
  giveIgnoredSummary.textContent = "";
  giveIgnoredNotice.hidden = true;
}

function renderReceiveIgnoredNotice(added, ignored) {
  if (!ignored.length) {
    clearReceiveIgnoredNotice();
    return;
  }
  receiveIgnoredSummary.textContent = `${tradeLineQuantityTotal(added)} cards added, ${tradeLineQuantityTotal(ignored)} ignored because you have them already.`;
  receiveIgnoredNotice.hidden = false;
}

function clearReceiveIgnoredNotice() {
  pendingIgnoredReceivedLines = [];
  receiveIgnoredSummary.textContent = "";
  receiveIgnoredNotice.hidden = true;
}

function addLinesToSide(side, additions) {
  const merged = mergeTradeLines(currentTradeLines(side), additions);
  if (side === "given") tradeGiveList.replaceChildren(...basketRows(merged, "given"));
  else tradeReceiveList.replaceChildren(...basketRows(merged, "received"));
}

function addIgnoredReceivedLines() {
  if (!pendingIgnoredReceivedLines.length) return;
  addLinesToSide("received", pendingIgnoredReceivedLines);
  const addedCount = tradeLineQuantityTotal(pendingIgnoredReceivedLines);
  clearReceiveIgnoredNotice();
  tradeOtherSideText.value = "";
  updateTradeControls();
  status.textContent = `${addedCount} already-owned cards added to I receive anyway.`;
}

function addIgnoredGivenLines() {
  if (!pendingIgnoredGivenLines.length) return;
  addLinesToSide("given", pendingIgnoredGivenLines);
  const addedCount = tradeLineQuantityTotal(pendingIgnoredGivenLines);
  clearGiveIgnoredNotice();
  tradeOtherSideText.value = "";
  updateTradeControls();
  status.textContent = `${addedCount} unavailable cards added to I give anyway.`;
}

function mergeTradeLines(existing, additions) {
  const merged = new Map();
  for (const line of [...existing, ...additions]) {
    const key = `${line.code}:${line.variant || ""}`;
    const previous = merged.get(key) || { ...line, quantity: 0 };
    merged.set(key, { ...previous, ...line, quantity: Number(previous.quantity || 0) + Number(line.quantity || 0) });
  }
  return [...merged.values()].sort((a, b) => sortCode(a.code, b.code));
}

function missingCodes() {
  const model = currentInventoryProjection().collectionModel;
  const missing = new Set();
  for (const card of model.cards.filter((item) => item.missing)) {
    missing.add(card.code);
    for (const alias of card.aliases || []) missing.add(alias);
  }
  return missing;
}

function reservedQuantity(code) {
  return transactionSummary(loadLedger())
    .filter((transaction) => transaction.status === "reserved")
    .flatMap((transaction) => transaction.given)
    .filter((line) => line.code === code)
    .reduce((sum, line) => sum + line.quantity, 0);
}

async function saveDraft() {
  const given = currentTradeLines("given");
  const received = currentTradeLines("received");
  if (!given.length || !received.length) {
    status.textContent = "A trade needs at least one card on each side.";
    updateTradeControls();
    return false;
  }
  const issues = await validateOutgoingBasket();
  if (activeTradeId) {
    if (activeTradeStatus === "reserved" && issues.length) {
      status.textContent = "Resolve outgoing card issues before saving changes to this reservation.";
      return false;
    }
    try {
      saveLedger(updateTradeLines(loadLedger(), activeTradeId, { given, received }));
    } catch (error) {
      status.textContent = error.message || "Could not save trade changes.";
      return false;
    }
    status.textContent = issues.length
      ? "Changes saved. Resolve outgoing issues before reserving or completing it."
      : "Changes saved on this phone.";
    updateTradeControls();
    return true;
  }
  const next = createTradeDraft(loadLedger(), { given, received });
  saveLedger(next);
  sessionStorage.removeItem(TRADE_SEED_KEY);
  activeTradeId = next.transactions[next.transactions.length - 1]?.id || null;
  activeTradeStatus = "draft";
  status.textContent = issues.length
    ? "Draft saved on this phone. Resolve outgoing issues before reserving or completing it."
    : "Draft saved on this phone.";
  saveTradeDraftButton.disabled = true;
  saveTradeDraftButton.textContent = "Save changes";
  reserveTradeButton.disabled = false;
  completeTradeButton.disabled = false;
  cancelTradeButton.disabled = false;
  return true;
}

async function transitionActiveTrade(nextStatus) {
  if (!activeTradeId) {
    if (!(await saveDraft())) return;
    if (!activeTradeId) return;
  }
  if (["completed", "cancelled"].includes(nextStatus) && !confirmTradeTransition(nextStatus)) return;
  if (nextStatus === "reserved" || nextStatus === "completed") {
    const issues = await validateOutgoingBasket();
    if (issues.length) {
      status.textContent = "Resolve outgoing card issues before changing trade status.";
      return;
    }
  }
  try {
    let ledger = loadLedger();
    if (isActiveTradeEditable()) {
      ledger = updateTradeLines(ledger, activeTradeId, {
        given: currentTradeLines("given"),
        received: currentTradeLines("received"),
      });
    }
    saveLedger(transitionTransactionStatus(ledger, activeTradeId, nextStatus));
  } catch (error) {
    status.textContent = error.message || "Could not update trade status.";
    return;
  }
  status.textContent = nextStatus === "completed"
    ? "Trade completed. Collection and available inventory now include this transaction."
    : nextStatus === "reserved"
      ? "Trade reserved. Outgoing cards are no longer freely available."
      : "Trade cancelled. Reservations are released.";
  activeTradeStatus = nextStatus;
  if (!isActiveTradeEditable()) setBasketControlsDisabled(true);
  saveTradeDraftButton.disabled = true;
  reserveTradeButton.disabled = nextStatus !== "draft";
  completeTradeButton.disabled = nextStatus === "completed" || nextStatus === "cancelled";
  cancelTradeButton.disabled = nextStatus === "cancelled";
}

async function validateOutgoingBasket() {
  await loadInventory();
  const adjusted = currentInventoryProjection().adjustedInventory;
  const issues = tradeAvailabilityIssues(currentTradeLines("given"), adjusted);
  renderTradeIssues(issues);
  return issues;
}

function renderTradeIssues(issues) {
  tradeIssueList.hidden = !issues.length;
  tradeIssueList.replaceChildren(...issues.map((issue) => {
    const item = document.createElement("p");
    item.textContent = issue.type === "variant_required"
      ? `${issue.code}: choose a variant before removing one of ${issue.variants.join(", ")}.`
      : `${issue.code}${issue.variant ? ` (${issue.variant})` : ""}: requested ${issue.requested}, available ${issue.available}.`;
    return item;
  }));
}

function updateTradeReadiness(issues, options = {}) {
  const summary = tradeIssueSummary(issues, options);
  tradeReadiness.dataset.severity = summary.severity;
  tradeReadinessTitle.textContent = summary.title;
  tradeReadinessDetail.textContent = summary.detail;
  const blocked = summary.severity === "blocked";
  const title = blocked ? `${summary.title}: ${summary.detail}` : "";
  saveTradeDraftButton.title = title;
  reserveTradeButton.title = title;
  completeTradeButton.title = title;
}

function updateIncompleteTradeReadiness(given, received) {
  const missingSide = !given.length ? "I give" : "I receive";
  tradeReadiness.dataset.severity = "checking";
  tradeReadinessTitle.textContent = `Add cards to ${missingSide}`;
  tradeReadinessDetail.textContent = "A trade needs at least one card on each side.";
  saveTradeDraftButton.title = "";
  reserveTradeButton.title = "";
  completeTradeButton.title = "";
}

function confirmTradeTransition(nextStatus) {
  const action = nextStatus === "completed" ? "complete" : "cancel";
  const given = currentTradeLines("given");
  const received = currentTradeLines("received");
  const message = [
    `Are you sure you want to ${action} this trade?`,
    `I give: ${tradeLineQuantityTotal(given)}`,
    `I receive: ${tradeLineQuantityTotal(received)}`,
  ].join("\n");
  return window.confirm(message);
}

function setBasketControlsDisabled(disabled) {
  for (const control of document.querySelectorAll("input[data-trade-side], select[data-trade-variant], button[data-remove-trade-line]")) {
    control.disabled = disabled;
  }
  tradeOtherSideText.disabled = disabled;
  addTradeGiveButton.disabled = disabled;
  addTradeReceiveButton.disabled = disabled;
  addIgnoredGiveButton.disabled = disabled;
  addIgnoredReceiveButton.disabled = disabled;
  setAllGreenButton.disabled = disabled;
  setAllBlueButton.disabled = disabled;
}

function applyVariantToAll(variant) {
  for (const select of document.querySelectorAll("select[data-trade-variant]")) {
    if ([...select.options].some((option) => option.value === variant)) {
      select.value = variant;
    }
  }
  updateTradeControls();
}

document.querySelector("#tradeDraftPanel").addEventListener("click", (event) => {
  if (!event.target.matches("[data-remove-trade-line]")) return;
  event.target.closest("li")?.remove();
  updateTradeControls();
});
document.querySelector("#tradeDraftPanel").addEventListener("input", (event) => {
  if (!event.target.matches("input[data-trade-side], select[data-trade-variant]")) return;
  updateTradeControls();
});
addTradeGiveButton.addEventListener("click", () => addTradeSide("given"));
addTradeReceiveButton.addEventListener("click", () => addTradeSide("received"));
addIgnoredGiveButton.addEventListener("click", addIgnoredGivenLines);
addIgnoredReceiveButton.addEventListener("click", addIgnoredReceivedLines);
setAllGreenButton.addEventListener("click", () => applyVariantToAll("united_edition"));
setAllBlueButton.addEventListener("click", () => applyVariantToAll("standard_fifa_licensed"));
saveTradeDraftButton.addEventListener("click", () => saveDraft());
reserveTradeButton.addEventListener("click", () => transitionActiveTrade("reserved"));
completeTradeButton.addEventListener("click", () => transitionActiveTrade("completed"));
cancelTradeButton.addEventListener("click", () => transitionActiveTrade("cancelled"));

async function initializeTradeBuilder() {
  const seed = loadTradeSeed();
  inventorySnapshot = seed.inventorySnapshot || inventorySnapshot;
  const [inventoryResult] = await Promise.allSettled([loadInventory()]);
  renderSeed(seed);
  if (inventoryResult.status === "rejected") {
    status.textContent = activeTradeId
      ? "Trade loaded. Inventory is still unavailable, so availability checks will run when inventory loads."
      : "Trade screen ready. Inventory is still unavailable, so availability checks will run when inventory loads.";
  }
}

initializeTradeBuilder();
