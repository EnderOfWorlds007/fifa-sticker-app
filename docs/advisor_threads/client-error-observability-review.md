# SOL review: client error observability

Thread: `01a0918b-86f2-7aa0-8fd9-2ee50ce9ec58`

## Mission

Review the privacy, failure semantics, UI impact, cache integration, and current
public V2 port of durable mobile OCR error diagnostics.

## Findings and resolution

The initial implementation review identified four material gaps: report delivery
could delay the UI, Compare and Trade bypassed reporting, a permanently invalid
queue entry could block later reports, and retry/correlation coverage was
incomplete. The implementation was changed to persist first and deliver in the
background, cover every photo OCR entry point, dead-letter permanent rejections,
retry on startup/connectivity/authenticated success, and preserve request, job,
and upload correlation.

A follow-up found that the UI could display a client event reference that had
not been saved when IndexedDB failed. The UI now displays that reference only
after successful local persistence and otherwise states that diagnostic storage
is unavailable.

The final public-port review found no P0 or P1 problem. It found one P2 release
documentation mismatch: the canonical cache runbook still pointed to the prior
build and recovery URL. This branch updates the runbook to
`build-758205c86f15` and clarifies that the visible camera marker is a separate,
component-specific diagnostic revision.

## Final verdict

Ship after the runbook correction. The integration is privacy-safe,
non-blocking, tolerant of partial multi-photo failures, and consistently included
in the current PWA app shell.
