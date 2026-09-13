# SOL review: PR #68 photo-job transport recovery

- Thread: `01a09bb2-9442-7ac2-985f-b036cd4328d9`
- Repository: `EnderOfWorlds007/fifa-sticker-app`
- Pull request: [#68](https://github.com/EnderOfWorlds007/fifa-sticker-app/pull/68)
- Initial commit reviewed: `0e01d1bd58748012ea9458e3a0c11a0c90c46c3d`

## Mission

Review the V2 photo-job transport recovery, client-owned idempotent PUT and
reconciliation flow, transient-versus-terminal error handling, cancellation
wiring in both photo-entry paths, tests, and cache-safe release consistency.

## Initial findings

Verdict: **request changes**.

- **P1:** A truncated successful PUT body can reject `response.json()` with
  `SyntaxError`. The initial implementation classified every such exception as
  terminal, so an accepted backend job could again be abandoned without a
  reconciliation GET.
- **P2:** Cancellation coverage verified source text but did not prove that the
  visible scanner and trade-photo controls abort work and restore their idle UI.

## Resolution

- Successful PUT JSON-decoding failures are now classified as ambiguous
  acknowledgements and enter the same job-ID reconciliation flow. Valid but
  malformed payloads, identity mismatches, and malformed polling responses
  remain terminal.
- A real truncated `Response` regression proves the next request is a GET for
  the same job ID.
- Transport tests cover cancellation during the initial PUT, reconciliation
  GET, and retry backoff.
- The V2 Chrome test cancels deferred polling through both the scanner and
  reusable trade-photo UI and verifies that controls return to their idle state.

## Final re-review

- Corrective commit reviewed: `5542e27fe73d027a5cb630b7734b1a4fce934805`
- Verdict: **APPROVE** — no remaining P0, P1, or P2 findings.
- The reviewer confirmed that truncated successful PUT acknowledgements reconcile
  by GET without re-uploading, while malformed polling and protocol responses
  remain terminal.
- The reviewer confirmed behavioral cancellation coverage for the initial PUT,
  reconciliation GET, scanner polling, and trade-photo polling, including idle
  control restoration.
- Build `build-7d84c2e91a6f` remains internally consistent and preserves the
  collection-safe recovery page.
