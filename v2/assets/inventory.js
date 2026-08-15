import {
  adjustedInventoryCsv,
  inventoryFreshnessSummary,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-6dbdd88f9b0a";
import { loadInventoryProjection } from "/fifa-sticker-app/v2/assets/inventory_projection.js?v=build-6dbdd88f9b0a";

const totalCards = document.querySelector("#inventoryTotalCards");
const uniqueCodes = document.querySelector("#inventoryUniqueCodes");
const photoCount = document.querySelector("#inventoryPhotoCount");
const sessionCount = document.querySelector("#inventorySessionCount");
const search = document.querySelector("#inventorySearch");
const status = document.querySelector("#inventoryStatus");
const list = document.querySelector("#inventoryCards");
const downloadAdjustedInventoryButton = document.querySelector("#downloadAdjustedInventoryButton");
const inventoryFreshness = document.querySelector("#inventoryFreshness");

let inventoryCards = [];
let inventorySourceLabel = "local scanner server";
let adjustedInventorySnapshot = null;
let inventoryCacheMeta = null;
let collectionModel = null;

function cardColour(type) {
  if (type === "united_edition") return "Green card";
  if (type === "standard_fifa_licensed") return "Blue card";
  if (type === "mixed") return "Mixed colours";
  return "Colour unknown";
}

function sortCode(a, b) {
  const aMatch = String(a.code || "").match(/^([A-Z]+)(\d+)$/);
  const bMatch = String(b.code || "").match(/^([A-Z]+)(\d+)$/);
  if (!aMatch || !bMatch) return String(a.code || "").localeCompare(String(b.code || ""));
  return aMatch[1].localeCompare(bMatch[1]) || Number(aMatch[2]) - Number(bMatch[2]);
}

async function loadInventory() {
  try {
    const projection = await loadInventoryProjection();
    const adjustedPayload = projection.adjustedInventory;
    collectionModel = projection.collectionModel;
    adjustedInventorySnapshot = adjustedPayload;
    inventorySourceLabel = projection.inventorySource?.label || "inventory";
    inventoryCacheMeta = projection.inventoryCacheMeta;
    const stats = adjustedPayload.stats ?? {};
    inventoryCards = Object.values(adjustedPayload.cards ?? {}).sort(sortCode);
    const total = stats.matched_card_count ?? inventoryCards.reduce((sum, card) => sum + Number(card.count || 0), 0);
    totalCards.textContent = String(total);
    uniqueCodes.textContent = String(stats.unique_code_count ?? inventoryCards.length);
    photoCount.textContent = String(stats.photo_count ?? 0);
    sessionCount.textContent = String(stats.session_count ?? 0);
    renderInventoryFreshness(adjustedPayload, inventoryCacheMeta);
    render();
  } catch {
    status.textContent = "Saved inventory is unavailable.";
    list.replaceChildren();
  }
}

function renderInventoryFreshness(payload, cacheMeta) {
  const summary = inventoryFreshnessSummary({ sourceLabel: inventorySourceLabel, payload, cacheMeta });
  inventoryFreshness.querySelector("strong").textContent = summary.title;
  inventoryFreshness.querySelector("span").textContent = summary.detail;
}

function downloadAdjustedInventory() {
  if (!adjustedInventorySnapshot) {
    status.textContent = "Adjusted inventory is still loading.";
    return;
  }
  const blob = new Blob([adjustedInventoryCsv(adjustedInventorySnapshot)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `panini-adjusted-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  status.textContent = `Downloaded adjusted inventory from ${inventorySourceLabel}.`;
}

function render() {
  const query = search.value.trim().toUpperCase();
  const visible = inventoryCards.filter((card) => {
    if (!query) return true;
    return [card.code, card.team, card.name].some((value) => String(value || "").toUpperCase().includes(query));
  });
  status.textContent = `${visible.length} saved codes shown · ${inventorySourceLabel}.`;
  list.replaceChildren(...visible.map((card) => {
    const item = document.createElement("li");
    const captures = Array.isArray(card.captures) ? card.captures.length : 0;
    item.innerHTML = `
      <strong>${card.code}</strong>
      <span>${inventoryCardDetail(card, captures)}</span>
      <small>${[card.name, card.team].filter(Boolean).join(" · ") || "No catalogue name"}</small>
    `;
    return item;
  }));
}

function inventoryCardDetail(card, captures) {
  const modelCard = collectionModel?.byCode?.[card.code];
  const parts = [
    `${card.count ?? 0} saved`,
    cardColour(card.back_insignia_type),
  ];
  if (modelCard?.inventory) {
    parts.push(`${modelCard.inventory.availableToTradeQuantity} trade-ready`);
  }
  if (modelCard?.collection) {
    parts.push(modelCard.collection.missingQuantity > 0 ? "album missing" : "album placed");
  }
  if (captures) parts.push(`${captures} captures`);
  return parts.join(" · ");
}

search.addEventListener("input", render);
downloadAdjustedInventoryButton.addEventListener("click", downloadAdjustedInventory);
loadInventory();
