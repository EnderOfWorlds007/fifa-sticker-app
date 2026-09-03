import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyScannedCards,
  SCANNED_CARD_STATUS,
  summarizeScannedCardStatuses,
} from "../v2/assets/scan_card_status.js";

const { NEW_FOR_ALBUM, NEW_TRADING_CARD, DUPLICATE_TRADING_CARD } = SCANNED_CARD_STATUS;

function collectionModel(cards) {
  return {
    byCode: Object.fromEntries(cards.map(({ code, missing, availableToTradeQuantity = 0 }) => [code, {
      code,
      missing,
      inventory: { availableToTradeQuantity },
    }])),
  };
}

test("missing repeated cards fill the album, create a first trading card, then become duplicates", () => {
  const statuses = classifyScannedCards(
    ["AUS-16", "AUS16", "AUS 16"],
    collectionModel([{ code: "AUS16", missing: true }]),
  );
  assert.deepEqual(statuses, [
    { code: "AUS16", status: NEW_FOR_ALBUM, priorTradingQuantity: 0 },
    { code: "AUS16", status: NEW_TRADING_CARD, priorTradingQuantity: 0 },
    { code: "AUS16", status: DUPLICATE_TRADING_CARD, priorTradingQuantity: 1 },
  ]);
});

test("an owned album card becomes a new trading card before later scan copies are duplicates", () => {
  const statuses = classifyScannedCards(
    ["COD2", "COD2"],
    collectionModel([{ code: "COD2", missing: false }]),
  );
  assert.deepEqual(statuses.map(({ status }) => status), [NEW_TRADING_CARD, DUPLICATE_TRADING_CARD]);
  assert.equal(statuses[1].priorTradingQuantity, 1);
});

test("a card already available for trade is identified as a duplicate trading card", () => {
  const statuses = classifyScannedCards(
    ["TUN8", "TUN8"],
    collectionModel([{ code: "TUN8", missing: false, availableToTradeQuantity: 2 }]),
  );
  assert.deepEqual(statuses, [
    { code: "TUN8", status: DUPLICATE_TRADING_CARD, priorTradingQuantity: 2 },
    { code: "TUN8", status: DUPLICATE_TRADING_CARD, priorTradingQuantity: 3 },
  ]);
});

test("scan status summary counts each physical card occurrence", () => {
  const statuses = classifyScannedCards(
    ["AUS16", "COD2", "COD2", "TUN8"],
    collectionModel([
      { code: "AUS16", missing: true },
      { code: "COD2", missing: false },
      { code: "TUN8", missing: false, availableToTradeQuantity: 1 },
    ]),
  );
  assert.deepEqual(summarizeScannedCardStatuses(statuses), {
    newForAlbum: 1,
    newTradingCards: 1,
    duplicateTradingCards: 2,
  });
});
