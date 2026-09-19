# SOL review: batch review queue implementation

Thread: `01a0bb10-5838-7e03-b94d-f749c997c9a1`

## Initial verdict

**CHANGES REQUESTED.** The hierarchical queue model was sound, but four
durability risks were merge-blocking.

## Initial findings

### P1 — Stale pages could overwrite decisions or reactivate an old batch

The original implementation chose the latest batch by mutable `updatedAt`, did
not refresh long-lived background tabs, and allowed controls to remain active
during BFCache hydration. Whole-photo writes also had no conflict detection.

Recommended fix: use an explicit active-batch pointer per profile, gate review
controls while restoring state, notify other tabs, and add revision/CAS checks.

### P1 — Add/Undo was not reconciled with the collection ledger

The collection ledger updated synchronously while the batch marker was saved
fire-and-forget. A navigation or failed metadata write could enable a duplicate
add or leave Add disabled after an undo. The ledger state was not rechecked on
load.

Recommended fix: assign a deterministic per-batch transaction identity, treat
the ledger as authoritative, await metadata writes, and reconcile interrupted
operations during hydration.

### P1 — Photo decisions and queue metadata could commit inconsistently

The photo and batch were written in separate transactions. Hydration only
rebuilt review items when the entire list was empty, so an interrupted second
photo could be omitted forever. Local state was not rolled back on storage
failure.

Recommended fix: atomically persist photo plus batch metadata, reconcile every
photo's expected queue items on hydration, and roll back decisions when the
local write fails.

### P1 — Hydration cloned every retained image Blob

The loader called `getAll()` for the full photo history, then filtered by batch.
Unlimited development retention made this an eventual mobile memory failure.

Recommended fix: upgrade the database with a `batchId` index and query only the
active batch's photos.

### P2 — Late feedback responses could overwrite newer feedback state

Feedback completions were not tied to a decision revision. Reordered responses
could therefore change the status of a newer decision.

Recommended fix: attach a monotonically increasing decision revision and only
apply a response when it still matches.

### P2 — Behavioral coverage was too shallow

The browser harness restored and navigated a two-photo batch, but did not
complete decisions or verify Add, reload, Undo, and reload across the durable
queue.

## Changes made in response

- Added an explicit active batch record per profile, `BroadcastChannel`
  refresh, hydration gating, and batch/photo revision checks.
- Added atomic batch-plus-photo persistence and complete queue reconciliation
  during hydration.
- Upgraded IndexedDB to version 2 with an indexed `batchId` lookup.
- Made the collection ledger authoritative using batch-scoped transaction IDs,
  awaited metadata saves, and reconciled Add/Undo on every render/load.
- Added local-decision rollback and decision revisions for late feedback.
- Expanded the real browser flow to complete two insignia decisions across two
  photos, auto-advance across the photo boundary, verify aggregate variants,
  add to collection, reload, undo, and reload again.

## First re-review

**CHANGES REQUESTED.** Two Reviews tabs could trigger an endless
hydrate/write/broadcast cycle because hydration persisted the restored active
task. A delayed feedback response also compared against a detached slot object
after cross-tab hydration and could report an obsolete decision.

The implementation was updated so hydration activation is side-effect free,
broadcasts are revision-filtered, and a same-profile active-batch change is
followed by the Reviews page. Feedback responses now resolve the current slot
by photo ID, slot ID, decision kind, and revision; CAS conflicts rehydrate and
retry the feedback-status write once.

The Chrome test now opens two Reviews tabs, proves the batch revision settles,
holds a Blue feedback response while the second tab changes the card to Green,
then verifies that the stale response neither overwrites Green nor emits a
stale Blue status.

## Final re-review

**APPROVE.** No remaining P0, P1, or P2 findings.

The reviewer reproduced 124/124 non-browser tests, both browser harnesses,
JavaScript syntax checks, manifest validation, and diff checks. It confirmed
that the two tabs converge without revision churn, different active batches
rehydrate correctly, stale feedback is ignored, and the complete cross-photo
decision/Add/reload/Undo/reload journey is covered.
