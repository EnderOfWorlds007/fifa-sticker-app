export const INVENTORY_SNAPSHOT_KEY = "panini.inventorySnapshot.v1";
export const INVENTORY_CACHE_META_KEY = "panini.inventorySnapshotMeta.v1";
export const DEFAULT_INVENTORY_SOURCES = [
  { url: "/api/trade-inventory", label: "local scanner server" },
];

export function isUsableInventoryPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload?.stats?.offline) return false;
  return Boolean(payload.cards && typeof payload.cards === "object");
}

export async function loadInventoryPayload(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const storage = options.storage || globalThis.localStorage;
  const now = options.now || (() => new Date().toISOString());
  const sources = options.sources || DEFAULT_INVENTORY_SOURCES;
  const cached = loadCachedInventoryPayload(storage);
  const cachedMeta = cached ? loadInventoryCacheMeta(storage) : {};
  if (cached && cachedMeta?.emptyAccount) return { payload: cached, source: { label: cachedMeta.sourceLabel || "empty cloud account" } };
  const candidates = [];
  let lastError = null;

  for (const source of sources) {
    try {
      const response = await fetchImpl(source.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${source.label} unavailable`);
      const payload = await response.json();
      if (!isUsableInventoryPayload(payload)) throw new Error(`${source.label} returned offline inventory placeholder`);
      candidates.push({ payload, source });
    } catch (error) {
      lastError = error;
    }
  }

  if (cached) candidates.push({ payload: cached, source: { label: "browser cache" }, meta: cachedMeta, cached: true });
  const selected = selectInventoryCandidate(candidates);
  if (selected) {
    if (!selected.cached) {
      cacheInventoryPayload(storage, selected.payload, {
        cachedAt: now(),
        sourceLabel: selected.source.label,
      });
    }
    return { payload: selected.payload, source: selected.source };
  }
  throw lastError ?? new Error("inventory unavailable");
}

function selectInventoryCandidate(candidates) {
  const usable = Array.isArray(candidates) ? candidates.filter((candidate) => isUsableInventoryPayload(candidate?.payload)) : [];
  if (!usable.length) return null;
  const live = usable.find((candidate) => candidate.source?.label === "local scanner server");
  if (live) return live;
  const cached = usable.find((candidate) => candidate.cached);
  const staticSnapshot = usable.find((candidate) => candidate.source?.label === "static snapshot");
  if (cached && staticSnapshot && shouldKeepCachedInventory(cached, staticSnapshot)) return cached;
  return usable[0];
}

function shouldKeepCachedInventory(cached, fetched) {
  const fetchedLabel = fetched?.source?.label || "";
  if (fetchedLabel !== "static snapshot") return false;
  const cachedTimestamp = inventoryTimestamp(cached?.payload);
  const fetchedTimestamp = inventoryTimestamp(fetched?.payload);
  if (cachedTimestamp && fetchedTimestamp) return cachedTimestamp >= fetchedTimestamp;
  return Boolean(cachedTimestamp || !fetchedTimestamp);
}

function inventoryTimestamp(payload) {
  const value = payload?.updated_at || payload?.generated_at || payload?.created_at;
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function cacheInventoryPayload(storage, payload, meta) {
  try {
    storage.setItem(INVENTORY_SNAPSHOT_KEY, JSON.stringify(payload));
    storage.setItem(INVENTORY_CACHE_META_KEY, JSON.stringify(meta));
  } catch {
    // Inventory reads should still work when browser storage is unavailable.
  }
}

export function loadCachedInventoryPayload(storage = globalThis.localStorage) {
  try {
    const payload = JSON.parse(storage.getItem(INVENTORY_SNAPSHOT_KEY) || "{}");
    return isUsableInventoryPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function loadInventoryCacheMeta(storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage.getItem(INVENTORY_CACHE_META_KEY) || "{}");
  } catch {
    return {};
  }
}
