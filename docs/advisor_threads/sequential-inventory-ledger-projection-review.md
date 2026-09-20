# SOL review: sequential inventory ledger projection

- **Thread:** `01a0bfdc-2130-7972-8a30-b6cddf63cd0f`
- **Mission:** Review the inventory projection ordering fix, variant and album semantics, mutation safety, regression coverage, and V2 cache release.
- **Status:** Complete; final verdict **APPROVE** with no blocking findings.

## Findings

- Projection order is correct: the raw inventory and completed loose receipts are combined before completed or reserved outgoing quantities are applied.
- Variant accounting correctly removes the earlier three blue and one green copies in the regression scenario, leaving exactly six blue copies from the replacement receipt.
- Album semantics remain intact because `completedLooseReceivedAdjustments` still excludes the album-filling copy.
- `back_insignia_counts` is cloned before mutation, so the caller's raw inventory is not modified.
- Cache release `build-c41e7a92d63f` is internally consistent. Historical recovery pages retain their original identifiers, and the new recovery page stages the current shell before deleting stale caches.
- Verification observed by the reviewer: 160 non-browser tests, two Chrome tests, syntax checks, and `git diff --check` passed.

## Recommendations applied

The reviewer recommended explicit regressions for input immutability, reserved outgoing stock, and first-copy album allocation. These tests were added before the change was committed.

The remaining recommendation is to complete the cache runbook's live GitHub Pages/CDN checks after deployment.
