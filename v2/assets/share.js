import { loadCollectionCatalog } from "/fifa-sticker-app/v2/assets/catalog_source.js?v=build-1fbffbba6425";
import { fetchPublicProjection, publicShareTokenFromLocation } from "/fifa-sticker-app/v2/assets/public_share.js?v=build-1fbffbba6425";
import { sortCode } from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-1fbffbba6425";
import { buildSharedListQuery, sharedCardMatches } from "/fifa-sticker-app/v2/assets/share_filter.js?v=build-1fbffbba6425";

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
    setStatus("This is the latest read-only trade list.", "ok");
    render();
    search.addEventListener("input", render);
  } catch (error) {
    setStatus(error?.message || "The shared trade list could not be loaded.", "warning");
  }
}

function render() {
  const query = buildSharedListQuery(search.value);
  const needs = (Array.isArray(payload?.needs) ? payload.needs : [])
    .map((code) => cardView(code, 1))
    .filter((card) => sharedCardMatches(card, query));
  const offers = (Array.isArray(payload?.offers) ? payload.offers : [])
    .map((offer) => cardView(offer.code, offer.quantity))
    .filter((card) => sharedCardMatches(card, query));
  renderGroups(needsList, needs, { query });
  renderGroups(offersList, offers, { quantities: true, query });
  needsCount.textContent = `(${needs.length})`;
  offersCount.textContent = `(${offers.length})`;
  needsEmpty.hidden = needs.length > 0;
  offersEmpty.hidden = offers.length > 0;
  if (query.text) {
    needsPanel.open = needs.length > 0;
    offersPanel.open = offers.length > 0;
  }
}

function cardView(code, quantity) {
  const card = catalogByCode.get(code) || {};
  return { code, quantity, team: card.team || "Other", name: card.name || "" };
}

function renderGroups(container, cards, { quantities = false, query = { text: "" } } = {}) {
  container.textContent = "";
  const groups = new Map();
  for (const card of cards.sort((a, b) => sortCode(a.code, b.code))) {
    if (!groups.has(card.team)) groups.set(card.team, []);
    groups.get(card.team).push(card);
  }
  for (const [team, groupCards] of groups) {
    const country = document.createElement("details");
    country.className = "collectionTeam shareCountryDisclosure";
    country.open = Boolean(query.text);
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
}

function setStatus(message, severity) {
  status.dataset.severity = severity;
  status.querySelector("span").textContent = message;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString();
}
