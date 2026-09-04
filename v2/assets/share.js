import { loadCollectionCatalog } from "/fifa-sticker-app/v2/assets/catalog_source.js?v=build-d13e6b8f204a";
import { fetchPublicProjection, publicShareTokenFromLocation } from "/fifa-sticker-app/v2/assets/public_share.js?v=build-d13e6b8f204a";
import { sortCode } from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-d13e6b8f204a";
import {
  buildPublicTradeMatch,
  publicTradeMatchMessage,
} from "/fifa-sticker-app/v2/assets/share_matcher.js?v=build-d13e6b8f204a";
import {
  disclosureControlState,
} from "/fifa-sticker-app/v2/assets/share_filter.js?v=build-d13e6b8f204a";

const status = document.querySelector("#shareStatus");
const updatedAt = document.querySelector("#shareUpdatedAt");
const search = document.querySelector("#shareSearch");
const needsList = document.querySelector("#shareNeedsList");
const offersList = document.querySelector("#shareOffersList");
const needsEmpty = document.querySelector("#shareNeedsEmpty");
const offersEmpty = document.querySelector("#shareOffersEmpty");
const needsCount = document.querySelector("#shareNeedsCount");
const offersCount = document.querySelector("#shareOffersCount");
const needsPanel = document.querySelector("#shareNeedsPanel");
const offersPanel = document.querySelector("#shareOffersPanel");
const needsToggleAll = document.querySelector("#shareNeedsToggleAll");
const offersToggleAll = document.querySelector("#shareOffersToggleAll");
const matchOfferButton = document.querySelector("#shareMatchOfferButton");
const matchNeedButton = document.querySelector("#shareMatchNeedButton");
const matchClearButton = document.querySelector("#shareMatchClearButton");
const matchResult = document.querySelector("#shareMatchResult");
const matchText = document.querySelector("#shareMatchText");
const copyMatchButton = document.querySelector("#shareCopyMatchButton");
let payload = null;
let catalogByCode = new Map();

start();

async function start() {
  const token = publicShareTokenFromLocation();
  const baseUrl = String(globalThis.PANINI_CONFIG?.collectionSyncBaseUrl || "").replace(/\/+$/, "");
  if (!token || !baseUrl) {
    setStatus("This trade link is invalid or no longer shared.", "warning");
    return;
  }
  try {
    const [projection, catalog] = await Promise.all([
      fetchPublicProjection({ baseUrl, token }),
      loadCollectionCatalog(),
    ]);
    payload = projection;
    catalogByCode = new Map(catalog.cards.map((card) => [card.code, card]));
    updatedAt.textContent = `Shared revision ${projection.sourceRevision} · updated ${formatDate(projection.updatedAt)}`;
    updatedAt.hidden = false;
    setStatus("Fresh from their latest collection update.", "ok");
    render();
    matchOfferButton.disabled = false;
    matchNeedButton.disabled = false;
  } catch (error) {
    setStatus(error?.message || "The shared trade list could not be loaded.", "warning");
  }
}

function render() {
  const needs = (Array.isArray(payload?.needs) ? payload.needs : [])
    .map((code) => cardView(code, 1));
  const offers = (Array.isArray(payload?.offers) ? payload.offers : [])
    .map((offer) => cardView(offer.code, offer.quantity));
  renderGroups(needsList, needs, { toggleButton: needsToggleAll });
  renderGroups(offersList, offers, { quantities: true, toggleButton: offersToggleAll });
  needsCount.textContent = `(${needs.length})`;
  offersCount.textContent = `(${offers.length})`;
  needsEmpty.hidden = needs.length > 0;
  offersEmpty.hidden = offers.length > 0;
}

function cardView(code, quantity) {
  const card = catalogByCode.get(code) || {};
  return { code, quantity, team: card.team || "Other", name: card.name || "" };
}

function renderGroups(container, cards, { quantities = false, toggleButton } = {}) {
  container.textContent = "";
  const groups = new Map();
  for (const card of cards.sort((a, b) => sortCode(a.code, b.code))) {
    if (!groups.has(card.team)) groups.set(card.team, []);
    groups.get(card.team).push(card);
  }
  for (const [team, groupCards] of groups) {
    const country = document.createElement("details");
    country.className = "collectionTeam shareCountryDisclosure";
    country.open = false;
    country.addEventListener("toggle", () => syncDisclosureControl(container, toggleButton));
    const summary = document.createElement("summary");
    const summaryContent = document.createElement("span");
    summaryContent.className = "shareCountrySummary";
    const heading = document.createElement("strong");
    heading.textContent = team;
    const count = document.createElement("span");
    count.textContent = `${groupCards.length} sticker${groupCards.length === 1 ? "" : "s"}`;
    summaryContent.append(heading, count);
    summary.append(summaryContent);
    const list = document.createElement("ul");
    list.className = "tradeLookupResults";
    for (const card of groupCards) {
      const item = document.createElement("li");
      item.textContent = `${card.code}${card.name ? ` · ${card.name}` : ""}${quantities ? ` · ${card.quantity} available` : ""}`;
      list.append(item);
    }
    country.append(summary, list);
    container.append(country);
  }
  syncDisclosureControl(container, toggleButton);
}

function syncDisclosureControl(container, button) {
  if (!button) return;
  const state = disclosureControlState(container.querySelectorAll("details.shareCountryDisclosure"));
  button.textContent = state.label;
  button.disabled = state.disabled;
}

function toggleAllCountries(panel, container, button, event) {
  event.preventDefault();
  event.stopPropagation();
  const countries = [...container.querySelectorAll("details.shareCountryDisclosure")];
  const state = disclosureControlState(countries);
  if (state.nextOpen) panel.open = true;
  for (const country of countries) country.open = state.nextOpen;
  syncDisclosureControl(container, button);
}

function setStatus(message, severity) {
  status.dataset.severity = severity;
  status.querySelector("span").textContent = message;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString();
}

function showMatch(mode) {
  if (!payload) return;
  const result = buildPublicTradeMatch({
    value: search.value,
    mode,
    needs: payload.needs,
    offers: payload.offers,
  });
  matchText.value = publicTradeMatchMessage(result);
  matchResult.dataset.status = result.status;
  matchResult.hidden = false;
  copyMatchButton.disabled = result.status !== "match";
  setSelectedMatchMode(mode);
}

function resetMatch() {
  matchText.value = "";
  matchResult.hidden = true;
  matchResult.removeAttribute("data-status");
  copyMatchButton.disabled = true;
  copyMatchButton.textContent = "Copy match";
  setSelectedMatchMode("");
}

function setSelectedMatchMode(mode) {
  for (const [button, buttonMode] of [
    [matchOfferButton, "offer"],
    [matchNeedButton, "need"],
  ]) {
    const selected = mode === buttonMode;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("selected", selected);
  }
}

matchOfferButton.addEventListener("click", () => showMatch("offer"));
matchNeedButton.addEventListener("click", () => showMatch("need"));
matchClearButton.addEventListener("click", () => {
  search.value = "";
  resetMatch();
  search.focus();
});
search.addEventListener("input", resetMatch);
copyMatchButton.addEventListener("click", async () => {
  if (!matchText.value || copyMatchButton.disabled) return;
  try {
    await navigator.clipboard.writeText(matchText.value);
    copyMatchButton.textContent = "Copied";
    window.setTimeout(() => { copyMatchButton.textContent = "Copy match"; }, 1200);
  } catch {
    matchText.focus();
    matchText.select();
  }
});

needsToggleAll.addEventListener("click", (event) => toggleAllCountries(needsPanel, needsList, needsToggleAll, event));
offersToggleAll.addEventListener("click", (event) => toggleAllCountries(offersPanel, offersList, offersToggleAll, event));
