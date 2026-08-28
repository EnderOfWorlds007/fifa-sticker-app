import { extractCodeOccurrences } from "./trade_state.js?v=build-1fbffbba6425";

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
