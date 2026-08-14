import { sortCode } from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-c1b0d4e9a623";
import {
  INVENTORY_CACHE_META_KEY,
  INVENTORY_SNAPSHOT_KEY,
  isUsableInventoryPayload,
  loadCachedInventoryPayload,
  loadInventoryCacheMeta,
} from "/fifa-sticker-app/v2/assets/inventory_source.js?v=build-c1b0d4e9a623";
import { ensureActiveProfileId } from "/fifa-sticker-app/v2/assets/v2_profile.js?v=build-c1b0d4e9a623";

export const COLLECTION_KEY = "panini.collectionTracker.v1";
export const COLLECTION_SNAPSHOT_URL = "/fifa-sticker-app/v2/data/collection_inventory.json?v=build-c1b0d4e9a623";
export const COLLECTION_SNAPSHOT_IMPORT_VERSION = 4;
const PUBLIC_V1_COLLECTION_KEY = "panini.collectionTracker.v2";
const SNAPSHOT_IMPORT_SOURCE_LABEL = "imported v1 collection snapshot";

export function loadCollectionState(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(COLLECTION_KEY);
    if (!raw) return defaultCollectionState();
    const parsed = JSON.parse(raw || "{}");
    return normalizeCollectionState(parsed, true);
  } catch {
    return defaultCollectionState();
  }
}

export function saveCollectionState(state, storage = globalThis.localStorage) {
  storage.setItem(COLLECTION_KEY, JSON.stringify(normalizeCollectionState(state, true)));
}

export async function importCollectionSnapshotState({
  state = loadCollectionState(),
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  forceInventoryImport = false,
} = {}) {
  const snapshot = await fetchCollectionSnapshot(fetchImpl);
  if (!snapshot) return { state, snapshot: null, imported: false, inventoryImported: false, summary: null };
  const snapshotCards = Array.isArray(snapshot?.cards) ? snapshot.cards : [];
  if (!snapshotCards.length) return { state, snapshot, imported: false, inventoryImported: false, summary: null };

  let nextState = normalizeCollectionState(state, state.hasLocalState);
  let imported = false;
  let inventoryImported = false;
  const publicV1Collected = loadPublicV1Collected(storage);
  if (nextState.importedCollectionSnapshotVersion !== COLLECTION_SNAPSHOT_IMPORT_VERSION) {
    nextState = {
      ...nextState,
      collected: [...new Set([...nextState.collected, ...publicV1Collected])].sort(sortCode),
      hasLocalState: Boolean(nextState.hasLocalState || publicV1Collected.length),
      importedCollectionSnapshotVersion: COLLECTION_SNAPSHOT_IMPORT_VERSION,
    };
    saveCollectionState(nextState, storage);
    imported = true;
  }
  if (shouldImportSnapshotInventory(storage, forceInventoryImport)) {
    saveCollectionSnapshotInventory(snapshot, { storage, publicV1Collected });
    inventoryImported = true;
  }
  return {
    state: nextState,
    snapshot,
    imported,
    inventoryImported,
    summary: collectionSnapshotInventorySummary(snapshot, { publicV1Collected }),
  };
}

export async function ensureImportedCollectionState(options = {}) {
  try {
    const current = options.state || loadCollectionState(options.storage);
    const result = await importCollectionSnapshotState({ ...options, state: current });
    return result.state;
  } catch {
    return options.state || loadCollectionState(options.storage);
  }
}

function loadPublicV1Collected(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(PUBLIC_V1_COLLECTION_KEY) || "{}");
    return Array.isArray(parsed.collected)
      ? parsed.collected.map((code) => String(code || "").trim().replace(/[\s_-]/g, "").toUpperCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export async function fetchCollectionSnapshot(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(COLLECTION_SNAPSHOT_URL, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

export function collectionSnapshotInventorySummary(snapshot, { publicV1Collected = [] } = {}) {
  const cards = Array.isArray(snapshot?.cards) ? snapshot.cards : [];
  const importedCodes = new Set(publicV1Collected.map((code) => normalizeCode(code)).filter(Boolean));
  let albumOwnedCount = 0;
  let tradeableUniqueCount = 0;
  let tradeableCardCount = 0;
  let missingCount = 0;
  for (const card of cards) {
    const code = normalizeCode(card?.code);
    const albumOwned = Boolean(card?.owned) || importedCodes.has(code);
    if (albumOwned) albumOwnedCount += 1;
    else missingCount += 1;
    const tradeable = Math.max(0, Number(card?.tradeable_count || 0));
    if (tradeable > 0) {
      tradeableUniqueCount += 1;
      tradeableCardCount += tradeable;
    }
  }
  return {
    catalogCount: cards.length,
    albumOwnedCount,
    missingCount,
    tradeableUniqueCount,
    tradeableCardCount,
  };
}

export function collectionSnapshotToInventoryPayload(snapshot, { publicV1Collected = [], now } = {}) {
  const cards = {};
  const importedCodes = new Set(publicV1Collected.map((code) => normalizeCode(code)).filter(Boolean));
  for (const row of Array.isArray(snapshot?.cards) ? snapshot.cards : []) {
    const code = normalizeCode(row?.code);
    if (!code) continue;
    const tradeable = Math.max(0, Number(row?.tradeable_count || 0));
    const albumQuantity = (row?.owned || importedCodes.has(code)) ? 1 : 0;
    const card = {
      code,
      name: String(row?.name || "").trim(),
      team: String(row?.team || "").trim(),
      count: tradeable,
      album_count: albumQuantity,
      source: "v1_collection_snapshot",
      owned: albumQuantity > 0,
      in_album: albumQuantity > 0,
      tradeable_count: tradeable,
      available_for_trading: tradeable > 0,
    };
    if (row?.back_insignia_type) {
      card.back_insignia_type = row.back_insignia_type;
      if (tradeable > 0) card.back_insignia_counts = { [row.back_insignia_type]: tradeable };
    }
    cards[code] = card;
  }
  const summary = collectionSnapshotInventorySummary(snapshot, { publicV1Collected });
  const generatedAt = snapshot?.updated_at || snapshot?.generated_at || snapshot?.exported_at || (now ? now() : new Date().toISOString());
  return {
    schema_version: 1,
    generated_at: generatedAt,
    updated_at: generatedAt,
    source: "v1_collection_snapshot",
    cards,
    stats: {
      ...(snapshot?.stats || {}),
      unique_code_count: summary.tradeableUniqueCount,
      matched_card_count: summary.tradeableCardCount,
      album_owned_count: summary.albumOwnedCount,
      missing_count: summary.missingCount,
      imported_from_v1_collection: true,
    },
  };
}

export function saveCollectionSnapshotInventory(snapshot, {
  storage = globalThis.localStorage,
  publicV1Collected = [],
  now,
} = {}) {
  const payload = collectionSnapshotToInventoryPayload(snapshot, { publicV1Collected, now });
  storage.setItem(INVENTORY_SNAPSHOT_KEY, JSON.stringify(payload));
  storage.setItem(INVENTORY_CACHE_META_KEY, JSON.stringify({
    cachedAt: now ? now() : new Date().toISOString(),
    sourceLabel: SNAPSHOT_IMPORT_SOURCE_LABEL,
  }));
  ensureActiveProfileId(storage);
  return payload;
}

function shouldImportSnapshotInventory(storage, forceInventoryImport) {
  if (forceInventoryImport) return true;
  const cached = loadCachedInventoryPayload(storage);
  if (!isUsableInventoryPayload(cached)) return true;
  const meta = loadInventoryCacheMeta(storage);
  const sourceLabel = String(meta?.sourceLabel || "").toLowerCase();
  if (!sourceLabel) return true;
  return [
    "static snapshot",
    SNAPSHOT_IMPORT_SOURCE_LABEL,
  ].some((label) => sourceLabel === label);
}

function defaultCollectionState() {
  return { filter: "missing", collected: [], hasLocalState: false, importedCollectionSnapshotVersion: 0 };
}

function normalizeCollectionState(value, hasLocalState) {
  return {
    filter: ["missing", "all", "collected"].includes(value?.filter) ? value.filter : "missing",
    collected: Array.isArray(value?.collected) ? value.collected : [],
    hasLocalState: Boolean(hasLocalState),
    importedCollectionSnapshotVersion: Number(value?.importedCollectionSnapshotVersion || 0),
  };
}

function normalizeCode(value) {
  return String(value || "").trim().replace(/[\s_-]/g, "").toUpperCase();
}
