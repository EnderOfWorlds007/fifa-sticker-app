# SOL review: sparse legacy cloud history recovery

Thread: `01a0bb8a-29d6-7dc2-aec4-2a5ec6073cb5`

## Verdict

**Recommend the narrow validation change.** Legacy failed writes can consume a
profile revision without creating a transaction row, so revision numbers are a
strictly increasing high-water sequence, not a contiguous row count. Requiring
`revision === previousRevision + 1`, or requiring `currentRevision` to equal the
last returned row, incorrectly rejects valid retained history.

## Smallest safe change

- During explicit revision-zero recovery, require each transaction revision to
  be a positive safe integer strictly greater than the preceding returned
  revision. Continue rejecting duplicates, descending order, zero, fractional,
  non-numeric, and unsafe revisions. Do not sort client-side; server order is
  part of the pagination contract.
- Treat `currentRevision` as a high-water mark. Require it to be a safe integer
  greater than or equal to the last returned transaction revision, but allow it
  to exceed that row. Once pagination has demonstrably completed, use that
  high-water mark as the recovered cursor so later delta reads do not repeatedly
  scan an empty tail and later writes do not use a stale `baseRevision`.
- Preserve `setLastRevision` monotonicity. A revision-zero replay repairs missing
  IndexedDB state; it must not move an already persisted cursor backward.
- Make page-limit exhaustion fail closed before accepting the high-water cursor.
  Completion may be established by reaching the high-water mark or by receiving
  an empty page after the last returned row.

## Why this remains safe

- Every transaction envelope is authenticated by AES-GCM under the restore-code
  key. Accepting a numeric gap does not bypass decryption or authentication.
- Review photo parts retain their content digests and immutable import identity.
  The commit manifest checks the exact photo count, unique part/photo/index
  identities, every part digest and batch binding, and all review-item references
  and the declared item count.
- Commit materialization is one IndexedDB transaction with activation disabled
  during replay. The active queue pointer moves only after the entire ordered
  history decrypts and imports successfully. A missing part, bad digest,
  malformed envelope, out-of-order row, or incomplete commit therefore leaves
  the existing queue active.
- The sync/autosave gate and account-generation checks remain unchanged. The
  post-recovery quiet delta sync continues to catch writes that arrive after the
  replay's final page.

## Residual risk

Sparse monotonic revisions cannot prove that the server returned every unrelated
historical row; only a server-provided row count or authenticated hash chain could
do that. That stronger property is unnecessary for this recovery because the
target queue proves its own application-level completeness through the 35-part,
117-item commit manifest. Do not weaken or remove those manifest checks.

## Required regression coverage

- Sparse rows across multiple pages recover in returned order, including a first
  row greater than one.
- `currentRevision` greater than the final stored row succeeds, advances a fresh
  cursor to the high-water mark, and does not reduce a newer stored cursor.
- Duplicate, descending, invalid, or greater-than-high-water row revisions fail
  without activation.
- Page-limit exhaustion fails rather than returning partial history.
- The retained 35-photo/117-item manifest still activates exactly once only
  after all parts decrypt and validate; missing parts, digest mismatch, tampered
  AES-GCM envelopes, and commit-before-part ordering keep the previous queue.

## Verification

The existing focused suites pass: 25/25 tests in
`v2_cloud_sync_review_import.test.mjs` and `v2_photo_review_queue.test.mjs`.
Those tests cover current contiguous pagination and queue integrity, but they do
not yet cover sparse revisions or a high-water mark beyond the last row.

## Implementation re-review

**APPROVE. No P0, P1, or P2 findings.**

The implementation follows the recommendation: recovery accepts only positive
safe strictly increasing row revisions at or below the remote high-water mark,
retains returned ordering, rejects inconsistent applied revisions, adopts the
high-water cursor only after complete pagination, and makes page-limit
exhaustion fail closed. Existing AES-GCM decryption, digest and manifest
validation, deferred queue activation, rollback, account-generation guards, and
sync/autosave serialization remain intact.

Focused re-review verification passed 32/32 tests across cloud recovery, queue
integrity, and V2 cache refresh. The implementation author also reported the
complete 144-test non-browser suite and standalone browser flow passing.
