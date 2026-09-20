import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogHasCards,
  createCatalogCodeResolver,
  partitionCatalogCodes,
  partitionCatalogLines,
  partitionCatalogOccurrences,
  REJECTED_CARD_EVIDENCE_KEY,
  recordRejectedCardEvidence,
  sanitizeBusinessProjection,
} from "../v2/assets/catalog_membership.js";
import {
  applyAlbumPageResultToInventory,
  applyTextInventoryCodesToInventory,
} from "../v2/assets/album_inventory_state.js";
import { INVENTORY_SNAPSHOT_KEY } from "../v2/assets/trade_state.js";

const catalog = {
  cards: [{ code: "USA1" }, { code: "CUW13" }, { code: "CIV10" }],
  aliases: { "USA-01": "USA1" },
};

test("catalogue resolver is the single fail-closed card-membership boundary", () => {
  const resolver = createCatalogCodeResolver(catalog);
  assert.equal(resolver.resolve("USA-01"), "USA1");
  assert.equal(resolver.resolve("AND13"), "");
  assert.equal(resolver.resolve("USA99"), "");
  assert.equal(catalogHasCards(catalog), true);
  assert.equal(catalogHasCards({ cards: [], aliases: {} }), false);
});

test("catalogue partitions preserve valid quantities and retain rejected evidence", () => {
  assert.deepEqual(partitionCatalogCodes(["USA1", "AND13", "CUW 13"], catalog), {
    accepted: ["USA1", "CUW13"],
    rejected: ["AND13"],
  });
  assert.deepEqual(partitionCatalogOccurrences(new Map([["CIV10", 2], ["ET3", 1]]), catalog), {
    accepted: new Map([["CIV10", 2]]),
    rejected: new Map([["ET3", 1]]),
  });
  assert.deepEqual(partitionCatalogLines([{ code: "USA1", quantity: 2 }, { code: "TUN27", quantity: 1 }], catalog), {
    accepted: [{ code: "USA1", quantity: 2 }],
    rejected: [{ code: "TUN27", quantity: 1 }],
  });
});

test("inventory write helpers reject codes outside the supplied catalogue", () => {
  const storage = memoryStorage();
  const textResult = applyTextInventoryCodesToInventory(["USA1", "AND13", "USA1"], {
    storage,
    catalog,
    now: () => "2026-09-20T00:00:00.000Z",
  });
  assert.equal(textResult.applied, 2);
  assert.equal(textResult.rejected, 1);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(INVENTORY_SNAPSHOT_KEY)).cards), ["USA1"]);

  const albumResult = applyAlbumPageResultToInventory({
    slots: [
      { code: "CIV10", state: "filled" },
      { code: "ET3", state: "filled" },
    ],
  }, { storage, catalog, now: () => "2026-09-20T00:01:00.000Z" });
  assert.equal(albumResult.applied, 1);
  assert.equal(albumResult.rejected, 1);
  assert.equal(JSON.parse(storage.getItem(INVENTORY_SNAPSHOT_KEY)).cards.ET3, undefined);
});

test("inventory write helpers fail closed when no catalogue is available", () => {
  const storage = memoryStorage();
  const result = applyTextInventoryCodesToInventory(["USA1"], { storage, catalog: null });
  assert.equal(result.applied, 0);
  assert.equal(result.rejected, 1);
  assert.equal(storage.getItem(INVENTORY_SNAPSHOT_KEY), null);
});

test("account and restore projections quarantine unknown codes before active storage", () => {
  const raw = {
    collectionState: { collected: ["USA1", "AND13"], albumStatusOverrides: { CIV10: "present", ET3: "missing" } },
    ledger: {
      schemaVersion: 1,
      transactions: [{ id: "tx1", received: [{ code: "CUW13", quantity: 1 }, { code: "ET3", quantity: 1 }], given: [{ code: "AND13", quantity: 2 }] }],
    },
    inventorySnapshot: { cards: { USA1: { count: 1 }, AND13: { count: 2 } } },
  };
  const { projection, rejected } = sanitizeBusinessProjection(raw, catalog);
  assert.deepEqual(projection.collectionState.collected, ["USA1"]);
  assert.deepEqual(projection.collectionState.albumStatusOverrides, { CIV10: "present" });
  assert.deepEqual(projection.ledger.transactions[0].received, [{ code: "CUW13", quantity: 1 }]);
  assert.deepEqual(projection.ledger.transactions[0].given, []);
  assert.deepEqual(Object.keys(projection.inventorySnapshot.cards), ["USA1"]);
  assert.deepEqual(new Set(rejected.collectionCodes), new Set(["AND13", "ET3"]));
  assert.equal(rejected.ledgerLines.length, 2);
  assert.deepEqual(rejected.inventoryCards.AND13, { count: 2 });

  const storage = memoryStorage();
  assert.equal(recordRejectedCardEvidence(storage, { source: "test import", rejected }), true);
  const evidence = JSON.parse(storage.getItem(REJECTED_CARD_EVIDENCE_KEY));
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].source, "test import");
  assert.equal(evidence[0].rejected.ledgerLines[0].line.code, "ET3");
});

test("projection sanitizing fails closed without a verified catalogue", () => {
  assert.throws(() => sanitizeBusinessProjection({ inventorySnapshot: { cards: { USA1: { count: 1 } } } }, null), /catalogue is unavailable/i);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
