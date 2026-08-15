import {
  adjustedInventoryPayload,
  deriveCollectionModel,
  loadLedger,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-8ae15889ea59";
import { loadCollectionCatalog } from "/fifa-sticker-app/v2/assets/catalog_source.js?v=build-8ae15889ea59";
import { loadInventoryCacheMeta, loadInventoryPayload } from "/fifa-sticker-app/v2/assets/inventory_source.js?v=build-8ae15889ea59";
import { ensureImportedCollectionState, loadCollectionState } from "/fifa-sticker-app/v2/assets/collection_state.js?v=build-8ae15889ea59";

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
  const legacyCollected = Array.isArray(collectionState?.collected) ? collectionState.collected : [];
  const adjustedInventory = adjustedInventoryPayload(inventoryPayload || {}, ledger, {
    catalog,
    legacyCollected,
    excludeTransactionId,
  });
  const collectionModel = deriveCollectionModel({
    catalog,
    legacyCollected,
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

async function loadCatalogFallback() {
  try {
    return await loadCollectionCatalog();
  } catch {
    return { cards: [], aliases: {} };
  }
}
