import {
  INVENTORY_CACHE_META_KEY,
  INVENTORY_SNAPSHOT_KEY,
  loadCachedInventoryPayload,
} from "./inventory_source.js?v=build-f1a5c4a9e027";
import { ensureActiveProfileId } from "./v2_profile.js?v=build-f1a5c4a9e027";

const ALBUM_SCAN_SOURCE_LABEL = "album page scan";
const TEXT_INVENTORY_SOURCE_LABEL = "pasted text inventory";

export function albumPageInventoryChanges(result) {
  const slots = Array.isArray(result?.slots) ? result.slots : [];
  return slots
    .filter((slot) => slot?.code && ["filled", "empty"].includes(slot.state) && slot.review_required !== true)
    .map((slot) => ({
      code: normalizeCode(slot.code),
      state: slot.state,
      confidence: Number(slot.confidence || 0),
      slot_id: slot.slot_id || "",
      ordinal: Number(slot.ordinal || 0),
      team: slot.team || result?.template?.team || "",
      name: slot.name || "",
    }))
    .filter((change) => change.code);
}

export function applyAlbumPageResultToInventory(result, {
  storage = globalThis.localStorage,
  now = () => new Date().toISOString(),
} = {}) {
  const changes = albumPageInventoryChanges(result);
  if (!changes.length) {
    return { applied: 0, filled: 0, empty: 0, skipped: skippedSlotCount(result), payload: loadCachedInventoryPayload(storage) };
  }
  const timestamp = now();
  const payload = normalizedInventoryPayload(loadCachedInventoryPayload(storage), timestamp);
  const cards = payload.cards;
  let filled = 0;
  let empty = 0;
  for (const change of changes) {
    const current = cards[change.code] || { code: change.code, count: 0 };
    const next = {
      ...current,
      code: change.code,
      team: current.team || change.team,
      name: current.name || change.name,
      album_updated_at: timestamp,
      album_source: ALBUM_SCAN_SOURCE_LABEL,
      album_last_slot_id: change.slot_id || current.album_last_slot_id,
      album_last_ordinal: change.ordinal || current.album_last_ordinal,
      album_confidence: change.confidence,
    };
    if (change.state === "filled") {
      next.album_count = Math.max(1, Number(next.album_count || 0));
      next.in_album = true;
      next.owned = true;
      delete next.album_observed_empty;
      filled += 1;
    } else {
      next.album_count = 0;
      next.in_album = false;
      next.album_observed_empty = true;
      next.owned = Boolean(Number(next.count || 0) > 0 || Number(next.tradeable_count || 0) > 0);
      empty += 1;
    }
    cards[change.code] = next;
  }
  payload.updated_at = timestamp;
  payload.source = payload.source || "browser-local inventory";
  payload.stats = {
    ...(payload.stats || {}),
    album_scan_updated_at: timestamp,
    album_scan_applied_count: Number(payload.stats?.album_scan_applied_count || 0) + changes.length,
    album_owned_count: Object.values(cards).filter((card) => Number(card?.album_count || 0) > 0).length,
    album_empty_count: Object.values(cards).filter((card) => Number(card?.album_count || 0) <= 0 && card?.album_observed_empty).length,
    unique_code_count: Object.keys(cards).length,
    matched_card_count: Object.values(cards).reduce((sum, card) => sum + Number(card?.count || 0), 0),
  };
  storage.setItem(INVENTORY_SNAPSHOT_KEY, JSON.stringify(payload));
  storage.setItem(INVENTORY_CACHE_META_KEY, JSON.stringify({
    cachedAt: timestamp,
    sourceLabel: ALBUM_SCAN_SOURCE_LABEL,
  }));
  ensureActiveProfileId(storage);
  return { applied: changes.length, filled, empty, skipped: skippedSlotCount(result), payload };
}

export function applyTextInventoryCodesToInventory(codes, {
  storage = globalThis.localStorage,
  now = () => new Date().toISOString(),
} = {}) {
  const quantities = normalizedCodeQuantities(codes);
  if (!quantities.size) {
    return { applied: 0, unique: 0, total: 0, payload: loadCachedInventoryPayload(storage) };
  }
  const timestamp = now();
  const payload = normalizedInventoryPayload(loadCachedInventoryPayload(storage), timestamp);
  const cards = payload.cards;
  let total = 0;
  for (const [code, quantity] of quantities.entries()) {
    total += quantity;
    const current = cards[code] || { code, count: 0 };
    cards[code] = {
      ...current,
      code,
      count: Math.max(Number(current.count || 0), quantity),
      owned: true,
      text_inventory_updated_at: timestamp,
      text_inventory_source: TEXT_INVENTORY_SOURCE_LABEL,
    };
  }
  payload.updated_at = timestamp;
  payload.source = payload.source || "browser-local inventory";
  payload.stats = {
    ...(payload.stats || {}),
    text_inventory_updated_at: timestamp,
    text_inventory_applied_count: Number(payload.stats?.text_inventory_applied_count || 0) + total,
    unique_code_count: Object.keys(cards).length,
    matched_card_count: Object.values(cards).reduce((sum, card) => sum + Number(card?.count || 0), 0),
  };
  storage.setItem(INVENTORY_SNAPSHOT_KEY, JSON.stringify(payload));
  storage.setItem(INVENTORY_CACHE_META_KEY, JSON.stringify({
    cachedAt: timestamp,
    sourceLabel: TEXT_INVENTORY_SOURCE_LABEL,
  }));
  ensureActiveProfileId(storage);
  return { applied: total, unique: quantities.size, total, payload };
}

function normalizedInventoryPayload(payload, timestamp) {
  const base = payload && typeof payload === "object" ? payload : {};
  return {
    schema_version: Number(base.schema_version || base.schemaVersion || 1),
    generated_at: base.generated_at || timestamp,
    updated_at: base.updated_at || timestamp,
    source: base.source || "browser-local inventory",
    cards: base.cards && typeof base.cards === "object" ? { ...base.cards } : {},
    stats: base.stats && typeof base.stats === "object" ? { ...base.stats } : {},
  };
}

function skippedSlotCount(result) {
  const slots = Array.isArray(result?.slots) ? result.slots : [];
  return slots.filter((slot) => slot?.code && (slot.review_required === true || !["filled", "empty"].includes(slot.state))).length;
}

function normalizeCode(value) {
  return String(value || "").trim().replace(/[\s_-]/g, "").toUpperCase();
}

function normalizedCodeQuantities(codes) {
  const quantities = new Map();
  const values = Array.isArray(codes) ? codes : String(codes || "").split(/\s+/);
  for (const value of values) {
    const code = normalizeCode(value);
    if (!code) continue;
    quantities.set(code, (quantities.get(code) || 0) + 1);
  }
  return quantities;
}
