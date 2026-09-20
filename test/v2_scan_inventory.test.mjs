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
    catalog: catalogFor("COL11"),
    legacyCollected: ["COL11"],
  });
  assert.equal(inventory.cards.COL11.count, 3);
  assert.equal(inventory.cards.COL11.back_insignia_type, "mixed");
  assert.deepEqual(inventory.cards.COL11.back_insignia_counts, {
    standard_fifa_licensed: 1,
    united_edition: 2,
  });
});

test("outgoing trades remove loose copies received by earlier transactions", () => {
  let ledger = createTransaction({ schemaVersion: 1, transactions: [] }, {
    idFactory: () => "txn_old_scan",
    now: () => "2026-09-11T10:00:00.000Z",
    kind: "received",
    received: [
      { code: "ARG7", quantity: 3, variant: "standard_fifa_licensed" },
      { code: "ARG7", quantity: 1, variant: "united_edition" },
    ],
    given: [],
  });
  ledger = createTransaction(ledger, {
    idFactory: () => "txn_replace_snapshot",
    now: () => "2026-09-20T10:00:00.000Z",
    kind: "trade",
    received: [{ code: "ARG7", quantity: 6, variant: "standard_fifa_licensed" }],
    given: [
      { code: "ARG7", quantity: 3, variant: "standard_fifa_licensed" },
      { code: "ARG7", quantity: 1, variant: "united_edition" },
    ],
  });

  const inventory = adjustedInventoryPayload({ cards: {}, captures: [], stats: {} }, ledger, {
    catalog: catalogFor("ARG7"),
    legacyCollected: ["ARG7"],
  });

  assert.equal(inventory.cards.ARG7.count, 6);
  assert.equal(inventory.cards.ARG7.back_insignia_type, "standard_fifa_licensed");
  assert.deepEqual(inventory.cards.ARG7.back_insignia_counts, {
    standard_fifa_licensed: 6,
    united_edition: 0,
  });
});

test("snapshot replacement preserves the received colour when the old copy was unclassified", () => {
  const rawInventory = {
    cards: {
      CIV10: {
        code: "CIV10",
        count: 1,
      },
    },
    captures: [],
    stats: {},
  };
  const ledger = createTransaction({ schemaVersion: 1, transactions: [] }, {
    idFactory: () => "txn_replace_unclassified_civ10",
    now: () => "2026-09-20T10:00:00.000Z",
    kind: "trade",
    received: [{ code: "CIV10", quantity: 1, variant: "standard_fifa_licensed" }],
    given: [{ code: "CIV10", quantity: 1 }],
  });

  const inventory = adjustedInventoryPayload(rawInventory, ledger, {
    catalog: catalogFor("CIV10"),
    legacyCollected: ["CIV10"],
  });

  assert.equal(inventory.cards.CIV10.count, 1);
  assert.equal(inventory.cards.CIV10.back_insignia_type, "standard_fifa_licensed");
  assert.deepEqual(inventory.cards.CIV10.back_insignia_counts, {
    standard_fifa_licensed: 1,
  });
});

test("plain outgoing stock consumes an implicit unknown copy before a known blue copy", () => {
  const rawInventory = {
    cards: {
      CIV10: {
        code: "CIV10",
        count: 2,
        back_insignia_type: "standard_fifa_licensed",
        back_insignia_counts: { standard_fifa_licensed: 1 },
      },
    },
    captures: [],
    stats: {},
  };
  const ledger = createTransaction({ schemaVersion: 1, transactions: [] }, {
    idFactory: () => "txn_give_unclassified_civ10",
    now: () => "2026-09-20T10:00:00.000Z",
    kind: "given",
    received: [],
    given: [{ code: "CIV10", quantity: 1 }],
  });

  const inventory = adjustedInventoryPayload(rawInventory, ledger, {
    catalog: catalogFor("CIV10"),
    legacyCollected: ["CIV10"],
  });

  assert.equal(inventory.cards.CIV10.count, 1);
  assert.deepEqual(inventory.cards.CIV10.back_insignia_counts, {
    standard_fifa_licensed: 1,
  });
});

test("later outgoing trades still remove colours received by earlier transactions", () => {
  let ledger = createTransaction({ schemaVersion: 1, transactions: [] }, {
    idFactory: () => "txn_receive_civ10_blue",
    now: () => "2026-09-20T10:00:00.000Z",
    kind: "received",
    received: [{ code: "CIV10", quantity: 1, variant: "standard_fifa_licensed" }],
    given: [],
  });
  ledger = createTransaction(ledger, {
    idFactory: () => "txn_give_civ10_blue",
    now: () => "2026-09-20T11:00:00.000Z",
    kind: "given",
    received: [],
    given: [{ code: "CIV10", quantity: 1, variant: "standard_fifa_licensed" }],
  });

  const inventory = adjustedInventoryPayload({ cards: {}, captures: [], stats: {} }, ledger, {
    legacyCollected: ["CIV10"],
  });

  assert.equal(inventory.cards.CIV10, undefined);
});

test("first receipts fill the album before reserved outgoing stock is projected", () => {
  let ledger = createTransaction({ schemaVersion: 1, transactions: [] }, {
    idFactory: () => "txn_first_receipt",
    now: () => "2026-09-11T10:00:00.000Z",
    kind: "received",
    received: [{ code: "ARG7", quantity: 3, variant: "standard_fifa_licensed" }],
    given: [],
  });
  ledger = createTransaction(ledger, {
    idFactory: () => "txn_reserved_outgoing",
    now: () => "2026-09-12T10:00:00.000Z",
    kind: "trade",
    status: "reserved",
    received: [],
    given: [{ code: "ARG7", quantity: 1, variant: "standard_fifa_licensed" }],
  });

  const inventory = adjustedInventoryPayload({ cards: {}, captures: [], stats: {} }, ledger, {
    catalog: { cards: [{ code: "ARG7", team: "Argentina", name: "Player" }] },
  });

  assert.equal(inventory.cards.ARG7.count, 1);
  assert.deepEqual(inventory.cards.ARG7.back_insignia_counts, {
    standard_fifa_licensed: 1,
  });
});

test("inventory projection does not mutate the raw inventory payload", () => {
  const rawInventory = {
    cards: {
      ARG7: {
        code: "ARG7",
        count: 1,
        back_insignia_type: "standard_fifa_licensed",
        back_insignia_counts: { standard_fifa_licensed: 1 },
      },
    },
    captures: [],
    stats: {},
  };
  const before = structuredClone(rawInventory);
  const ledger = createTransaction({ schemaVersion: 1, transactions: [] }, {
    idFactory: () => "txn_new_green",
    now: () => "2026-09-11T10:00:00.000Z",
    kind: "received",
    received: [{ code: "ARG7", quantity: 1, variant: "united_edition" }],
    given: [],
  });

  const inventory = adjustedInventoryPayload(rawInventory, ledger, {
    catalog: { cards: [{ code: "ARG7", team: "Argentina", name: "Player" }] },
    legacyCollected: ["ARG7"],
  });

  assert.deepEqual(rawInventory, before);
  assert.equal(inventory.cards.ARG7.count, 2);
  assert.deepEqual(inventory.cards.ARG7.back_insignia_counts, {
    standard_fifa_licensed: 1,
    united_edition: 1,
  });
});

test("catalogue-backed inventory projection excludes unknown raw and ledger codes", () => {
  const inventory = adjustedInventoryPayload({
    cards: {
      ARG7: { code: "ARG7", count: 2 },
      AND13: { code: "AND13", count: 4 },
    },
  }, {
    schemaVersion: 1,
    transactions: [{
      id: "txn_unknown",
      kind: "received",
      status: "completed",
      received: [{ code: "ET3", quantity: 2 }, { code: "ARG7", quantity: 1 }],
      given: [],
    }],
  }, {
    catalog: { cards: [{ code: "ARG7", team: "Argentina", name: "Player" }] },
    legacyCollected: ["ARG7"],
  });

  assert.deepEqual(Object.keys(inventory.cards), ["ARG7"]);
  assert.equal(inventory.cards.ARG7.count, 3);
});

function catalogFor(...codes) {
  return { cards: codes.map((code) => ({ code, team: code.replace(/\d.*$/, ""), name: "Card" })) };
}
