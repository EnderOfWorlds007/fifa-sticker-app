import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8792;
const DEBUG_PORT = 9332;

test("V2 controlled camera sends its captured File through the existing OCR flow", async () => {
  const serverRoot = await mkdtemp(join(tmpdir(), "fifa-v2-camera-server-"));
  await symlink(process.cwd(), join(serverRoot, "fifa-sticker-app"));
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: serverRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chromeProfile = await mkdtemp(join(tmpdir(), "fifa-v2-camera-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${chromeProfile}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/fifa-sticker-app/v2/scanner/`);
    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const page = await createPage("about:blank");
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    try {
      await send(cdp, "Runtime.enable");
      await send(cdp, "Page.enable");
      await send(cdp, "Page.addScriptToEvaluateOnNewDocument", { source: cameraMockSource() });
      await send(cdp, "Page.navigate", { url: `http://127.0.0.1:${PORT}/fifa-sticker-app/v2/scanner/` });
      await waitForExpression(cdp, `document.querySelector("#photoScannerCameraButton")`);
      await delay(500);
      await evaluate(cdp, installOcrMockSource());

      await evaluate(cdp, `document.querySelector("#photoScannerCameraButton").click()`);
      await waitForExpression(cdp, `document.querySelector(".cameraCaptureDialog")`);
      await waitForExpression(cdp, `document.querySelector(".cameraTakeButton:not([disabled])")`);
      const livePreview = await evaluate(cdp, `document.querySelector(".cameraCaptureStatus").textContent`);
      assert.match(livePreview, /Preview 1920×1080/);
      assert.match(livePreview, /still-photo flash ready/);

      await evaluate(cdp, `document.querySelector(".cameraTakeButton").click()`);
      await waitForExpression(cdp, `document.querySelector("#photoScannerResult").value === "TUR5"`);
      const result = await evaluate(cdp, `({
        upload: window.__cameraUpload,
        diagnostics: document.querySelector("#photoCameraDiagnostics").textContent,
        tracksStopped: window.__cameraTracksStopped,
        torch: window.__cameraTorch,
        cameraButtonDisabled: document.querySelector("#photoScannerCameraButton").disabled,
      })`);
      assert.equal(result.upload.name.startsWith("sticker-camera-"), true);
      assert.equal(result.upload.type, "image/png");
      assert.ok(result.upload.size > 0);
      assert.match(result.diagnostics, /captured 1×1/);
      assert.match(result.diagnostics, /native still photo/);
      assert.match(result.diagnostics, /still-photo flash requested/);
      assert.equal(result.tracksStopped, true);
      assert.equal(result.torch, false, "cleanup should turn the torch off");
      assert.equal(result.cameraButtonDisabled, false);

      await evaluate(cdp, `(() => {
        Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
        Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
      })()`);
      await evaluate(cdp, `document.querySelector("#photoScannerCameraButton").click()`);
      await waitForExpression(cdp, `document.querySelector(".cameraTakeButton:not([disabled])")`);
      const iosPreview = await evaluate(cdp, `document.querySelector(".cameraCaptureStatus").textContent`);
      assert.match(iosPreview, /torch confirmed active/);
      await evaluate(cdp, `document.querySelector(".cameraTakeButton").click()`);
      await waitForExpression(cdp, `window.__cameraUploadCount === 2`);
      const iosResult = await evaluate(cdp, `({
        nativeCalls: window.__nativeTakePhotoCalls,
        diagnostics: document.querySelector("#photoCameraDiagnostics").textContent,
        upload: window.__cameraUpload,
      })`);
      assert.equal(iosResult.nativeCalls, 1, "iPhone capture must not call ImageCapture.takePhoto");
      assert.ok(iosResult.upload.size > 0);
      assert.match(iosResult.diagnostics, /iPhone\/iPad camera frame \(native still bypassed\)/);

      await send(cdp, "Page.setInterceptFileChooserDialog", { enabled: true });
      await waitForExpression(cdp, `document.querySelector("#photoScannerStatus").textContent.includes("recognized") && !document.querySelector("#photoScannerCameraButton").disabled`);
      await evaluate(cdp, `document.querySelector("#photoScannerCameraButton").click()`);
      await waitForExpression(cdp, `document.querySelector(".cameraFallbackButton")`);
      const fallbackRect = await evaluate(cdp, `(() => {
        const rect = document.querySelector(".cameraFallbackButton").getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })()`);
      const chooserPromise = withTimeout(cdp.waitFor("Page.fileChooserOpened"), 2000, "fallback file chooser did not open");
      await clickCenter(cdp, fallbackRect);
      const chooser = await chooserPromise;
      assert.equal(chooser.mode, "selectMultiple");
    } finally {
      cdp.close();
    }
  } finally {
    server.kill();
    chrome.kill();
    await Promise.allSettled([once(server, "exit"), once(chrome, "exit")]);
    await rm(serverRoot, { recursive: true, force: true });
    await rm(chromeProfile, { recursive: true, force: true });
  }
});

function cameraMockSource() {
  return `(() => {
    sessionStorage.setItem("fifa-v2-controller-reload-build-8948f03f90fb", "1");
    window.__cameraTorch = false;
    window.__cameraTracksStopped = false;
    window.__nativeTakePhotoCalls = 0;
    const track = {
      getCapabilities: () => ({ width: { max: 4096 }, height: { max: 3072 }, torch: true, resizeMode: ["none"] }),
      getSettings: () => ({ width: 1920, height: 1080, facingMode: "environment", torch: window.__cameraTorch }),
      applyConstraints: async (constraints) => {
        const requested = constraints?.advanced?.[0]?.torch;
        if (typeof requested === "boolean") window.__cameraTorch = requested;
      },
      stop: () => { window.__cameraTracksStopped = true; },
    };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1920 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 1080 });
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() { return this.__mockStream || null; },
      set(value) { this.__mockStream = value; },
    });
    HTMLVideoElement.prototype.play = async function () {};
    HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
      get(target, property) {
        if (!(property in target)) target[property] = () => {};
        return target[property];
      },
      set(target, property, value) { target[property] = value; return true; },
    });
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));
      callback(new Blob([bytes], { type: "image/png" }));
    };
    window.ImageCapture = class {
      constructor() {}
      async getPhotoCapabilities() { return { imageWidth: { max: 4032 }, imageHeight: { max: 3024 }, fillLightMode: ["flash"] }; }
      async takePhoto() {
        window.__nativeTakePhotoCalls += 1;
        const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));
        return new Blob([bytes], { type: "image/png" });
      }
    };
  })()`;
}

function installOcrMockSource() {
  return `(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, init) => {
      if (String(url).includes("/api/photo-code-jobs") && init?.method === "POST") {
        const file = init.body;
        window.__cameraUploadCount = (window.__cameraUploadCount || 0) + 1;
        window.__cameraUpload = file ? { name: file.name, type: file.type, size: file.size } : null;
        return Promise.resolve(new Response(JSON.stringify({ job_id: "camera-job", status: "queued" }), { status: 202, headers: { "content-type": "application/json" } }));
      }
      if (String(url).includes("/api/photo-code-jobs/camera-job")) {
        return Promise.resolve(new Response(JSON.stringify({ status: "done", result: { codes: ["TUR5"] } }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return originalFetch(url, init);
    };
    window.PANINI_CONFIG.recognitionBaseUrl = "https://ocr.test";
  })()`;
}

async function createPage(url) {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not create Chrome page: ${response.status}`);
  return response.json();
}

async function waitForHttp(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const waiters = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
      return;
    }
    const listeners = waiters.get(message.method) || [];
    for (const listener of listeners.splice(0)) listener(message.params || {});
  });
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    waitFor(method) {
      return new Promise((resolve) => {
        const listeners = waiters.get(method) || [];
        listeners.push(resolve);
        waiters.set(method, listeners);
      });
    },
  };
}

function send(cdp, method, params) { return cdp.send(method, params); }

async function evaluate(cdp, expression) {
  const result = await send(cdp, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(cdp, expression) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(cdp, expression)) return;
    await delay(50);
  }
  const debug = await evaluate(cdp, `({
    cameraStatus: document.querySelector(".cameraCaptureStatus")?.textContent || "",
    scannerStatus: document.querySelector("#photoScannerStatus")?.textContent || "",
    result: document.querySelector("#photoScannerResult")?.value || "",
    upload: window.__cameraUpload || null,
    uploadCount: window.__cameraUploadCount || 0,
    href: location.href,
  })`);
  throw new Error(`Timed out waiting for ${expression}. State: ${JSON.stringify(debug)}`);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function clickCenter(cdp, rect) {
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  await send(cdp, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send(cdp, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
