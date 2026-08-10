import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCodeOccurrences,
  extractDirectedCodeOccurrences,
} from "../v2/assets/trade_state.js";

test("v2 parser handles grouped country codes with flag emoji before colons", () => {
  const text = `Sorry, we got Tur 7 from a friend , belie is updated list.
I need
GER 🇩🇪: 9
ECU 🇪🇨: 8
COD 🇨🇩: 8
GHA 🇬🇭: 12`;

  assert.deepEqual([...extractCodeOccurrences(text).entries()], [
    ["COD8", 1],
    ["ECU8", 1],
    ["GER9", 1],
    ["GHA12", 1],
    ["TUR7", 1],
  ]);

  const directed = extractDirectedCodeOccurrences(text);
  assert.deepEqual([...directed.ambiguous.entries()], [["TUR7", 1]]);
  assert.deepEqual([...directed.offers.entries()], []);
  assert.deepEqual([...directed.wants.entries()], [
    ["COD8", 1],
    ["ECU8", 1],
    ["GER9", 1],
    ["GHA12", 1],
  ]);
});
