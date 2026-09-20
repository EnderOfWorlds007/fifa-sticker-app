# SOL review: central card semantics and grouped continuations

Thread: `01a0c054-dad3-7f83-9af8-cf4b36c58524`

## Final re-review

**APPROVE.** No P0/P1/P2 findings remain. The reported parser/classifier defect,
ordinary UI writes, backup restore, and cloud account activation now share the
catalogue-authoritative boundary and fail closed when it is unavailable.

### Correct and verified

- The reported sentence resolves to exactly these 14 cards:
  `AUT13`, `CIV10`, `CPV13`, `CUW9`, `CUW13`, `EGY3`, `EGY5`, `IRQ6`,
  `IRQ9`, `IRQ19`, `NED13`, `PAN5`, `SWE5`, and `USA1`.
- The shared parser carries a team anchor across comma/conjunction continuation
  numbers and does not emit `AND13`, `AND19`, or `ET3`. Existing generic parser
  coverage, including non-voice prefixes, remains intact.
- `catalog_membership.js` provides exact full-code membership and alias
  resolution from `collection_catalog.json`; it does not mistake a valid team
  prefix for a valid card.
- A code absent from the resolved catalogue is `unrecognized-card`, never
  `new-for-album`. The complete-album regression reports zero new-for-album
  cards for the reported sentence.
- Getting Started, album/text inventory helpers, Scan, Collection, and Trade
  partition candidates against the catalogue before ordinary writes. Unknown
  scan/review observations remain available as raw review evidence.
- Inventory and collection projections independently filter unknown raw
  inventory and ledger rows, so legacy contamination cannot affect album,
  availability, public-share, or comparison calculations.
- Catalogue failure is fail-closed: Scan and Getting Started disable apply;
  Collection keeps its small hunt-list fallback read-only; Trade cannot
  save/reserve/complete without a verified catalogue.
- Cancelling a legacy trade changes only its status and no longer rewrites its
  unverified basket.
- V2 uses fresh `build-3da9e0dd8cdb`; the new recovery page is unique,
  `catalog_membership.js` is in the service-worker app shell, the scanner marker
  matches, and historical recovery pages are unchanged.

### Resolved import boundary

`sanitizeBusinessProjection()` now validates collection codes, ledger lines,
and inventory card keys before backup or cloud projections reach active storage.
Both activation paths fail closed without a verified catalogue. Rejected rows
are excluded from active business keys and appended to a durable evidence record
with source and timestamp. Mixed valid/invalid restore coverage proves accepted
rows survive while `AND13`/`ET3`-style rows remain evidence only.

### Test and release gates

The focused parser, classifier, UI-write, projection, import, and cache suite
passes `91/91`; the dedicated cloud/import suite passes `22/22`; and the isolated
browser camera/Compare regression passed `1/1`. `git diff --check` and syntax
checks for the changed modules and service worker are clean. A later aggregate
run that launched every browser fixture concurrently was interrupted after it
produced no progress; it does not supersede the successful isolated browser run.

Merge, wait for Pages, and directly verify the live scanner, `pwa.js`, `sw.js`,
parser, classifier, membership module, catalogue, and recovery URL before
declaring the production deployment complete.

## Initial review (superseded by the final re-review above)

The findings below document the earlier patch state. Items described there as
missing in ordinary parser, scanner, Collection, Trade, or cache flows have
since been addressed unless repeated in the final re-review.

### Initial verdict

**CHANGES REQUESTED.** The current patch fixes the reported grouped-continuation
parse and stops an absent `collectionModel.byCode` entry from being labelled
`new-for-album`, but it does not yet enforce the requested invariant that only
catalogue cards can enter inventory or ledger business state.

## What is correct in the current patch

- The exact report now produces 14 intended codes, including `CUW13`, `EGY3`,
  `IRQ9`, and `IRQ19`, without producing `AND13`, `AND19`, or `ET3`.
- Grouped continuation parsing is implemented once in the shared V2 parser and
  retains multiplier support.
- `classifyScannedCards()` now gives a code absent from the resolved collection
  model an explicit `unrecognized-card` status instead of calling it new for the
  album.
- The historical multiline parser contract remains intact after reverting an
  intermediate voice-alias allowlist that dropped `CHI`, `CHN`, `CMR`, `JAM`,
  `KAZ`, `POL`, and `SRB` entries.
- The focused parser, status, paste-preview, and scan-inventory tests passed: 39
  tests, 0 failures.

## Blocking findings

### P1 — Catalogue membership is still not enforced at business-state writes

The parser is a syntax recognizer, not a catalogue authority. The current
conjunction denylist prevents the three observed false tokens, and the new
classifier labels arbitrary examples such as `FOO7` as unrecognized when a real
collection model is supplied. However, the persistence APIs still accept those
same values:

- `createTransaction()`, `updateTradeLines()`, `normalizeLedger()`, and
  `saveLedger()` accept any syntactically normalizable two- or three-letter
  prefix and number.
- `applyTextInventoryCodesToInventory()` writes every normalized token into the
  inventory snapshot.
- `receivedLinesForScan()` and Scan's `addScanToCollection()` can turn an
  unrecognized OCR/review code into a completed received transaction.
- Collection and Trade expose “Add all anyway” paths that can promote an
  unavailable/unmatched token into the ledger.
- Backup restore and cloud projection writes bypass the ordinary UI helpers and
  can reintroduce invalid ledger or inventory rows.

Concrete recommendation: add one pure catalogue-semantics layer whose source of
truth is the full `collection_catalog.json` card-code set plus aliases—not a
team-prefix list and not the voice alias table. It should normalize/canonicalize
one value and partition batches into accepted and rejected observations. Use it
at every inventory and ledger write boundary, including scanner add, Getting
Started apply, Collection/Trade “anyway” actions, restore, and cloud apply. A
valid prefix is insufficient: `CC20` and `TUN27` are still not catalogue cards.

Rejected raw text, OCR slots, and review observations may remain in durable
review/evidence state for diagnosis, but must not contribute to collection,
trade inventory, public offers, or completed transaction lines. Existing
invalid stored rows should be quarantined from projections and reported; do not
silently delete the original data during migration.

### P1 — Catalogue failure still has a fail-open classification/save path

The new classifier guard relies on `collectionModel.byCode` being authoritative.
Scan's `fallbackCollectionModel()` instead synthesizes a `byCode` entry for
every scanned token after projection failure, so the same unknown value can
again become `new-for-album`. `loadCatalogFallback()` also converts catalogue
load failure into an empty catalogue without exposing readiness, while save
controls remain usable. Getting Started similarly enables Apply after its model
lookup fails and persists the previously parsed values.

Concrete recommendation: make catalogue readiness explicit. With no verified
catalogue, classification is unavailable/unrecognized, all business-state save
actions are disabled, and the UI retains the candidate observations for retry.
Do not synthesize catalogue membership from the incoming codes. The classifier
should either receive an explicit catalogue resolver/set or require a model
marked as catalogue-resolved, rather than trusting any object with a `byCode`
property.

## Important findings

### P2 — Getting Started still uses a different parser for pasted text

`parsedCodesFromText()` calls the voice-oriented `normalizeCodeInput()`. For the
reported text that path currently returns only 10 codes and drops `CUW13`,
`EGY3`, `IRQ9`, and `IRQ19`, while the shared paste parser returns all 14.

Concrete recommendation: route ordinary pasted text through
`extractCodeOccurrences()` plus the catalogue partition. Reserve voice
normalization for speech transcripts, then feed its candidates through the same
catalogue partition before display or save.

### P2 — The unrecognized status is visible but not yet actionable everywhere

Reusable paste previews display the new status, but Scan's top summary omits its
unrecognized count, Scan still enables Add, and Getting Started still enables
Apply. This lets the preview tell the truth while the adjacent action violates
it.

Concrete recommendation: show the rejected count and codes, exclude them from
the receipt/save signature, disable the action when no valid code remains, and
state when valid codes will be saved while rejected observations stay for
review.

### P2 — Regression coverage stops before the dangerous boundary

The added tests prove parsing and classification, but not the invariant at
storage. Add behavioral tests that attempt to save a mixed valid/invalid batch
through Getting Started, Scan, Collection, Trade, restore, and cloud apply;
assert that valid catalogue cards survive, invalid codes remain only in
diagnostic/review output, and neither `panini.tradeTransactions.v1` nor
`panini.inventorySnapshot.v1` contains a newly accepted invalid business row.
Also cover catalogue-unavailable behavior and the exact complete-album message
in a browser flow, not only a constructed unit-test model.

## Cache and deployment gates

This changes cached V2 JavaScript and is not deployable under the existing
`build-90cdc644aa5c` identity. Before release:

1. Generate a never-used 12-hex V2 build identifier and replace the old build
   consistently across V2 HTML, module imports, data URLs, updater, service
   worker, scanner marker, and tests.
2. Add a new immutable recovery pathname under `/fifa-sticker-app/v2/`; do not
   edit historical recovery pages or add the new page to the app shell.
3. Run the parser/classifier/save-boundary tests, the focused cache and camera
   suite, and the browser scanner test separately.
4. Merge and wait for the Pages deployment, then verify the live scanner HTML,
   `pwa.js`, `sw.js`, changed parser/classifier/persistence assets, catalogue,
   and recovery page directly. The production symptom may otherwise remain on
   an installed client even after source is corrected.

## Required acceptance contract

- The reported sentence resolves to exactly the 14 intended catalogue codes.
- No conjunction token is classified or saved as a card.
- A syntactically plausible but absent code is explicitly unrecognized, never
  new-for-album, and cannot enter collection/trade business state.
- Catalogue unavailability fails closed without discarding the raw observation.
- A complete album reports zero new-for-album cards for the reported sentence.
- Existing general parser coverage remains unchanged.
- The deployed client presents one internally consistent fresh V2 build.
