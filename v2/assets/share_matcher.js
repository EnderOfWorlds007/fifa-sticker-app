import {
  allocateInsigniaQuantities,
  extractCodeOccurrences,
  insigniaFilterIsStrict,
  insigniaQuantity,
  normalizeInsigniaFilter,
  sortCode,
} from "./trade_state.js?v=build-42a76c25ccf2";

export function buildPublicTradeMatch({ value, mode, needs = [], offers = [], insigniaFilter = "both" } = {}) {
  const normalizedFilter = normalizeInsigniaFilter(insigniaFilter);
  const occurrences = extractCodeOccurrences(value);
  const parsedCodes = [...occurrences.keys()].sort(sortCode);
  const colourUnavailable = mode === "need"
    && insigniaFilterIsStrict(normalizedFilter)
    && !publicOffersHaveInsigniaData(offers);
  const eligibleCodes = mode === "need"
    ? offers
      .filter((offer) => insigniaQuantity(offer, normalizedFilter) > 0)
      .map((offer) => String(offer?.code || "").toUpperCase())
    : needs.map((code) => String(code || "").toUpperCase());
  const eligible = new Set(eligibleCodes);
  const matchedCodes = parsedCodes.filter((code) => eligible.has(code));
  const offersByCode = new Map(offers.map((offer) => [String(offer?.code || "").toUpperCase(), offer]));
  const allocatedOffers = mode === "need"
    ? matchedCodes.flatMap((code) => allocateInsigniaQuantities(
      offersByCode.get(code),
      Math.max(1, Number(occurrences.get(code) || 1)),
      normalizedFilter,
    ).map((allocation) => ({ code, ...allocation })))
    : [];
  return {
    mode: mode === "need" ? "need" : "offer",
    insigniaFilter: normalizedFilter,
    parsedCodes,
    matchedCodes,
    allocatedOffers,
    status: !parsedCodes.length
      ? "empty"
      : colourUnavailable
        ? "colour-unavailable"
        : matchedCodes.length
          ? "match"
          : "no-match",
  };
}

export function publicTradeMatchMessage(result) {
  if (result?.status === "empty") return "Paste at least one sticker code first.";
  if (result?.status === "colour-unavailable") {
    return "Card-back colours have not reached this shared list yet. Ask its owner to open Compare or Collection once, then try again.";
  }
  if (result?.status !== "match") return "No matches found in this list. Try pasting another one.";
  if (result.mode !== "need") {
    return `Hi! I found a match.\nI can offer: ${groupCodes(result.matchedCodes)}.`;
  }
  const colourLines = formattedColourLines(result.allocatedOffers || []);
  return colourLines.length
    ? `Hi! I found a match.\nI need:\n${colourLines.join("\n")}`
    : `Hi! I found a match.\nI need: ${groupCodes(result.matchedCodes)}.`;
}

function formattedColourLines(lines) {
  const groups = [
    ["standard_fifa_licensed", "Blue"],
    ["united_edition", "Green"],
    ["", "Back not recorded"],
  ];
  return groups.flatMap(([variant, label]) => {
    const matches = lines.filter((line) => (line.variant || "") === variant);
    return matches.length ? [`${label}: ${formatAllocatedCodes(matches)}.`] : [];
  });
}

function formatAllocatedCodes(lines) {
  return [...lines]
    .sort((a, b) => sortCode(a.code, b.code))
    .map((line) => `${line.code}${line.quantity > 1 ? ` ×${line.quantity}` : ""}`)
    .join(", ");
}

export function publicOffersHaveInsigniaData(offers = []) {
  const available = Array.isArray(offers) ? offers : [];
  const totalQuantity = available.reduce((sum, offer) => sum + Math.max(0, Number(offer?.quantity || 0)), 0);
  if (!totalQuantity) return true;
  return available.some((offer) => (
    Math.max(0, Number(offer?.variants?.green || 0))
    + Math.max(0, Number(offer?.variants?.blue || 0))
  ) > 0);
}

function groupCodes(codes) {
  const groups = new Map();
  const standalone = [];
  for (const code of [...codes].sort(sortCode)) {
    const match = String(code).match(/^([A-Z]+)(\d+)(S)?$/);
    if (!match) {
      standalone.push(String(code));
      continue;
    }
    if (!groups.has(match[1])) groups.set(match[1], []);
    groups.get(match[1]).push(`${Number(match[2])}${match[3] || ""}`);
  }
  return [
    ...standalone,
    ...groups.entries().map(([team, numbers]) => `${team}: ${numbers.join(", ")}`),
  ].join("; ");
}
