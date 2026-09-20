# SOL review: Scan/Reviews hydration isolation

- Thread: `01a0bffe-5bee-7cd0-a0a5-1ad0c6d135e3`
- Status: Complete; final verdict APPROVE with no remaining P0/P1/P2/P3 findings

## Mission

Review the scoped browser fix that prevents saved review batches from populating
the Scan page while preserving Reviews hydration, the just-scanned batch, and
explicit review-write conflict recovery.

## Findings

### P2 — An initially empty Reviews page can miss the first later batch

`visibilitychange` only calls the guarded helper when `photoReviewState.id` is
already set. Initialization covers the first page load, but if Reviews starts
empty, is suspended in the background, misses a BroadcastChannel notification,
and another tab creates the first batch, returning to the visible page does not
rehydrate it. The queue stays stale until another event or reload.

Remove the `photoReviewState.id` condition and call
`hydrateSavedReviewsPage()` whenever the document becomes visible. The helper's
`reviewsPage` and `scanInFlight` checks already provide the needed isolation.
Add a regression for an empty Reviews page catching up after a batch appears.

### P2 — The browser regression can dispatch before the application listener exists

The test waits only for `#photoScannerResult`, which is parsed before the
bottom-of-body module script executes. The synthetic `panini:cloud-sync-applied`
event can therefore be lost, allowing the test to pass against the buggy
listener. The fixed 250 ms wait can also false-pass if a buggy IndexedDB hydrate
takes longer on CI.

Wait for module readiness (at minimum `document.readyState === "complete"`,
preferably an explicit scanner-ready marker) before dispatch. Assert immediately
that dispatch did not set `#photoReviewPanel[aria-busy]`; the buggy handler sets
that attribute synchronously before its first await. Retain the later empty
result/panel/link assertions.

### P3 — Source assertions do not isolate individual handlers

The greedy `pageshow[\s\S]*hydrateSavedReviewsPage()` and
`visibilitychange[\s\S]*hydrateSavedReviewsPage()` patterns can match a helper
call in any later listener, so either handler can regress to a direct hydrate
without failing the test. The cloud-sync-status success path also still calls
`hydrateLatestReviewBatch()` directly, leaving a background bypass outside the
new boundary even though its current page guard makes it behaviorally safe.

Extract and assert each listener body separately (or use syntax-aware tests),
route the cloud-sync-status success path through the helper, and assert that the
only remaining direct hydrations are Reviews initialization and explicit
write-conflict recovery.

## Verification

- `node --test test/v2_photo_review_queue.test.mjs` — 30/30 passed.
- `node --test test/browser_v2_camera_capture.test.mjs` — 1/1 passed.

## Re-review

The two P2 findings are resolved:

- Reviews now rehydrates whenever it becomes visible, including the
  empty-to-first-batch case, while the helper keeps Scan isolated.
- The browser regression waits for an application-owned readiness marker,
  chooses the active cloud-or-local profile, and proves synchronously that the
  cloud-applied event did not start hydration before checking the settled UI.
- The cloud-sync-status path now uses the same guarded helper, and the source
  checks target the individual background handlers instead of using greedy
  cross-handler matches.

### P1 / Blocking — The cached V2 asset still uses the previous release identity

`v2/assets/photo_scanner.js` changes, but the diff does not create and propagate
a never-used V2 build identifier. The app still advertises and caches
`build-ec7b4a1d9032`. This violates the repository's mandatory V2 cache strategy
and does not provide an internally distinct app shell for installed/mobile
clients, so the code can merge while affected clients continue executing the
old hydration behavior or an old offline shell.

Before deployment, generate a new 12-character lowercase hexadecimal build
suffix, propagate it through the complete V2 HTML/module graph, updater,
service worker, app-shell/cache assertions, visible scanner marker, and tests,
and add the new in-scope immutable recovery pathname required by the runbook.
Run the focused cache, review, and Chrome browser suites, then verify the live
scanner, changed asset, updater, worker, and recovery page after deployment.

### P3 / Non-blocking — Complete the background-call allowlist assertion

The revised source checks now cover the important individual handlers, but do
not explicitly cover `PANINI_CLOUD_SYNC_READY` or prove that direct
`hydrateLatestReviewBatch()` calls remain limited to Reviews initialization and
the two conflict-recovery sites. Add those assertions when touching this test
again so a future background path cannot bypass the page boundary unnoticed.

## Interim verdict

The page-scoped hydration implementation and focused regression coverage are
approved with no remaining behavioral P0/P1/P2 findings. Deployment is not yet
approved because the mandatory V2 cache/build release work is absent.

Re-review verification:

- `node --test test/v2_photo_review_queue.test.mjs` — 30/30 passed.
- `node --test test/browser_v2_camera_capture.test.mjs` — 1/1 passed.
- `node --test test/v2_cache_refresh.test.mjs` — 6/6 passed against the still-old build identity; this confirms internal consistency, not a new release.
- `node --check v2/assets/photo_scanner.js` and `git diff --check` — passed.

## Final re-review

The release blocker and remaining non-blocking coverage recommendation are now
resolved:

- The previous release remains recorded as `build-ec7b4a1d9032`; the new,
  never-used release identity is `build-7ab34d90e216`.
- `build-7ab34d90e216` is propagated consistently through the active V2 HTML,
  JavaScript module graph, updater, service worker/cache name and app shell,
  visible scanner marker, tests, and cache-strategy documentation.
- The new immutable in-scope recovery page at
  `v2/cache-reset-build-7ab34d90e216/` stages and verifies the current worker and
  cache before deleting stale caches, preserves browser application data, and
  is intentionally absent from the app shell. The historical
  `v2/cache-reset-build-ec7b4a1d9032/` page remains unchanged.
- The source regression now covers `PANINI_CLOUD_SYNC_READY` and allowlists the
  exact direct `hydrateLatestReviewBatch()` call sites: Reviews initialization,
  the helper itself, and the two explicit write-conflict recovery paths.

Final verdict: **APPROVE** with no remaining P0, P1, P2, or P3 findings. Live
verification of the deployed scanner, changed asset, updater, worker, and new
recovery URL remains the normal post-deployment step rather than a code-review
blocker.

Final verification evidence:

- Complete non-browser suite — 164/164 passed.
- Focused cache/review suites — 36/36 passed; independently reproduced during
  final review.
- Camera browser suite — 1/1 passed.
- JavaScript syntax and `git diff --check` — passed; independently reproduced
  during final review.
- The unrelated legacy `browser_media_buttons` assertions completed, but its
  process hung during Chrome teardown and was interrupted; this is not a
  behavioral failure in the reviewed Scan/Reviews path.
