export function createCatalogCodeResolver(catalog = {}) {
  const canonical = new Map();
  const cards = Array.isArray(catalog)
    ? catalog
    : Array.isArray(catalog?.cards)
      ? catalog.cards
      : Array.isArray(catalog?.stickers)
        ? catalog.stickers
        : [];
  for (const card of cards) {
    const code = normalizeCatalogCode(card?.code);
    if (code) canonical.set(code, code);
  }
  const aliases = catalog?.aliases && typeof catalog.aliases === "object" ? catalog.aliases : {};
  for (const [rawAlias, rawCode] of Object.entries(aliases)) {
    const alias = normalizeCatalogCode(rawAlias);
    const code = normalizeCatalogCode(rawCode);
    if (alias && canonical.has(code)) canonical.set(alias, code);
  }
  return Object.freeze({
    resolve(value) {
      return canonical.get(normalizeCatalogCode(value)) || "";
    },
    has(value) {
      return Boolean(canonical.get(normalizeCatalogCode(value)));
    },
    get size() {
      return canonical.size;
    },
  });
}

export function catalogHasCards(catalog) {
  return createCatalogCodeResolver(catalog).size > 0;
}

export function partitionCatalogCodes(codes, catalog) {
  const resolver = createCatalogCodeResolver(catalog);
  const accepted = [];
  const rejected = [];
  for (const rawCode of Array.isArray(codes) ? codes : []) {
    const normalized = normalizeCatalogCode(rawCode);
    const code = resolver.resolve(normalized);
    if (code) accepted.push(code);
    else if (normalized) rejected.push(normalized);
  }
  return { accepted, rejected };
}

export function partitionCatalogOccurrences(occurrences, catalog) {
  const resolver = createCatalogCodeResolver(catalog);
  const accepted = new Map();
  const rejected = new Map();
  for (const [rawCode, rawQuantity] of occurrences || []) {
    const normalized = normalizeCatalogCode(rawCode);
    if (!normalized) continue;
    const quantity = Math.max(1, Math.floor(Number(rawQuantity || 1)));
    const code = resolver.resolve(normalized);
    const target = code ? accepted : rejected;
    const key = code || normalized;
    target.set(key, (target.get(key) || 0) + quantity);
  }
  return { accepted, rejected };
}

export function partitionCatalogLines(lines, catalog) {
  const resolver = createCatalogCodeResolver(catalog);
  const accepted = [];
  const rejected = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const normalized = normalizeCatalogCode(line?.code);
    const code = resolver.resolve(normalized);
    if (code) accepted.push({ ...line, code });
    else if (normalized) rejected.push({ ...line, code: normalized });
  }
  return { accepted, rejected };
}

export function normalizeCatalogCode(value) {
  const text = String(value || "").trim().replace(/[\s\-–—_./]/g, "").toUpperCase();
  if (text === "00") return text;
  const match = text.match(/^([A-Z]{2,3})(\d{1,2})(S)?$/);
  if (!match) return "";
  return `${match[1]}${Number(match[2])}${match[3] || ""}`;
}

export const REJECTED_CARD_EVIDENCE_KEY = "panini.rejectedCardEvidence.v1";

export function sanitizeBusinessProjection(projection, catalog) {
  const resolver = createCatalogCodeResolver(catalog);
  if (!resolver.size) throw new Error("The physical sticker catalogue is unavailable.");
  const source = projection && typeof projection === "object" ? projection : {};
  const rejected = { collectionCodes: [], ledgerLines: [], inventoryCards: {} };

  const collectionState = { ...(source.collectionState || {}) };
  if (Array.isArray(collectionState.collected)) {
    collectionState.collected = collectionState.collected.flatMap((rawCode) => {
      const code = resolver.resolve(rawCode);
      if (code) return [code];
      const normalized = normalizeCatalogCode(rawCode);
      if (normalized) rejected.collectionCodes.push(normalized);
      return [];
    });
  }
  if (collectionState.albumStatusOverrides && typeof collectionState.albumStatusOverrides === "object") {
    collectionState.albumStatusOverrides = Object.fromEntries(Object.entries(collectionState.albumStatusOverrides).flatMap(([rawCode, value]) => {
      const code = resolver.resolve(rawCode);
      if (code) return [[code, value]];
      const normalized = normalizeCatalogCode(rawCode);
      if (normalized) rejected.collectionCodes.push(normalized);
      return [];
    }));
  }

  const ledgerSource = source.ledger && typeof source.ledger === "object" ? source.ledger : {};
  const ledger = {
    ...ledgerSource,
    schemaVersion: 1,
    transactions: (Array.isArray(ledgerSource.transactions) ? ledgerSource.transactions : []).map((transaction) => ({
      ...transaction,
      received: sanitizeTransactionLines(transaction?.received, "received", transaction?.id, resolver, rejected),
      given: sanitizeTransactionLines(transaction?.given, "given", transaction?.id, resolver, rejected),
    })),
  };

  const inventorySource = source.inventorySnapshot && typeof source.inventorySnapshot === "object"
    ? source.inventorySnapshot
    : {};
  const inventoryCards = inventorySource.cards && typeof inventorySource.cards === "object" && !Array.isArray(inventorySource.cards)
    ? inventorySource.cards
    : {};
  const cards = {};
  for (const [rawCode, card] of Object.entries(inventoryCards)) {
    const code = resolver.resolve(rawCode);
    if (code) cards[code] = card;
    else {
      const normalized = normalizeCatalogCode(rawCode);
      if (normalized) rejected.inventoryCards[normalized] = card;
    }
  }

  return {
    projection: {
      ...source,
      collectionState,
      ledger,
      inventorySnapshot: { ...inventorySource, cards },
    },
    rejected,
  };
}

export function recordRejectedCardEvidence(storage, { source = "import", rejected } = {}) {
  if (!hasRejectedEvidence(rejected)) return false;
  let entries = [];
  try {
    const parsed = JSON.parse(storage.getItem(REJECTED_CARD_EVIDENCE_KEY) || "[]");
    if (Array.isArray(parsed)) entries = parsed;
  } catch {}
  entries.push({ source, recordedAt: new Date().toISOString(), rejected });
  storage.setItem(REJECTED_CARD_EVIDENCE_KEY, JSON.stringify(entries));
  return true;
}

function sanitizeTransactionLines(lines, field, transactionId, resolver, rejected) {
  return (Array.isArray(lines) ? lines : []).flatMap((line) => {
    const code = resolver.resolve(line?.code);
    if (code) return [{ ...line, code }];
    const normalized = normalizeCatalogCode(line?.code);
    if (normalized) rejected.ledgerLines.push({ transactionId: String(transactionId || ""), field, line: { ...line, code: normalized } });
    return [];
  });
}

function hasRejectedEvidence(rejected) {
  return Boolean(
    rejected
      && (rejected.collectionCodes?.length
        || rejected.ledgerLines?.length
        || Object.keys(rejected.inventoryCards || {}).length),
  );
}
