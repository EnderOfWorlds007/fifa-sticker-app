import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compareParsedCodes,
  insigniaQuantity,
  insigniaVariantForFilter,
  partitionOutgoingLinesByAvailability,
} from "../v2/assets/trade_state.js";
import { buildPublicTradeMatch, publicTradeMatchMessage } from "../v2/assets/share_matcher.js";

const mixedCard = {
  code: "ARG10",
  count: 5,
  back_insignia_type: "mixed",
  back_insignia_counts: {
    united_edition: 2,
    standard_fifa_licensed: 3,
  },
};

test("insignia filter maps green and blue to the scanner back variants", () => {
  assert.equal(insigniaVariantForFilter("green"), "united_edition");
  assert.equal(insigniaVariantForFilter("blue"), "standard_fifa_licensed");
  assert.equal(insigniaQuantity(mixedCard, "both"), 5);
  assert.equal(insigniaQuantity(mixedCard, "green"), 2);
  assert.equal(insigniaQuantity(mixedCard, "blue"), 3);
});

test("compare limits cards I can give to the selected back colour", () => {
  const occurrences = new Map([["ARG10", 1]]);
  const inventory = { cards: { ARG10: mixedCard } };
  assert.equal(compareParsedCodes(occurrences, inventory, [], { insigniaFilter: "both" }).canGive[0].available, 5);
  const green = compareParsedCodes(occurrences, inventory, [], { insigniaFilter: "green" }).canGive[0];
  assert.equal(green.available, 2);
  assert.equal(green.variant, "united_edition");
  assert.equal(compareParsedCodes(occurrences, inventory, [], { insigniaFilter: "blue" }).canGive[0].available, 3);
});

test("trade availability partitions outgoing cards by selected back colour", () => {
  const split = partitionOutgoingLinesByAvailability({
    additions: [{ code: "ARG10", quantity: 3, variant: "united_edition" }],
    inventory: { cards: { ARG10: mixedCard } },
  });
  assert.deepEqual(split.added, [{ code: "ARG10", quantity: 2, variant: "united_edition" }]);
  assert.deepEqual(split.ignored, [{ code: "ARG10", quantity: 1, variant: "united_edition" }]);
});

test("read-only matching filters only the shared collector's offers", () => {
  const offers = [
    { code: "ARG10", quantity: 5, variants: { green: 2, blue: 3 } },
    { code: "FRA7", quantity: 1, variants: { green: 0, blue: 1 } },
  ];
  const green = buildPublicTradeMatch({ value: "ARG10 FRA7", mode: "need", offers, insigniaFilter: "green" });
  assert.deepEqual(green.matchedCodes, ["ARG10"]);
  assert.match(publicTradeMatchMessage(green), /I need \(green backs\): ARG: 10/);
  const offer = buildPublicTradeMatch({ value: "FRA7", mode: "offer", needs: ["FRA7"], offers, insigniaFilter: "green" });
  assert.deepEqual(offer.matchedCodes, ["FRA7"]);
});

test("all five V2 query surfaces mount the shared three-state filter", () => {
  const surfaces = ["collection", "inventory", "compare", "trade", "share"];
  for (const surface of surfaces) {
    const html = readFileSync(new URL(`../v2/${surface}/index.html`, import.meta.url), "utf8");
    const script = readFileSync(new URL(`../v2/assets/${surface === "collection" ? "collection_tracker" : surface === "trade" ? "trade_builder" : surface}.js`, import.meta.url), "utf8");
    assert.match(html, /data-insignia-filter/, `${surface} should include the filter host`);
    assert.match(script, /mountInsigniaFilter/, `${surface} should mount the filter`);
  }
  const filterSource = readFileSync(new URL("../v2/assets/insignia_filter.js", import.meta.url), "utf8");
  assert.match(filterSource, />Both</);
  assert.match(filterSource, />Green</);
  assert.match(filterSource, />Blue</);
});

test("public projections are versioned for colour quantities", () => {
  const projectionSource = readFileSync(new URL("../v2/assets/inventory_projection.js", import.meta.url), "utf8");
  const shareSource = readFileSync(new URL("../v2/assets/public_share.js", import.meta.url), "utf8");
  assert.match(projectionSource, /variants:\s*\{/);
  assert.match(projectionSource, /green: insigniaQuantity/);
  assert.match(projectionSource, /blue: insigniaQuantity/);
  assert.match(shareSource, /PUBLIC_PROJECTION_MODEL_VERSION = 3/);
  assert.match(shareSource, /modelVersion: PUBLIC_PROJECTION_MODEL_VERSION/);
});
