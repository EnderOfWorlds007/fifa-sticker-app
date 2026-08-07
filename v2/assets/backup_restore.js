import {
  COLLECTION_KEY,
  INVENTORY_CACHE_META_KEY,
  INVENTORY_SNAPSHOT_KEY,
  LEDGER_KEY,
} from "./trade_state.js";

export {
  COLLECTION_KEY,
  INVENTORY_CACHE_META_KEY,
  INVENTORY_SNAPSHOT_KEY,
  LEDGER_KEY,
};

export const DEFAULT_RESTORE_FAILURE_MESSAGE = "That backup JSON could not be restored.";
export const RESTORE_PARTIAL_ROLLBACK_MESSAGE = "Restore failed and browser storage could not fully roll back. Keep this backup JSON before making more changes.";
export const RESTORE_RENDER_FAILURE_MESSAGE = "Backup restored, but the page could not refresh. Reload to see restored data.";

export function captureBackupStorageSnapshot({ storage, liveInventorySnapshot }) {
  return {
    collection: storage.getItem(COLLECTION_KEY),
    ledger: storage.getItem(LEDGER_KEY),
    inventory: storage.getItem(INVENTORY_SNAPSHOT_KEY),
    inventoryMeta: storage.getItem(INVENTORY_CACHE_META_KEY),
    inventorySnapshot: liveInventorySnapshot,
  };
}

export function applyBackupRestoreStorage({ storage, restorePlan, previous }) {
  const changedValues = [];
  try {
    writeStorageValue(storage, COLLECTION_KEY, JSON.stringify(restorePlan.collectionState), changedValues, previous.collection);
    writeStorageValue(storage, LEDGER_KEY, JSON.stringify(restorePlan.ledger), changedValues, previous.ledger);
    applyInventoryRestoreStorage({ storage, restorePlan, changedValues, previous });
    return {
      status: "restored",
      collectionState: restorePlan.collectionState,
      inventorySnapshot: restorePlan.shouldPreserveInventory ? preservedInventorySnapshot(previous) : restorePlan.inventorySnapshot,
    };
  } catch (error) {
    return {
      status: "failed",
      error,
      rollbackComplete: restoreBackupStorageSnapshot({ storage, changedValues }),
      inventorySnapshot: preservedInventorySnapshot(previous),
    };
  }
}

function applyInventoryRestoreStorage({ storage, restorePlan, changedValues, previous }) {
  if (!restorePlan.inventorySnapshot) return;
  writeStorageValue(storage, INVENTORY_SNAPSHOT_KEY, JSON.stringify(restorePlan.inventorySnapshot), changedValues, previous.inventory);
  writeStorageValue(storage, INVENTORY_CACHE_META_KEY, JSON.stringify(restorePlan.inventoryCacheMeta), changedValues, previous.inventoryMeta);
}

function restoreBackupStorageSnapshot({ storage, changedValues }) {
  const rollbackResults = [...changedValues].reverse().map(({ key, previousValue }) => (
    writeStorageValueSafely(storage, key, previousValue)
  ));
  return !rollbackResults.includes(false);
}

function writeStorageValue(storage, key, value, changedValues = null, previousValue = null) {
  if (changedValues) changedValues.push({ key, previousValue });
  if (value === null) storage.removeItem(key);
  else storage.setItem(key, value);
}

function writeStorageValueSafely(storage, key, value) {
  try {
    writeStorageValue(storage, key, value);
    return true;
  } catch {
    return false;
  }
}

function preservedInventorySnapshot(previous) {
  if (previous.inventorySnapshot) return previous.inventorySnapshot;
  try {
    const parsed = JSON.parse(previous.inventory || "null");
    if (parsed && typeof parsed === "object" && parsed.cards && typeof parsed.cards === "object" && !Array.isArray(parsed.cards)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
