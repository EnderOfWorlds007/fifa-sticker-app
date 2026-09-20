# SOL review: sequential inventory ledger projection

- **Thread:** `01a0bfdc-2130-7972-8a30-b6cddf63cd0f`
- **Mission:** Review the inventory projection ordering fix, variant and album semantics, mutation safety, regression coverage, and V2 cache release.
- **Status:** Complete; follow-up verdict **APPROVE** with no blocking findings.

## Findings

- Projection order is correct: the raw inventory and completed loose receipts are combined before completed or reserved outgoing quantities are applied.
- Variant accounting correctly removes the earlier three blue and one green copies in the regression scenario, leaving exactly six blue copies from the replacement receipt.
- Album semantics remain intact because `completedLooseReceivedAdjustments` still excludes the album-filling copy.
- `back_insignia_counts` is cloned before mutation, so the caller's raw inventory is not modified.
- The initial statement that `build-c41e7a92d63f` was fully cache-consistent was superseded after live verification found a stale visible camera-build marker.
- Follow-up release `build-ec7b4a1d9032` makes the visible marker derive from the active build contract, adds a regression, preserves the historical `c41e7a92d63f` recovery page, and keeps stage-before-delete recovery semantics.
- Initial verification covered 160 non-browser tests and two Chrome tests. The follow-up verified 163 non-browser tests, two Chrome tests, syntax checks, and `git diff --check`.

## Recommendations applied

The reviewer recommended explicit regressions for input immutability, reserved outgoing stock, and first-copy album allocation. These tests were added before the change was committed.

The follow-up review approved the correction. The remaining recommendation is to complete the cache runbook's live GitHub Pages/CDN checks after deployment.
