import {
  assignOutgoingVariants,
  buildBackupPayload,
  cancelTransaction,
  createTransaction,
  extractCodeOccurrences as sharedExtractCodeOccurrences,
  INVENTORY_CACHE_META_KEY,
  INVENTORY_SNAPSHOT_KEY,
  loadLedger,
  missingListText,
  planBackupRestore,
  planBackupSource,
  parseBackupPayload,
  partitionOutgoingLinesByAvailability,
  saveLedger,
  storagePersistenceSummary,
  transactionDetailLines,
  tradeLineQuantityTotal,
  transactionSummary,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-8948f03f90fb";
import {
  applyBackupRestoreStorage,
  captureBackupStorageSnapshot,
  DEFAULT_RESTORE_FAILURE_MESSAGE,
  RESTORE_PARTIAL_ROLLBACK_MESSAGE,
  RESTORE_RENDER_FAILURE_MESSAGE,
} from "/fifa-sticker-app/v2/assets/backup_restore.js?v=build-8948f03f90fb";
import { loadCollectionCatalog } from "/fifa-sticker-app/v2/assets/catalog_source.js?v=build-8948f03f90fb";
import {
  COLLECTION_SNAPSHOT_IMPORT_VERSION,
  importCollectionSnapshotState,
  loadCollectionState,
  saveCollectionState,
} from "/fifa-sticker-app/v2/assets/collection_state.js?v=build-8948f03f90fb";
import {
  buildInventoryProjection,
  loadInventoryProjection,
} from "/fifa-sticker-app/v2/assets/inventory_projection.js?v=build-8948f03f90fb";
import { mountTradePasteBox } from "/fifa-sticker-app/v2/assets/trade_paste_box.js?v=build-8948f03f90fb";
import { ensureActiveProfileId } from "/fifa-sticker-app/v2/assets/v2_profile.js?v=build-8948f03f90fb";

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

const ALBUM_PREFIX_ORDER = [
  "00",
  "FWC",
  "MEX",
  "RSA",
  "KOR",
  "CZE",
  "CAN",
  "BIH",
  "QAT",
  "SUI",
  "BRA",
  "MAR",
  "HAI",
  "SCO",
  "USA",
  "PAR",
  "AUS",
  "TUR",
  "GER",
  "CUW",
  "CIV",
  "ECU",
  "NED",
  "JPN",
  "SWE",
  "TUN",
  "BEL",
  "EGY",
  "IRN",
  "NZL",
  "ESP",
  "CPV",
  "KSA",
  "URU",
  "FRA",
  "SEN",
  "IRQ",
  "NOR",
  "ARG",
  "ALG",
  "AUT",
  "JOR",
  "POR",
  "COD",
  "UZB",
  "COL",
  "ENG",
  "CRO",
  "GHA",
  "PAN",
];

const ALBUM_PREFIX_RANK = new Map(ALBUM_PREFIX_ORDER.map((prefix, index) => [prefix, index]));
const TRADED_AWAY_KEY = "panini.tradeInventoryRemoved.v1";
const ALBUM_UPDATE_PROMPT_LIMIT = 12;

mountTradePasteBox('[data-trade-paste-box="collection-update"]', {
  label: "Update from pasted text",
  textareaId: "collectionUpdateText",
  rows: 5,
  placeholder: "Paste any message or list, e.g. I got MEX7 and CZE 5, traded away ENG13.",
  capabilities: { photo: true, voice: true },
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
const availableTradeCount = document.querySelector("#availableTradeCount");
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
const sortButtons = [...document.querySelectorAll("[data-sort-order]")];
const parsedBatchPreview = document.querySelector("#parsedBatchPreview");
const activityList = document.querySelector("#activityList");
const albumReviewPanel = document.querySelector("#albumReviewPanel");
const albumReviewSummary = document.querySelector("#albumReviewSummary");
const albumReviewList = document.querySelector("#albumReviewList");
const saveAlbumReviewButton = document.querySelector("#saveAlbumReviewButton");
const cancelAlbumReviewButton = document.querySelector("#cancelAlbumReviewButton");
const backupButton = document.querySelector("#backupButton");
const shareBackupButton = document.querySelector("#shareBackupButton");
const downloadBackupButton = document.querySelector("#downloadBackupButton");
const importBackupButton = document.querySelector("#importBackupButton");
const restoreButton = document.querySelector("#restoreButton");
const startLocalButton = document.querySelector("#startLocalButton");
const backupText = document.querySelector("#backupText");
const backupFileInput = document.querySelector("#backupFileInput");
const storagePersistenceStatus = document.querySelector("#storagePersistenceStatus");

let state = loadState();
let pendingIgnoredGotLines = [];
let pendingIgnoredTradedAwayLines = [];
let pendingAlbumStatusChanges = new Map();
let albumInventoryCheckPrompted = false;
let inventorySnapshot = null;
let inventoryProjection = null;
let cards = startingMissingCards();
let collectionCatalog = { cards, aliases: {} };
let catalogSourceLabel = "hunt list";

function loadState() {
  return loadCollectionState();
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
    try {
      await applyImportedCollectionSnapshot();
    } catch {
      catalogSourceLabel = `physical catalogue (${cards.length})`;
    }
    render();
    loadSharedInventoryProjection();
  } catch {
    catalogSourceLabel = "hunt list fallback";
    status.textContent = "Full catalogue unavailable. Showing the local hunt list fallback.";
  }
}

async function applyImportedCollectionSnapshot() {
  const result = await importCollectionSnapshotState({ state });
  state = result.state;
  const snapshotCards = Array.isArray(result.snapshot?.cards) ? result.snapshot.cards : [];
  if (!snapshotCards.length) return;

  collectionCatalog = {
    ...(collectionCatalog || {}),
    cards: snapshotCards.map(({ code, name, team }) => ({ code, name, team })),
  };
  cards = collectionCatalog.cards.map(decorateCatalogCard).sort((a, b) => sortCode(a.code, b.code));
  catalogSourceLabel = `imported v1 collection snapshot (${cards.length})`;
}

function saveState() {
  saveCollectionState(state);
}

function collectedSet() {
  return new Set(currentCollectionModel().cards.filter((card) => !card.missing).map((card) => card.code));
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
  const projection = await ensureInventoryProjection();
  return projection.adjustedInventory;
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
  pendingIgnoredGotLines = [];
  clearTradedAwayIgnoredNotice();
  clearGotIgnoredNotice();
  const received = recordReceivedLines([...split.added, ...split.ignored]);
  render();
  const newCount = tradeLineQuantityTotal(split.added);
  const duplicateCount = tradeLineQuantityTotal(split.ignored);
  const untrackedText = split.untracked.length ? ` · ignored ${split.untracked.length} untracked` : "";
  if (received.length) {
    status.textContent = [
      `${tradeLineQuantityTotal(received)} received card${tradeLineQuantityTotal(received) === 1 ? "" : "s"} recorded`,
      newCount ? `${newCount} new to collection` : "",
      duplicateCount ? `${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} added to inventory` : "",
    ].filter(Boolean).join(" · ") + untrackedText + ".";
  } else {
    status.textContent = `No tracked card codes found${untrackedText}.`;
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
  gotIgnoredSummary.textContent = `${tradeLineQuantityTotal(added)} new cards, ${tradeLineQuantityTotal(ignored)} duplicate cards ready to add to inventory.`;
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
  return currentInventoryProjection().collectionModel;
}

function baseCollectionModel() {
  return buildInventoryProjection({
    catalog: collectionCatalog,
    collectionState: { ...state, albumStatusOverrides: {} },
    ledger: loadLedger(),
    inventoryPayload: inventorySnapshot || {},
    inventorySource: inventoryProjection?.inventorySource || { label: inventorySnapshot ? "browser cache" : "unloaded inventory" },
    inventoryCacheMeta: inventoryProjection?.inventoryCacheMeta || {},
  }).collectionModel;
}

function currentInventoryProjection() {
  return buildInventoryProjection({
    catalog: collectionCatalog,
    collectionState: state,
    ledger: loadLedger(),
    inventoryPayload: inventorySnapshot || {},
    inventorySource: inventoryProjection?.inventorySource || { label: inventorySnapshot ? "browser cache" : "unloaded inventory" },
    inventoryCacheMeta: inventoryProjection?.inventoryCacheMeta || {},
  });
}

async function ensureInventoryProjection() {
  if (!inventoryProjection) await loadSharedInventoryProjection();
  return currentInventoryProjection();
}

async function loadSharedInventoryProjection() {
  try {
    const projection = await loadInventoryProjection({
      catalog: collectionCatalog,
      collectionState: state,
    });
    inventoryProjection = projection;
    inventorySnapshot = projection.inventoryPayload;
    state = projection.collectionState;
    saveState();
    render();
    maybePromptAlbumInventoryUpdates();
  } catch {
    inventoryProjection = currentInventoryProjection();
  }
  return inventoryProjection;
}

function groupedByTeam(items) {
  return items.reduce((groups, card) => {
    if (!groups.has(card.team)) groups.set(card.team, []);
    groups.get(card.team).push(card);
    return groups;
  }, new Map());
}

function sortedTeamEntries(groups) {
  const entries = [...groups.entries()];
  if (state.sortOrder === "alphabetical") {
    return entries.sort(([teamA, cardsA], [teamB, cardsB]) => (
      teamA.localeCompare(teamB) || cardAlbumRank(cardsA[0]) - cardAlbumRank(cardsB[0])
    ));
  }
  return entries.sort(([, cardsA], [, cardsB]) => (
    teamAlbumRank(cardsA) - teamAlbumRank(cardsB)
    || cardsA[0].team.localeCompare(cardsB[0].team)
  ));
}

function teamAlbumRank(teamCards) {
  return Math.min(...teamCards.map(cardAlbumRank));
}

function cardAlbumRank(card) {
  const code = String(card?.code || "").toUpperCase();
  if (code === "00") return 0;
  const match = code.match(/^([A-Z]+)(\d+)/);
  if (!match) return 999999;
  const prefixRank = ALBUM_PREFIX_RANK.get(match[1]);
  const number = Number(match[2]);
  return (prefixRank ?? 999) * 1000 + (Number.isFinite(number) ? number : 999);
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
  availableTradeCount.textContent = String(summary.availableToTradeCount);
  status.textContent = `${visible.length} cards shown from ${summary.catalogCount} cards in ${catalogSourceLabel}.`;

  filterButtons.forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  sortButtons.forEach((button) => {
    const active = button.dataset.sortOrder === state.sortOrder;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  teamList.replaceChildren(
    ...sortedTeamEntries(groups).map(([team, teamCards]) => teamSection(team, teamCards)),
  );
  emptyState.hidden = visible.length > 0;
  renderAlbumReviewPanel();
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
  const pendingStatus = pendingAlbumStatusChanges.get(card.code);
  const displayedStatus = pendingStatus || savedAlbumStatus(card);
  const isCollected = displayedStatus === "present";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "collectionCard";
  button.classList.toggle("collected", isCollected);
  button.classList.toggle("pending", Boolean(pendingStatus));
  button.classList.toggle("pendingPresent", pendingStatus === "present");
  button.classList.toggle("pendingMissing", pendingStatus === "missing");
  button.setAttribute("aria-pressed", String(isCollected));
  button.setAttribute("aria-label", `${card.label}, ${isCollected ? "present" : "missing"}${pendingStatus ? ", pending change" : ""}`);
  button.innerHTML = `<strong>${card.number}</strong><span>${cardStatusLabel(displayedStatus, pendingStatus)}</span>`;
  button.addEventListener("click", () => stageAlbumStatusFlip(card.code));
  return button;
}

function cardStatusLabel(status, pendingStatus) {
  if (pendingStatus === "present") return "Save present";
  if (pendingStatus === "missing") return "Save missing";
  return status === "present" ? "Present" : "Missing";
}

function savedAlbumStatus(card) {
  const override = state.albumStatusOverrides?.[card.code];
  if (["present", "missing"].includes(override)) return override;
  return card.missing ? "missing" : "present";
}

function baseAlbumStatus(code) {
  return baseCollectionModel().byCode?.[code]?.missing ? "missing" : "present";
}

function stageAlbumStatusFlip(code) {
  const card = currentCollectionModel().byCode?.[code];
  if (!card) return;
  const savedStatus = savedAlbumStatus(card);
  const currentStatus = pendingAlbumStatusChanges.get(code) || savedStatus;
  const nextStatus = currentStatus === "present" ? "missing" : "present";
  if (nextStatus === savedStatus) pendingAlbumStatusChanges.delete(code);
  else pendingAlbumStatusChanges.set(code, nextStatus);
  render();
  const count = pendingAlbumStatusChanges.size;
  status.textContent = count
    ? `${count} album status change${count === 1 ? "" : "s"} staged. Review and save below.`
    : "No album status changes staged.";
}

function renderAlbumReviewPanel() {
  const entries = pendingAlbumStatusEntries();
  albumReviewPanel.hidden = entries.length === 0;
  if (!entries.length) {
    albumReviewSummary.textContent = "";
    albumReviewList.replaceChildren();
    return;
  }
  const presentCount = entries.filter((entry) => entry.nextStatus === "present").length;
  const missingCount = entries.filter((entry) => entry.nextStatus === "missing").length;
  albumReviewSummary.textContent = [
    presentCount ? `${presentCount} to present` : "",
    missingCount ? `${missingCount} to missing` : "",
  ].filter(Boolean).join(" / ");
  albumReviewList.replaceChildren(...entries.map(albumReviewItem));
}

function pendingAlbumStatusEntries() {
  const model = currentCollectionModel();
  return [...pendingAlbumStatusChanges.entries()]
    .map(([code, nextStatus]) => {
      const card = model.byCode?.[code];
      if (!card) return null;
      return {
        code,
        card,
        currentStatus: savedAlbumStatus(card),
        nextStatus,
      };
    })
    .filter(Boolean)
    .sort((a, b) => cardAlbumRank(a.card) - cardAlbumRank(b.card) || sortCode(a.code, b.code));
}

function albumReviewItem(entry) {
  const item = document.createElement("li");
  item.className = entry.nextStatus === "present" ? "found" : "missing";
  item.textContent = `${entry.code}${entry.card.name ? ` - ${entry.card.name}` : ""} - ${entry.currentStatus} -> ${entry.nextStatus}`;
  return item;
}

function saveAlbumStatusChanges() {
  const entries = pendingAlbumStatusEntries();
  if (!entries.length) return;
  const overrides = { ...(state.albumStatusOverrides || {}) };
  for (const entry of entries) {
    const baseline = baseAlbumStatus(entry.code);
    if (entry.nextStatus === baseline) delete overrides[entry.code];
    else overrides[entry.code] = entry.nextStatus;
  }
  state = {
    ...state,
    albumStatusOverrides: Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => sortCode(a, b))),
    hasLocalState: true,
  };
  pendingAlbumStatusChanges = new Map();
  saveState();
  render();
  status.textContent = `${entries.length} album status change${entries.length === 1 ? "" : "s"} saved on this phone.`;
}

function albumInventoryUpdateCandidates() {
  return currentCollectionModel().cards
    .filter((card) => card.missing && card.inventory?.availableToTradeQuantity > 0)
    .sort((a, b) => cardAlbumRank(a) - cardAlbumRank(b) || sortCode(a.code, b.code));
}

function maybePromptAlbumInventoryUpdates() {
  if (albumInventoryCheckPrompted) return;
  const candidates = albumInventoryUpdateCandidates();
  if (!candidates.length) return;
  albumInventoryCheckPrompted = true;
  const preview = candidates.slice(0, ALBUM_UPDATE_PROMPT_LIMIT).map((card) => card.code).join(", ");
  const overflow = candidates.length > ALBUM_UPDATE_PROMPT_LIMIT ? `, plus ${candidates.length - ALBUM_UPDATE_PROMPT_LIMIT} more` : "";
  const confirmText = [
    `Found ${candidates.length} card${candidates.length === 1 ? "" : "s"} you need for the album in your inventory:`,
    `${preview}${overflow}.`,
    "",
    "Move them into the album now? This will remove one copy of each from Cards I Can Give and mark them present in the album.",
  ].join("\n");
  if (!window.confirm(confirmText)) {
    status.textContent = `${candidates.length} album-needed card${candidates.length === 1 ? "" : "s"} found in inventory. Not moved.`;
    return;
  }
  applyAlbumInventoryUpdates(candidates);
}

function applyAlbumInventoryUpdates(candidates) {
  const rawLines = candidates.map((card) => ({ code: card.code, quantity: 1 }));
  const outgoing = assignOutgoingVariants(rawLines, currentInventoryProjection().adjustedInventory);
  if (!outgoing.length) {
    status.textContent = "No album-needed inventory cards were available to move.";
    return;
  }
  const outgoingCodes = new Set(outgoing.map((line) => line.code));
  const overrides = { ...(state.albumStatusOverrides || {}) };
  for (const code of outgoingCodes) overrides[code] = "present";
  saveLedger(createTransaction(loadLedger(), { kind: "album-update", received: [], given: outgoing }));
  state = {
    ...state,
    albumStatusOverrides: Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => sortCode(a, b))),
    hasLocalState: true,
  };
  inventoryProjection = null;
  saveState();
  render();
  status.textContent = `Moved ${outgoing.length} needed card${outgoing.length === 1 ? "" : "s"} from inventory into the album.`;
}

function undoTransaction(transaction) {
  saveLedger(cancelTransaction(loadLedger(), transaction.id));
  if (transaction.kind === "album-update") {
    const overrides = { ...(state.albumStatusOverrides || {}) };
    for (const line of transaction.given || []) {
      const baseline = baseAlbumStatus(line.code);
      if (baseline === "missing" && overrides[line.code] === "present") delete overrides[line.code];
    }
    state = {
      ...state,
      albumStatusOverrides: Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => sortCode(a, b))),
      hasLocalState: true,
    };
    saveState();
  }
  inventoryProjection = null;
  render();
}

function cancelAlbumStatusChanges() {
  const count = pendingAlbumStatusChanges.size;
  pendingAlbumStatusChanges = new Map();
  render();
  status.textContent = count ? "Album status changes discarded." : "No album status changes to discard.";
}

function missingText() {
  const missing = currentCollectionModel().cards.filter((card) => card.missing);
  return missingListText(missing);
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
    gotCardsButton.textContent = "I got these cards";
    tradedAwayButton.textContent = "I traded them away";
    parsedBatchPreview.dataset.state = "empty";
    parsedBatchPreview.textContent = "Parsed preview appears here before anything changes.";
    return;
  }
  const occurrences = extractCodeOccurrences(value);
  if (!occurrences.size) {
    gotCardsButton.textContent = "I got these cards";
    tradedAwayButton.textContent = "I traded them away";
    parsedBatchPreview.dataset.state = "empty";
    parsedBatchPreview.textContent = "No card codes found yet.";
    return;
  }
  const tracked = trackedCodeSet();
  const lines = parsedLines(occurrences);
  const split = splitReceivedLines(lines);
  const trackedCount = tradeLineQuantityTotal([...split.added, ...split.ignored]);
  const newCount = tradeLineQuantityTotal(split.added);
  const duplicateCount = tradeLineQuantityTotal(split.ignored);
  const untrackedCount = tradeLineQuantityTotal(split.untracked);
  gotCardsButton.textContent = trackedCount ? `Record ${trackedCount} received` : "I got these cards";
  tradedAwayButton.textContent = trackedCount ? `Record ${trackedCount} traded away` : "I traded them away";
  parsedBatchPreview.dataset.state = trackedCount ? "ready" : "empty";
  const actionSummary = trackedCount
    ? `Action preview: received records ${trackedCount} card${trackedCount === 1 ? "" : "s"}${newCount ? `, marks ${newCount} new` : ""}${duplicateCount ? `, adds ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} to trade inventory` : ""}. Traded away removes matching cards from Cards I Can Give.`
    : "Action preview: no tracked card codes will change your inventory.";
  const ignoredText = untrackedCount ? ` ${untrackedCount} untracked card${untrackedCount === 1 ? "" : "s"} will be ignored.` : "";
  parsedBatchPreview.textContent = `${actionSummary}${ignoredText} Codes: ${[...occurrences.entries()].map(([code, quantity]) => {
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
      undo.addEventListener("click", () => undoTransaction(transaction));
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
  if (transaction.kind === "album-update") return transaction.label;
  if (transaction.kind === "trade") return `Trade · ${transaction.label}`;
  return transaction.label;
}

function createBackup() {
  backupText.value = JSON.stringify(buildCurrentBackupPayload(), null, 2);
  status.textContent = "Backup JSON created.";
}

function buildCurrentBackupPayload() {
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
  return buildBackupPayload({
    collectionState: state,
    ledger: loadLedger(),
    inventorySnapshot: backupSource.inventorySnapshot,
    inventoryCacheMeta: backupSource.inventoryCacheMeta,
    catalog: collectionCatalog,
  });
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
    inventoryProjection = null;
    try {
      render();
      loadSharedInventoryProjection();
      status.textContent = "Backup restored on this phone.";
    } catch {
      status.textContent = RESTORE_RENDER_FAILURE_MESSAGE;
    }
  } catch (error) {
    if (error?.message && failureMessage === DEFAULT_RESTORE_FAILURE_MESSAGE) failureMessage = error.message;
    status.textContent = failureMessage;
  }
}

function downloadBackup() {
  const { text, fileName } = currentBackupFileParts();
  backupText.value = text;
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  status.textContent = "Backup JSON downloaded.";
}

function currentBackupFileParts() {
  const text = JSON.stringify(buildCurrentBackupPayload(), null, 2);
  return {
    text,
    fileName: `fifa-sticker-backup-${new Date().toISOString().slice(0, 10)}.json`,
  };
}

async function shareBackup() {
  const { text, fileName } = currentBackupFileParts();
  backupText.value = text;
  const file = new File([text], fileName, { type: "application/json" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: "FIFA sticker backup",
        text: "FIFA sticker tracker backup JSON.",
        files: [file],
      });
      status.textContent = "Backup shared.";
      return;
    }
    if (navigator.share) {
      await navigator.share({
        title: "FIFA sticker backup",
        text,
      });
      status.textContent = "Backup shared as text.";
      return;
    }
    await navigator.clipboard.writeText(text);
    status.textContent = "Backup JSON copied. Paste it into a message or email.";
  } catch (error) {
    if (error?.name === "AbortError") {
      status.textContent = "Backup share cancelled.";
      return;
    }
    status.textContent = "Sharing is not available here. Use Download JSON or copy the generated backup text.";
  }
}

function emptyLocalInventorySnapshot() {
  const timestamp = new Date().toISOString();
  return {
    generated_at: timestamp,
    updated_at: timestamp,
    source: "local-only tracker",
    cards: {},
    stats: {
      unique_code_count: 0,
      matched_card_count: 0,
    },
  };
}

function chooseBackupFile() {
  backupFileInput.value = "";
  backupFileInput.click();
}

async function importBackupFile() {
  const [file] = backupFileInput.files || [];
  if (!file) return;
  try {
    backupText.value = await file.text();
    restoreBackup();
  } catch {
    status.textContent = "That backup file could not be read.";
  }
}

function startOwnTracker() {
  if (!window.confirm("Start a local-only tracker on this phone? Current local marks and trade activity will be cleared.")) return;
  state = { filter: "missing", sortOrder: state.sortOrder || "album", collected: [], albumStatusOverrides: {}, hasLocalState: true, importedCollectionSnapshotVersion: COLLECTION_SNAPSHOT_IMPORT_VERSION };
  pendingAlbumStatusChanges = new Map();
  inventorySnapshot = emptyLocalInventorySnapshot();
  inventoryProjection = null;
  saveState();
  saveLedger({ version: 1, transactions: [] });
  localStorage.setItem(INVENTORY_SNAPSHOT_KEY, JSON.stringify(inventorySnapshot));
  localStorage.setItem(INVENTORY_CACHE_META_KEY, JSON.stringify({
    cachedAt: inventorySnapshot.generated_at,
    sourceLabel: "local-only tracker",
  }));
  ensureActiveProfileId();
  localStorage.removeItem(TRADED_AWAY_KEY);
  searchInput.value = "";
  updateText.value = "";
  backupText.value = "";
  clearGotIgnoredNotice();
  clearTradedAwayIgnoredNotice();
  render();
  status.textContent = "Started a local-only tracker on this phone. Create a JSON backup after important changes.";
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

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.sortOrder = button.dataset.sortOrder;
    saveState();
    render();
  });
});

searchInput.addEventListener("input", render);
copyMissingButton.addEventListener("click", copyMissingList);
saveAlbumReviewButton.addEventListener("click", saveAlbumStatusChanges);
cancelAlbumReviewButton.addEventListener("click", cancelAlbumStatusChanges);
gotCardsButton.addEventListener("click", markGotCards);
tradedAwayButton.addEventListener("click", markTradedAway);
addIgnoredGotButton.addEventListener("click", addIgnoredGotCards);
addIgnoredTradedAwayButton.addEventListener("click", addIgnoredTradedAwayCards);
updateText.addEventListener("input", renderParsedPreview);
backupButton.addEventListener("click", createBackup);
shareBackupButton.addEventListener("click", shareBackup);
downloadBackupButton.addEventListener("click", downloadBackup);
importBackupButton.addEventListener("click", chooseBackupFile);
restoreButton.addEventListener("click", restoreBackup);
startLocalButton.addEventListener("click", startOwnTracker);
backupFileInput.addEventListener("change", importBackupFile);
window.addEventListener("panini:cloud-sync-applied", () => {
  state = loadState();
  try {
    inventoryProjection = null;
    inventorySnapshot = JSON.parse(localStorage.getItem(INVENTORY_SNAPSHOT_KEY) || "null") || inventorySnapshot;
  } catch {}
  render();
  loadSharedInventoryProjection();
  status.textContent = "Cloud backup changes applied on this browser.";
});
updateText.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") markGotCards();
});
resetButton.addEventListener("click", () => {
  if (!window.confirm("Reset all collection marks from this tracker? Traded-away activity stays recorded.")) return;
  state = { filter: "missing", sortOrder: state.sortOrder || "album", collected: [], albumStatusOverrides: {}, hasLocalState: true, importedCollectionSnapshotVersion: COLLECTION_SNAPSHOT_IMPORT_VERSION };
  pendingAlbumStatusChanges = new Map();
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
  inventoryProjection = null;
  render();
  loadSharedInventoryProjection();
});

render();
loadCatalogue();
renderStoragePersistenceStatus();
