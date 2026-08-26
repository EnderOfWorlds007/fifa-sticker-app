# V2 browser cache and service-worker strategy

This is the canonical cache-busting and stale-client recovery runbook for the public V2 sticker app. Read it before changing or deploying any V2 HTML, JavaScript, CSS, service worker, manifest, or other browser-cached asset.

The core rule is simple: **a V2 change is not complete until a previously installed iPhone client can obtain one internally consistent build without losing local collection data or its working offline copy.**

## Why ordinary query-string busting was insufficient

An older V2 service worker used cache-first lookup with `ignoreSearch: true`. Under that worker, requesting:

```text
/v2/assets/camera_capture.js?v=new-build
```

could still return the cached response for:

```text
/v2/assets/camera_capture.js?v=old-build
```

Changing only `?v=...`, the HTML references, or the service-worker cache name therefore does not guarantee recovery for a client still controlled by that worker.

V2 also overlaps the legacy root worker scope. Root and V2 workers must never delete or read from each other's caches.

## Current architecture and invariants

### Build identity

- V2 uses one build identifier in the form `build-<12 lowercase hex characters>`.
- The current deployed identifier is `build-9c4a1f2e7b63`.
- The identifier appears consistently in V2 HTML asset URLs, JavaScript module imports, data URLs, `v2/assets/pwa.js`, `v2/sw.js`, cache tests, and the current recovery page.
- Every deployable change to cached V2 assets gets a new identifier. Never reuse an identifier, even for a reverted or amended deployment.

### V2 worker ownership

- `v2/sw.js` owns only `fifa-card-apps-fifa-sticker-app-v2-*` caches.
- Runtime reads use `cache.match()` on the current named cache, never origin-global `caches.match()`.
- Activation deletes only older caches bearing the V2 prefix.
- Navigations and mutable HTML, JavaScript, and CSS are network-first with `cache: "no-store"` and a current-cache fallback.
- Every app-shell URL is fetched with the current build query during installation. This prevents the browser or CDN from filling a new cache with an older unversioned response.
- Offline fallback may ignore the search string only inside the current named V2 cache.

### Legacy root worker ownership

- `sw.js` owns only the legacy `fifa-card-apps-v*` cache namespace.
- Root-worker activation deletes only older caches bearing that legacy prefix. It must never delete V2 caches.
- Requests below `/fifa-sticker-app/v2/` are network-first if the root worker sees them.
- Root cache lookups are restricted to the current root cache.

### Updater behavior

- Every ordinary V2 HTML entry loads `/v2/assets/pwa.js?v=<current-build>`.
- Registration uses `/v2/sw.js?v=<current-build>` with `updateViaCache: "none"`, followed by `registration.update()`.
- Readiness is truthful only when the active worker has the expected build in its script URL and is in the `activated` state.
- When the new controller takes over, the page reloads once with the current build and a nonce.
- Reload protection uses both an in-memory per-page guard and a per-build `sessionStorage` key.
- `v2/sw.js` supports `SKIP_WAITING`; its install path also calls `skipWaiting()` after the complete app shell has been cached.

## Standard deployment procedure

For every change that affects V2 browser assets:

1. Start from refreshed `origin/main` in a clean task branch/worktree.
2. Generate a never-used 12-character lowercase hexadecimal build suffix.
3. Replace the prior V2 build identifier across `v2/` and affected tests.
4. Confirm every ordinary V2 HTML entry references the current, versioned `pwa.js`.
5. Confirm all V2 module imports and top-level asset URLs use the same identifier.
6. Confirm `v2/sw.js` uses that identifier for `BUILD_ID`, its cache name, and every app-shell install request.
7. Run the focused cache, camera, affected-feature, and browser tests.
8. Inspect the complete diff for old identifiers, mixed builds, global CacheStorage reads, or cross-worker deletion.
9. Merge through a focused PR and wait for the GitHub Pages deployment to finish.
10. Verify the live scanner HTML, updater, V2 worker, root worker, and changed asset directly. Do not infer success only from the Pages workflow.

Useful checks:

```bash
rg -n 'build-[0-9a-f]{12}' v2 test
rg -n 'caches\.match' sw.js v2/sw.js
git diff --check
node --check sw.js
node --check v2/sw.js
node --check v2/assets/pwa.js
node --test test/v2_cache_refresh.test.mjs test/v2_camera_capture.test.mjs test/v2_photo_scanner_collection_labels.test.mjs test/photo_code_debug_review.test.mjs test/media_buttons.test.mjs
node --test test/browser_v2_camera_capture.test.mjs
```

The full Node test glob contains browser-oriented tests that may contend for fixed ports when run concurrently. Run the focused non-browser group and browser test separately unless that harness is changed.

## Recovery from a stale controlling worker

When a real client may still be controlled by a legacy `ignoreSearch` worker, add a **new pathname**, not merely a new query string:

```text
/fifa-sticker-app/v2/cache-reset-build-<current-build-suffix>/
```

The pathname must meet all of these requirements:

- It is new and has never appeared in an earlier app shell or runtime cache.
- It remains under `/fifa-sticker-app/v2/`, inside the installed app's manifest and worker scopes. Moving it outside V2 can open Safari instead of the installed iOS app and make the user's data appear missing because iOS may use a different website-data container.
- It is not added to `APP_SHELL_PATHS`; the old worker must encounter a cache miss and fetch it from the network.
- It is self-contained with inline styles and JavaScript, so it cannot load stale dependencies.
- It never clears `localStorage`, IndexedDB, collection state, OCR settings, or application data.

Recovery is two-phase:

1. Register the current versioned V2 worker with `updateViaCache: "none"`.
2. Let that worker download the complete versioned app shell.
3. Wait, with a bounded timeout, until the expected worker is active.
4. Verify the current named V2 cache exists.
5. Only then unregister older overlapping workers and delete stale `fifa-card-apps*` caches, retaining the verified current cache.
6. Check every `unregister()` and `caches.delete()` boolean result.
7. Redirect to the scanner with the current build and a fresh nonce.
8. If staging or activation fails, keep the old caches and show a retry action. Never destroy the working offline copy first.

The current live recovery URL is:

```text
https://enderofworlds007.github.io/fifa-sticker-app/v2/cache-reset-build-9c4a1f2e7b63/
```

Create a new recovery pathname whenever the build changes and stale installed clients need an explicit escape route. Do not overwrite or reuse an older recovery pathname.

## Live verification checklist

After Pages reports success, verify all of the following against the public site:

- The recovery path returns HTTP 200 and contains the current `BUILD_ID`, current cache name, bounded activation wait, and stage-before-delete ordering.
- Scanner HTML shows the current camera build marker and links to the current recovery path.
- Scanner HTML loads `pwa.js` with the current build query.
- `v2/assets/pwa.js` contains the current `V2_BUILD_ID`, `updateViaCache: "none"`, and `controllerchange` handling.
- `v2/sw.js` contains the current `BUILD_ID`, versioned `APP_SHELL_PATHS.map(...)`, and named-cache `cache.match()` calls.
- `sw.js` uses the root-only cache prefix, does not delete V2 caches, and treats `/v2/` as network-first.
- The deployed changed asset is byte-for-byte identical to the tested local file when practical.

For a camera regression, ask the tester to confirm the visible scanner marker before diagnosing further:

```text
Camera build <current-suffix> ready
```

If that marker is current and the one-time recovery completed, treat the remaining behavior as an application/browser bug rather than assuming cache staleness again.

## Prohibited shortcuts

Do not:

- bump only the service-worker cache name;
- change only query strings when a legacy `ignoreSearch` worker may control the page;
- use origin-global `caches.match()` for root or V2 runtime assets;
- let one worker delete every origin cache;
- place the recovery page outside the V2 installed-app scope;
- delete old caches before the replacement shell is installed and active;
- clear `localStorage`, IndexedDB, collection data, or settings as cache recovery;
- report a build ready merely because some service worker is active;
- reuse a build identifier or recovery pathname;
- stop at a successful PR or Pages workflow without checking live content.

## Historical context

The failure mode and remediation were reviewed and recorded in:

- [`docs/advisor_threads/v2-force-cache-refresh-review.md`](advisor_threads/v2-force-cache-refresh-review.md)
- [`docs/advisor_threads/v2-ios-capture-timeout-review.md`](advisor_threads/v2-ios-capture-timeout-review.md)

Those reviews explain why query-only busting, cross-worker cache access, out-of-scope recovery, and delete-before-stage recovery are unsafe.
