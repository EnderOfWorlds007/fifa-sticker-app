import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8791;
const DEBUG_PORT = 9331;

test("media buttons align and Use Photos fills the textbox after file selection in Chrome", async () => {
  const serverRoot = await mkdtemp(join(tmpdir(), "fifa-app-server-"));
  await symlink(process.cwd(), join(serverRoot, "fifa-sticker-app"));
  const photoPath = join(serverRoot, "sample.png");
  await writeFile(photoPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ));
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: serverRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chromeProfile = await mkdtemp(join(tmpdir(), "fifa-app-chrome-"));
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
    await waitForHttp(`http://127.0.0.1:${PORT}/fifa-sticker-app/need-lookup/`);
    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);

    const page = await createPage(`http://127.0.0.1:${PORT}/fifa-sticker-app/need-lookup/`);
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    try {
      await send(cdp, "Runtime.enable");
      await send(cdp, "Page.enable");
      await send(cdp, "DOM.enable");
      await send(cdp, "Page.setInterceptFileChooserDialog", { enabled: true });
      await waitForReady(cdp);
      await evaluate(cdp, `(() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = (url, init) => {
          if (String(url).includes("/api/photo-codes")) {
            window.__lastPhotoRequestHeaders = Object.fromEntries(new Headers(init?.headers || {}));
            return Promise.resolve(new Response(JSON.stringify({ grouped_text: "FRA3" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }));
          }
          return originalFetch(url, init);
        };
        window.PANINI_CONFIG.recognitionBaseUrl = "https://ocr.test";
      })()`);

      const metrics = await evaluate(cdp, `(() => {
        const photo = document.querySelector("#needPhotoButton").getBoundingClientRect();
        const voice = document.querySelector("#needVoiceButton").getBoundingClientRect();
        return {
          photo: { left: photo.left, top: photo.top, width: photo.width, height: photo.height },
          voice: { left: voice.left, top: voice.top, width: voice.width, height: voice.height },
        };
      })()`);

      assert.equal(Math.round(metrics.photo.top), Math.round(metrics.voice.top), "buttons should share the same row");
      assert.equal(Math.round(metrics.photo.height), Math.round(metrics.voice.height), "buttons should share height");
      assert.ok(Math.abs(metrics.photo.width - metrics.voice.width) <= 1, "buttons should share width");

      const chooserPromise = withTimeout(waitForEvent(cdp, "Page.fileChooserOpened"), 3000, "file chooser did not open");
      await clickCenter(cdp, metrics.photo);
      const chooser = await chooserPromise;
      assert.equal(chooser.mode, "selectMultiple");
      assert.ok(chooser.backendNodeId, "file chooser should expose the input backend node id");

      await send(cdp, "DOM.setFileInputFiles", {
        backendNodeId: chooser.backendNodeId,
        files: [photoPath],
      });
      const filledText = await waitForExpression(cdp, `document.querySelector("#needLookupText").value`);
      assert.equal(filledText, "FRA3");
      const requestHeaders = await evaluate(cdp, `window.__lastPhotoRequestHeaders`);
      assert.equal(requestHeaders["x-panini-expected-side"], "back");
      const summary = await evaluate(cdp, `document.querySelector("#needLookupSummary").textContent`);
      assert.match(summary, /Filled card codes from 1\/1 photo/);
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

async function createPage(url) {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not create Chrome page: ${response.status}`);
  return response.json();
}

async function waitForHttp(url) {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
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

function send(cdp, method, params) {
  return cdp.send(method, params);
}

async function evaluate(cdp, expression) {
  const result = await send(cdp, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitForReady(cdp) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await evaluate(cdp, "document.readyState");
    if (state === "complete") return;
    await delay(50);
  }
  throw new Error("Timed out waiting for document readiness");
}

async function waitForExpression(cdp, expression) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await evaluate(cdp, expression);
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

function waitForEvent(cdp, method) {
  return cdp.waitFor(method);
}

async function clickCenter(cdp, rect) {
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  await send(cdp, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send(cdp, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send(cdp, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
