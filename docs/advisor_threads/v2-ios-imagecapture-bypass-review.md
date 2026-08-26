# SOL review: iOS `ImageCapture` bypass

## Decision

**The iPhone/iPad `ImageCapture` bypass is justified.**

`Promise.race()` cannot provide a deadline when the operation being raced blocks WebKit's main event loop or synchronously remains inside a native bridge call. In this implementation the timeout is installed before the microtask invokes `ImageCapture.takePhoto()`, but the timeout callback still needs the same event loop to run. A WebKit defect that prevents the call from yielding therefore also prevents the six-second timer, status changes, close handling, and fallback from executing. The repeated real-device stall after the timeout release is consistent with that failure mode, although a JavaScript trace cannot prove the internal WebKit mechanism.

The tactical tradeoff is appropriate: Apple-mobile devices lose `ImageCapture`'s potentially higher-resolution native still and still-photo flash, but retain a live-preview capture path that avoids the demonstrated permanent UI stall. Other platforms continue using native still capture with timeout, preserved-frame fallback, and late-result suppression.

## Findings

### No blocking code finding in the bypass path

The device predicate covers explicit `iPhone`, `iPad`, and `iPod` user agents/platforms plus iPad's desktop identity (`MacIntel` with multiple touch points). On a detected device the code does not construct `ImageCapture`, so neither `getPhotoCapabilities()` nor `takePhoto()` can enter the problematic native path. Fill-light support is consequently not advertised; exposed track torch support becomes the only controllable light mechanism. The canvas encoder and image decoder have finite asynchronous deadlines, the resulting `Blob` follows the unchanged `File` and OCR upload path, and session-generation guards suppress results after cancellation or replacement.

Focused verification passes:

- `git diff --check`
- `node --check v2/assets/camera_capture.js`
- `node --check v2/sw.js`
- `node --test test/v2_camera_capture.test.mjs test/v2_cache_refresh.test.mjs test/photo_code_debug_review.test.mjs` — 14 passed
- `node --test test/browser_v2_camera_capture.test.mjs` — 1 passed

### P1 — Torch activation remains an unbounded Apple-mobile native operation

The bypass removes `ImageCapture`, but `startCamera()` still awaits `track.applyConstraints({ advanced: [{ torch: true }] })` without a deadline before enabling **Take photo**. If WebKit exposes `torch` but its constraints bridge stalls, the modal can hang during startup instead of during capture. Capability exposure is not sufficient proof that activation will settle or that the torch is active.

Concrete fixes:

- Bound the asynchronous torch request independently, with a short device-tested deadline.
- Enable capture after the deadline even when torch activation is unresolved; record `torch request timed out` and capture without claiming illumination.
- Treat only `track.getSettings().torch === true` as confirmed active. Keep the existing requested/unconfirmed and rejected states distinct.
- Add tests for torch capability absent, constraint rejection, constraint timeout, successful-but-unconfirmed application, and confirmed activation.

### P1 — Timer bounds cannot protect synchronous canvas work

The new `encodeCanvas()` and `imageDimensions()` deadlines correctly handle promises that never settle, but—as with `takePhoto()`—they cannot preempt synchronous main-thread work. `snapshotVideoFrame()` performs `drawImage()` synchronously, and the `canvas.toBlob()` invocation itself occurs before the timeout can win. A maximum-resolution preview may require a large RGBA allocation and JPEG encode on an older iPhone.

This is a materially lower risk than the demonstrated `ImageCapture` defect and does not invalidate the bypass, but the limits should not be described as protection from every WebKit main-thread stall.

Concrete fixes:

- Record actual preview dimensions and canvas pixel count in diagnostics.
- Device-test the maximum-resolution path on the oldest supported iPhone/iPad and under memory pressure.
- If necessary, impose a documented canvas pixel ceiling that preserves enough detail for OCR, using aspect-ratio-preserving downscaling only above that ceiling.
- Keep **Use Photos** available because the native picker remains the highest-quality escape route when preview-frame capture is insufficient.

### P2 — Bypass diagnostics depend unnecessarily on `ImageCapture` being present

`diagnostics.nativeStillBypassed` is currently set only when both the Apple-mobile predicate and `window.ImageCapture` support are true. On an iPhone/iPad version where `ImageCapture` is absent, behavior is still safe—the canvas branch runs—but diagnostics say only that `ImageCapture` is unavailable rather than explicitly reporting the intentional Apple-mobile policy. The formatted source also says `iPhone camera frame` for iPad.

Concrete fixes:

- Compute the platform policy independently: `nativeStillBypassed = shouldBypassNativeStillCapture(window)`.
- Keep `imageCaptureSupported` as a separate availability fact.
- Report `iPhone/iPad camera frame (native still bypassed)` or `Apple-mobile camera frame` consistently.
- Add a test for an Apple-mobile environment with no `ImageCapture` constructor and assert the explicit bypass diagnostic.

### P2 — Browser tests cannot reproduce the native WebKit failure

The Chrome/CDP test is useful: after switching to the iPhone platform identity it proves the cumulative native call count does not increase, torch is confirmed in the mock, a non-empty canvas file reaches OCR, and the source diagnostic reports the bypass. Unit coverage also distinguishes desktop Mac from desktop-UA iPad and preserves Android native capture.

Concrete recommendations:

- Count `ImageCapture` constructor and `getPhotoCapabilities()` calls as well as `takePhoto()` calls; all must remain zero for the Apple-mobile session.
- Assert the iPhone/iPad canvas dimensions and MIME type, track cleanup, torch-off cleanup, and capture-button recovery after encode/decode failure.
- Retain a manual real-WebKit release check because Chromium mocks cannot establish that WebKit no longer enters the blocking native API.
- Verify on: iPhone Safari browser tab, installed home-screen app, iPad Safari with desktop browsing identity, an Android Chromium device, and desktop Chromium.

## Cache migration

The proposed migration to `build-b7e3d4f6a219` is internally consistent across V2 HTML, module imports, `pwa.js`, `sw.js`, tests, documentation, scanner build marker, and the new unique recovery pathname. The V2 worker installs versioned app-shell URLs into a build-specific named cache; runtime cache reads stay within that cache. The recovery page stages and verifies the current worker/cache before removing stale workers and caches, and it preserves collection/settings storage.

Concrete release requirements:

- Ensure the currently untracked `v2/cache-reset-build-b7e3d4f6a219/` directory is included in the commit; the scanner already links to it.
- Do not add the recovery pathname to `APP_SHELL_PATHS`; its novelty is what lets legacy cache-first clients reach it.
- Keep the historical `cache-reset-build-9c4a1f2e7b63` page unchanged.
- After GitHub Pages deploys, verify HTTP 200 and the exact build ID for scanner HTML, `camera_capture.js`, `pwa.js`, `sw.js`, and the new reset page.
- On the affected phone, open the new reset path once and confirm the visible `Camera build b7e3d4f6a219 ready` marker before retesting capture. If the marker is current, any remaining stall is no longer attributable to the old cached camera module.

## Recommended deployment posture

Ship the Apple-mobile bypass as the immediate reliability fix. Its platform scope is deliberately conservative and reversible, and it avoids an API that has now defeated both a native rejection fallback and a JavaScript timeout on the target device. Treat re-enabling `ImageCapture` on iPhone/iPad as a future opt-in experiment gated by real-device evidence, not by API presence alone.

## Resolution applied

- Native-still bypass policy is recorded independently from `ImageCapture` availability, and diagnostics consistently say `iPhone/iPad camera frame`.
- Torch activation has an independent 1.8-second promise deadline with a distinct timed-out diagnostic; capture remains available without claiming the light is active.
- Apple-mobile cleanup stops the media track directly instead of making another potentially blocking torch-constraint call. Stopping the track releases the camera and physical torch.
- The browser regression checks that an iPhone-identified session makes no additional `takePhoto()` call and sends a non-empty canvas capture through the existing OCR upload.
