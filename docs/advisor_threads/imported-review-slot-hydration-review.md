# SOL review: imported review slot hydration

Thread: `01a0bb98-eaa5-7bb0-a311-56ab1dfb7c64`

## Findings

- The cloud import and IndexedDB commit succeed. The deterministic crash occurs when `installPhotoReviewBatch()` passes retained slots directly to `renderInspector()`, which iterates `slot.code_candidates` even though the imported slot schema omits that UI-only field.
- Add lossless read-time hydration for stored slots. Preserve all existing properties and decision fields, synthesize a safe candidate array from the code and candidate aliases, never filter slots, and never write merely because hydration occurred.
- Keep a defensive safe-candidate call in the inspector so another loading path cannot reproduce the crash.
- Do not reuse live OCR normalization because it resets original/decision fields and filters records.
- A malformed slot must be retained as a deterministic diagnostic sentinel rather than dropping the whole queue. An orphaned review item must not be silently counted as complete.

## Regression requirements

- Exercise the imported shape with `code_candidates` absent and verify the first insignia task renders.
- Cover malformed candidate containers and a malformed slot without losing later review items.
- Confirm hydration does not mutate the raw staged import or cause a persistence revision write.
- Release with a build/cache token bump so iPhone Safari does not retain the crashing module.

## Implementation re-review

SOL returned **APPROVE** with no P0, P1, or P2 findings. It verified lossless read-time hydration, safe malformed candidate handling, diagnostic sentinels, navigable orphan items, the exact 35-photo/1,133-slot/117-item regression, browser coverage without `code_candidates`, and the complete cache/build bump.
