# SOL review: streamed cloud review restore

Thread ID: `01a0be0c-09b4-75c2-9aa6-166a195cd273`

## Mission

Review the fix for Reviews remaining indefinitely at **Loading encrypted reviews**
when a phone restores an account with 289 cloud revisions, including 35 large
per-photo packages.

## Findings

- The restore must stream into a durable, hidden generation rather than retain
  every encrypted and decrypted transaction in memory.
- `limit=1` bounds each response, but the client must also finish the durable
  write and release the photo working set before fetching the next record.
- Recovery must freeze the remote head observed by its first page so a moving
  account cannot make the scan endless or mix snapshots.
- The request deadline must include response-body reading, not only receipt of
  HTTP headers. Cancellation and account-generation guards must prevent late
  work from updating current state.
- Individual photo parts remain invisible until the authenticated commit
  manifest validates exact part identity, ordering, digests, and review-item
  references. Promotion should be a small active-pointer update, not a second
  all-photo copy.
- The currently active queue must remain visible on timeout, corruption, quota
  failure, cancellation, or incomplete history. Retry must be idempotent.
- Progress should distinguish cloud records checked from photo packages loaded;
  the expected photo count is not known until the final commit.

## Recommendation applied

Reviews now uses the same serialized coordinator for automatic and explicit
sync, with explicit recovery cancelling a lower-priority background request.
It freezes the first remote high-water revision, downloads one transaction at a
time, decrypts and writes one photo package at a time, and displays throttled
record/photo progress. Each cloud request—including body parsing—has a bounded
deadline. A per-photo write stores the final hidden photo plus small staging
metadata atomically; the commit validates the exact manifest and promotes only
the completed batch. Error diagnostics record the safe stage and counts without
logging the restore code.

## Required verification

Cover header and body timeouts, fixed-head pagination, no retained transaction
array, hidden one-photo staging, complete 35-photo/117-item promotion, commit
rollback, retry idempotency, stale-operation rejection, cache consistency, and
mobile browser restoration.

## Final implementation review — changes requested

The implementation is close and the central design is sound, but it is not yet
ready to merge.

### Important findings

1. **Gate acquisition can still wait forever behind a public-share autosave.**
   Explicit recovery disables its controls and then waits for
   `syncGate.block()`. It aborts the background delta controller, but it does
   not abort a running autosave. When public sharing is enabled, that autosave
   calls `publicShareForCheckpoint()`, whose catalogue fetch and response-body
   read have no timeout or cancellation. A stalled catalogue request therefore
   recreates the original indefinite gate and leaves Retry disabled. Give all
   gate-owned automatic work a shared deadline/cancellation path, or bound the
   barrier itself; ensure busy-state cleanup covers failure while acquiring the
   gate.

2. **Malformed rows can be filtered out before sparse-history validation.**
   `fetchAllDeltaPages()` filters raw transactions against the frozen head
   before validating each revision. `NaN`, fractional, unsafe, or impossible
   first-page revisions can disappear from the page; an empty filtered page is
   then accepted as normal sparse completion. Validate every raw revision
   first, then ignore only well-formed post-snapshot rows. Add fetch-level
   regressions for malformed rows and rows above the first advertised head.

### Minor finding

- Cancellation is checked around streaming work, but not transactionally tied
  to final active-pointer promotion. An abort arriving while
  `activateCloudPhotoReviewBatch()` is awaiting IndexedDB can still let that
  pointer write finish before the following generation check reports the run
  stale. Either make promotion cancellation-aware or define promotion as the
  point of no return and report it consistently. Cover this window in the
  orchestration test.

### Confirmed strengths

- The first remote head is frozen and the real 289-revision replay terminates
  correctly at that snapshot.
- Recovery uses `limit=1`, retains no ciphertext array, and writes one photo plus
  small manifest metadata per IndexedDB transaction.
- Exact commit membership and review-item references are validated before a
  small active-pointer promotion; cloud batches without an active pointer are
  now excluded from fallback reads.
- Request deadlines cover both headers and response-body parsing.
- The current V2 build identifier, module graph, service worker, recovery page,
  and cache documentation are consistent.

### Verification performed

- `git diff --check` and syntax checks passed.
- 69 focused Node tests passed, covering cache refresh, cloud recovery, review
  storage, camera, and related UI contracts.
- The standalone browser camera/picker test passed.

### Verdict

**CHANGES REQUESTED.** Fix the two important findings and add an orchestration
test that drives timeout/cancellation through gate acquisition, UI unlock, and
retry. Re-review after those changes.

## Final re-review

The unbounded autosave gate, malformed-row filtering, hidden-generation
visibility, and browser orchestration findings are resolved. The main task
reports 157 non-browser tests and both browser suites passing; this review also
confirmed the focused recovery/storage/cache suites.

One cancellation race remains. `stageCloudPhotoReviewPart()`,
`commitCloudPhotoReviewImport()`, and `activateCloudPhotoReviewBatch()` check the
signal before awaiting `openReviewDatabase()`, then register the transaction
abort listener only after that await. If cancellation occurs while the database
is opening, the already-fired abort is missed and the new transaction can still
commit. For final promotion this lets a cancelled generation update the active
pointer and then report success. The current regression covers a signal aborted
before entry, not an abort during the delayed database open.

This final race is resolved: all three cloud storage operations now re-check
the signal immediately after the database opens and before creating a
transaction. A delayed-open cancellation regression proves the prior active
pointer remains unchanged.

**Final verdict: APPROVE. No remaining P0, P1, or P2 findings.**
