import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cameraAvailabilityMessage,
  formatCameraDiagnostics,
  lightStatusLabel,
} from "../v2/assets/camera_capture.js";

test("camera availability explains secure-context and browser fallbacks", () => {
  assert.match(cameraAvailabilityMessage({ isSecureContext: false, navigator: {} }), /secure HTTPS/);
  assert.match(cameraAvailabilityMessage({ isSecureContext: true, navigator: {} }), /Use Photos/);
  assert.equal(cameraAvailabilityMessage({
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia() {} } },
  }), "");
});

test("light diagnostics never turn a request into a confirmed claim", () => {
  assert.equal(lightStatusLabel({ torchRequested: true, torchApplied: true }), "torch requested (browser did not confirm it active)");
  assert.equal(lightStatusLabel({ torchRequested: true, torchApplied: true, torchObserved: true }), "torch confirmed active");
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
  assert.match(camera, /imageCapture\.takePhoto\(settings\)/);
  assert.match(camera, /canvas\.width = width/);
  assert.match(camera, /track\.applyConstraints\(\{ advanced: \[\{ torch: false \}\] \}\)/);
  assert.match(serviceWorker, /v2\/assets\/camera_capture\.js/);
});
