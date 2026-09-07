import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compareParsedCodes,
  insigniaQuantity,
  insigniaVariantForFilter,
  partitionOutgoingLinesByAvailability,
} from "../v2/assets/trade_state.js";
import { buildPublicTradeMatch, publicOffersHaveInsigniaData, publicTradeMatchMessage } from "../v2/assets/share_matcher.js";
import { cacheInventoryPayload, INVENTORY_SNAPSHOT_KEY } from "../v2/assets/inventory_source.js";

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

test("an inventory refresh notifies cloud sharing only when its snapshot changes", () => {
  const values = new Map();
  const events = [];
  class TestCustomEvent {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  }
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const eventTarget = {
    CustomEvent: TestCustomEvent,
    dispatchEvent: (event) => events.push(event),
  };
  const payload = { cards: { ARG10: mixedCard } };
  cacheInventoryPayload(storage, payload, { sourceLabel: "scanner" }, { eventTarget });
  cacheInventoryPayload(storage, payload, { sourceLabel: "scanner" }, { eventTarget });
  assert.equal(values.get(INVENTORY_SNAPSHOT_KEY), JSON.stringify(payload));
  assert.deepEqual(events.map((event) => [event.type, event.detail.kind]), [
    ["panini:local-state-saved", "inventory-refresh"],
  ]);
});

test("read-only matching explains stale shared projections instead of reporting no matches", () => {
  const oldOffers = [{ code: "ARG10", quantity: 2 }];
  assert.equal(publicOffersHaveInsigniaData(oldOffers), false);
  const result = buildPublicTradeMatch({
    value: "ARG10",
    mode: "need",
    offers: oldOffers,
    insigniaFilter: "green",
  });
  assert.equal(result.status, "colour-unavailable");
  assert.match(publicTradeMatchMessage(result), /colours have not reached this shared list/i);
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
  assert.match(shareSource, /PUBLIC_PROJECTION_MODEL_VERSION = 4/);
  assert.match(shareSource, /modelVersion: PUBLIC_PROJECTION_MODEL_VERSION/);
  const cloudSource = readFileSync(new URL("../v2/assets/cloud_sync.js", import.meta.url), "utf8");
  assert.match(cloudSource, /pendingInitializationSave = kind/);
  assert.match(cloudSource, /if \(upgradeNeeded \|\| pendingKind\) queueAutosave/);
});
