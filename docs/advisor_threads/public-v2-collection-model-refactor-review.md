# SOL review: public V2 collection model refactor

Thread: `01a03a5e-0f92-7cc0-b750-1e1383ee5494`

## Findings

### High: Scanner still does not consume the same resolved projection as Collection

`photo_scanner.js` classifies codes from synchronous `loadCollectionState()`, `loadLedger()`, and `loadCachedInventoryPayload()` calls. In contrast, Collection and the other inventory-aware screens call `loadInventoryProjection()`, which first runs `ensureImportedCollectionState()` and then fetches/selects the live, static, or cached inventory source. On a fresh browser that opens Scanner first, or whenever the live/static source is newer than the browser cache, Scanner can still label an album-owned card as **New for album** while Collection resolves it as present. This preserves the original divergence at the data-loading boundary even though the classification rules are now shared. Scanner should initialize and retain the same `loadInventoryProjection()` result before rendering ownership labels (with a defined loading/error fallback), or the shared domain API should classify from an already-resolved model rather than independently assembled raw inputs.

References: `v2/assets/photo_scanner.js:434-439`, `v2/assets/inventory_projection.js:10-37`, `v2/assets/inventory_source.js:14-48`.

### Medium: Normalization can make genuinely new formatted codes render as already owned

`splitCodesByAlbumStatus()` removes spaces, underscores, and hyphens, so an input such as `USA-2` is returned in `newCodes` as `USA2`. The scanner keeps `latestScanCodes` with only trimming and uppercasing, then tests `latestCollectionSplit.newCodes.includes(code)` using the un-compacted `USA-2`. The membership test fails and the row renders **Already owned / inventory**, despite the summary counting the card as new. Use one exported canonicalization function on scanner input and split output, or return a per-occurrence classification keyed to the original input.

References: `v2/assets/collection_model.js:70-78,111-114`, `v2/assets/photo_scanner.js:426-428,570-575`.

### Medium: Explicit overrides leave the resolved card model internally contradictory

`applyAlbumStatusOverridesToModel()` updates `missing` and the nested collection quantities but leaves the top-level `owned` and `duplicateCount` values from the pre-override model. A `missing` override can therefore produce `missing: true`, `collection.acquiredQuantity: 0`, and `owned: 1`; a `present` override can produce the reverse. Current consumers mostly read `missing`, but the new module is presented as the shared domain model and this inconsistency is a trap for existing or future consumers. Either define album placement separately from physical ownership and preserve acquisition fields, or recompute every denormalized ownership field from one documented invariant.

References: `v2/assets/collection_model.js:26-40`, `v2/assets/trade_state.js:512-547`.

### Medium: The added tests verify source text, not the ownership behavior

The new assertions only match imports and code fragments. They do not execute override precedence, all supported inventory evidence fields, duplicate occurrence splitting, fresh-cache behavior, normalization, or resolved-model invariants. Consequently all three defects above can pass the reported test suite. Add executable unit tests for `collection_model.js` and at least one scanner integration test that starts from representative persisted state/inventory and asserts both summary counts and per-row labels before and after adding a scan.

Reference: `test/v2_photo_scanner_collection_labels.test.mjs:48-72`.

## Deployment/cache assessment

No additional cache-buster defect was found in the reviewed diff. The build token is consistently propagated, `collection_model.js` is in the app shell, the service-worker cache name changes, JavaScript is network-first, and offline fallback ignores the query string. The principal deployment risk is behavioral rather than service-worker version skew: Scanner can render before the source/import work performed by the projection path has ever populated its browser cache.

## Main-thread disposition

- Addressed: Scanner now imports `loadInventoryProjection()` and classifies photo results from the same resolved collection model used by Collection/Compare/Inventory, with the previous raw-state classifier retained only as a fallback.
- Addressed: Scanner recognized codes now use the shared canonical code normalizer before per-row classification, so formatted codes such as `USA-2` compare as `USA2`.
- Addressed: Added regression coverage for the shared projection path, canonical scanner normalization, and the seeded V2 missing list.
- Deferred: The resolved model still carries legacy denormalized fields from `deriveCollectionModel()`. Current V2 consumers use `missing` and `collection.*`; a future cleanup should remove or recompute stale top-level ownership fields rather than widening this PR.
