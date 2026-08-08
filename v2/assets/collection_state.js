import { sortCode } from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-960000000001";

export const COLLECTION_KEY = "panini.collectionTracker.v1";
export const COLLECTION_SNAPSHOT_URL = "/fifa-sticker-app/v2/data/collection_inventory.json?v=build-960000000001";
export const COLLECTION_SNAPSHOT_IMPORT_VERSION = 3;
const PUBLIC_V1_COLLECTION_KEY = "panini.collectionTracker.v2";

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
} = {}) {
  const response = await fetchImpl(COLLECTION_SNAPSHOT_URL, { cache: "no-store" });
  if (!response.ok) return { state, snapshot: null, imported: false };
  const snapshot = await response.json();
  const snapshotCards = Array.isArray(snapshot?.cards) ? snapshot.cards : [];
  if (!snapshotCards.length) return { state, snapshot, imported: false };

  let nextState = normalizeCollectionState(state, state.hasLocalState);
  let imported = false;
  if (nextState.importedCollectionSnapshotVersion !== COLLECTION_SNAPSHOT_IMPORT_VERSION) {
    const importedOwned = snapshotCards
      .filter((card) => card?.owned)
      .map((card) => String(card.code || "").toUpperCase())
      .filter(Boolean);
    const publicV1Collected = loadPublicV1Collected(storage);
    nextState = {
      ...nextState,
      collected: [...new Set([...nextState.collected, ...importedOwned, ...publicV1Collected])].sort(sortCode),
      hasLocalState: true,
      importedCollectionSnapshotVersion: COLLECTION_SNAPSHOT_IMPORT_VERSION,
    };
    saveCollectionState(nextState, storage);
    imported = true;
  }
  return { state: nextState, snapshot, imported };
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
