export const COLLECTION_CATALOG_URL = "/fifa-sticker-app/v2/data/collection_catalog.json?v=build-f00ce7c65d44";

export async function loadCollectionCatalog(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const url = options.url || COLLECTION_CATALOG_URL;
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) throw new Error("collection catalogue unavailable");
  const payload = await response.json();
  const cards = Array.isArray(payload?.cards) ? payload.cards : Array.isArray(payload?.stickers) ? payload.stickers : [];
  return {
    ...(payload || {}),
    aliases: payload?.aliases && typeof payload.aliases === "object" ? payload.aliases : {},
    cards: cards.map((card) => ({
      code: String(card?.code || "").trim().toUpperCase(),
      name: String(card?.name || "").trim(),
      team: String(card?.team || "").trim(),
    })).filter((card) => card.code),
  };
}
