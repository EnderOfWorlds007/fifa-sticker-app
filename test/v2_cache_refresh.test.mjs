import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  V2_BUILD_ID,
  buildReloadUrl,
  reloadOnceForBuild,
  serviceWorkerUsesBuild,
  updateV2ServiceWorker,
} from "../v2/assets/pwa.js";

test("V2 reload URL and worker checks require the current build", () => {
  assert.equal(V2_BUILD_ID, "build-9c4a1f2e7b63");
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

test("emergency reset lives outside V2 scope and preserves local collection data", () => {
  const resetPage = readFileSync("cache-reset-build-9c4a1f2e7b63/index.html", "utf8");
  const serviceWorker = readFileSync("v2/sw.js", "utf8");
  assert.match(resetPage, /getRegistrations\(\)/);
  assert.match(resetPage, /registration\.unregister\(\)/);
  assert.match(resetPage, /name\.startsWith\("fifa-card-apps"\)/);
  assert.match(resetPage, /collection and settings are not affected/i);
  assert.doesNotMatch(resetPage, /localStorage\.clear|indexedDB\.deleteDatabase/);
  assert.match(resetPage, /cache-reset=\$\{Date\.now\(\)\}/);
  assert.match(serviceWorker, /APP_SHELL_PATHS\.map/);
  assert.match(serviceWorker, /v=\$\{BUILD_ID\}/);
  assert.match(serviceWorker, /SKIP_WAITING/);
});
