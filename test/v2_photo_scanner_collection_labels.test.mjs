import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../v2/assets/photo_scanner.js", import.meta.url), "utf8");

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
  const splitBody = functionBody("splitCollectionCodes");
  assert.match(splitBody, /addInventoryAlbumCodes\(owned,\s*loadCachedInventoryPayload\(\)\)/);
  const albumBody = functionBody("addInventoryAlbumCodes");
  assert.match(albumBody, /album_count/);
  assert.match(albumBody, /in_album === true/);
  assert.doesNotMatch(albumBody, /card\?\.owned === true/, "loose inventory ownership is not treated as album placement");
});

test("recognized code rows use one shared renderer", () => {
  const directRenderExpressions = source.match(/codesList\.replaceChildren\(\.\.\.\(latestScanCodes\.length/g) || [];
  assert.equal(directRenderExpressions.length, 1);
  assert.match(functionBody("renderResults"), /renderRecognizedCodeRows\(\)/);
  assert.match(functionBody("updateResultFromReviewSlots"), /renderRecognizedCodeRows\(\)/);
});
