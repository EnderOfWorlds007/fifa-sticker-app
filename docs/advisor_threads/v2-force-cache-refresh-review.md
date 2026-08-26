# Second-opinion review: V2 forced cache refresh (`3921286`)

## Blocking status

**Blocking findings remain: YES.** Findings 1–3 should be fixed before relying on this flow as the recovery path for installed iOS users or as a safe offline-cache migration.

## Prioritized findings

### P1 / Blocking — The reset page can run outside the installed iOS web app's website-data container

`v2/manifest.webmanifest` limits the installed app to `/fifa-sticker-app/v2/`, but the new recovery link navigates to `/fifa-sticker-app/cache-reset-build-9c4a1f2e7b63/` (`v2/scanner/index.html:49`). That location is intentionally outside both the V2 manifest and V2 worker scopes. On iOS, a Home Screen web app is a separate application context and its post-install website data is not shared with Safari. An out-of-scope navigation may therefore leave the standalone context or be presented in Safari. In that case, `getRegistrations()` and `caches.keys()` on the reset page can inspect/delete Safari's container rather than the installed app's V2 registration/cache, report success, and reopen a scanner with an apparently empty collection because it is now in the other container. The application files do not explicitly clear `localStorage` or IndexedDB, but this context switch can look exactly like data loss to the user.

**Concrete fix:** keep the immutable recovery page inside the installed application's manifest scope, for example `/fifa-sticker-app/v2/cache-reset-build-9c4a1f2e7b63/`. A never-before-used pathname still bypasses the old `ignoreSearch` cache entry because there is no matching pathname to return, while remaining in the same Home Screen application/data container. Validate this on a physical iPhone from the installed icon, including that the collection/settings remain visible after recovery. Do not widen the manifest to the repository root merely to include the reset page; that would create a second overlap with the legacy app.

### P1 / Blocking — Root and V2 workers do not own isolated cache namespaces

The legacy root worker still has scope over `/fifa-sticker-app/v2/`. Its activation handler deletes **every** cache except `fifa-card-apps-v26` (`sw.js:32-36`). After this reset unregisters the root worker, a later visit to any legacy page registers it again; its next activation can delete the current `fifa-card-apps-fifa-sticker-app-v2-build-9c4a1f2e7b63` app shell. Conversely, V2 uses origin-global `caches.match()` in both strategies (`v2/sw.js:103-105,110`). During root-to-V2 startup the root worker can cache V2 requests in its older cache, and V2's unqualified exact or `ignoreSearch` lookup can later select those stale responses ahead of the build cache. This reintroduces mixed-build/offline behavior after the emergency reset.

**Concrete fix:** make cache ownership explicit in both workers. The root worker should delete only caches bearing a root/legacy prefix and should pass through `/fifa-sticker-app/v2/` requests instead of runtime-caching them. V2 should open `CACHE_NAME` and call `cache.match()` on that cache only; its offline navigation fallback should derive the build-qualified shell key and look it up in that named cache rather than searching every origin cache with `ignoreSearch`. Add an integration test that installs/activates root, then V2, then root again and proves neither worker deletes or serves entries from the other's cache.

### P1 / Blocking — Recovery destroys the working offline copy before proving the replacement is usable

`resetAppCache()` unregisters both workers and deletes every `fifa-card-apps*` cache before attempting the scanner navigation (`cache-reset-build-9c4a1f2e7b63/index.html:38-49`). If the device is offline, captive, or loses connectivity during those operations—a common iOS recovery scenario—the user loses the functioning offline shell and cannot reload the reset page or scanner until connectivity returns. The collection/settings remain in origin storage, but the app is effectively bricked offline. Cache deletion success is also not checked; `Cache.delete()` and `unregister()` resolve to booleans, so the page can announce success even when a target remained.

**Concrete fix:** make recovery two-phase. First fetch and validate the current scanner, worker script, and required shell resources with the current build ID, or stage the complete current shell in its new named cache. Then activate/confirm the current V2 worker (with a bounded timeout) and only afterward remove old registrations/caches, retaining the verified current cache. If staging or activation fails, leave the old offline cache intact and expose the retry UI. Check boolean results and report partial cleanup instead of unconditionally navigating.

### P2 — Worker readiness and reload handling can claim the new build before it is active

`registration.update()` does not establish that a newly discovered worker has completed install/activation. The one-time `registration.waiting?.postMessage()` check can run before the worker reaches `waiting`, and the status message treats any `registration.active` worker—including the old one—as “Ready ... build-9c4a1f2e7b63” (`v2/assets/pwa.js:39-51`). The worker's install-time `skipWaiting()` mitigates the waiting race but not install failure, a slow app-shell download, or the misleading status. The `sessionStorage` exception fallback reloads without any in-memory guard (`v2/assets/pwa.js:17-26`), so storage-restricted WebKit behavior is not demonstrably loop-safe.

**Concrete fix:** observe `updatefound`, `installing.statechange`, `waiting`, and `controllerchange`; declare readiness only after an activated/controller worker has the expected script URL and build. Use a module-level reload guard in addition to the per-build session key, and put a timeout/error state around activation. Cover install rejection, delayed waiting/activation, multiple `controllerchange` events, unavailable/throwing `sessionStorage`, and a pre-existing old controller.

### P2 — The build bootstrap is not consistently versioned or present on all V2 entry pages

`v2/index.html`, `v2/apps/index.html`, `v2/404.html`, `v2/trade-lookup/index.html`, and `v2/need-lookup/index.html` still load `/v2/assets/pwa.js` without the build query. `v2/photo-code-debug-review/index.html` does not load the updater at all. The new worker is network-first for JavaScript once it controls the page, but an uncontrolled/browser-cache path or a partially recovered entry can still execute a stale bootstrap, and not every entry can initiate recovery consistently.

**Concrete fix:** use the current build-qualified `pwa.js` URL on every V2 HTML entry that registers the app worker, and decide explicitly whether the debug page participates; if it is in `APP_SHELL_PATHS`, it should normally load the same updater. Add a static test enumerating all V2 HTML entry points and asserting one current bootstrap reference (or an explicit exemption), plus a check that no old build ID remains.

## Test evidence and remaining gaps

- `node --test test/v2_cache_refresh.test.mjs test/photo_code_debug_review.test.mjs` passes (5 tests).
- `git diff --check origin/main..HEAD` passes.
- The new tests are source-pattern checks and mocked registration calls; they do not exercise CacheStorage ordering, overlapping scopes, real install/activate timing, offline navigation, standalone iOS data containers, or preservation of real local collection/settings values across a recovery.
- `node --test test/*.test.mjs` did not complete or emit results within roughly 90 seconds and was interrupted; the browser-oriented tests remained pending. This does not invalidate the focused pass, but there is no complete-suite result for this review.

## Non-blocking observations

- The reset implementation does not call `localStorage.clear()`, remove application keys, or delete IndexedDB, so direct collection/settings deletion was not found.
- Dynamic error text is assigned with `textContent`, avoiding an HTML-injection issue. The live status and retry button are reasonable accessibility primitives, although a failed or partial cleanup needs a persistent, actionable state rather than an immediate success redirect.

## Resolution applied after review

All three blocking findings were addressed before deployment:

- The reset page moved to the never-before-cached `/fifa-sticker-app/v2/cache-reset-build-9c4a1f2e7b63/` path, inside both the installed-app and V2 worker scopes. The unique pathname bypasses the legacy worker's `ignoreSearch` behavior without changing iOS data containers.
- Root and V2 workers now restrict reads and cleanup to their own named cache namespaces. The root worker is network-first for `/v2/` and no longer deletes V2 caches during activation.
- Recovery now installs and activates the complete current V2 worker/app shell with a 30-second bound, verifies the current named cache exists, and only then removes older registrations and caches. Failed staging retains the old cache and exposes retry instead of navigating.
- Worker readiness requires the expected build and `activated` state; controller reloads have both per-page and per-build guards. Every normal V2 HTML entry loads the build-qualified updater; the reset page intentionally uses only inline code.
- Focused cache/camera tests and the Chrome camera-to-OCR browser test pass after these changes.
