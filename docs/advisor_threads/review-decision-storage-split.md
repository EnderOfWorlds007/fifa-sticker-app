# SOL review: review decision storage split

- Thread: `01a0bf41-a51a-7343-8fd9-67c0396f44cc`
- Status: Complete
- Decision: Final implementation verdict APPROVE; no remaining P0, P1, or P2 findings

## Mission

Review the blocking mobile Safari failure where saving CAN17 card-back colour
rewrites a Blob-bearing photo record and IndexedDB raises `UnknownError: Error
preparing Blob/File data to be stored in object store`.

## Findings

- Split immutable source-photo evidence from mutable review state. After initial
  capture/import, no decision, feedback, selection, view, or scan-state update
  may write `review_photos`.
- Use an explicit whitelist for `review_photo_states`: key, batch identity,
  revision, status, error, payload, slots, selection, and view. State must not
  override immutable key, identity, index, or Blob fields when loading.
- Preserve atomic batch/photo revision updates. A legacy row without a state
  companion uses its source revision as the first baseline; the first mutation
  creates state at baseline + 1.
- Upgrade lazily and Blob-free. Database version 4 adds the state store and
  `batchId` index without rewriting existing source-photo records. Close open
  databases on `versionchange`; a blocked upgrade must ask for reload/closing
  another tab rather than delete storage.
- Fresh capture/import writes source and initial state atomically. Replay must
  not reset later decisions, and staging cleanup must not delete source/state.
- Map the observed Safari Blob-preparation `UnknownError` to a specific
  recoverable message while preserving the underlying cause for diagnostics.

## Required verification

- Legacy Blob record plus no state row can save and round-trip CAN17 colour
  without changing Blob bytes, type, or source record.
- State records contain no Blob/File and batch/photo revisions advance
  atomically; stale writes still conflict.
- Injecting failure on any post-initial `review_photos.put()` does not affect a
  normal decision save.
- A state-write failure rolls back batch metadata and state while preserving
  immutable source evidence.
- Fresh batch/cloud staging is atomic, replay preserves decisions, browser
  helpers use the overlay state, cache identifiers remain consistent, and the
  deployed action is verified on iPhone Safari.

## Final implementation review

SOL reviewed the completed DB v4 implementation and returned **APPROVE** with
no remaining P0, P1, or P2 findings. The review confirmed that the immutable
Blob evidence is separated from mutable review state, state and batch revisions
remain atomic, stale-tab and cloud-replay protections remain intact, and the
legacy migration and rollback paths are covered by focused tests.
