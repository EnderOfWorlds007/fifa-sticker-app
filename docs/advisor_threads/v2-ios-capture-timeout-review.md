# SOL review: iOS capture timeout fix

## Findings

There are no blocking findings. The change correctly bounds both configured and unconfigured `ImageCapture.takePhoto()` attempts, distinguishes its own timeout error, and sends a timed-out configured capture directly to the canvas fallback without making a second native call. `Promise.race()` installs fulfillment and rejection handlers on the native promise, so a later native resolution or rejection is ignored without becoming an unhandled rejection. Session-generation checks after each await prevent late timeout, capture, fallback, and decode results from updating a closed or replaced session.

The captured `Blob` still follows the existing dimensions → `File` → `openCameraCapture()` result → OCR path. The V2 cache name, scanner entry-point versions, module graph, service-worker registration URL, and cache assertion were updated consistently to `build-0d8b7c2e6a41`; this is sufficient for an online scanner navigation to install and activate the new app shell.

Focused unit and browser verification passes:

- `node --test test/v2_camera_capture.test.mjs test/browser_v2_camera_capture.test.mjs test/photo_code_debug_review.test.mjs`
- 7 tests passed, including the existing captured-file OCR handoff and native picker fallback.

## Prioritized risks and concrete recommendations

### P1 — The fallback frame is acquired after the native camera pipeline has already hung

On timeout, the unresolved `ImageCapture.takePhoto()` operation cannot be cancelled and remains attached to the same track while `canvasFrame(video)` draws from the live preview. If Safari's native still operation wedged or blanked that media pipeline—the supplied failure screenshot already shows a black preview area—the fallback can upload a frozen or black JPEG. The modal will no longer remain stuck, but OCR may receive unusable pixels.

Concrete fix:

- Snapshot the `<video>` pixels into an offscreen canvas synchronously at the start of `capture()`, before invoking `takePhoto()`.
- On native timeout, encode that preserved canvas and use it as the fallback; do not draw from the possibly wedged live video at that point.
- Stop the media track after the preserved fallback has been selected so the late native operation loses the camera resource as soon as practical.
- Keep the current direct-to-canvas behavior when `ImageCapture` is unavailable, because no native operation can have wedged the track in that branch.

### P1 — Regression coverage does not exercise the timeout orchestration

The new unit test proves only that `takePhotoWithTimeout()` rejects a never-settling promise. The source-pattern assertion does not prove that a configured timeout avoids the unconfigured retry, that the canvas result reaches OCR, or that closing during the six-second wait suppresses late work. The existing browser test covers only a successful native still.

Concrete fix:

- Add a controller/browser test whose first `takePhoto(settings)` never settles and whose call counter must remain exactly `1`.
- Allow a test-only timeout injection through the camera-session options, or extract the attempt/fallback orchestration into a dependency-injected helper, so the test does not wait six seconds.
- Assert that the canvas fallback becomes a non-empty `File`, is submitted to `createPhotoCodeJob()`, reports `source: "video-frame"`, and stops the track.
- Add close-during-timeout coverage: close or replace the session before expiry, advance the timer, and assert no status callback, OCR upload, or second native capture occurs.
- Add late-resolution and late-rejection cases to confirm they have no observable effect and do not generate `unhandledrejection`.

### P2 — Only native still capture is bounded

The fix removes the observed infinite wait in `takePhoto()`, but `canvas.toBlob()` and `imageDimensions()` remain unbounded. They normally settle reliably, yet an iOS memory-pressure or codec failure could still leave the capture button disabled indefinitely during the fallback/decode stages.

Concrete fix:

- Apply separate, clearly named time limits to canvas encoding and image decoding.
- On an encoding/decode timeout, re-enable **Take photo**, preserve **Use Photos**, and display a stage-specific retry message.
- Do not reuse the six-second native-photo timeout blindly; large preview-frame JPEG encoding may need a longer device-tested budget.

## Final recommendation

The current patch is safe to deploy as the immediate stall fix: its timeout classification, no-second-retry branch, late-promise handling, cancellation guards, OCR handoff, and cache busting are correct. Follow promptly with the pre-native preserved-frame fallback and behavioral timeout tests, because those protect image usefulness—not only modal liveness—on the exact Safari failure mode being addressed.

## Resolution applied

- The preview is copied to an offscreen canvas before native still capture begins, and timeout fallback encodes that preserved frame.
- Canvas JPEG encoding and captured-image decoding now have separate bounded timeouts.
- Timeout orchestration is dependency-injected and behaviorally tested: a hung configured capture makes exactly one native call, uses the preserved fallback, and suppresses fallback work after session cancellation.
- The existing browser test still verifies that the resulting `File` reaches OCR and that camera cleanup and the native picker fallback remain intact.
