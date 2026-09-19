# SOL review: load cloud queue from Reviews

Thread: `01a0bb6e-3e85-70e0-aafc-df991307679c`

## Findings

- The OCR token and restore code are separate credentials. The OCR token authorizes OCR and review-label requests; only the restore code identifies and decrypts the cloud review queue.
- Reuse the existing encrypted cloud controller rather than adding another loader or authentication mechanism.
- Render the controls in the initial Reviews HTML, distinguish loading, empty-account, and failure states, and ignore stale account operations through the controller's existing account-generation guard.
- Disable account controls while switching, clear a successfully used restore-code input, mask the input, and never embed or echo either secret.
- A failed account switch must leave the current review queue active.

## Recommendation applied

Add a compact **Load reviews** panel to Reviews with cloud status, saved-account selection, a masked restore-code input, and the existing restore action. Keep OCR settings in a separately named **OCR connection** panel. Drive queue hydration from the existing cloud-applied event and show explicit state-specific empty messages.

## Follow-up: stale cursor recovery

The review identified that a cloud revision cursor in `localStorage` can survive while its IndexedDB review queue is absent, so normal delta sync cannot repair the queue. The explicit **Load reviews** action therefore performs a bounded, paginated replay from revision zero. It decrypts and validates the complete ordered history before importing review parts, relies on the existing staged multipart/atomic commit path, applies only the latest recovered collection checkpoint, leaves the monotonic background-sync cursor unchanged, and preserves the prior active queue when recovery fails. Normal startup remains delta-only.

Some imported review accounts intentionally contain review transactions without a collection checkpoint. The explicit recovery path activates those queues while retaining the browser's current collection projection; ordinary account switching keeps its stricter checkpoint-or-cache requirement. This prevents loading reviews from erasing collection state while allowing the retained OCR evidence account to work.

## Final review corrections

The final review initially requested changes for three P1 issues. Recovery is now limited to the Reviews page; saved-account selection only prepares the explicit Load reviews action, leaving Collection's account switch unchanged. Cloud review commits are staged without changing the active queue and the recovered batch is promoted only after the entire ordered replay succeeds. Recovery errors bypass the ordinary cached-account fallback and restore the previous account and exact pre-recovery collection projection. A review-only account therefore cannot substitute a stale cached target collection. Background delta sync pauses during recovery and runs once afterward from the committed cursor.

The durable readiness promise also closes the event-ordering empty-state issue. Behavioral coverage now proves that a deferred cloud import leaves the previous queue active until explicit promotion, in addition to the retained 35-photo/117-item queue, multipart integrity, idempotency, pagination, and mobile browser flow.

The final concurrency review found that gating delta sync alone did not cover an autosave that had already advanced to checkpoint creation or append. The same serialization gate now owns the complete autosave transaction, recovery waits for it, and local save requests received during recovery are re-queued after the quiet catch-up sync. A deferred-operation regression test covers this overlap. Final advisor verdict: **APPROVE**, with no remaining P0, P1, or P2 findings.
