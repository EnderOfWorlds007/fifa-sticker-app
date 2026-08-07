export const LEDGER_KEY = "panini.tradeTransactions.v1";
export const COLLECTION_KEY = "panini.collectionTracker.v1";
export const INVENTORY_SNAPSHOT_KEY = "panini.inventorySnapshot.v1";
export const INVENTORY_CACHE_META_KEY = "panini.inventorySnapshotMeta.v1";
export const LEGACY_TRADED_AWAY_KEY = "panini.tradeInventoryRemoved.v1";
const LEGACY_TRANSACTION_ID = "legacy_traded_away_v1";
const TRANSACTION_TRANSITIONS = {
  draft: new Set(["reserved", "completed", "cancelled"]),
  reserved: new Set(["draft", "completed", "cancelled"]),
  completed: new Set(["cancelled"]),
  cancelled: new Set(),
};

export function extractCodeOccurrences(value) {
  const upper = String(value || "").toUpperCase();
  const occurrences = new Map();
  const inlineSpans = [];
  const add = (team, number = "", suffix = "", quantity = 1) => {
    const code = normalizeCardCode(`${team}${number}${suffix}`);
    if (!code) return;
    occurrences.set(code, (occurrences.get(code) || 0) + Math.max(1, Number(quantity || 1)));
  };
  const zeroPattern = /(?<![A-Z0-9])00(?:\s*\(\s*(\d{1,2})\s*X\s*\))?(?![A-Z0-9])/g;
  for (const match of upper.matchAll(zeroPattern)) {
    add("00", "", "", match[1]);
    inlineSpans.push([match.index, match.index + match[0].length]);
  }
  const inlinePattern = /(?<![A-Z0-9])([A-Z]{2,3})\s*[-–—_./]?\s*([1-9]\d?)(S)?(?:\s*\(\s*(\d{1,2})\s*X\s*\))?(?![A-Z0-9])/g;
  for (const match of upper.matchAll(inlinePattern)) {
    add(match[1], match[2], match[3], match[4]);
    inlineSpans.push([match.index, match.index + match[0].length]);
  }
  const groupedPattern = /^\s*([A-Z]{2,3})\s*:\s*([1-9][0-9S\s,;/&+().X-]*)/gm;
  const groupedTokenPattern = /([1-9]\d?)(S)?(?:\s*\(\s*(\d{1,2})\s*X\s*\))?/g;
  for (const match of upper.matchAll(groupedPattern)) {
    const start = match.index;
    if (inlineSpans.some(([spanStart, spanEnd]) => spanStart <= start && start < spanEnd)) continue;
    for (const token of match[2].matchAll(groupedTokenPattern)) add(match[1], token[1], token[2], token[3]);
  }
  return new Map([...occurrences.entries()].sort(([a], [b]) => sortCode(a, b)));
}

export function extractDirectedCodeOccurrences(value) {
  const wants = new Map();
  const offers = new Map();
  const ambiguous = new Map();
  const chunks = splitDirectionalClauses(value);
  let carryDirection = null;
  for (const chunk of chunks) {
    const explicitDirection = directionForText(chunk);
    const occurrences = extractCodeOccurrences(chunk);
    if (!occurrences.size) {
      if (explicitDirection !== "ambiguous") carryDirection = explicitDirection;
      continue;
    }
    const direction = explicitDirection !== "ambiguous" ? explicitDirection : carryDirection || "ambiguous";
    carryDirection = explicitDirection !== "ambiguous" ? explicitDirection : null;
    const target = direction === "want" ? wants : direction === "offer" ? offers : ambiguous;
    for (const [code, quantity] of occurrences.entries()) {
      target.set(code, (target.get(code) || 0) + quantity);
    }
  }
  return {
    wants: sortOccurrenceMap(wants),
    offers: sortOccurrenceMap(offers),
    ambiguous: sortOccurrenceMap(ambiguous),
  };
}

export function sortCode(a, b) {
  const aCode = normalizeCardCode(a) || String(a || "").toUpperCase();
  const bCode = normalizeCardCode(b) || String(b || "").toUpperCase();
  if (aCode === "00") return bCode === "00" ? 0 : -1;
  if (bCode === "00") return 1;
  const aMatch = aCode.match(/^([A-Z]+)(\d+)(S)?$/);
  const bMatch = bCode.match(/^([A-Z]+)(\d+)(S)?$/);
  if (!aMatch || !bMatch) return String(a || "").localeCompare(String(b || ""));
  return aMatch[1].localeCompare(bMatch[1])
    || Number(aMatch[2]) - Number(bMatch[2])
    || String(aMatch[3] || "").localeCompare(String(bMatch[3] || ""));
}

export function normalizeLedger(value) {
  const transactions = Array.isArray(value?.transactions) ? value.transactions : [];
  return {
    schemaVersion: 1,
    transactions: transactions.map(normalizeTransaction).filter(Boolean),
  };
}

export function loadLedger(storage = globalThis.localStorage) {
  try {
    const ledger = normalizeLedger(JSON.parse(storage.getItem(LEDGER_KEY) || "{}"));
    return migrateLegacyTradedAway(ledger, storage);
  } catch {
    return { schemaVersion: 1, transactions: [] };
  }
}

export function saveLedger(ledger, storage = globalThis.localStorage) {
  storage.setItem(LEDGER_KEY, JSON.stringify(normalizeLedger(ledger)));
}

export function createTransaction(ledger, options) {
  const current = normalizeLedger(ledger);
  const transaction = normalizeTransaction({
    id: options.idFactory ? options.idFactory() : `txn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: options.now ? options.now() : new Date().toISOString(),
    kind: options.kind || "trade",
    status: options.status || "completed",
    received: options.received || [],
    given: options.given || [],
  });
  return {
    schemaVersion: 1,
    transactions: [...current.transactions, transaction],
  };
}

export function createTradeDraft(ledger, options = {}) {
  return createTransaction(ledger, {
    ...options,
    kind: "trade",
    status: "draft",
  });
}

export function transitionTransactionStatus(ledger, transactionId, status) {
  if (!["draft", "reserved", "completed", "cancelled"].includes(status)) {
    throw new Error(`Unsupported transaction status: ${status}`);
  }
  const current = normalizeLedger(ledger);
  const existing = current.transactions.find((transaction) => transaction.id === transactionId);
  if (!existing) throw new Error(`Transaction not found: ${transactionId}`);
  if (existing.status === status) return current;
  if (!TRANSACTION_TRANSITIONS[existing.status]?.has(status)) {
    throw new Error(`Illegal transition from ${existing.status} to ${status}`);
  }
  return {
    schemaVersion: 1,
    transactions: current.transactions.map((transaction) => (
      transaction.id === transactionId ? { ...transaction, status } : transaction
    )),
  };
}

export function updateTradeLines(ledger, transactionId, { received = [], given = [] } = {}) {
  const current = normalizeLedger(ledger);
  const existing = current.transactions.find((transaction) => transaction.id === transactionId);
  if (!existing) throw new Error(`Transaction not found: ${transactionId}`);
  if (existing.kind !== "trade") throw new Error(`Transaction is not a trade: ${transactionId}`);
  if (!["draft", "reserved"].includes(existing.status)) {
    throw new Error(`Cannot edit ${existing.status} trade.`);
  }
  const updated = {
    ...existing,
    received: normalizeLines(received),
    given: normalizeLines(given),
  };
  return {
    schemaVersion: 1,
    transactions: current.transactions.map((transaction) => (
      transaction.id === transactionId ? updated : transaction
    )),
  };
}

export function cancelTransaction(ledger, transactionId) {
  return transitionTransactionStatus(ledger, transactionId, "cancelled");
}

export function transactionSummary(ledger) {
  return normalizeLedger(ledger).transactions
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .map((transaction) => ({
      id: transaction.id,
      createdAt: transaction.createdAt,
      kind: transaction.kind,
      status: transaction.status,
      received: transaction.received,
      given: transaction.given,
      label: transactionLabel(transaction),
    }));
}

export function transactionDetailLines(transaction) {
  const details = [];
  const received = lineDetails(transaction?.received || []);
  const given = lineDetails(transaction?.given || []);
  if (received) details.push(`Receive: ${received}`);
  if (given) details.push(`Give: ${given}`);
  return details;
}

export function tradeGroups(ledger) {
  const groups = {
    draft: [],
    reserved: [],
    completed: [],
    cancelled: [],
  };
  for (const transaction of transactionSummary(ledger)) {
    if (transaction.kind !== "trade") continue;
    if (groups[transaction.status]) groups[transaction.status].push(transaction);
  }
  return groups;
}

export function tradeLineQuantityTotal(lines) {
  return normalizeLines(lines).reduce((sum, line) => sum + line.quantity, 0);
}

export function partitionOutgoingLinesByAvailability({ additions, existing = [], inventory } = {}) {
  const cards = inventory?.cards && typeof inventory.cards === "object" ? inventory.cards : {};
  const aliases = inventoryAliasMap(cards);
  const used = new Map();
  for (const line of normalizeLines(existing).map((item) => canonicalizeInventoryLine(item, aliases))) {
    used.set(line.code, (used.get(line.code) || 0) + line.quantity);
  }
  return normalizeLinesWithMetadata(additions).map((item) => canonicalizeInventoryLine(item, aliases)).reduce((result, line) => {
    const available = Math.max(0, Number(cards[line.code]?.count || 0));
    const remaining = Math.max(0, available - (used.get(line.code) || 0));
    const addableQuantity = Math.min(line.quantity, remaining);
    const ignoredQuantity = line.quantity - addableQuantity;
    if (addableQuantity > 0) {
      result.added.push({ ...line, quantity: addableQuantity });
      used.set(line.code, (used.get(line.code) || 0) + addableQuantity);
    }
    if (ignoredQuantity > 0) result.ignored.push({ ...line, quantity: ignoredQuantity });
    return result;
  }, { added: [], ignored: [] });
}

export function assignOutgoingVariants(lines, inventory, options = {}) {
  const preferredVariant = options.preferredVariant || "standard_fifa_licensed";
  const cards = inventory?.cards && typeof inventory.cards === "object" ? inventory.cards : {};
  const aliases = inventoryAliasMap(cards);
  const remainingByCode = new Map();
  const output = [];

  for (const line of normalizeLinesWithMetadata(lines).map((item) => canonicalizeInventoryLine(item, aliases))) {
    const card = cards[line.code];
    const counts = remainingVariantCounts(card?.back_insignia_counts, remainingByCode, line.code);
    if (line.variant || !counts.size) {
      output.push(line);
      if (line.variant && counts.has(line.variant)) {
        counts.set(line.variant, Math.max(0, counts.get(line.variant) - line.quantity));
      }
      continue;
    }

    let remaining = line.quantity;
    for (const variant of orderedVariants(counts, preferredVariant)) {
      if (remaining <= 0) break;
      const available = Math.max(0, counts.get(variant) || 0);
      if (!available) continue;
      const quantity = Math.min(remaining, available);
      output.push({ ...line, quantity, variant });
      counts.set(variant, available - quantity);
      remaining -= quantity;
    }
    if (remaining > 0) output.push({ ...line, quantity: remaining });
  }

  return output;
}

export function deriveCollectionCodes(legacyCollected, ledger) {
  const codes = new Set(Array.isArray(legacyCollected) ? legacyCollected : []);
  for (const transaction of normalizeLedger(ledger).transactions) {
    if (transaction.status !== "completed") continue;
    for (const line of transaction.received) {
      if (line.quantity > 0) codes.add(line.code);
    }
  }
  return codes;
}

export function deriveCollectionSummary(trackedCards, legacyCollected, ledger) {
  const found = deriveCollectionCodes(legacyCollected, ledger);
  const tracked = Array.isArray(trackedCards) ? trackedCards : [];
  const collectedCount = tracked.filter((card) => found.has(card.code)).length;
  const missingCards = tracked.filter((card) => !found.has(card.code));
  return {
    trackedCount: tracked.length,
    collectedCount,
    missingCount: missingCards.length,
    teamsRemainingCount: new Set(missingCards.map((card) => card.team)).size,
    progressPercent: tracked.length ? Math.round((collectedCount / tracked.length) * 100) : 0,
  };
}

export function deriveCollectionModel({ catalog, legacyCollected, ledger, inventory } = {}) {
  const cards = normalizeCatalogCards(catalog);
  const aliases = normalizeCatalogAliases(catalog);
  const ownership = completedReceivedTotals(ledger, aliases);
  const completedReceived = completedReceivedTotals(ledger, aliases);
  const completedGiven = completedGivenTotals(ledger, aliases);
  const reservedGiven = reservedGivenTotals(ledger, aliases);
  for (const code of Array.isArray(legacyCollected) ? legacyCollected : []) {
    const normalized = canonicalCardCode(code, aliases);
    if (normalized) ownership.set(normalized, Math.max(1, ownership.get(normalized) || 0));
  }

  const inventoryCards = inventory?.cards && typeof inventory.cards === "object" ? inventory.cards : {};
  const inventoryCounts = canonicalInventoryCounts(inventoryCards, aliases);
  const byCode = {};
  for (const card of cards) {
    const owned = ownership.get(card.code) || 0;
    const reserved = reservedGiven.get(card.code) || 0;
    const completedOut = completedGiven.get(card.code) || 0;
    const inventoryCount = inventoryCounts.get(card.code) || 0;
    const collection = {
      targetQuantity: 1,
      acquiredQuantity: owned,
      placedQuantity: Math.min(1, owned),
      missingQuantity: Math.max(0, 1 - Math.min(1, owned)),
      completedReceivedQuantity: completedReceived.get(card.code) || 0,
      manuallyCollected: Array.isArray(legacyCollected)
        ? legacyCollected.some((code) => canonicalCardCode(code, aliases) === card.code)
        : false,
    };
    const inventoryModel = {
      scannerBaselineQuantity: inventoryCount,
      completedGivenQuantity: completedOut,
      reservedQuantity: reserved,
      onHandQuantity: Math.max(0, inventoryCount - completedOut),
      availableToTradeQuantity: Math.max(0, inventoryCount - completedOut - reserved),
      overdrawQuantity: Math.max(0, completedOut + reserved - inventoryCount),
    };
    byCode[card.code] = {
      ...card,
      aliases: Object.entries(aliases)
        .filter(([, canonical]) => canonical === card.code)
        .map(([alias]) => alias),
      wanted: true,
      owned,
      missing: collection.missingQuantity > 0,
      duplicateCount: Math.max(0, owned - 1),
      reserved,
      completedGiven: completedOut,
      availableToTrade: inventoryModel.availableToTradeQuantity,
      inventoryCount,
      collection,
      inventory: inventoryModel,
    };
  }
  const list = Object.values(byCode).sort((a, b) => sortCode(a.code, b.code));
  const collectedCount = list.filter((card) => !card.missing).length;
  const missingCards = list.filter((card) => card.missing);
  return {
    cards: list,
    byCode,
    summary: {
      catalogCount: list.length,
      trackedCount: list.length,
      collectedCount,
      missingCount: missingCards.length,
      teamsRemainingCount: new Set(missingCards.map((card) => card.team)).size,
      progressPercent: list.length ? Math.round((collectedCount / list.length) * 100) : 0,
      duplicateCount: list.reduce((sum, card) => sum + card.duplicateCount, 0),
      reservedCount: list.reduce((sum, card) => sum + card.reserved, 0),
      availableToTradeCount: list.reduce((sum, card) => sum + card.inventory.availableToTradeQuantity, 0),
    },
  };
}

export function adjustedInventoryPayload(inventory, ledger, options = {}) {
  const aliases = normalizeCatalogAliases(options.catalog);
  const sourceCards = canonicalInventoryCards(
    inventory?.cards && typeof inventory.cards === "object" ? inventory.cards : {},
    aliases,
    options.catalog,
  );
  const given = activeOutgoingAdjustments(ledger, { ...options, aliases });
  const receivedLoose = completedLooseReceivedAdjustments(ledger, aliases, options.legacyCollected);
  const catalogueByCode = new Map(normalizeCatalogCards(options.catalog).map((card) => [card.code, card]));
  const cards = {};
  for (const [code, card] of Object.entries(sourceCards)) {
    const adjustment = given.get(code) || { total: 0, variants: new Map() };
    const removed = adjustment.total;
    const originalCount = Math.max(0, Number(card?.count || 0));
    const nextCount = Math.max(0, originalCount - removed);
    if (!nextCount) continue;
    cards[code] = {
      ...card,
      count: nextCount,
    };
    if (card?.back_insignia_counts) {
      cards[code].back_insignia_counts = adjustColourCounts(card.back_insignia_counts, adjustment);
      cards[code].back_insignia_type = colourTypeFromCounts(cards[code].back_insignia_counts, card.back_insignia_type);
    }
  }
  for (const [code, adjustment] of receivedLoose.entries()) {
    const current = cards[code] || {
      ...(catalogueByCode.get(code) || {}),
      code,
      count: 0,
      back_insignia_counts: {},
    };
    current.count = Math.max(0, Number(current.count || 0)) + adjustment.total;
    for (const [variant, quantity] of adjustment.variants.entries()) {
      current.back_insignia_counts[variant] = Math.max(0, Number(current.back_insignia_counts[variant] || 0)) + quantity;
    }
    current.back_insignia_type = colourTypeFromCounts(current.back_insignia_counts, current.back_insignia_type);
    if (!Object.keys(current.back_insignia_counts).length) delete current.back_insignia_counts;
    cards[code] = current;
  }
  const captures = Array.isArray(inventory?.captures) ? inventory.captures : [];
  return {
    ...(inventory || {}),
    cards,
    stats: {
      ...(inventory?.stats || {}),
      session_count: inventory?.stats?.session_count ?? new Set(captures.map((item) => item?.session_id).filter(Boolean)).size,
      photo_count: inventory?.stats?.photo_count ?? captures.length,
      unique_code_count: Object.keys(cards).length,
      matched_card_count: Object.values(cards).reduce((sum, card) => sum + Number(card.count || 0), 0),
      adjusted: true,
    },
  };
}

export function adjustedInventoryCsv(inventory) {
  const cards = inventory?.cards && typeof inventory.cards === "object" ? inventory.cards : {};
  const rows = [
    ["code", "count", "team", "name", "back_insignia_type", "back_insignia_counts"],
    ...Object.values(cards)
      .sort((a, b) => sortCode(a?.code, b?.code))
      .map((card) => [
        card?.code || "",
        Number(card?.count || 0),
        card?.team || "",
        card?.name || "",
        card?.back_insignia_type || "",
        JSON.stringify(card?.back_insignia_counts || {}),
      ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export function inventoryFreshnessSummary({ sourceLabel, payload, cacheMeta } = {}) {
  const source = sourceLabel || "inventory source";
  const snapshotAt = formatIsoMinute(payload?.updated_at || payload?.generated_at || payload?.stats?.updated_at);
  const cachedAt = formatIsoMinute(cacheMeta?.cachedAt);
  const detail = cachedAt ? `Cached on this phone ${cachedAt}.` : "Not cached on this phone yet.";
  return {
    title: snapshotAt ? `${source} · snapshot ${snapshotAt}` : source,
    detail: [detail, stocktakeSummary(payload)].filter(Boolean).join(" "),
  };
}

export function storagePersistenceSummary({ persisted, canPersist } = {}) {
  if (persisted) {
    return {
      severity: "ok",
      title: "Storage protected",
      detail: "Browser says local collection, trades, and cached inventory are protected from automatic cleanup.",
    };
  }
  if (canPersist) {
    return {
      severity: "warning",
      title: "Storage not protected",
      detail: "Create a JSON backup before clearing browser data, changing phones, or relying on offline use.",
    };
  }
  return {
    severity: "warning",
    title: "Storage protection unavailable",
    detail: "This browser may clear local app data. Keep a JSON backup after important trades.",
  };
}

export function tradeAvailabilityIssues(givenLines, adjustedInventory) {
  const cards = adjustedInventory?.cards && typeof adjustedInventory.cards === "object" ? adjustedInventory.cards : {};
  const aliases = inventoryAliasMap(cards);
  const issues = [];
  for (const request of aggregateLineRequests(normalizeLines(givenLines).map((item) => canonicalizeInventoryLine(item, aliases))).values()) {
    const card = cards[request.code];
    const available = Math.max(0, Number(card?.count || 0));
    const variantCounts = positiveVariantCounts(card?.back_insignia_counts);
    if (request.total > available) {
      issues.push({ code: request.code, type: "overdraw", requested: request.total, available });
      continue;
    }
    for (const [variant, quantity] of request.variants.entries()) {
      if (card?.back_insignia_counts && Number(card.back_insignia_counts[variant] || 0) <= 0) {
        issues.push({ code: request.code, type: "invalid_variant", variant });
        continue;
      }
      const variantAvailable = card?.back_insignia_counts ? Math.max(0, Number(card.back_insignia_counts[variant] || 0)) : available;
      if (quantity > variantAvailable) {
        issues.push({ code: request.code, type: "overdraw", requested: quantity, available: variantAvailable, variant });
      }
    }
    if (request.plainQuantity > 0 && variantCounts.length > 1) {
      issues.push({ code: request.code, type: "variant_required", variants: variantCounts.map(([variant]) => variant) });
    }
  }
  return issues.sort((a, b) => sortCode(a.code, b.code) || String(a.type).localeCompare(String(b.type)));
}

export function tradeIssueSummary(issues, options = {}) {
  const list = Array.isArray(issues) ? issues : [];
  if (options.checked === false) {
    return {
      severity: "checking",
      title: "Checking availability",
      detail: "Outgoing card availability will be checked when inventory loads.",
    };
  }
  if (!list.length) {
    return {
      severity: "ok",
      title: "Ready to trade",
      detail: "Outgoing cards are available.",
    };
  }
  return {
    severity: "blocked",
    title: `${list.length} outgoing ${list.length === 1 ? "issue" : "issues"}`,
    detail: `${list.map(formatTradeIssue).join("; ")}.`,
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatIsoMinute(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function stocktakeSummary(payload) {
  const stocktake = payload?.stocktake;
  if (!stocktake || stocktake.mode !== "latest_inventory_session") return "";
  const eligibleSessions = Number(stocktake.eligible_session_count || 0);
  return eligibleSessions > 1
    ? `Latest scanner stocktake; ${eligibleSessions} inventory sessions kept as evidence.`
    : "Latest scanner stocktake.";
}

function formatTradeIssue(issue) {
  if (issue.type === "variant_required") {
    return `${issue.code} needs ${issue.variants.map(variantLabel).join(" or ")}`;
  }
  if (issue.type === "invalid_variant") {
    return `${issue.code} has no ${variantLabel(issue.variant)} copy available`;
  }
  return `${issue.code} needs ${issue.requested} but only ${issue.available} is available`;
}

export function variantLabel(value) {
  const labels = {
    standard_fifa_licensed: "Blue",
    united_edition: "Green",
  };
  if (labels[value]) return labels[value];
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function compareParsedCodes(occurrences, adjustedInventory, missingCodes) {
  const cards = adjustedInventory?.cards && typeof adjustedInventory.cards === "object" ? adjustedInventory.cards : {};
  const aliases = inventoryAliasMap(cards);
  const missing = missingCodes instanceof Set ? missingCodes : new Set(missingCodes || []);
  const canGive = [];
  const needFromThem = [];
  const other = [];
  for (const [rawCode, mentions] of [...occurrences.entries()].sort(([a], [b]) => sortCode(a, b))) {
    const code = aliases[rawCode] || rawCode;
    const card = cards[code];
    const row = {
      code,
      mentions,
      available: card ? Number(card.count || 0) : 0,
      needed: missing.has(code),
      card: card || null,
    };
    if (row.available > 0) canGive.push(row);
    if (row.needed) needFromThem.push(row);
    if (row.available <= 0 && !row.needed) other.push(row);
  }
  return { canGive, needFromThem, other };
}

export function mergeCompareResults(giveResult, needResult, ambiguousResult, hasDirectedSections) {
  const canGive = uniqueRows(giveResult?.canGive || []);
  const needFromThem = uniqueRows(needResult?.needFromThem || []);
  const shown = new Set([...canGive, ...needFromThem].map((item) => item.code));
  const candidateOther = [
    ...(giveResult?.other || []),
    ...(needResult?.other || []),
    ...(hasDirectedSections ? (ambiguousResult?.other || []) : []),
  ];
  return {
    canGive,
    needFromThem,
    other: uniqueRows(candidateOther.filter((item) => !shown.has(item.code))),
  };
}

export function buildBackupPayload({ collectionState, ledger, inventorySnapshot, inventoryCacheMeta, catalog, now } = {}) {
  const normalizedInventorySnapshot = inventorySnapshot && typeof inventorySnapshot === "object" && !Array.isArray(inventorySnapshot)
    ? inventorySnapshot
    : {};
  return {
    schemaVersion: 1,
    exportedAt: now ? now() : new Date().toISOString(),
    collectionState: normalizeCollectionState(collectionState),
    ledger: normalizeLedger(ledger),
    inventorySnapshot: normalizedInventorySnapshot,
    inventoryCacheMeta: isRestorableInventorySnapshot(normalizedInventorySnapshot)
      ? normalizeInventoryCacheMeta(inventoryCacheMeta)
      : {},
    catalogIdentity: normalizeCatalogIdentity(catalog),
  };
}

export function parseBackupPayload(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.schemaVersion !== 1) {
    throw new Error("Unsupported backup schema.");
  }
  if (!parsed.collectionState || typeof parsed.collectionState !== "object") {
    throw new Error("Backup missing collectionState.");
  }
  if (!parsed.ledger || typeof parsed.ledger !== "object" || !Array.isArray(parsed.ledger.transactions)) {
    throw new Error("Backup missing ledger transactions.");
  }
  if (!parsed.inventorySnapshot || typeof parsed.inventorySnapshot !== "object" || Array.isArray(parsed.inventorySnapshot)) {
    throw new Error("Backup missing inventorySnapshot.");
  }
  validateBackupLedger(parsed.ledger);
  return buildBackupPayload({
    collectionState: parsed.collectionState,
    ledger: parsed.ledger,
    inventorySnapshot: parsed.inventorySnapshot,
    inventoryCacheMeta: parsed.inventoryCacheMeta,
    catalog: parsed.catalogIdentity,
    now: () => parsed.exportedAt || new Date().toISOString(),
  });
}

function validateBackupLedger(ledger) {
  for (const transaction of ledger.transactions) {
    if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
      throw new Error("Backup contains invalid transaction.");
    }
    if (typeof transaction.id !== "string" || !transaction.id.trim()) {
      throw new Error("Backup transaction missing id.");
    }
    if (typeof transaction.createdAt !== "string" || !transaction.createdAt.trim()) {
      throw new Error("Backup transaction missing createdAt.");
    }
    if (!["received", "given", "trade"].includes(transaction.kind)) {
      throw new Error(`Unsupported transaction kind: ${transaction.kind}`);
    }
    if (!["draft", "reserved", "completed", "cancelled"].includes(transaction.status)) {
      throw new Error(`Unsupported transaction status: ${transaction.status}`);
    }
    validateBackupLines(transaction.received, "received");
    validateBackupLines(transaction.given, "given");
  }
}

function validateBackupLines(lines, field) {
  if (!Array.isArray(lines)) throw new Error(`Backup transaction missing ${field} lines.`);
  for (const line of lines) {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw new Error(`Invalid transaction line in ${field}.`);
    }
    if (!normalizeCardCode(line.code)) throw new Error(`Invalid transaction line code in ${field}.`);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || Math.floor(quantity) !== quantity) {
      throw new Error(`Invalid transaction line quantity in ${field}.`);
    }
    if (line.variant !== undefined && (typeof line.variant !== "string" || !line.variant.trim())) {
      throw new Error(`Invalid transaction line variant in ${field}.`);
    }
  }
}

export function planBackupRestore(payload, previous = {}) {
  const catalogCompatibility = compareCatalogIdentity(payload?.catalogIdentity, previous.catalog);
  if (catalogCompatibility.status === "mismatch") {
    throw new Error(`Backup catalogue does not match this app catalogue: ${catalogCompatibility.reason}.`);
  }
  const inventorySnapshot = isRestorableInventorySnapshot(payload?.inventorySnapshot) ? payload.inventorySnapshot : null;
  return {
    collectionState: normalizeCollectionState(payload?.collectionState),
    ledger: normalizeLedger(payload?.ledger),
    inventorySnapshot,
    inventoryCacheMeta: inventorySnapshot ? normalizeInventoryCacheMeta(payload?.inventoryCacheMeta) : {},
    catalogCompatibility,
    shouldPreserveInventory: !inventorySnapshot,
  };
}

export function planBackupSource({ storedInventorySnapshot, liveInventorySnapshot, inventoryCacheMeta } = {}) {
  if (isRestorableInventorySnapshot(storedInventorySnapshot)) {
    return {
      inventorySnapshot: storedInventorySnapshot,
      inventoryCacheMeta: normalizeInventoryCacheMeta(inventoryCacheMeta),
    };
  }
  if (isRestorableInventorySnapshot(liveInventorySnapshot)) {
    return {
      inventorySnapshot: liveInventorySnapshot,
      inventoryCacheMeta: {},
    };
  }
  return {
    inventorySnapshot: {},
    inventoryCacheMeta: {},
  };
}

export function isRestorableInventorySnapshot(snapshot) {
  return Boolean(
    snapshot
      && typeof snapshot === "object"
      && !Array.isArray(snapshot)
      && snapshot.cards
      && typeof snapshot.cards === "object"
      && !Array.isArray(snapshot.cards),
  );
}

function normalizeInventoryCacheMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const normalized = {};
  const cachedAt = typeof meta.cachedAt === "string" ? meta.cachedAt : "";
  if (cachedAt && !Number.isNaN(Date.parse(cachedAt))) normalized.cachedAt = cachedAt;
  const sourceLabel = typeof meta.sourceLabel === "string" ? meta.sourceLabel.trim() : "";
  if (sourceLabel) normalized.sourceLabel = sourceLabel;
  return normalized;
}

function normalizeCatalogIdentity(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return null;
  const identity = {};
  if (Number(catalog.schemaVersion || catalog.schema_version) > 0) {
    identity.schemaVersion = Number(catalog.schemaVersion || catalog.schema_version);
  }
  for (const [from, to] of [["source", "source"], ["edition", "edition"]]) {
    const value = typeof catalog[from] === "string" ? catalog[from].trim() : "";
    if (value) identity[to] = value;
  }
  for (const [from, to] of [
    ["count", "count"],
    ["canonical_count", "canonicalCount"],
    ["canonicalCount", "canonicalCount"],
    ["alias_count", "aliasCount"],
    ["aliasCount", "aliasCount"],
  ]) {
    const value = Number(catalog[from]);
    if (Number.isFinite(value) && value >= 0 && identity[to] === undefined) identity[to] = value;
  }
  return Object.keys(identity).length ? identity : null;
}

function compareCatalogIdentity(backupCatalog, activeCatalog) {
  const backup = normalizeCatalogIdentity(backupCatalog);
  const active = normalizeCatalogIdentity(activeCatalog);
  if (!backup || !active) {
    return {
      status: "unknown",
      backup,
      active,
      reason: !backup ? "backup has no catalogue identity" : "active catalogue has no identity",
    };
  }
  for (const key of ["source", "edition", "canonicalCount", "aliasCount"]) {
    if (backup[key] !== undefined && active[key] !== undefined && backup[key] !== active[key]) {
      return {
        status: "mismatch",
        backup,
        active,
        reason: `${key} differs`,
      };
    }
  }
  return { status: "matched", backup, active };
}

function migrateLegacyTradedAway(ledger, storage) {
  if (!storage?.getItem || !storage?.setItem) return ledger;
  let legacy = null;
  try {
    legacy = JSON.parse(storage.getItem(LEGACY_TRADED_AWAY_KEY) || "{}");
  } catch {
    legacy = null;
  }
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy) || !Object.keys(legacy).length) {
    return ledger;
  }
  const alreadyMigrated = ledger.transactions.some((transaction) => transaction.id === LEGACY_TRANSACTION_ID);
  if (alreadyMigrated) {
    if (storage.removeItem) storage.removeItem(LEGACY_TRADED_AWAY_KEY);
    return ledger;
  }
  const given = Object.entries(legacy)
    .map(([code, quantity]) => ({ code: String(code).toUpperCase(), quantity: Number(quantity || 0) }))
    .filter((line) => /^[A-Z]{2,3}\d{1,2}$/.test(line.code) && line.quantity > 0)
    .sort((a, b) => sortCode(a.code, b.code));
  if (!given.length) return ledger;
  const migrated = {
    schemaVersion: 1,
    transactions: [
      ...ledger.transactions,
      {
        id: LEGACY_TRANSACTION_ID,
        createdAt: "2026-08-04T00:00:00.000Z",
        kind: "given",
        status: "completed",
        received: [],
        given,
      },
    ],
  };
  storage.setItem(LEDGER_KEY, JSON.stringify(migrated));
  if (storage.removeItem) storage.removeItem(LEGACY_TRADED_AWAY_KEY);
  return migrated;
}

function directionForText(text) {
  const lower = text.toLowerCase();
  if (/\b(i|we|they)?\s*(can\s+offer|can\s+give|offer|offering|have|available|for trade)\b/.test(lower)) {
    return "offer";
  }
  if (/\b(i|we|they)?\s*(need|needs|want|wants|missing|looking for|lf)\b/.test(lower)) {
    return "want";
  }
  return "ambiguous";
}

function splitDirectionalClauses(value) {
  return String(value || "")
    .split(/[\n.;]+/)
    .flatMap((chunk) => chunk.split(/\b(?:and|but)\s+(?=(?:i|we|they)?\s*(?:can\s+offer|can\s+give|offer|offering|have|available|for trade|need|needs|want|wants|missing|looking for|lf)\b)/i))
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function sortOccurrenceMap(map) {
  return new Map([...map.entries()].sort(([a], [b]) => sortCode(a, b)));
}

function uniqueRows(rows) {
  const byCode = new Map();
  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, row);
  }
  return [...byCode.values()].sort((a, b) => sortCode(a.code, b.code));
}

function normalizeCollectionState(value) {
  return {
    filter: ["missing", "all", "collected"].includes(value?.filter) ? value.filter : "missing",
    collected: Array.isArray(value?.collected) ? [...new Set(value.collected)].sort(sortCode) : [],
  };
}

function normalizeTransaction(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: String(value.id || `txn_${Date.now().toString(36)}`),
    createdAt: String(value.createdAt || new Date().toISOString()),
    kind: ["received", "given", "trade"].includes(value.kind) ? value.kind : "trade",
    status: ["draft", "reserved", "completed", "cancelled"].includes(value.status) ? value.status : "completed",
    received: normalizeLines(value.received),
    given: normalizeLines(value.given),
  };
}

function normalizeCardCode(value) {
  const text = String(value || "").replace(/[\s\-–—_./]/g, "").toUpperCase();
  if (text === "00") return "00";
  const match = text.match(/^([A-Z]{2,3})(\d{1,2})(S)?$/);
  if (!match) return "";
  return `${match[1]}${Number(match[2])}${match[3] || ""}`;
}

function normalizeCatalogCards(catalog) {
  const rows = Array.isArray(catalog)
    ? catalog
    : Array.isArray(catalog?.cards)
      ? catalog.cards
      : Array.isArray(catalog?.stickers)
        ? catalog.stickers
        : [];
  const byCode = new Map();
  for (const row of rows) {
    const code = normalizeCardCode(row?.code);
    if (!code || byCode.has(code)) continue;
    byCode.set(code, {
      ...row,
      code,
      team: String(row?.team || "").trim(),
      name: String(row?.name || "").trim(),
    });
  }
  return [...byCode.values()].sort((a, b) => sortCode(a.code, b.code));
}

function normalizeCatalogAliases(catalog) {
  const aliases = catalog?.aliases && typeof catalog.aliases === "object" ? catalog.aliases : {};
  return Object.fromEntries(Object.entries(aliases)
    .map(([alias, canonical]) => [normalizeCardCode(alias), normalizeCardCode(canonical)])
    .filter(([alias, canonical]) => alias && canonical));
}

function canonicalCardCode(value, aliases = {}) {
  const code = normalizeCardCode(value);
  return aliases[code] || code;
}

function inventoryAliasMap(cards) {
  const aliases = {};
  for (const [code, card] of Object.entries(cards || {})) {
    aliases[code] = code;
    for (const alias of Array.isArray(card?.aliases) ? card.aliases : []) {
      const normalized = normalizeCardCode(alias);
      if (normalized) aliases[normalized] = code;
    }
  }
  return aliases;
}

function canonicalizeInventoryLine(line, aliases) {
  const code = aliases[line.code] || line.code;
  return code === line.code ? line : { ...line, code };
}

function canonicalInventoryCounts(cards, aliases = {}) {
  const totals = new Map();
  for (const [rawCode, card] of Object.entries(cards || {})) {
    const code = canonicalCardCode(rawCode, aliases);
    if (!code) continue;
    totals.set(code, (totals.get(code) || 0) + Math.max(0, Number(card?.count || 0)));
  }
  return totals;
}

function canonicalInventoryCards(cards, aliases = {}, catalog) {
  const catalogueByCode = new Map(normalizeCatalogCards(catalog).map((card) => [card.code, card]));
  const merged = {};
  for (const [rawCode, card] of Object.entries(cards || {})) {
    const code = canonicalCardCode(rawCode, aliases);
    if (!code) continue;
    const catalogueCard = catalogueByCode.get(code) || {};
    const current = merged[code] || {
      ...card,
      ...catalogueCard,
      code,
      count: 0,
      aliases: [],
      captures: [],
      back_insignia_counts: {},
    };
    current.count = Math.max(0, Number(current.count || 0)) + Math.max(0, Number(card?.count || 0));
    if (rawCode !== code && !current.aliases.includes(rawCode)) current.aliases.push(rawCode);
    if (Array.isArray(card?.aliases)) {
      for (const alias of card.aliases) if (!current.aliases.includes(alias)) current.aliases.push(alias);
    }
    if (Array.isArray(card?.captures)) current.captures.push(...card.captures);
    if (card?.back_insignia_counts && typeof card.back_insignia_counts === "object") {
      for (const [variant, quantity] of Object.entries(card.back_insignia_counts)) {
        current.back_insignia_counts[variant] = Math.max(0, Number(current.back_insignia_counts[variant] || 0))
          + Math.max(0, Number(quantity || 0));
      }
    }
    current.back_insignia_type = colourTypeFromCounts(current.back_insignia_counts, card?.back_insignia_type || current.back_insignia_type);
    merged[code] = current;
  }
  for (const card of Object.values(merged)) {
    card.aliases.sort(sortCode);
    if (!card.aliases.length) delete card.aliases;
    if (!card.captures.length) delete card.captures;
    if (!Object.keys(card.back_insignia_counts).length) delete card.back_insignia_counts;
  }
  return merged;
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => {
    const normalized = {
      code: normalizeCardCode(line?.code),
      quantity: normalizeQuantity(line?.quantity),
    };
    if (typeof line?.variant === "string" && line.variant.trim()) {
      normalized.variant = line.variant.trim();
    }
    return normalized;
  }).filter((line) => line.code);
}

function normalizeLinesWithMetadata(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => {
    const normalized = {
      ...line,
      code: normalizeCardCode(line?.code),
      quantity: normalizeQuantity(line?.quantity),
    };
    if (typeof line?.variant === "string" && line.variant.trim()) {
      normalized.variant = line.variant.trim();
    } else {
      delete normalized.variant;
    }
    return normalized;
  }).filter((line) => line.code);
}

function lineDetails(lines) {
  const normalized = normalizeLines(lines);
  if (!normalized.length) return "";
  return normalized.map((line) => {
    const quantity = line.quantity > 1 ? ` x${line.quantity}` : "";
    const variant = line.variant ? ` ${variantLabel(line.variant)}` : "";
    return `${line.code}${quantity}${variant}`;
  }).join(", ");
}

function completedReceivedTotals(ledger, aliases = {}) {
  const totals = new Map();
  for (const transaction of normalizeLedger(ledger).transactions) {
    if (transaction.status !== "completed") continue;
    for (const line of transaction.received || []) {
      const code = canonicalCardCode(line.code, aliases);
      totals.set(code, (totals.get(code) || 0) + line.quantity);
    }
  }
  return totals;
}

function completedGivenTotals(ledger, aliases = {}) {
  const totals = new Map();
  for (const transaction of normalizeLedger(ledger).transactions) {
    if (transaction.status !== "completed") continue;
    for (const line of transaction.given || []) {
      const code = canonicalCardCode(line.code, aliases);
      totals.set(code, (totals.get(code) || 0) + line.quantity);
    }
  }
  return totals;
}

function reservedGivenTotals(ledger, aliases = {}) {
  const totals = new Map();
  for (const transaction of normalizeLedger(ledger).transactions) {
    if (transaction.status !== "reserved") continue;
    for (const line of transaction.given || []) {
      const code = canonicalCardCode(line.code, aliases);
      totals.set(code, (totals.get(code) || 0) + line.quantity);
    }
  }
  return totals;
}

function completedLooseReceivedAdjustments(ledger, aliases = {}, legacyCollected = []) {
  const received = new Map();
  for (const transaction of normalizeLedger(ledger).transactions) {
    if (transaction.status !== "completed") continue;
    for (const line of transaction.received || []) {
      const code = canonicalCardCode(line.code, aliases);
      const current = received.get(code) || { total: 0, variants: new Map() };
      current.total += line.quantity;
      if (line.variant) current.variants.set(line.variant, (current.variants.get(line.variant) || 0) + line.quantity);
      received.set(code, current);
    }
  }
  const legacy = new Set(Array.isArray(legacyCollected)
    ? legacyCollected.map((code) => canonicalCardCode(code, aliases)).filter(Boolean)
    : []);
  const loose = new Map();
  for (const [code, adjustment] of received.entries()) {
    const albumSlotsFilledByReceived = legacy.has(code) ? 0 : Math.min(1, adjustment.total);
    const total = Math.max(0, adjustment.total - albumSlotsFilledByReceived);
    if (!total) continue;
    const variants = new Map(adjustment.variants);
    let remainingAlbumSlots = albumSlotsFilledByReceived;
    for (const [variant, quantity] of [...variants.entries()]) {
      if (remainingAlbumSlots <= 0) break;
      const take = Math.min(quantity, remainingAlbumSlots);
      const next = quantity - take;
      if (next > 0) variants.set(variant, next);
      else variants.delete(variant);
      remainingAlbumSlots -= take;
    }
    loose.set(code, { total, variants });
  }
  return loose;
}

function normalizeQuantity(value) {
  const quantity = Number(value || 1);
  return Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
}

function activeOutgoingAdjustments(ledger, options = {}) {
  const totals = new Map();
  const aliases = options.aliases || normalizeCatalogAliases(options.catalog);
  for (const transaction of normalizeLedger(ledger).transactions) {
    if (!["reserved", "completed"].includes(transaction.status)) continue;
    if (options.excludeTransactionId && transaction.id === options.excludeTransactionId) continue;
    for (const line of transaction.given || []) {
      const code = canonicalCardCode(line.code, aliases);
      const current = totals.get(code) || { total: 0, variants: new Map() };
      current.total += line.quantity;
      if (line.variant) current.variants.set(line.variant, (current.variants.get(line.variant) || 0) + line.quantity);
      totals.set(code, current);
    }
  }
  return totals;
}

function aggregateLineRequests(lines) {
  const requests = new Map();
  for (const line of lines) {
    const request = requests.get(line.code) || {
      code: line.code,
      total: 0,
      plainQuantity: 0,
      variants: new Map(),
    };
    request.total += line.quantity;
    if (line.variant) {
      request.variants.set(line.variant, (request.variants.get(line.variant) || 0) + line.quantity);
    } else {
      request.plainQuantity += line.quantity;
    }
    requests.set(line.code, request);
  }
  return requests;
}

function adjustColourCounts(counts, adjustment) {
  const removed = Number(adjustment?.total || 0);
  if (!counts || typeof counts !== "object" || removed <= 0) return counts;
  const adjusted = { ...counts };
  let remaining = removed;
  for (const [variant, quantity] of adjustment.variants || []) {
    const value = Math.max(0, Number(adjusted[variant] || 0));
    const take = Math.min(value, quantity);
    adjusted[variant] = value - take;
    remaining -= take;
  }
  for (const key of ["standard_fifa_licensed", "united_edition", "no_clue"]) {
    if (remaining <= 0) break;
    const value = Math.max(0, Number(adjusted[key] || 0));
    const take = Math.min(value, remaining);
    adjusted[key] = value - take;
    remaining -= take;
  }
  return adjusted;
}

function colourTypeFromCounts(counts, fallback = "") {
  const variants = positiveVariantCounts(counts).map(([variant]) => variant);
  if (!variants.length) return fallback || "";
  if (variants.length === 1) return variants[0];
  return "mixed";
}

function remainingVariantCounts(sourceCounts, cache, code) {
  if (!cache.has(code)) {
    cache.set(code, new Map(positiveVariantCounts(sourceCounts).map(([variant, quantity]) => [
      variant,
      Math.max(0, Number(quantity || 0)),
    ])));
  }
  return cache.get(code);
}

function orderedVariants(counts, preferredVariant) {
  const preferred = [preferredVariant, "united_edition", "standard_fifa_licensed", "no_clue"];
  const seen = new Set();
  const ordered = [];
  for (const variant of preferred) {
    if (counts.has(variant) && !seen.has(variant)) {
      ordered.push(variant);
      seen.add(variant);
    }
  }
  for (const variant of [...counts.keys()].sort()) {
    if (!seen.has(variant)) ordered.push(variant);
  }
  return ordered;
}

function positiveVariantCounts(counts) {
  if (!counts || typeof counts !== "object") return [];
  return Object.entries(counts).filter(([, quantity]) => Number(quantity || 0) > 0);
}

function transactionLabel(transaction) {
  const received = transaction.received.reduce((sum, line) => sum + line.quantity, 0);
  const given = transaction.given.reduce((sum, line) => sum + line.quantity, 0);
  if (received && given) return `Received ${received}, gave ${given}`;
  if (received) return `Received ${received}`;
  if (given) return `Gave ${given}`;
  return "No card changes";
}
