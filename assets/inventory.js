const totalCards = document.querySelector("#inventoryTotalCards");
const uniqueCodes = document.querySelector("#inventoryUniqueCodes");
const photoCount = document.querySelector("#inventoryPhotoCount");
const sessionCount = document.querySelector("#inventorySessionCount");
const search = document.querySelector("#inventorySearch");
const status = document.querySelector("#inventoryStatus");
const list = document.querySelector("#inventoryCards");

let inventoryCards = [];
let inventorySourceLabel = "local scanner server";
const INVENTORY_SOURCES = [
  { url: "/fifa-sticker-app/api/trade-inventory", label: "local scanner server" },
  { url: "/fifa-sticker-app/data/trade_inventory.json", label: "static snapshot" },
];

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
    const { payload, source } = await loadInventoryPayload();
    inventorySourceLabel = source.label;
    const stats = payload.stats ?? {};
    inventoryCards = Object.values(payload.cards ?? {}).sort(sortCode);
    const total = stats.matched_card_count ?? inventoryCards.reduce((sum, card) => sum + Number(card.count || 0), 0);
    totalCards.textContent = String(total);
    uniqueCodes.textContent = String(stats.unique_code_count ?? inventoryCards.length);
    photoCount.textContent = String(stats.photo_count ?? 0);
    sessionCount.textContent = String(stats.session_count ?? 0);
    if (stats.offline) {
      status.textContent = "Inventory needs the local scanner server. The app shell is available offline.";
      list.replaceChildren();
      return;
    }
    render();
  } catch {
    inventoryCards = loadLocalInventoryCards();
    inventorySourceLabel = "browser cache";
    if (inventoryCards.length) {
      totalCards.textContent = String(inventoryCards.reduce((sum, card) => sum + Number(card.count || 0), 0));
      uniqueCodes.textContent = String(inventoryCards.length);
      photoCount.textContent = "0";
      sessionCount.textContent = "0";
      status.textContent = "Showing locally cached inventory from this browser.";
      render();
      return;
    }
    status.textContent = "Saved inventory is unavailable.";
    list.replaceChildren();
  }
}

async function loadInventoryPayload() {
  let lastError = null;
  for (const source of INVENTORY_SOURCES) {
    try {
      const response = await fetch(source.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${source.label} unavailable`);
      const payload = await response.json();
      localStorage.setItem("panini.inventorySnapshot.v1", JSON.stringify(payload));
      return { payload, source };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("inventory unavailable");
}

function loadLocalInventoryCards() {
  try {
    const payload = JSON.parse(localStorage.getItem("panini.inventorySnapshot.v1") || "{}");
    return Object.values(payload.cards ?? {}).sort(sortCode);
  } catch {
    return [];
  }
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
      <span>${card.count ?? 0} saved · ${cardColour(card.back_insignia_type)}${captures ? ` · ${captures} captures` : ""}</span>
      <small>${[card.name, card.team].filter(Boolean).join(" · ") || "No catalogue name"}</small>
    `;
    return item;
  }));
}

search.addEventListener("input", render);
loadInventory();
