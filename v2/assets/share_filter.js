import { extractCodeOccurrences } from "./trade_state.js?v=build-63027806af42";

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

export function disclosureControlState(disclosures) {
  const items = [...(disclosures || [])];
  const allOpen = items.length > 0 && items.every((item) => item?.open === true);
  return {
    nextOpen: !allOpen,
    label: allOpen ? "Collapse all" : "Show all",
    disabled: items.length === 0,
  };
}
