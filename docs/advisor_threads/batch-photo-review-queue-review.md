# SOL review: batch photo review queue

Thread: `01a0bb00-fcbf-78a1-8244-3d47525c0ff2`

## Verdict

Proceed with a hierarchical batch model. Retain each photo, its OCR payload, and its locally scoped slots, then derive a decision-level queue across photos. Do not flatten all slots into the existing single-photo state because image geometry, slot IDs, and progress remain photo-specific.

## Principal findings

- Successful OCR payloads currently lose their source-photo identity. A dense success array can pair photo 2's payload with photo 1's image if photo 1 fails.
- Only the first payload currently enters review state. Later photos can therefore be omitted from review, copy output, collection receipts, duplicate counts, and insignia variants.
- Review identity must include `photoId`, `slotId`, and decision kind because backend slot IDs may repeat and one card may need both code and insignia decisions.
- A saved unreadable code must resolve its code-review task. Queue completion must use an explicit human-decision state rather than the presence of a usable code.
- Code and insignia decisions should use the same global auto-advance path. A late feedback response must not advance from a newer user selection.
- Preserve per-photo success, failure, cancellation, and error information. Cancellation should retain all settled successes.
- Aggregate results and collection receipts across every successful photo while keeping drawing, hit-testing, and geometry calibration scoped to the active photo.

## Recommended state and behavior

Keep a batch containing ordered photo records. Each photo owns its file/blob, OCR payload, status/error, slots, selected slot, and view state. Keep a stable, photo-major review-item list with code before insignia for a card requiring both. Each review item uses a composite key.

The first unresolved item activates its owning photo and focuses its card. Completing any decision advances to the next unresolved task, including across photo boundaries. Previous/next photo controls are independent of queue navigation. Active-photo bulk confirmation must never affect another photo.

Create object URLs from retained blobs for the active document and revoke them on batch replacement or page exit. Never infer a payload's photo from a success-only array index.

## Reviews-tab addendum

The recommended first-class tab design is a dedicated `/v2/reviews/` route backed by a small IndexedDB persistence module while retaining the existing review controller in a second boot mode.

- Scanner mode captures/uploads photos, persists the batch, and may continue showing inline review.
- Reviews mode restores the active batch and mounts result, navigation, review, and collection controls.
- Store original image blobs in IndexedDB, not Web Storage, object URLs, or the service-worker cache.
- Use separate batch and photo stores so updating one decision does not rewrite every full-resolution blob.
- Scope batches by active profile. Persist each selected photo before uploading, and commit each photo result/error as it settles.
- Store local review decisions before attempting backend feedback. Failed feedback remains retryable without reversing the decision.
- Persist collection transaction/signature state with the batch so Add/Undo survives navigation.
- Rehydrate on `pageshow` to avoid a restored Safari page overwriting newer decisions; revoke only transient object URLs on `pagehide`.
- Do not add automatic age or quota pruning. Removal must be explicit.

The alternative in-memory hash/query view was rejected because navigation destroys its files and state. A broad shared-controller extraction was deferred because it would increase regression scope before behavioral coverage exists.

## Required coverage

- Multi-photo ordering and repeated slot IDs.
- Failure/success association and partial cancellation.
- Separate code and insignia items for one card.
- Unreadable decisions resolving and both decision types auto-advancing across photos.
- Aggregate duplicate/insignia collection receipts across photos.
- Blob/payload/decision round trips through IndexedDB and profile isolation.
- Reload/offline restoration, object-URL lifecycle, storage failure reporting, and no automatic deletion.
- Reviews-tab presence/current state and narrow-phone layout.
- Existing single-photo camera and picker journeys.

## Release constraint

This changes cached V2 JavaScript, HTML, CSS, routes, and the app shell. Use a fresh build identifier and recovery pathname, update the complete module graph, run focused and browser tests, and verify the deployed GitHub Pages assets.
