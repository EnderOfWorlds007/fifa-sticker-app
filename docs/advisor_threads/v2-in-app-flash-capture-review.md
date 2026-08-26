# SOL review: V2 controlled camera and flash capture

## Findings

- Implement one shared `v2/assets/camera_capture.js` module for both `photo_scanner.js` and `trade_paste_box.js`.
- Preserve the existing OCR pipeline by returning a normal `File` plus diagnostics. Camera code should not know about OCR URLs, collection state, or trade parsing.
- Keep **Use Photos** unchanged and add a separate **Use Camera** action.
- Reuse the proven concepts in legacy `assets/app.js`, but avoid copying its stateful scanner code into V2.
- Distinguish still-photo flash from continuous torch:
  - `fillLightMode: "flash"` applies to `ImageCapture.takePhoto()`.
  - `torch` is a video-track constraint.
- A resolved `applyConstraints()` call does not prove the light is active. Re-read `track.getSettings().torch` and report confirmed, unconfirmed, rejected, or unsupported states.
- Safari added Image Capture in 18.4, but torch, flash, lens selection, and maximum resolution remain device-dependent.
- “No downscaling” should mean the `ImageCapture` blob is submitted unchanged. Canvas fallback cannot guarantee sensor resolution or lossless capture.

## Recommended capture hierarchy

1. `ImageCapture.takePhoto()` with maximum advertised dimensions.
2. Canvas snapshot at intrinsic `video.videoWidth × video.videoHeight`, without resizing.
3. Native file/photo input fallback.

Return diagnostics such as:

```js
{
  source: "image-capture" | "video-frame" | "native-picker",
  streamWidth,
  streamHeight,
  captureWidth,
  captureHeight,
  facingMode,
  rearCameraRequested,
  imageCaptureSupported,
  torchSupported,
  torchRequested,
  torchApplied,
  torchObserved,
  fillLightModeRequested,
  fillLightModeSupported,
  fallbackReason,
}
```

## Camera behavior

- Request the rear camera with ideal 4096×3072 constraints.
- After permission, inspect capabilities and apply maximum supported resolution.
- Request `resizeMode: "none"` only when supported; retry without it when rejected.
- Display actual settings rather than claiming requested settings were achieved.
- When illumination is requested:
  1. Prefer still-photo flash if advertised.
  2. Otherwise enable torch.
  3. Confirm through current settings.
  4. Wait about 300 ms for exposure to settle.
  5. Capture.
  6. Disable torch in `finally`.

## UI and accessibility

Use a reusable camera dialog containing:

- live `playsinline`, muted preview;
- flash-light toggle;
- **Take photo**;
- **Cancel**;
- native-camera/photo fallback;
- an `aria-live="polite"` diagnostics region.

Report preview resolution, captured resolution, source, and truthful light state. Restore focus to the invoking button and support Escape.

## Lifecycle requirements

Use an explicit state machine and allow only one active camera session per page.

On success, cancel, error, page hiding, or navigation:

- disable torch best-effort;
- stop every media track;
- clear `video.srcObject`;
- revoke object URLs;
- invalidate pending asynchronous work;
- restore focus.

Use a session token so late permission or capture results cannot reopen or mutate a closed dialog.

## Testing recommendations

Add dependency-injected unit tests covering:

- insecure or unsupported contexts;
- rear-camera and resolution constraints;
- unchanged `takePhoto()` blob delivery;
- intrinsic-size canvas fallback;
- flash capability selection;
- torch supported, confirmed, unconfirmed, and rejected;
- torch restoration after success and error;
- track cleanup on cancellation;
- stale asynchronous result rejection;
- native-picker fallback;
- existing OCR upload receiving the captured `File` unchanged.

Add browser and structural tests confirming:

- Scanner and paste boxes expose **Use Camera** and **Use Photos**;
- dialog lifecycle and focus behavior;
- camera capture reaches the existing OCR flow;
- live-region status semantics.

Manual testing remains necessary on current iPhone Safari, older/no-ImageCapture Safari, and Android Chrome with torch support.

## Service-worker recommendations

- Add `v2/assets/camera_capture.js` to the V2 app shell.
- Bump the V2 cache/build identifier.
- Update versioned imports consistently.
- Test both clean installation and upgrade from the previous PWA cache.

## Primary risks

1. Falsely reporting that flash or torch is active.
2. Recompressing a full-resolution still through canvas.
3. Leaving the camera or torch active after closing.
4. Duplicating camera state across consumers.
5. Treating video-frame resolution as sensor-photo resolution.
6. Breaking the existing photo-library path.
7. Serving stale modules from the service worker.
8. Assuming Safari Image Capture support implies reliable iPhone flash control.

## Implementation review

### Verdict

Blocking findings remain. The shared-module direction, OCR handoff, UI integration, and service-worker versioning are sound, but the native fallback and camera-session lifecycle need correction before deployment.

### P0 — Native **Use Photos** fallback can lose browser user activation

`camera_capture.js` handles the fallback button by calling `finish(null, { fallback: true })`. `finish()` waits for asynchronous `cleanup()` before invoking `options.onFallback()`, which then calls the hidden file input's `click()`.

Mobile Safari and other browsers commonly require the file picker to be opened during the original trusted click event. Invoking it after awaiting torch cleanup can lose transient user activation, so **Use Photos** may do nothing—the exact fallback the issue requires preserving.

Concrete fix:

- Invoke the picker callback synchronously inside the fallback button's click handler.
- Stop the media tracks synchronously before opening the picker.
- Perform best-effort asynchronous torch reset and remaining cleanup afterward.
- Split `finish()` into a synchronous deactivation step and an awaited final-cleanup step, or add a dedicated `fallbackToPicker()` path.
- Add a browser test that clicks the dialog fallback and observes a file-chooser event.

### P0 — A replacement session starts before the previous camera has closed

`openCameraCapture()` calls `activeSession.close(...)` without awaiting it, then immediately creates and starts a new session. `close()` returns nothing, while cleanup may still be awaiting `applyConstraints({ torch: false })` before tracks are stopped.

On phones, the second `getUserMedia()` can race the still-active first stream and fail with `NotReadableError`, briefly leave two sessions active, or produce inconsistent torch state.

Concrete fix:

- Make `close()` return the cleanup/settlement promise.
- In `openCameraCapture()`, `await activeSession.close(...)` before assigning or starting the next session.
- Stop tracks immediately at the start of cleanup; do not wait for torch-reset completion before releasing the camera hardware.
- Add a test that opens two sessions quickly and asserts the first track is stopped before the second `getUserMedia()` call.

### P1 — Flash and torch selection does not follow the advertised priority

The session starts `getPhotoCapabilities()` asynchronously, then immediately requests continuous torch whenever light is requested. At capture time it may also request `fillLightMode: "flash"`. A device supporting both can therefore receive continuous torch plus still-photo flash.

This can cause overexposure and does not implement the intended “prefer still flash, otherwise torch” policy.

Concrete fix:

- Await photo-capability discovery before selecting the light mechanism.
- Record a single selected mode: `fill-light`, `torch`, or `unsupported`.
- If still flash is supported, do not enable continuous torch automatically.
- If live torch preview is desired, expose it as a distinct user choice and do not combine it silently with still flash.
- Ensure `photoSettings()` updates `fillLightModeSupported` from the same capability result instead of relying on a separate racing promise.

### P1 — “Full-resolution still” is an unsupported claim

`formatCameraDiagnostics()` labels every `ImageCapture` result as `full-resolution still`. The code requests maximum advertised dimensions, but the browser may ignore those settings or return a smaller still. Actual dimensions are reported correctly, but the source label overstates the guarantee.

Concrete fix:

- Rename the source label to `native still photo` or `ImageCapture still`.
- Report `maximum resolution requested` separately.
- Call a result “maximum/full resolution” only when returned dimensions are verified against trustworthy advertised maxima.

### P1 — Asynchronous work can update status after cancellation or replacement

Generation checks exist during early camera startup, but not after `requestTorch()`, `getPhotoCapabilities()`, `takePhoto()`, `imageDimensions()`, or capture failures. A closed session can therefore call `onStatus` after its dialog is gone and overwrite the invoking page's status, including after a new session begins.

Concrete fix:

- Capture a session token at the start of every asynchronous operation.
- After every `await`, return without UI or callback updates when `settled` or the token is stale.
- Guard the `getPhotoCapabilities().then(...)` callback.
- Suppress capture error/status reporting after intentional close.
- Add tests for close-during-permission, close-during-torch-delay, and close-during-`takePhoto()`.

### P1 — Tests do not exercise the controller behavior

The new tests validate formatting and source-code patterns only. They would pass with the lifecycle and fallback defects above. Missing behavioral coverage includes:

- unchanged `ImageCapture` blob reaching OCR;
- canvas fallback dimensions;
- capability discovery and light-mode selection;
- truthful confirmed/unconfirmed torch states;
- torch rejection;
- cleanup after success, failure, and cancel;
- fallback picker user activation;
- replacement-session serialization;
- focus restoration;
- stale asynchronous result suppression.

Concrete fix:

- Inject `window`, `document`, timers, `ImageCapture`, and `getUserMedia`, or expose a controller factory accepting these dependencies.
- Use fake tracks with recorded calls and controllable promises.
- Retain the current structural tests, but add behavioral unit tests for all lifecycle branches.
- Extend the existing Chrome/CDP media test to cover dialog open/cancel and the fallback file chooser.

### P2 — Camera privacy cleanup does not cover backgrounding

Cleanup is registered for `pagehide` but not `visibilitychange`. On mobile, switching apps or locking the phone may leave the capture session logically active until the browser suspends it.

Concrete fix:

- Close the session when `document.visibilityState === "hidden"`.
- Remove that listener during cleanup.
- On return, require a new user action to reopen the camera rather than attempting to reuse a suspended track.

### P2 — Dialog isolation is incomplete

The custom `div[role="dialog"]` traps Tab among its buttons but does not make background content inert. Screen-reader virtual navigation can still reach the underlying page, and background controls remain programmatically focusable.

Concrete fix:

- Prefer a native `<dialog>` with `showModal()` where supported.
- Otherwise mark the application shell inert while the camera is open and restore its prior state during cleanup.
- Add `aria-describedby` pointing to the live camera status.
- Verify focus restoration for close, successful capture, fallback, permission failure, and replacement sessions.

### Service worker, security, and existing OCR behavior

- The build identifier is consistently updated across V2 HTML and module imports.
- `camera_capture.js` is present in the V2 app shell, and the cache name is bumped.
- The camera module uses constant markup rather than interpolating untrusted content; no new injection path was found.
- Captured files continue through the existing `createPhotoCodeJob()` path without app-side redraw when `ImageCapture` succeeds.
- The ordinary photo-picker path remains structurally intact, aside from the blocking dialog-fallback activation bug described above.
- Focused static/unit tests pass, but that does not mitigate the missing controller-behavior coverage.

## Resolution after implementation review

The blocking and high-priority findings above were addressed before deployment:

- The native picker callback now runs synchronously in the fallback button's trusted click handler, after tracks are stopped synchronously; a Chrome/CDP test observes the real file-chooser event.
- Replacement sessions await the previous session's cleanup, and cleanup stops tracks before awaiting best-effort torch reset.
- Still-photo flash and continuous torch are mutually selected: advertised still flash wins, otherwise torch is attempted and verified from track settings.
- Diagnostics now say `native still photo (maximum resolution requested)` and continue to report actual captured dimensions.
- Async camera operations use the session generation/settled guard before updating UI or returning captured data.
- The camera closes on `visibilitychange` when the document becomes hidden.
- The custom overlay was replaced by a native modal `dialog` with labelled live diagnostics and focus restoration.
- A mocked-camera browser test verifies the unchanged captured `File` OCR handoff, truthful still-flash diagnostics, track cleanup, torch-off cleanup, and native picker fallback.

Remaining device-level validation is intentionally manual because desktop/headless browsers cannot establish whether physical iPhone/Android flash hardware fired.
