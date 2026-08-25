import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../v2/assets/photo_scanner.js", import.meta.url), "utf8");
const scannerHtml = readFileSync(new URL("../v2/scanner/index.html", import.meta.url), "utf8");
const projectionSource = readFileSync(new URL("../v2/assets/inventory_projection.js", import.meta.url), "utf8");
const collectionSource = readFileSync(new URL("../v2/assets/collection_tracker.js", import.meta.url), "utf8");
const compareSource = readFileSync(new URL("../v2/assets/compare.js", import.meta.url), "utf8");
const tradeBuilderSource = readFileSync(new URL("../v2/assets/trade_builder.js", import.meta.url), "utf8");
const collectionModelSource = readFileSync(new URL("../v2/assets/collection_model.js", import.meta.url), "utf8");
const collectionInventory = JSON.parse(
  readFileSync(new URL("../v2/data/collection_inventory.json", import.meta.url), "utf8"),
);

const EXPECTED_MISSING_CODES = [
  "ALG12",
  "ARG10",
  "AUS13",
  "AUS14",
  "AUS16",
  "AUS18",
  "AUT18",
  "BIH2",
  "CIV17",
  "CZE13",
  "ENG13",
  "FRA1",
  "GER14",
  "GER15",
  "HAI3",
  "HAI4",
  "IRN6",
  "IRQ9",
  "JOR6",
  "NED15",
  "PAR2",
  "QAT19",
  "RSA10",
  "SCO10",
  "SUI13",
  "TUN8",
  "URU19",
];

function functionBody(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} exists`);
  const paramsStart = source.indexOf("(", start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") paramsDepth += 1;
    if (char === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      bodyStart = source.indexOf("{", index);
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `${name} body starts`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`${name} body closes`);
}

test("adding scan to collection refreshes per-card album labels", () => {
  const body = functionBody("addScanToCollection");
  assert.match(body, /latestCollectionSplit\s*=\s*splitCollectionCodes\(latestScanCodes\)/);
  assert.match(body, /renderCollectionActions\(\)/);
  assert.match(body, /renderRecognizedCodeRows\(\)/);
  assert.ok(
    body.indexOf("renderRecognizedCodeRows()") > body.indexOf("renderCollectionActions()"),
    "rows refresh after the collection summary refreshes",
  );
});

test("scanner album labels include cached inventory album ownership", () => {
  assert.match(source, /import \{ loadCachedInventoryPayload \} from "\/fifa-sticker-app\/v2\/assets\/inventory_source\.js/);
  assert.match(source, /import \{ loadInventoryProjection \} from "\/fifa-sticker-app\/v2\/assets\/inventory_projection\.js/);
  assert.match(source, /splitCodesByResolvedCollectionModel/);
  const splitBody = functionBody("splitCollectionCodes");
  assert.match(splitBody, /latestInventoryProjection\?\.collectionModel/);
  assert.match(splitBody, /splitCodesByResolvedCollectionModel\(codes,\s*latestInventoryProjection\.collectionModel\)/);
  assert.match(splitBody, /splitCodesByAlbumStatus\(codes,\s*\{/);
  assert.match(splitBody, /collectionState:\s*loadCollectionState\(\)/);
  assert.match(splitBody, /ledger:\s*loadLedger\(\)/);
  assert.match(splitBody, /inventoryPayload:\s*loadCachedInventoryPayload\(\)/);
});

test("scanner normalizes recognized code formatting before row classification", () => {
  assert.match(source, /import \{[\s\S]*normalizeCollectionCodeList[\s\S]*\} from "\/fifa-sticker-app\/v2\/assets\/collection_model\.js/);
  assert.match(functionBody("normalizeCodeList"), /return normalizeCollectionCodeList\(codes\)/);
  assert.match(collectionModelSource, /export function normalizeCollectionCodeList/);
  assert.match(collectionModelSource, /replace\(\s*\/\[\\s_-\]\/g,\s*""\s*\)/);
});

test("scanner album labels honor explicit collection overrides", () => {
  assert.match(collectionModelSource, /export function applyAlbumStatusOverridesToCodes/);
  assert.match(collectionModelSource, /status === "present"/);
  assert.match(collectionModelSource, /owned\.add\(code\)/);
  assert.match(collectionModelSource, /status === "missing"/);
  assert.match(collectionModelSource, /owned\.delete\(code\)/);
});

test("inventory-aware screens use the shared resolved collection model", () => {
  assert.match(projectionSource, /import \{ deriveResolvedCollectionModel \} from "\/fifa-sticker-app\/v2\/assets\/collection_model\.js/);
  assert.match(projectionSource, /const collectionModel = deriveResolvedCollectionModel\(\{/);
  assert.doesNotMatch(projectionSource, /deriveCollectionModel/);
  assert.doesNotMatch(collectionSource, /function applyAlbumStatusOverrides/);
  assert.match(collectionSource, /return currentInventoryProjection\(\)\.collectionModel/);
});

test("recognized code rows use one shared renderer", () => {
  const directRenderExpressions = source.match(/codesList\.replaceChildren\(\.\.\.\(latestScanCodes\.length/g) || [];
  assert.equal(directRenderExpressions.length, 1);
  assert.match(functionBody("renderResults"), /renderRecognizedCodeRows\(\)/);
  assert.match(functionBody("updateResultFromReviewSlots"), /renderRecognizedCodeRows\(\)/);
});

test("scanner add-to-collection is one-shot with undo", () => {
  assert.match(scannerHtml, /id="photoUndoCollectionButton"/);
  assert.match(source, /import \{[\s\S]*cancelTransaction[\s\S]*\} from "\/fifa-sticker-app\/v2\/assets\/trade_state\.js/);
  assert.match(source, /let latestAppliedScan = \{ signature: "", transactionId: "" \}/);
  assert.match(source, /undoCollectionButton\?\.addEventListener\("click", undoLastScanAdd\)/);

  const addBody = functionBody("addScanToCollection");
  assert.match(addBody, /if \(isCurrentScanApplied\(\)\) \{/);
  assert.match(addBody, /This scan was already added/);
  assert.match(addBody, /const nextLedger = createTransaction\(loadLedger\(\), \{ kind: "received", received, given: \[\] \}\)/);
  assert.match(addBody, /latestAppliedScan = \{ signature: currentScanSignature\(\), transactionId \}/);

  const renderBody = functionBody("renderCollectionActions");
  assert.match(renderBody, /const applied = isCurrentScanApplied\(\)/);
  assert.match(renderBody, /addCollectionButton\.disabled = applied/);
  assert.match(renderBody, /undoCollectionButton\.hidden = !applied/);

  const undoBody = functionBody("undoLastScanAdd");
  assert.match(undoBody, /cancelTransaction\(loadLedger\(\), latestAppliedScan\.transactionId\)/);
  assert.match(undoBody, /already undone elsewhere/);
  assert.match(undoBody, /latestAppliedScan = \{ signature: "", transactionId: "" \}/);
  assert.match(undoBody, /Scan add undone/);
});

test("seeded V2 missing list matches the three-letter country-code list", () => {
  const missingCodes = collectionInventory.cards
    .filter((card) => !card.in_album || card.source === "missing")
    .map((card) => card.code)
    .sort();

  assert.deepEqual(missingCodes, EXPECTED_MISSING_CODES);
  assert.equal(collectionInventory.stats.missing_count, EXPECTED_MISSING_CODES.length);
  assert.equal(collectionInventory.stats.album_owned_count, collectionInventory.cards.length - EXPECTED_MISSING_CODES.length);
  assert.ok(missingCodes.every((code) => /^[A-Z]{3}\d+$/.test(code)), "missing entries use 3-letter prefixes");
  assert.ok(!missingCodes.includes("USA2"));
  assert.ok(!missingCodes.includes("USA7"));
});

test("fallback missing constants use the same three-letter country-code seed", () => {
  for (const fileSource of [collectionSource, compareSource, tradeBuilderSource]) {
    assert.match(fileSource, /RSA:\s*\[10\]/);
    assert.match(fileSource, /CZE:\s*\[13\]/);
    assert.match(fileSource, /BIH:\s*\[2\]/);
    assert.match(fileSource, /ENG:\s*\[13\]/);
    assert.doesNotMatch(fileSource, /USA:\s*\[/);
    assert.doesNotMatch(fileSource, /FWC:\s*\[/);
    assert.doesNotMatch(fileSource, /CC:\s*\[/);
  }
});
