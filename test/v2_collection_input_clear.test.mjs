import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pasteBoxSource = readFileSync(new URL("../v2/assets/trade_paste_box.js", import.meta.url), "utf8");
const collectionSource = readFileSync(new URL("../v2/assets/collection_tracker.js", import.meta.url), "utf8");

test("collection paste box offers a clear button next to voice input", () => {
  assert.match(collectionSource, /capabilities:\s*\{\s*photo:\s*true,\s*voice:\s*true,\s*clear:\s*true\s*\}/);
  assert.match(pasteBoxSource, /button\.id = `\$\{textarea\.id\}ClearButton`/);
  assert.match(pasteBoxSource, /button\.textContent = "Clear"/);
  assert.ok(
    pasteBoxSource.indexOf("row.append(button);") < pasteBoxSource.indexOf("row.append(clearButton);"),
    "the clear button follows the voice button",
  );
});

test("clearing card text also refreshes the parsed preview", () => {
  assert.match(pasteBoxSource, /export function clearTradePasteText\(textarea\)/);
  assert.match(pasteBoxSource, /textarea\.value = "";\s*textarea\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
});

test("successful received and traded-away collection actions clear their consumed text", () => {
  assert.match(collectionSource, /if \(received\.length\) \{[\s\S]*?clearTradePasteText\(updateText\);[\s\S]*?\} else \{/);
  assert.match(collectionSource, /if \(given\.length\) \{[\s\S]*?clearTradePasteText\(updateText\);[\s\S]*?\} else if/);
  assert.match(collectionSource, /function addIgnoredGotCards\([\s\S]*?clearTradePasteText\(updateText\);/);
  assert.match(collectionSource, /function addIgnoredTradedAwayCards\([\s\S]*?clearTradePasteText\(updateText\);/);
});

test("invalid collection actions return before clearing the text", () => {
  assert.match(collectionSource, /function markGotCards\(\) \{\s*const occurrences = parsedUpdateCodes\(\);\s*if \(!occurrences\) return;/);
  assert.match(collectionSource, /async function markTradedAway\(\) \{\s*const occurrences = parsedUpdateCodes\(\);\s*if \(!occurrences\) return;/);
});
