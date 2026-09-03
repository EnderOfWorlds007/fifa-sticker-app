import { extractCodeOccurrences, sortCode } from "./trade_state.js?v=build-c6df73a9142b";

export function buildPublicTradeMatch({ value, mode, needs = [], offers = [] } = {}) {
  const parsedCodes = [...extractCodeOccurrences(value).keys()].sort(sortCode);
  const eligibleCodes = mode === "need"
    ? offers
      .filter((offer) => Number(offer?.quantity || 0) > 0)
      .map((offer) => String(offer?.code || "").toUpperCase())
    : needs.map((code) => String(code || "").toUpperCase());
  const eligible = new Set(eligibleCodes);
  const matchedCodes = parsedCodes.filter((code) => eligible.has(code));
  return {
    mode: mode === "need" ? "need" : "offer",
    parsedCodes,
    matchedCodes,
    status: !parsedCodes.length ? "empty" : matchedCodes.length ? "match" : "no-match",
  };
}

export function publicTradeMatchMessage(result) {
  if (result?.status === "empty") return "Paste at least one sticker code first.";
  if (result?.status !== "match") return "No matches found in this list. Try pasting another one.";
  const label = result.mode === "need" ? "I need" : "I can offer";
  return `Hi! I found a match.\n${label}: ${groupCodes(result.matchedCodes)}.`;
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
