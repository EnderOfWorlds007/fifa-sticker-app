# SOL review: iOS review storage transaction fix

- Thread: `01a0bdc2-673e-7d30-bc7b-3ebc2b250545`
- Status: Superseded by final review `01a0bdd0-5eef-77a2-9129-44c847b69cf3`
- Mission: Review the narrow repair for an iPhone Safari IndexedDB transaction failure after loading the 35-photo full-resolution review queue.

## Findings

The reviewer found the proposal correct and appropriately bounded. Removing the committed staging Blob copy preserves the active photo and encrypted cloud/rollback evidence while reducing the storage pressure that caused a small review decision to fail. Deleting staging records in the same transaction as queue activation preserves the all-or-nothing invariant. Idempotent replay and legacy cleanup cover both new and existing installations.

Separating mutable decisions from Blob-bearing photo records could reduce future write amplification, but is explicitly deferred as a separate architectural change.

The implementation reviews then found two P2 test/design gaps: cleanup initially materialized staged Blobs, and the fake IndexedDB did not exercise request failures or multi-store rollback. Those findings were addressed with indexed key-only deletion, injected quota failures, transaction snapshots, late-commit rollback, and direct active-pointer assertions. The final approval is recorded separately.

## Risks and resolutions

- Safari can auto-close IndexedDB transactions if unrelated asynchronous work occurs between requests. Cleanup schedules only IndexedDB work within request callbacks; no network, crypto, or timer work occurs inside the transaction.
- Cleanup must not delete staging for an incomplete import. The retained commit record is written atomically with the complete active queue, and incomplete-commit tests prove staging remains.
- A cleanup failure must not prevent the active queue from loading. Queue-load cleanup is best-effort, logged, and retried on the next load.
- The first request-level failure must survive the later transaction abort. The implementation retains the earliest request error and does not call `preventDefault()`.
- Initial import can still require both copies temporarily. This change addresses post-commit storage pressure; a near-quota import boundary remains a separate integration-test concern.

## Verification contract

- committed staging records are removed atomically;
- replay cannot recreate duplicate staging Blobs;
- legacy duplicates are reaped on load;
- incomplete imports retain their staging evidence;
- active Blob contents, size, MIME type, photo identity, order, matches, and review items remain unchanged;
- quota and clone failures surface as specific messages instead of a generic transaction error.
