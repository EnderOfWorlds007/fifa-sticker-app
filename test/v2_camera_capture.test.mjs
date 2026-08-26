import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CameraCaptureTimeoutError,
  applyTorchConstraintWithTimeout,
  cameraAvailabilityMessage,
  captureStillWithFallback,
  formatCameraDiagnostics,
  lightStatusLabel,
  shouldBypassNativeStillCapture,
  takePhotoWithTimeout,
} from "../v2/assets/camera_capture.js";

test("native still capture returns normally before the timeout", async () => {
  const expected = new Blob(["photo"], { type: "image/jpeg" });
  const actual = await takePhotoWithTimeout({
    takePhoto(settings) {
      assert.deepEqual(settings, { imageWidth: 4032 });
      return Promise.resolve(expected);
    },
  }, { imageWidth: 4032 }, 50);

  assert.equal(actual, expected);
});

test("native still capture rejects when the browser never settles", async () => {
  await assert.rejects(
    takePhotoWithTimeout({ takePhoto: () => new Promise(() => {}) }, undefined, 5),
    (error) => error instanceof CameraCaptureTimeoutError && /within 5 ms/.test(error.message),
  );
});

test("torch constraints are bounded and preserve the requested value", async () => {
  let received = null;
  await applyTorchConstraintWithTimeout({
    applyConstraints(constraints) {
      received = constraints;
      return Promise.resolve();
    },
  }, true, 20);
  assert.deepEqual(received, { advanced: [{ torch: true }] });

  await assert.rejects(
    applyTorchConstraintWithTimeout({ applyConstraints: () => new Promise(() => {}) }, true, 5),
    /Torch request timed out/,
  );
});

test("a timed-out configured capture uses fallback without a second native attempt", async () => {
  let nativeAttempts = 0;
  let fallbackAttempts = 0;
  const fallbackBlob = new Blob(["preserved preview"], { type: "image/jpeg" });
  const result = await captureStillWithFallback({
    imageCapture: {
      takePhoto() {
        nativeAttempts += 1;
        return new Promise(() => {});
      },
    },
    settings: { fillLightMode: "flash" },
    timeoutMs: 5,
    fallback: async () => {
      fallbackAttempts += 1;
      return fallbackBlob;
    },
  });

  assert.equal(nativeAttempts, 1);
  assert.equal(fallbackAttempts, 1);
  assert.equal(result.blob, fallbackBlob);
  assert.equal(result.source, "video-frame");
  assert.equal(result.retried, false);
  assert.ok(result.error instanceof CameraCaptureTimeoutError);
});

test("a closed session suppresses retry and fallback after a native timeout", async () => {
  let fallbackAttempts = 0;
  await assert.rejects(captureStillWithFallback({
    imageCapture: { takePhoto: () => new Promise(() => {}) },
    settings: { fillLightMode: "flash" },
    timeoutMs: 5,
    shouldContinue: () => false,
    fallback: async () => {
      fallbackAttempts += 1;
      return new Blob(["unused"]);
    },
  }), CameraCaptureTimeoutError);

  assert.equal(fallbackAttempts, 0);
});

test("camera availability explains secure-context and browser fallbacks", () => {
  assert.match(cameraAvailabilityMessage({ isSecureContext: false, navigator: {} }), /secure HTTPS/);
  assert.match(cameraAvailabilityMessage({ isSecureContext: true, navigator: {} }), /Use Photos/);
  assert.equal(cameraAvailabilityMessage({
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia() {} } },
  }), "");
});

test("native still capture is bypassed on iPhone and desktop-UA iPad", () => {
  assert.equal(shouldBypassNativeStillCapture({ navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 } }), true);
  assert.equal(shouldBypassNativeStillCapture({ navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 } }), true);
  assert.equal(shouldBypassNativeStillCapture({ navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 0 } }), false);
  assert.equal(shouldBypassNativeStillCapture({ navigator: { userAgent: "Mozilla/5.0 (Linux; Android 16)", platform: "Linux armv8l", maxTouchPoints: 5 } }), false);
});

test("light diagnostics never turn a request into a confirmed claim", () => {
  assert.equal(lightStatusLabel({ torchRequested: true, torchApplied: true }), "torch requested (browser did not confirm it active)");
  assert.equal(lightStatusLabel({ torchRequested: true, torchApplied: true, torchObserved: true }), "torch confirmed active");
  assert.equal(lightStatusLabel({ torchRequested: true, torchTimedOut: true }), "torch request timed out; captured without confirmed light");
  assert.equal(lightStatusLabel({ lightRequested: true, torchSupported: false, fillLightModeSupported: false }), "flash/torch unsupported");
  assert.match(formatCameraDiagnostics({
    streamWidth: 1920,
    streamHeight: 1080,
    captureWidth: 4032,
    captureHeight: 3024,
    source: "image-capture",
    fillLightModeRequested: true,
    fillLightModeSupported: true,
  }), /Preview 1920×1080; captured 4032×3024; native still photo \(maximum resolution requested\); still-photo flash requested/);
});

test("scanner and shared paste boxes expose camera plus unchanged photo picker paths", () => {
  const scannerHtml = readFileSync("v2/scanner/index.html", "utf8");
  const scannerJs = readFileSync("v2/assets/photo_scanner.js", "utf8");
  const pasteBox = readFileSync("v2/assets/trade_paste_box.js", "utf8");
  const camera = readFileSync("v2/assets/camera_capture.js", "utf8");
  const serviceWorker = readFileSync("v2/sw.js", "utf8");

  assert.match(scannerHtml, /id="photoScannerCameraButton"[^>]*>Use Camera</);
  assert.match(scannerHtml, /id="photoScannerButton"[^>]*>Use Photos</);
  assert.match(scannerJs, /openCameraCapture/);
  assert.match(pasteBox, /cameraButton\.textContent = "Use Camera"/);
  assert.match(pasteBox, /photoButton\.textContent = "Use Photos"/);
  assert.match(camera, /facingMode: \{ ideal: "environment" \}/);
  assert.match(camera, /captureStillWithFallback/);
  assert.match(camera, /shouldBypassNativeStillCapture/);
  assert.match(camera, /snapshotVideoFrame\(video\)/);
  assert.match(camera, /Native still capture timed out; used a preserved camera preview frame/);
  assert.match(camera, /canvas\.width = width/);
  assert.match(camera, /applyTorchConstraintWithTimeout\(\s*track,\s*false/);
  assert.match(serviceWorker, /v2\/assets\/camera_capture\.js/);
});
