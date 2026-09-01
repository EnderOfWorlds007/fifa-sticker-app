import {
  adjustedInventoryPayload,
  loadLedger,
  sortCode,
} from "./trade_state.js?v=build-8948f03f90fb";
import { loadCollectionCatalog } from "./catalog_source.js?v=build-8948f03f90fb";
import { loadInventoryCacheMeta, loadInventoryPayload } from "./inventory_source.js?v=build-8948f03f90fb";
import { ensureImportedCollectionState, loadCollectionState } from "./collection_state.js?v=build-8948f03f90fb";
import { deriveResolvedCollectionModel } from "./collection_model.js?v=build-8948f03f90fb";

export async function loadInventoryProjection(options = {}) {
  const catalog = options.catalog || await loadCatalogFallback();
  const collectionState = await ensureImportedCollectionState({
    state: options.collectionState || loadCollectionState(options.storage),
    storage: options.storage,
    fetchImpl: options.fetch,
  });
  const ledger = options.ledger || loadLedger(options.storage);
  const inventoryResult = options.inventoryPayload
    ? {
      payload: options.inventoryPayload,
      source: options.inventorySource || { label: "provided inventory" },
    }
    : await loadInventoryPayload({
      fetch: options.fetch,
      storage: options.storage,
      now: options.now,
      sources: options.sources,
    });
  return buildInventoryProjection({
    catalog,
    collectionState,
    ledger,
    inventoryPayload: inventoryResult.payload,
    inventorySource: inventoryResult.source,
    inventoryCacheMeta: loadInventoryCacheMeta(options.storage),
    excludeTransactionId: options.excludeTransactionId,
  });
}

export function buildInventoryProjection({
  catalog = { cards: [], aliases: {} },
  collectionState = { collected: [] },
  ledger = { schemaVersion: 1, transactions: [] },
  inventoryPayload = {},
  inventorySource = { label: "unloaded inventory" },
  inventoryCacheMeta = {},
  excludeTransactionId,
} = {}) {
  if (inventoryPayload?.stats?.adjusted === true) {
    throw new Error("Inventory projections require the raw inventory snapshot.");
  }
  const legacyCollected = Array.isArray(collectionState?.collected) ? collectionState.collected : [];
  const adjustedInventory = adjustedInventoryPayload(inventoryPayload || {}, ledger, {
    catalog,
    legacyCollected,
    excludeTransactionId,
  });
  const collectionModel = deriveResolvedCollectionModel({
    catalog,
    collectionState,
    ledger,
    inventory: inventoryPayload || {},
  });
  return {
    catalog,
    collectionState,
    ledger,
    inventoryPayload: inventoryPayload || {},
    inventorySource,
    inventoryCacheMeta,
    adjustedInventory,
    collectionModel,
  };
}

export function selectNeededCodes(projection) {
  return (Array.isArray(projection?.collectionModel?.cards) ? projection.collectionModel.cards : [])
    .filter((card) => card.missing)
    .map((card) => card.code)
    .sort(sortCode);
}

export function selectAvailableTradeOffers(projection) {
  return (Array.isArray(projection?.collectionModel?.cards) ? projection.collectionModel.cards : [])
    .filter((card) => card.inventory.availableToTradeQuantity > 0)
    .map((card) => ({ code: card.code, quantity: card.inventory.availableToTradeQuantity }))
    .sort((a, b) => sortCode(a.code, b.code));
}

async function loadCatalogFallback() {
  try {
    return await loadCollectionCatalog();
  } catch {
    return { cards: [], aliases: {} };
  }
}
