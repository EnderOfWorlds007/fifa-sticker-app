import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pasteBoxSource = read("v2/assets/trade_paste_box.js");
const pasteStatusSource = read("v2/assets/paste_card_status.js");
const gettingStartedSource = read("v2/assets/getting_started.js");
const shareSource = read("v2/assets/share.js");
const serviceWorkerSource = read("v2/sw.js");

test("every reusable V2 card paste box mounts the shared collection-status preview", () => {
  assert.match(pasteBoxSource, /mountPasteCardStatusPreview/);
  assert.match(pasteBoxSource, /cardStatusPreview = true/);
  assert.match(pasteBoxSource, /Parsed status against your collection/);
  assert.match(pasteStatusSource, /extractCodeOccurrences/);
  assert.match(pasteStatusSource, /classifyScannedCards/);
  assert.match(pasteStatusSource, /groupScannedCardStatuses/);
});

test("Getting Started enriches its existing parsed-text review instead of showing a duplicate panel", () => {
  assert.match(gettingStartedSource, /cardStatusPreview: false/);
  assert.match(gettingStartedSource, /classifyScannedCards/);
  assert.match(gettingStartedSource, /renderPastedCardStatusList/);
  assert.match(gettingStartedSource, /scannedCardStatusSummaryText/);
});

test("read-only shared collection parsing uses the published collector model", () => {
  assert.match(shareSource, /mountPasteCardStatusPreview/);
  assert.match(shareSource, /Parsed status against this shared collection/);
  assert.match(shareSource, /function sharedCollectionModel/);
  assert.match(shareSource, /availableToTradeQuantity: offers\.get\(code\) \|\| 0/);
  assert.match(shareSource, /missing: missing\.has\(code\)/);
});

test("offline V2 app shell includes both status modules", () => {
  assert.match(serviceWorkerSource, /assets\/scan_card_status\.js/);
  assert.match(serviceWorkerSource, /assets\/paste_card_status\.js/);
});

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
