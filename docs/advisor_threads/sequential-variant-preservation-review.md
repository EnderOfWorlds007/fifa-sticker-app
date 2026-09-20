# SOL review: sequential variant preservation

Thread: `01a0c03e-4a22-7583-9567-4c9c17ed4e14`

## Verdict

GO after correcting one cache-release blocker found during review.

## Findings

- The ledger replay change matches the required semantics: transaction order is preserved, each outgoing side is applied before its incoming side, and a plain outgoing line consumes implicit unclassified stock before known blue or green copies.
- Reserved and completed transactions, first-receipt album absorption, and `excludeTransactionId` behavior remain covered.
- Public projection model 5 and a fresh V2 build identifier are appropriate so existing shares republish with corrected colour quantities.
- The corrective migration is safe only if its eight deterministic trades are inserted immediately before the later 80-card outgoing transaction, all original transactions remain byte-for-byte unchanged and in relative order, and both the pre-give and post-give projections are verified.
- The cloud write must keep optimistic concurrency, a durable rollback checkpoint, exact private readback, idempotency checks for uncertain retries, and public-endpoint verification.

## Blocking issue and resolution

The initial cache-wide mechanical rewrite also modified the historical
`cache-reset-build-7ab34d90e216` page. Historical recovery paths must remain
immutable. That edit was reverted; only the new
`cache-reset-build-90cdc644aa5c` page targets the new build.

## Additional coverage

The reviewer recommended a mixed-stock regression proving that an unclassified
outgoing copy is removed before a known blue copy. That regression was added.

The focused test set passed. The all-files glob was not counted as evidence
because its first browser harness did not complete in this execution
environment and the run was interrupted.
