import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../v2/assets/collection_tracker.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("the hunt-list fallback is display-only when the physical catalogue is unavailable", () => {
  assert.match(source, /let catalogueReady = false;/);
  assert.match(source, /catch \{\s*catalogueReady = false;[\s\S]*?read-only; collection and trade changes are disabled/);
  assert.match(functionBody("trackedCodeSet"), /return catalogueReady \? new Set\(cards\.map[\s\S]*: new Set\(\);/);
  assert.match(functionBody("requireVerifiedCatalogue"), /catalogueReady && catalogHasCards\(collectionCatalog\)/);
});

test("collection mutations fail closed without a verified catalogue", () => {
  for (const name of [
    "recordReceivedLines",
    "recordTradedAwayLines",
    "markGotCards",
    "markTradedAway",
    "addIgnoredGotCards",
    "addIgnoredTradedAwayCards",
    "stageAlbumStatusFlip",
    "saveAlbumStatusChanges",
    "applyAlbumInventoryUpdates",
    "undoTransaction",
    "restoreBackup",
    "chooseBackupFile",
    "importBackupFile",
    "startOwnTracker",
  ]) {
    assert.match(functionBody(name), /if \(!requireVerifiedCatalogue\(\)\) return(?: \[\])?;/, `${name} should fail closed`);
  }
  assert.match(functionBody("render"), /gotCardsButton\.disabled = !catalogueReady;/);
  assert.match(functionBody("render"), /restoreButton\.disabled = !catalogueReady;/);
  assert.match(functionBody("render"), /resetButton\.disabled = !catalogueReady;/);
});

test("cancelling a legacy trade does not rewrite its unverified basket", () => {
  const tradeSource = readFileSync(new URL("../v2/assets/trade_builder.js", import.meta.url), "utf8");
  const start = tradeSource.indexOf("async function transitionActiveTrade(");
  const end = tradeSource.indexOf("\nfunction validateTradeCatalogueLines", start);
  const body = tradeSource.slice(start, end);
  assert.match(body, /if \(nextStatus !== "cancelled" && isActiveTradeEditable\(\)\)/);
});
