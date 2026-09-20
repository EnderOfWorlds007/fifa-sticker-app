# SOL review: missing upload ID feedback fix

- Thread: `01a0bf8a-46f9-7693-9eb4-80f224aa522d`
- Status: Complete; final implementation verdict APPROVE with no remaining P0/P1/P2 findings

## Mission

Review the mobile card-back feedback failure for imported review packages whose
cards legitimately have no original OCR `upload_id`, including stable fallback
identity, cloud hydration, concurrent revisions, diagnostics, regression tests,
and V2 cache-safe deployment.

## Evidence

The retained `IMG_1304.HEIC` review package contains 32 slots and no photo- or
slot-level upload identifier. The previous client threw before `fetch`, so the
backend remained healthy and the local collection decision succeeded while OCR
feedback never reached the durable label file.

## Findings

- Keep the legacy `photo:<upload_id>:<slot_id>` identity unchanged whenever an
  OCR upload identifier exists.
- For retained/imported photos, use
  `photo:retained:<source_batch_id>:<photo_id>:<slot_id>` so the label remains
  stable through cloud hydration and is namespaced beyond the photo's short
  random suffix.
- Do not put the local decision revision in the label ID: downstream consumers
  resolve corrected choices by taking the latest event for the same identity.
- Persist the concrete feedback error through the existing revision guard, and
  clear it when a newer choice begins or succeeds. Log structured context but
  never credentials.
- This fallback preserves feedback and later reconciliation, but without an OCR
  upload ID it is not yet directly joined to a server-side crop.
- Release only with a complete, never-reused V2 build ID, recovery path, browser
  regression, and live Pages verification.

## Resolution

The implementation now follows the stable legacy/fallback identity split,
retains revision-gated error state, exercises missing-upload-ID feedback in the
real browser flow, and uses the full V2 cache release procedure.

The final re-review verified syntax, cache consistency, the focused test suite,
and the real Chrome Reviews flow, and returned **APPROVE** with no remaining
P0/P1/P2 findings.
