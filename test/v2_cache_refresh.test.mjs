import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  V2_BUILD_ID,
  buildReloadUrl,
  reloadOnceForBuild,
  serviceWorkerUsesBuild,
  updateV2ServiceWorker,
} from "../v2/assets/pwa.js";

test("V2 reload URL and worker checks require the current build", () => {
  assert.equal(V2_BUILD_ID, "build-1b27c3660edd");
  assert.equal(serviceWorkerUsesBuild({ scriptURL: `https://example.test/v2/sw.js?v=${V2_BUILD_ID}` }), true);
  assert.equal(serviceWorkerUsesBuild({ scriptURL: "https://example.test/v2/sw.js?v=old" }), false);
  const url = new URL(buildReloadUrl("https://example.test/fifa-sticker-app/v2/scanner/?foo=bar", V2_BUILD_ID, 123));
  assert.equal(url.searchParams.get("foo"), "bar");
  assert.equal(url.searchParams.get("v"), V2_BUILD_ID);
  assert.equal(url.searchParams.get("sw-refresh"), "123");
});

test("controller refresh reloads at most once per build", () => {
  const values = new Map();
  const replaced = [];
  const environment = {
    location: {
      href: "https://example.test/fifa-sticker-app/v2/scanner/",
      replace: (url) => replaced.push(url),
      reload: () => assert.fail("replace should be available"),
    },
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  assert.equal(reloadOnceForBuild(environment), true);
  assert.equal(reloadOnceForBuild(environment), false);
  assert.equal(replaced.length, 1);
  assert.match(replaced[0], new RegExp(`v=${V2_BUILD_ID}`));
});

test("V2 updater bypasses the HTTP cache and reloads when the new worker controls", async () => {
  const listeners = new Map();
  const calls = [];
  const registration = {
    active: { scriptURL: "https://example.test/fifa-sticker-app/v2/sw.js?v=old" },
    waiting: { postMessage: (message) => calls.push(["message", message]) },
    addEventListener() {},
    update: async () => calls.push(["update"]),
  };
  const values = new Map();
  const environment = {
    navigator: {
      serviceWorker: {
        controller: null,
        addEventListener: (type, listener) => listeners.set(type, listener),
        register: async (url, options) => {
          calls.push(["register", url, options]);
          return registration;
        },
      },
    },
    location: {
      href: "https://example.test/fifa-sticker-app/v2/scanner/",
      replace: (url) => calls.push(["replace", url]),
      reload: () => assert.fail("replace should be available"),
    },
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
  };

  assert.equal(await updateV2ServiceWorker(environment), registration);
  assert.deepEqual(calls[0], [
    "register",
    `/fifa-sticker-app/v2/sw.js?v=${V2_BUILD_ID}`,
    { updateViaCache: "none" },
  ]);
  assert.deepEqual(calls[1], ["update"]);
  assert.deepEqual(calls[2], ["message", { type: "SKIP_WAITING" }]);
  environment.navigator.serviceWorker.controller = {
    scriptURL: `https://example.test/fifa-sticker-app/v2/sw.js?v=${V2_BUILD_ID}`,
  };
  listeners.get("controllerchange")();
  assert.equal(calls.at(-1)[0], "replace");
  assert.match(calls.at(-1)[1], new RegExp(`v=${V2_BUILD_ID}`));
});

test("emergency reset uses a unique path and preserves local collection data", () => {
  const resetPage = readFileSync("v2/cache-reset-build-1b27c3660edd/index.html", "utf8");
  const serviceWorker = readFileSync("v2/sw.js", "utf8");
  const rootServiceWorker = readFileSync("sw.js", "utf8");
  const appShellPaths = serviceWorker.match(/APP_SHELL_PATHS = \[([\s\S]*?)\];/)?.[1] || "";
  assert.match(resetPage, /getRegistrations\(\)/);
  assert.match(resetPage, /registration\.unregister\(\)/);
  assert.match(resetPage, /name\.startsWith\("fifa-card-apps"\)/);
  assert.match(resetPage, /stagedNames\.includes\(CURRENT_CACHE\)/);
  assert.match(resetPage, /name !== CURRENT_CACHE/);
  assert.ok(resetPage.indexOf("waitForCurrentWorker(currentRegistration)") < resetPage.indexOf("caches.delete(name)"));
  assert.match(resetPage, /collection and settings are not affected/i);
  assert.doesNotMatch(resetPage, /localStorage\.clear|indexedDB\.deleteDatabase/);
  assert.match(resetPage, /cache-reset=\$\{Date\.now\(\)\}/);
  assert.match(resetPage, /build-1b27c3660edd/);
  assert.doesNotMatch(appShellPaths, /cache-reset-build/);
  assert.match(serviceWorker, /APP_SHELL_PATHS\.map/);
  assert.match(serviceWorker, /v=\$\{BUILD_ID\}/);
  assert.match(serviceWorker, /SKIP_WAITING/);
  assert.match(serviceWorker, /const cached = await cache\.match\(request\)/);
  assert.doesNotMatch(serviceWorker, /const cached = await caches\.match\(request\)/);
  assert.match(rootServiceWorker, /const CACHE_PREFIX = "fifa-card-apps-v"/);
  assert.match(rootServiceWorker, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);
  assert.match(rootServiceWorker, /pathname\.startsWith\("\/fifa-sticker-app\/v2\/"\)/);
  assert.doesNotMatch(rootServiceWorker, /names\.filter\(\(name\) => name !== CACHE_NAME\)/);
});

test("every V2 HTML entry loads the current updater except the inline reset page", () => {
  for (const path of htmlFiles("v2")) {
    if (path.includes("/cache-reset-build-")) continue;
    const html = readFileSync(path, "utf8");
    assert.match(html, /\/v2\/assets\/pwa\.js\?v=build-1b27c3660edd/, path);
  }
});

function htmlFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...htmlFiles(path));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}
