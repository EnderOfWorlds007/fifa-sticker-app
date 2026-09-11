import assert from "node:assert/strict";
import test from "node:test";

import {
  receivedLinesForScan,
  scanReceiptSignature,
  summarizeScanInsignias,
} from "../v2/assets/scan_inventory.js";
import {
  adjustedInventoryPayload,
  createTransaction,
  transactionDetailLines,
} from "../v2/assets/trade_state.js";

test("scan receipt lines preserve a colour per physical card and aggregate exact matches", () => {
  const received = receivedLinesForScan({
    slots: [
      { code: "col11", back_insignia_type: "united_edition" },
      { code: "COL11", back_insignia_type: "standard_fifa_licensed" },
      { code: "COL11", back_insignia_type: "united_edition" },
      { code: "ARG 7", back_insignia_type: "no_clue" },
    ],
  });

  assert.deepEqual(received, [
    { code: "ARG7", quantity: 1 },
    { code: "COL11", quantity: 1, variant: "standard_fifa_licensed" },
    { code: "COL11", quantity: 2, variant: "united_edition" },
  ]);
  assert.deepEqual(summarizeScanInsignias(received), { blue: 1, green: 2, unknown: 1 });
});

test("unknown insignias remain unclassified rather than becoming blue or green", () => {
  assert.deepEqual(receivedLinesForScan({
    slots: [
      { code: "CPV1", back_insignia_type: "no_clue" },
      { code: "CPV1", back_insignia_type: "mixed" },
      { code: "CPV2" },
    ],
  }), [{ code: "CPV1", quantity: 2 }, { code: "CPV2", quantity: 1 }]);
});

test("legacy code-only results still produce colour-unknown receipt lines", () => {
  assert.deepEqual(receivedLinesForScan({ fallbackCodes: ["COL 3", "COL3"] }), [
    { code: "COL3", quantity: 2 },
  ]);
});

test("one-shot scan signature changes when the saved insignia changes", () => {
  const blue = [{ code: "COL11", quantity: 1, variant: "standard_fifa_licensed" }];
  const green = [{ code: "COL11", quantity: 1, variant: "united_edition" }];
  assert.notEqual(scanReceiptSignature(blue), scanReceiptSignature(green));
});

test("scan colours survive the collection ledger and inventory projection", () => {
  const received = receivedLinesForScan({
    slots: [
      { code: "COL11", back_insignia_type: "standard_fifa_licensed" },
      { code: "COL11", back_insignia_type: "united_edition" },
      { code: "COL11", back_insignia_type: "united_edition" },
    ],
  });
  const ledger = createTransaction({ schemaVersion: 1, transactions: [] }, {
    idFactory: () => "txn_scan_colours",
    now: () => "2026-09-11T10:00:00.000Z",
    kind: "received",
    received,
    given: [],
  });

  assert.deepEqual(ledger.transactions[0].received, received);
  assert.deepEqual(transactionDetailLines(ledger.transactions[0]), ["Receive: COL11 Blue, COL11 x2 Green"]);
  const inventory = adjustedInventoryPayload({ cards: {}, captures: [], stats: {} }, ledger, {
    legacyCollected: ["COL11"],
  });
  assert.equal(inventory.cards.COL11.count, 3);
  assert.equal(inventory.cards.COL11.back_insignia_type, "mixed");
  assert.deepEqual(inventory.cards.COL11.back_insignia_counts, {
    standard_fifa_licensed: 1,
    united_edition: 2,
  });
});
