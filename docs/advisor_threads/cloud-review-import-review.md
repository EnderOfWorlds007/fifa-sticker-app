# SOL review: encrypted cloud review import

Thread ID: `01a0bb3b-8592-7aa2-9b34-d9ab4f6c9550`

## Mission

Review the smallest safe way to seed an existing 35-photo, 117-question OCR
review queue into one restore-code account without overwriting collection state.

## Initial verdict

Changes requested. The advisor accepted separate opaque AES-GCM review payloads
but identified incomplete-batch visibility, replay overwrites, cross-account key
collisions, stale hydration on account switches, skipped delta pages, unstable
retry identity, and non-atomic Worker revision allocation.

## Durable recommendations

- Upload immutable photo parts first and a manifest commit last.
- Activate the batch only when one IndexedDB transaction verifies every expected
  photo digest and every referenced review item.
- Namespace imported records by the derived cloud profile and import id.
- Treat identical replay as a no-op and reject conflicting retained evidence.
- Fetch cloud deltas page by page and advance only to the highest applied row.
- Keep transaction identity stable across retries and never move a revision
  cursor backward after an older duplicate acknowledgement.
- Keep encrypted evidence append-only. A future rollback should be another
  event, not deletion.
- Review decisions remain local in this slice; cross-device decision convergence
  is a separate follow-up design.

## Implementation response

The app now stages account-namespaced immutable photo parts, atomically validates
and activates only a complete commit, protects locally edited photos from replay,
rehydrates Reviews on ordinary cloud-account application events, paginates delta
fetches with a low page size, preserves monotonic cursors, and caches the new
offline modules. Focused regression tests cover partial import, replay conflict,
account isolation, complete commit hydration, pagination, and cursor monotonicity.

The Worker now allocates the transaction row and profile revision in one atomic
D1 batch. Client follow-up fixes pin autosaves to the revision from which their
checkpoint was built, preserve legacy review batch ids used by ledger
reconciliation, prevent review-only accounts from replacing collection state,
and discard decrypted data if the active account changes while AES-GCM work is
pending.

## Final verdict

**APPROVE.** No remaining P0, P1, or P2 findings. The final review confirmed
atomic staged import, replay and digest validation, account and revision race
protection, complete pagination, safe legacy migration, cache recovery, Reviews
hydration, and atomic D1 revision allocation. Verification at approval: 137/137
non-browser app tests, the browser Reviews integration, and 3/3 Worker tests.
