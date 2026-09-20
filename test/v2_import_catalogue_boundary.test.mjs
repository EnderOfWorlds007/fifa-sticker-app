import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyBackupRestoreStorage, captureBackupStorageSnapshot } from "../v2/assets/backup_restore.js";
import {
  COLLECTION_KEY,
  INVENTORY_SNAPSHOT_KEY,
  LEDGER_KEY,
} from "../v2/assets/trade_state.js";
import { REJECTED_CARD_EVIDENCE_KEY } from "../v2/assets/catalog_membership.js";

const catalog = { cards: [{ code: "USA1" }, { code: "CIV10" }] };

test("backup restore writes only catalogue cards and retains rejected evidence", () => {
  const storage = memoryStorage();
  const previous = captureBackupStorageSnapshot({ storage, liveInventorySnapshot: null });
  const result = applyBackupRestoreStorage({
    storage,
    previous,
    catalog,
    restorePlan: {
      collectionState: { collected: ["USA1", "AND13"], albumStatusOverrides: {} },
      ledger: { schemaVersion: 1, transactions: [{ id: "tx", received: [{ code: "CIV10", quantity: 1 }, { code: "ET3", quantity: 1 }], given: [] }] },
      inventorySnapshot: { cards: { USA1: { count: 1 }, AND13: { count: 1 } } },
      inventoryCacheMeta: {},
      shouldPreserveInventory: false,
    },
  });
  assert.equal(result.status, "restored");
  assert.deepEqual(JSON.parse(storage.getItem(COLLECTION_KEY)).collected, ["USA1"]);
  assert.deepEqual(JSON.parse(storage.getItem(LEDGER_KEY)).transactions[0].received, [{ code: "CIV10", quantity: 1 }]);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(INVENTORY_SNAPSHOT_KEY)).cards), ["USA1"]);
  assert.equal(JSON.parse(storage.getItem(REJECTED_CARD_EVIDENCE_KEY)).length, 1);
});

test("cloud checkpoint sanitizes imports through the same catalogue boundary", () => {
  const source = readFileSync(new URL("../v2/assets/cloud_sync.js", import.meta.url), "utf8");
  assert.match(source, /export function applyCloudCheckpoint\(payload, storage = globalThis\.localStorage, catalog\)/);
  assert.match(source, /return applyAccountProjection\(storage, payload\.storage, catalog\);/);
  assert.match(source, /const \{ projection: sanitized, rejected \} = sanitizeBusinessProjection\(projection, catalog\);/);
  assert.match(source, /recordRejectedCardEvidence\(storage, \{ source: "cloud account projection", rejected \}\);/);
});

test("backup and cloud activation fail closed without a catalogue", () => {
  const backupStorage = memoryStorage();
  const previous = captureBackupStorageSnapshot({ storage: backupStorage, liveInventorySnapshot: null });
  const result = applyBackupRestoreStorage({
    storage: backupStorage,
    previous,
    catalog: null,
    restorePlan: { collectionState: {}, ledger: { transactions: [] }, inventorySnapshot: { cards: {} }, inventoryCacheMeta: {}, shouldPreserveInventory: false },
  });
  assert.equal(result.status, "failed");
  assert.equal(backupStorage.getItem(COLLECTION_KEY), null);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
