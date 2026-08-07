import {
  adjustedInventoryPayload,
  assignOutgoingVariants,
  buildBackupPayload,
  cancelTransaction,
  createTransaction,
  deriveCollectionCodes,
  deriveCollectionModel,
  deriveCollectionSummary,
  extractCodeOccurrences as sharedExtractCodeOccurrences,
  INVENTORY_CACHE_META_KEY,
  INVENTORY_SNAPSHOT_KEY,
  loadLedger,
  planBackupRestore,
  planBackupSource,
  parseBackupPayload,
  partitionOutgoingLinesByAvailability,
  saveLedger,
  storagePersistenceSummary,
  transactionDetailLines,
  tradeLineQuantityTotal,
  transactionSummary,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-153b7ac2b5ca";
import {
  applyBackupRestoreStorage,
  captureBackupStorageSnapshot,
  DEFAULT_RESTORE_FAILURE_MESSAGE,
  RESTORE_PARTIAL_ROLLBACK_MESSAGE,
  RESTORE_RENDER_FAILURE_MESSAGE,
} from "/fifa-sticker-app/v2/assets/backup_restore.js?v=build-153b7ac2b5ca";
import { loadCollectionCatalog } from "/fifa-sticker-app/v2/assets/catalog_source.js?v=build-153b7ac2b5ca";
import { loadInventoryPayload } from "/fifa-sticker-app/v2/assets/inventory_source.js?v=build-153b7ac2b5ca";
import { mountTradePasteBox } from "/fifa-sticker-app/v2/assets/trade_paste_box.js?v=build-153b7ac2b5ca";

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

const STORAGE_KEY = "panini.collectionTracker.v1";
const TRADED_AWAY_KEY = "panini.tradeInventoryRemoved.v1";

mountTradePasteBox('[data-trade-paste-box="collection-update"]', {
  label: "Update from pasted text",
  textareaId: "collectionUpdateText",
  rows: 5,
  placeholder: "Paste any message or list, e.g. I got MEX7 and CZE 5, traded away ENG13.",
  actions: [
    { id: "gotCardsButton", label: "I got these cards" },
    { id: "tradedAwayButton", label: "I traded them away", secondary: true },
  ],
  notices: [
    {
      id: "gotIgnoredNotice",
      summaryId: "gotIgnoredSummary",
      buttonId: "addIgnoredGotButton",
      buttonLabel: "Add all anyway",
    },
    {
      id: "tradedAwayIgnoredNotice",
      summaryId: "tradedAwayIgnoredSummary",
      buttonId: "addIgnoredTradedAwayButton",
      buttonLabel: "Add all anyway",
    },
  ],
});

const teamList = document.querySelector("#teamList");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const updateText = document.querySelector("#collectionUpdateText");
const status = document.querySelector("#collectionStatus");
const missingCount = document.querySelector("#missingCount");
const collectedCount = document.querySelector("#collectedCount");
const teamCount = document.querySelector("#teamCount");
const progressCount = document.querySelector("#progressCount");
const copyMissingButton = document.querySelector("#copyMissingButton");
const gotCardsButton = document.querySelector("#gotCardsButton");
const tradedAwayButton = document.querySelector("#tradedAwayButton");
const gotIgnoredNotice = document.querySelector("#gotIgnoredNotice");
const gotIgnoredSummary = document.querySelector("#gotIgnoredSummary");
const addIgnoredGotButton = document.querySelector("#addIgnoredGotButton");
const tradedAwayIgnoredNotice = document.querySelector("#tradedAwayIgnoredNotice");
const tradedAwayIgnoredSummary = document.querySelector("#tradedAwayIgnoredSummary");
const addIgnoredTradedAwayButton = document.querySelector("#addIgnoredTradedAwayButton");
const resetButton = document.querySelector("#resetButton");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const parsedBatchPreview = document.querySelector("#parsedBatchPreview");
const activityList = document.querySelector("#activityList");
const backupButton = document.querySelector("#backupButton");
const restoreButton = document.querySelector("#restoreButton");
const backupText = document.querySelector("#backupText");
const storagePersistenceStatus = document.querySelector("#storagePersistenceStatus");

let state = loadState();
let pendingIgnoredGotLines = [];
let pendingIgnoredTradedAwayLines = [];
let inventorySnapshot = null;
let cards = startingMissingCards();
let collectionCatalog = { cards, aliases: {} };
let catalogSourceLabel = "hunt list";

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      filter: ["missing", "all", "collected"].includes(parsed.filter) ? parsed.filter : "missing",
      collected: Array.isArray(parsed.collected) ? parsed.collected : [],
    };
  } catch {
    return { filter: "missing", collected: [] };
  }
}

function startingMissingCards() {
  return Object.entries(STARTING_MISSING).flatMap(([team, numbers]) =>
    numbers.map((number) => decorateCatalogCard({
      team,
      name: "",
      code: `${team}${number}`,
    })),
  );
}

function decorateCatalogCard(card) {
  const code = String(card?.code || "").toUpperCase();
  const match = code.match(/^([A-Z]+)(\d+)(S)?$/);
  const number = code === "00" ? "00" : match ? `${Number(match[2])}${match[3] || ""}` : code;
  return {
    code,
    team: String(card?.team || "").trim() || (match ? match[1] : "Other"),
    name: String(card?.name || "").trim(),
    number,
    label: [code, card?.name].filter(Boolean).join(" · "),
  };
}

async function loadCatalogue() {
  try {
    const payload = await loadCollectionCatalog();
    collectionCatalog = payload;
    cards = payload.cards.map(decorateCatalogCard).sort((a, b) => sortCode(a.code, b.code));
    catalogSourceLabel = `physical catalogue (${cards.length})`;
    render();
  } catch {
    catalogSourceLabel = "hunt list fallback";
    status.textContent = "Full catalogue unavailable. Showing the local hunt list fallback.";
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function collectedSet() {
  return deriveCollectionCodes(state.collected, loadLedger());
}

function setCardCollected(code, isCollected) {
  const next = new Set(state.collected);
  if (isCollected) next.add(code);
  else next.delete(code);
  state.collected = [...next].sort(sortCode);
  saveState();
  render();
}

function trackedCodeSet() {
  return new Set(cards.map((card) => card.code));
}

function extractCodeOccurrences(value) {
  return sharedExtractCodeOccurrences(value);
}

function parsedUpdateCodes() {
  const value = updateText.value.trim();
  if (!value) {
    status.textContent = "Paste some card text first.";
    return null;
  }
  const occurrences = extractCodeOccurrences(value);
  if (!occurrences.size) {
    status.textContent = "No card codes found in that text.";
    return null;
  }
  return occurrences;
}

function parsedLines(occurrences) {
  const merged = new Map();
  for (const [rawCode, quantity] of occurrences.entries()) {
    const code = canonicalCollectionCode(rawCode);
    merged.set(code, (merged.get(code) || 0) + quantity);
  }
  return [...merged.entries()].map(([code, quantity]) => ({ code, quantity }));
}

function splitReceivedLines(lines) {
  const tracked = trackedCodeSet();
  const found = collectedSet();
  return lines.reduce((result, line) => {
    if (!tracked.has(line.code)) {
      result.untracked.push(line);
    } else if (found.has(line.code)) {
      result.ignored.push(line);
    } else {
      result.added.push(line);
    }
    return result;
  }, { added: [], ignored: [], untracked: [] });
}

async function loadAdjustedInventoryForOutgoing() {
  if (!inventorySnapshot) inventorySnapshot = (await loadInventoryPayload()).payload;
  return adjustedInventoryPayload(inventorySnapshot || {}, loadLedger(), {
    catalog: collectionCatalog,
    legacyCollected: state.collected,
  });
}

async function splitTradedAwayLines(lines) {
  const adjusted = await loadAdjustedInventoryForOutgoing();
  const split = partitionOutgoingLinesByAvailability({ additions: lines, existing: [], inventory: adjusted });
  return {
    ...split,
    added: assignOutgoingVariants(split.added, adjusted),
  };
}

function recordReceivedLines(lines, { allowAlreadyOwned = false } = {}) {
  const tracked = trackedCodeSet();
  const received = lines.filter((line) => tracked.has(line.code) || allowAlreadyOwned);
  if (received.length) {
    saveLedger(createTransaction(loadLedger(), { kind: "received", received, given: [] }));
  }
  return received;
}

function recordTradedAwayLines(lines) {
  if (!lines.length) return [];
  saveLedger(createTransaction(loadLedger(), { kind: "given", received: [], given: lines }));
  localStorage.removeItem(TRADED_AWAY_KEY);
  return lines;
}

function markGotCards() {
  const occurrences = parsedUpdateCodes();
  if (!occurrences) return;
  const split = splitReceivedLines(parsedLines(occurrences));
  pendingIgnoredGotLines = split.ignored;
  clearTradedAwayIgnoredNotice();
  renderGotIgnoredNotice(split.added, split.ignored);
  const received = recordReceivedLines(split.added);
  render();
  const untrackedText = split.untracked.length ? ` · ignored ${split.untracked.length} untracked` : "";
  if (received.length) {
    status.textContent = pendingIgnoredGotLines.length
      ? `${tradeLineQuantityTotal(received)} cards marked collected, ${tradeLineQuantityTotal(pendingIgnoredGotLines)} ignored because you have them already${untrackedText}.`
      : `Marked ${received.length} card${received.length === 1 ? "" : "s"} as collected${untrackedText}.`;
  } else if (pendingIgnoredGotLines.length) {
    status.textContent = `Those cards were ignored because you have them already${untrackedText}. Use Add all anyway if you still want to record them.`;
  } else {
    status.textContent = `No tracked missing cards found${untrackedText}.`;
  }
}

async function markTradedAway() {
  const occurrences = parsedUpdateCodes();
  if (!occurrences) return;
  const split = await splitTradedAwayLines(parsedLines(occurrences));
  pendingIgnoredTradedAwayLines = split.ignored;
  clearGotIgnoredNotice();
  renderTradedAwayIgnoredNotice(split.added, split.ignored);
  const given = recordTradedAwayLines(split.added);
  render();
  if (given.length) {
    status.textContent = pendingIgnoredTradedAwayLines.length
      ? `${tradeLineQuantityTotal(given)} cards recorded as traded away, ${tradeLineQuantityTotal(pendingIgnoredTradedAwayLines)} skipped because you do not have them.`
      : `Recorded ${tradeLineQuantityTotal(given)} traded-away card${tradeLineQuantityTotal(given) === 1 ? "" : "s"} in Activity.`;
  } else if (pendingIgnoredTradedAwayLines.length) {
    status.textContent = "Those cards were skipped because you do not have them. Use Add all anyway only if you still want to record them.";
  } else {
    status.textContent = "No outgoing card codes found.";
  }
}

function renderGotIgnoredNotice(added, ignored) {
  if (!ignored.length) {
    clearGotIgnoredNotice();
    return;
  }
  gotIgnoredSummary.textContent = `${tradeLineQuantityTotal(added)} cards added, ${tradeLineQuantityTotal(ignored)} ignored because you have them already.`;
  gotIgnoredNotice.hidden = false;
}

function clearGotIgnoredNotice() {
  pendingIgnoredGotLines = [];
  gotIgnoredSummary.textContent = "";
  gotIgnoredNotice.hidden = true;
}

function renderTradedAwayIgnoredNotice(added, ignored) {
  if (!ignored.length) {
    clearTradedAwayIgnoredNotice();
    return;
  }
  tradedAwayIgnoredSummary.textContent = `${tradeLineQuantityTotal(added)} cards recorded, ${tradeLineQuantityTotal(ignored)} skipped because you do not have them.`;
  tradedAwayIgnoredNotice.hidden = false;
}

function clearTradedAwayIgnoredNotice() {
  pendingIgnoredTradedAwayLines = [];
  tradedAwayIgnoredSummary.textContent = "";
  tradedAwayIgnoredNotice.hidden = true;
}

function addIgnoredGotCards() {
  if (!pendingIgnoredGotLines.length) return;
  const received = recordReceivedLines(pendingIgnoredGotLines, { allowAlreadyOwned: true });
  const count = tradeLineQuantityTotal(received);
  clearGotIgnoredNotice();
  updateText.value = "";
  render();
  status.textContent = `${count} already-owned cards recorded anyway.`;
}

function addIgnoredTradedAwayCards() {
  if (!pendingIgnoredTradedAwayLines.length) return;
  const given = recordTradedAwayLines(pendingIgnoredTradedAwayLines);
  const count = tradeLineQuantityTotal(given);
  clearTradedAwayIgnoredNotice();
  updateText.value = "";
  render();
  status.textContent = `${count} unavailable cards recorded as traded away anyway.`;
}

function sortCode(a, b) {
  const aMatch = a.match(/^([A-Z]+)(\d+)$/);
  const bMatch = b.match(/^([A-Z]+)(\d+)$/);
  if (!aMatch || !bMatch) return a.localeCompare(b);
  return aMatch[1].localeCompare(bMatch[1]) || Number(aMatch[2]) - Number(bMatch[2]);
}

function visibleCards() {
  const model = currentCollectionModel();
  const query = searchInput.value.trim().toUpperCase().replace(/[-_]/g, " ");
  return model.cards.filter((card) => {
    if (state.filter === "missing" && !card.missing) return false;
    if (state.filter === "collected" && card.missing) return false;
    if (!query) return true;
    const compactQuery = query.replace(/\s+/g, "");
    return (
      card.team.toUpperCase().includes(query) ||
      card.label.toUpperCase().includes(query) ||
      card.name.toUpperCase().includes(query) ||
      card.code.includes(compactQuery)
    );
  });
}

function currentCollectionModel() {
  return deriveCollectionModel({
    catalog: collectionCatalog,
    legacyCollected: state.collected,
    ledger: loadLedger(),
    inventory: inventorySnapshot || {},
  });
}

function groupedByTeam(items) {
  return items.reduce((groups, card) => {
    if (!groups.has(card.team)) groups.set(card.team, []);
    groups.get(card.team).push(card);
    return groups;
  }, new Map());
}

function render() {
  const model = currentCollectionModel();
  const visible = visibleCards();
  const groups = groupedByTeam(visible);
  const summary = model.summary;

  missingCount.textContent = String(summary.missingCount);
  collectedCount.textContent = String(summary.collectedCount);
  teamCount.textContent = String(summary.teamsRemainingCount);
  progressCount.textContent = `${summary.progressPercent}%`;
  status.textContent = `${visible.length} cards shown from ${summary.catalogCount} cards in ${catalogSourceLabel}.`;

  filterButtons.forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  teamList.replaceChildren(
    ...[...groups.entries()].map(([team, teamCards]) => teamSection(team, teamCards)),
  );
  emptyState.hidden = visible.length > 0;
  renderParsedPreview();
  renderActivity();
}

function teamSection(team, teamCards) {
  const section = document.createElement("section");
  section.className = "collectionTeam";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = team;
  const meta = document.createElement("span");
  const collected = teamCards.filter((card) => !card.missing).length;
  meta.textContent = `${teamCards.length - collected} missing`;
  header.append(title, meta);

  const list = document.createElement("div");
  list.className = "collectionCards";
  list.append(...teamCards.map((card) => cardButton(card)));

  section.append(header, list);
  return section;
}

function cardButton(card) {
  const isCollected = !card.missing;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "collectionCard";
  button.classList.toggle("collected", isCollected);
  button.setAttribute("aria-pressed", String(isCollected));
  button.setAttribute("aria-label", `${card.label}, ${isCollected ? "collected" : "missing"}`);
  button.innerHTML = `<strong>${card.number}</strong><span>${isCollected ? "Have" : "Need"}</span>`;
  button.addEventListener("click", () => setCardCollected(card.code, !isCollected));
  return button;
}

function missingText() {
  const missing = currentCollectionModel().cards.filter((card) => card.missing);
  return [...groupedByTeam(missing).entries()]
    .map(([team, teamCards]) => {
      const remaining = teamCards.map((card) => card.number);
      return remaining.length ? `${team}: ${remaining.join(", ")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function copyMissingList() {
  const text = missingText();
  if (!text) {
    status.textContent = "Everything in this hunt list is marked collected.";
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Missing list copied.";
  } catch {
    status.textContent = text;
  }
}

function renderParsedPreview() {
  const value = updateText.value.trim();
  if (!value) {
    parsedBatchPreview.textContent = "Parsed preview appears here before anything changes.";
    return;
  }
  const occurrences = extractCodeOccurrences(value);
  if (!occurrences.size) {
    parsedBatchPreview.textContent = "No card codes found yet.";
    return;
  }
  const tracked = trackedCodeSet();
  parsedBatchPreview.textContent = `Preview: ${[...occurrences.entries()].map(([code, quantity]) => {
    const canonical = canonicalCollectionCode(code);
    const statusText = tracked.has(canonical) ? "tracked" : "not in missing list";
    const label = canonical === code ? code : `${code} as ${canonical}`;
    return `${label} x${quantity} (${statusText})`;
  }).join(", ")}`;
}

function canonicalCollectionCode(code) {
  const aliases = collectionCatalog?.aliases && typeof collectionCatalog.aliases === "object" ? collectionCatalog.aliases : {};
  return aliases[code] || code;
}

function renderActivity() {
  const transactions = transactionSummary(loadLedger());
  if (!transactions.length) {
    const row = document.createElement("li");
    row.className = "empty";
    row.textContent = "No local trade activity yet.";
    activityList.replaceChildren(row);
    return;
  }
  activityList.replaceChildren(...transactions.slice(0, 8).map((transaction) => {
    const row = document.createElement("li");
    row.className = transaction.status === "completed" ? "found" : "missing";
    const title = document.createElement("strong");
    title.textContent = transactionLabel(transaction);
    const state = document.createElement("span");
    state.textContent = transaction.status;
    row.append(title, state, activityDetailList(transaction));
    if (transaction.status === "completed") {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.textContent = "Undo";
      undo.addEventListener("click", () => {
        saveLedger(cancelTransaction(loadLedger(), transaction.id));
        render();
      });
      row.append(undo);
    }
    return row;
  }));
}

function activityDetailList(transaction) {
  const lines = transactionDetailLines(transaction);
  const list = document.createElement("ul");
  list.className = "transactionDetails";
  if (!lines.length) {
    const item = document.createElement("li");
    item.textContent = "No card changes.";
    list.append(item);
    return list;
  }
  list.append(...lines.map((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    return item;
  }));
  return list;
}

function transactionLabel(transaction) {
  if (transaction.kind === "trade") return `Trade · ${transaction.label}`;
  return transaction.label;
}

function createBackup() {
  let storedInventorySnapshot = {};
  let inventoryCacheMeta = {};
  try {
    storedInventorySnapshot = JSON.parse(localStorage.getItem(INVENTORY_SNAPSHOT_KEY) || "{}");
  } catch {
    storedInventorySnapshot = {};
  }
  try {
    inventoryCacheMeta = JSON.parse(localStorage.getItem(INVENTORY_CACHE_META_KEY) || "{}");
  } catch {
    inventoryCacheMeta = {};
  }
  const backupSource = planBackupSource({
    storedInventorySnapshot,
    liveInventorySnapshot: inventorySnapshot,
    inventoryCacheMeta,
  });
  const payload = buildBackupPayload({
    collectionState: state,
    ledger: loadLedger(),
    inventorySnapshot: backupSource.inventorySnapshot,
    inventoryCacheMeta: backupSource.inventoryCacheMeta,
    catalog: collectionCatalog,
  });
  backupText.value = JSON.stringify(payload, null, 2);
  status.textContent = "Backup JSON created.";
}

function restoreBackup() {
  let failureMessage = DEFAULT_RESTORE_FAILURE_MESSAGE;
  try {
    const payload = parseBackupPayload(backupText.value);
    if (!window.confirm("Restore this backup on this phone? Current local collection and activity will be replaced.")) return;
    const previous = captureBackupStorageSnapshot({ storage: localStorage, liveInventorySnapshot: inventorySnapshot });
    const restorePlan = planBackupRestore(payload, { inventorySnapshot, catalog: collectionCatalog });
    const restoreResult = applyBackupRestoreStorage({ storage: localStorage, restorePlan, previous });
    if (restoreResult.status === "failed") {
      inventorySnapshot = restoreResult.inventorySnapshot;
      state = loadState();
      if (!restoreResult.rollbackComplete) failureMessage = RESTORE_PARTIAL_ROLLBACK_MESSAGE;
      throw restoreResult.error;
    }
    state = restoreResult.collectionState;
    inventorySnapshot = restoreResult.inventorySnapshot;
    try {
      render();
      status.textContent = "Backup restored on this phone.";
    } catch {
      status.textContent = RESTORE_RENDER_FAILURE_MESSAGE;
    }
  } catch (error) {
    if (error?.message && failureMessage === DEFAULT_RESTORE_FAILURE_MESSAGE) failureMessage = error.message;
    status.textContent = failureMessage;
  }
}

async function renderStoragePersistenceStatus() {
  let summary = storagePersistenceSummary({ persisted: false, canPersist: false });
  try {
    if (navigator.storage?.persisted) {
      const persisted = await navigator.storage.persisted();
      summary = storagePersistenceSummary({
        persisted,
        canPersist: Boolean(navigator.storage.persist),
      });
    }
  } catch {
    summary = storagePersistenceSummary({ persisted: false, canPersist: false });
  }
  storagePersistenceStatus.dataset.severity = summary.severity;
  storagePersistenceStatus.querySelector("strong").textContent = summary.title;
  storagePersistenceStatus.querySelector("span").textContent = summary.detail;
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
gotCardsButton.addEventListener("click", markGotCards);
tradedAwayButton.addEventListener("click", markTradedAway);
addIgnoredGotButton.addEventListener("click", addIgnoredGotCards);
addIgnoredTradedAwayButton.addEventListener("click", addIgnoredTradedAwayCards);
updateText.addEventListener("input", renderParsedPreview);
backupButton.addEventListener("click", createBackup);
restoreButton.addEventListener("click", restoreBackup);
updateText.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") markGotCards();
});
resetButton.addEventListener("click", () => {
  if (!window.confirm("Reset all collection marks from this tracker? Traded-away activity stays recorded.")) return;
  state = { filter: "missing", collected: [] };
  const ledger = loadLedger();
  saveLedger({
    ...ledger,
    transactions: ledger.transactions.map((transaction) => (
      transaction.status === "completed" && transaction.received.length && !transaction.given.length
        ? { ...transaction, status: "cancelled" }
        : transaction
    )),
  });
  saveState();
  searchInput.value = "";
  render();
});

render();
loadCatalogue();
renderStoragePersistenceStatus();
