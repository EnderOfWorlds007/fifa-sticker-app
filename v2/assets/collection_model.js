import {
  deriveCollectionCodes,
  deriveCollectionModel,
  sortCode,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-2808667cc553";

export function deriveResolvedCollectionModel({
  catalog,
  collectionState = {},
  ledger,
  inventory,
} = {}) {
  const model = deriveCollectionModel({
    catalog,
    legacyCollected: Array.isArray(collectionState?.collected) ? collectionState.collected : [],
    ledger,
    inventory,
  });
  return applyAlbumStatusOverridesToModel(model, collectionState?.albumStatusOverrides);
}

export function applyAlbumStatusOverridesToModel(model, overrides = {}) {
  if (!model || !Array.isArray(model.cards)) return model;
  const normalizedOverrides = normalizeAlbumStatusOverrides(overrides);
  if (!normalizedOverrides.size) return model;
  const cards = model.cards.map((card) => {
    const status = normalizedOverrides.get(card.code);
    if (!status) return card;
    const missing = status === "missing";
    return {
      ...card,
      missing,
      collection: {
        ...card.collection,
        acquiredQuantity: missing ? 0 : Math.max(1, card.collection?.acquiredQuantity || 0),
        placedQuantity: missing ? 0 : 1,
        missingQuantity: missing ? 1 : 0,
        albumStatusOverride: status,
      },
    };
  });
  const byCode = Object.fromEntries(cards.map((card) => [card.code, card]));
  const collectedCount = cards.filter((card) => !card.missing).length;
  const missingCards = cards.filter((card) => card.missing);
  return {
    ...model,
    cards,
    byCode,
    summary: {
      ...model.summary,
      collectedCount,
      missingCount: missingCards.length,
      teamsRemainingCount: new Set(missingCards.map((card) => card.team)).size,
      progressPercent: cards.length ? Math.round((collectedCount / cards.length) * 100) : 0,
    },
  };
}

export function albumOwnedCodes({
  collectionState = {},
  ledger,
  inventoryPayload,
} = {}) {
  const owned = deriveCollectionCodes(collectionState?.collected, ledger);
  addInventoryAlbumCodes(owned, inventoryPayload);
  applyAlbumStatusOverridesToCodes(owned, collectionState?.albumStatusOverrides);
  return owned;
}

export function splitCodesByAlbumStatus(codes, options = {}) {
  const owned = albumOwnedCodes(options);
  return splitCodesByOwnedSet(codes, owned);
}

export function splitCodesByResolvedCollectionModel(codes, collectionModel) {
  const owned = new Set(
    (Array.isArray(collectionModel?.cards) ? collectionModel.cards : [])
      .filter((card) => !card.missing)
      .map((card) => card.code),
  );
  return splitCodesByOwnedSet(codes, owned);
}

function splitCodesByOwnedSet(codes, owned) {
  const newCodes = [];
  const inventoryCodes = [];
  for (const code of normalizeCodeList(codes)) {
    if (owned.has(code) || newCodes.includes(code)) inventoryCodes.push(code);
    else newCodes.push(code);
  }
  return { newCodes: newCodes.sort(sortCode), inventoryCodes: inventoryCodes.sort(sortCode) };
}

export function addInventoryAlbumCodes(owned, inventoryPayload) {
  const cards = inventoryPayload?.cards && typeof inventoryPayload.cards === "object" ? inventoryPayload.cards : {};
  for (const [rawCode, card] of Object.entries(cards)) {
    const code = normalizeCodeList([card?.code || rawCode])[0];
    if (!code) continue;
    const albumCount = Number(card?.album_count ?? card?.collection?.placedQuantity ?? card?.collection?.acquiredQuantity ?? 0);
    if (albumCount > 0 || card?.in_album === true || (card?.owned === true && card?.in_album !== false)) owned.add(code);
  }
  return owned;
}

export function applyAlbumStatusOverridesToCodes(owned, overrides = {}) {
  for (const [code, status] of normalizeAlbumStatusOverrides(overrides)) {
    if (status === "present") owned.add(code);
    if (status === "missing") owned.delete(code);
  }
  return owned;
}

function normalizeAlbumStatusOverrides(overrides = {}) {
  const normalized = new Map();
  if (!overrides || typeof overrides !== "object") return normalized;
  for (const [rawCode, status] of Object.entries(overrides)) {
    if (!["present", "missing"].includes(status)) continue;
    const code = normalizeCodeList([rawCode])[0];
    if (code) normalized.set(code, status);
  }
  return normalized;
}

export function normalizeCollectionCodeList(codes) {
  return Array.isArray(codes)
    ? codes.map((code) => String(code || "").trim().replace(/[\s_-]/g, "").toUpperCase()).filter(Boolean)
    : [];
}

function normalizeCodeList(codes) {
  return normalizeCollectionCodeList(codes);
}
