import { loadCollectionCatalog } from "/fifa-sticker-app/v2/assets/catalog_source.js?v=build-ea110a3c78a2";
import { fetchPublicProjection, publicShareTokenFromLocation } from "/fifa-sticker-app/v2/assets/public_share.js?v=build-ea110a3c78a2";
import { sortCode } from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-ea110a3c78a2";

const status = document.querySelector("#shareStatus");
const updatedAt = document.querySelector("#shareUpdatedAt");
const search = document.querySelector("#shareSearch");
const needsList = document.querySelector("#shareNeedsList");
const offersList = document.querySelector("#shareOffersList");
const needsEmpty = document.querySelector("#shareNeedsEmpty");
const offersEmpty = document.querySelector("#shareOffersEmpty");
const needsCount = document.querySelector("#shareNeedsCount");
const offersCount = document.querySelector("#shareOffersCount");
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
  const query = String(search.value || "").trim().toLowerCase();
  const needs = (Array.isArray(payload?.needs) ? payload.needs : [])
    .map((code) => cardView(code, 1))
    .filter((card) => matches(card, query));
  const offers = (Array.isArray(payload?.offers) ? payload.offers : [])
    .map((offer) => cardView(offer.code, offer.quantity))
    .filter((card) => matches(card, query));
  renderGroups(needsList, needs);
  renderGroups(offersList, offers, { quantities: true });
  needsCount.textContent = `(${needs.length})`;
  offersCount.textContent = `(${offers.length})`;
  needsEmpty.hidden = needs.length > 0;
  offersEmpty.hidden = offers.length > 0;
}

function cardView(code, quantity) {
  const card = catalogByCode.get(code) || {};
  return { code, quantity, team: card.team || "Other", name: card.name || "" };
}

function matches(card, query) {
  return !query || `${card.code} ${card.team} ${card.name}`.toLowerCase().includes(query);
}

function renderGroups(container, cards, { quantities = false } = {}) {
  container.textContent = "";
  const groups = new Map();
  for (const card of cards.sort((a, b) => sortCode(a.code, b.code))) {
    if (!groups.has(card.team)) groups.set(card.team, []);
    groups.get(card.team).push(card);
  }
  for (const [team, groupCards] of groups) {
    const section = document.createElement("section");
    section.className = "collectionTeam";
    const heading = document.createElement("h3");
    heading.textContent = team;
    const list = document.createElement("ul");
    list.className = "tradeLookupResults";
    for (const card of groupCards) {
      const item = document.createElement("li");
      item.textContent = `${card.code}${card.name ? ` · ${card.name}` : ""}${quantities ? ` · ${card.quantity} available` : ""}`;
      list.append(item);
    }
    section.append(heading, list);
    container.append(section);
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
