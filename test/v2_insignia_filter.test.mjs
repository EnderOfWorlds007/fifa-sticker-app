import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  allocateInsigniaQuantities,
  assignOutgoingVariants,
  compareParsedCodes,
  insigniaFilterIsStrict,
  insigniaQuantity,
  insigniaVariantForFilter,
  normalizeInsigniaFilter,
  partitionOutgoingLinesByAvailability,
  preferredInsigniaVariant,
} from "../v2/assets/trade_state.js";
import { buildPublicTradeMatch, publicOffersHaveInsigniaData, publicTradeMatchMessage } from "../v2/assets/share_matcher.js";
import { cacheInventoryPayload, INVENTORY_SNAPSHOT_KEY } from "../v2/assets/inventory_source.js";
import { publicShareRefreshNeededOnPage } from "../v2/assets/public_share_refresh.js";

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
  assert.equal(insigniaQuantity(mixedCard, "prefer-green"), 5);
  assert.equal(insigniaQuantity(mixedCard, "prefer-blue"), 5);
});

test("preference modes maximise their colour and then preserve coverage with the other colour", () => {
  assert.deepEqual(allocateInsigniaQuantities(mixedCard, 4, "prefer-blue"), [
    { quantity: 3, variant: "standard_fifa_licensed" },
    { quantity: 1, variant: "united_edition" },
  ]);
  assert.deepEqual(allocateInsigniaQuantities(mixedCard, 4, "prefer-green"), [
    { quantity: 2, variant: "united_edition" },
    { quantity: 2, variant: "standard_fifa_licensed" },
  ]);
  const assigned = assignOutgoingVariants(
    [{ code: "ARG10", quantity: 3 }],
    { cards: { ARG10: mixedCard } },
    {
      existing: [{ code: "ARG10", quantity: 1, variant: "united_edition" }],
      preferredVariant: "united_edition",
    },
  );
  assert.deepEqual(assigned, [
    { code: "ARG10", quantity: 1, variant: "united_edition" },
    { code: "ARG10", quantity: 2, variant: "standard_fifa_licensed" },
  ]);
});

test("all five modes normalize without weakening the strict green and blue filters", () => {
  assert.equal(normalizeInsigniaFilter("both"), "both");
  assert.equal(normalizeInsigniaFilter("green"), "green");
  assert.equal(normalizeInsigniaFilter("blue"), "blue");
  assert.equal(normalizeInsigniaFilter("prefer-green"), "prefer-green");
  assert.equal(normalizeInsigniaFilter("prefer-blue"), "prefer-blue");
  assert.equal(normalizeInsigniaFilter("unexpected"), "both");
  assert.equal(insigniaFilterIsStrict("green"), true);
  assert.equal(insigniaFilterIsStrict("blue"), true);
  assert.equal(insigniaFilterIsStrict("prefer-green"), false);
  assert.equal(insigniaFilterIsStrict("prefer-blue"), false);
  assert.equal(preferredInsigniaVariant("prefer-green"), "united_edition");
  assert.equal(preferredInsigniaVariant("prefer-blue"), "standard_fifa_licensed");
});

test("both and preference allocations split quantities deterministically and retain unrecorded backs", () => {
  assert.deepEqual(allocateInsigniaQuantities(mixedCard, 4, "both"), [
    { quantity: 3, variant: "standard_fifa_licensed" },
    { quantity: 1, variant: "united_edition" },
  ]);
  const partiallyRecordedCard = {
    code: "ECU7",
    count: 3,
    back_insignia_type: "mixed",
    back_insignia_counts: {
      united_edition: 1,
      standard_fifa_licensed: 1,
    },
  };
  assert.deepEqual(allocateInsigniaQuantities(partiallyRecordedCard, 3, "prefer-green"), [
    { quantity: 1, variant: "united_edition" },
    { quantity: 1, variant: "standard_fifa_licensed" },
    { quantity: 1 },
  ]);
  assert.deepEqual(allocateInsigniaQuantities(mixedCard, 4, "green"), [
    { quantity: 2, variant: "united_edition" },
  ]);
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
  assert.match(publicTradeMatchMessage(green), /I need:\nGreen: ARG10\./);
  const offer = buildPublicTradeMatch({ value: "FRA7", mode: "offer", needs: ["FRA7"], offers, insigniaFilter: "green" });
  assert.deepEqual(offer.matchedCodes, ["FRA7"]);
});

test("read-only preference matching keeps coverage and produces colour-labelled copy text", () => {
  const offers = [
    { code: "ARG10", quantity: 5, variants: { green: 2, blue: 3 } },
    { code: "FRA7", quantity: 1, variants: { green: 0, blue: 1 } },
  ];
  const green = buildPublicTradeMatch({
    value: "ARG10 ×4, FRA7",
    mode: "need",
    offers,
    insigniaFilter: "prefer-green",
  });
  assert.deepEqual(green.matchedCodes, ["ARG10", "FRA7"]);
  assert.deepEqual(green.allocatedOffers, [
    { code: "ARG10", quantity: 2, variant: "united_edition" },
    { code: "ARG10", quantity: 2, variant: "standard_fifa_licensed" },
    { code: "FRA7", quantity: 1, variant: "standard_fifa_licensed" },
  ]);
  assert.equal(
    publicTradeMatchMessage(green),
    "Hi! I found a match.\nI need:\nBlue: ARG10 ×2, FRA7.\nGreen: ARG10 ×2.",
  );
});

test("read-only prefer-blue maximises blue while retaining green-only matches", () => {
  const offers = [
    { code: "BEL19", quantity: 2, variants: { green: 1, blue: 1 } },
    { code: "COL17", quantity: 1, variants: { green: 1, blue: 0 } },
    { code: "ECU7", quantity: 2, variants: { green: 0, blue: 2 } },
  ];
  const result = buildPublicTradeMatch({
    value: "ECU7 ×2, BEL19 ×2, COL17",
    mode: "need",
    offers,
    insigniaFilter: "prefer-blue",
  });
  assert.deepEqual(result.matchedCodes, ["BEL19", "COL17", "ECU7"]);
  assert.equal(
    publicTradeMatchMessage(result),
    "Hi! I found a match.\nI need:\nBlue: BEL19, ECU7 ×2.\nGreen: BEL19, COL17.",
  );
});

test("Compare copy and trade drafts consume the shared colour allocation", () => {
  const compareSource = readFileSync(new URL("../v2/assets/compare.js", import.meta.url), "utf8");
  const tradeSource = readFileSync(new URL("../v2/assets/trade_builder.js", import.meta.url), "utf8");
  assert.match(compareSource, /allocateInsigniaQuantities/);
  assert.match(compareSource, /\["standard_fifa_licensed", "Blue"\]/);
  assert.match(compareSource, /\["united_edition", "Green"\]/);
  assert.match(compareSource, /const given = allocatedGiveLines/);
  assert.match(tradeSource, /assignOutgoingVariants\(split\.added/);
  assert.match(tradeSource, /preferredVariant: preferredInsigniaVariant/);
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

test("read-only preference modes keep matching when shared card-back colours are unavailable", () => {
  const oldOffers = [
    { code: "JOR1", quantity: 1 },
    { code: "POR11", quantity: 2 },
  ];
  for (const insigniaFilter of ["prefer-green", "prefer-blue"]) {
    const result = buildPublicTradeMatch({
      value: "JOR1 POR11",
      mode: "need",
      offers: oldOffers,
      insigniaFilter,
    });
    assert.equal(result.status, "match");
    assert.deepEqual(result.matchedCodes, ["JOR1", "POR11"]);
    assert.equal(
      publicTradeMatchMessage(result),
      "Hi! I found a match.\nI need:\nBack not recorded: JOR1, POR11.",
    );
  }
});

test("all five V2 query surfaces mount the shared five-state filter", () => {
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
  assert.match(filterSource, />Prefer green</);
  assert.match(filterSource, />Prefer blue</);
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
  assert.match(cloudSource, /upgradeNeeded \|\| pageRefreshNeeded \|\| pendingKind/);
});

test("enabled shares republish automatically from Compare and Collection", () => {
  const enabled = { enabled: true, token: "present" };
  assert.equal(publicShareRefreshNeededOnPage(enabled, { pathname: "/fifa-sticker-app/v2/compare/" }), true);
  assert.equal(publicShareRefreshNeededOnPage(enabled, { pathname: "/fifa-sticker-app/v2/collection/" }), true);
  assert.equal(publicShareRefreshNeededOnPage(enabled, { pathname: "/fifa-sticker-app/v2/share/" }), false);
  assert.equal(publicShareRefreshNeededOnPage({ enabled: false }, { pathname: "/fifa-sticker-app/v2/compare/" }), false);
  const compareSource = readFileSync(new URL("../v2/assets/compare.js", import.meta.url), "utf8");
  assert.match(compareSource, /compare-public-share-refresh/);
  assert.match(compareSource, /if \(publicShareRefreshRequested\) return/);
});
