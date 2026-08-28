import { extractCodeOccurrences } from "./trade_state.js?v=build-b1f8ab4abf3c";

export function buildSharedListQuery(value) {
  const text = String(value || "").trim().toLowerCase();
  return {
    text,
    codes: [...extractCodeOccurrences(value).keys()],
  };
}

export function sharedCardMatches(card, query) {
  if (!query?.text) return true;
  const searchable = `${card?.code || ""} ${card?.team || ""} ${card?.name || ""}`.toLowerCase();
  return searchable.includes(query.text)
    || query.codes.includes(String(card?.code || "").toUpperCase());
}
