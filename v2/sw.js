const CACHE_NAME = "fifa-card-apps-fifa-sticker-app-v2-build-a7c4d92f681b";
const CACHE_PREFIX = CACHE_NAME.replace(/build-[0-9a-f]{12}|build-2c133a7da1c4$/, "");
const APP_SHELL = [
  "/fifa-sticker-app/v2/",
  "/fifa-sticker-app/v2/apps/",
  "/fifa-sticker-app/v2/getting-started/",
  "/fifa-sticker-app/v2/review-album-pages/",
  "/fifa-sticker-app/v2/scanner/",
  "/fifa-sticker-app/v2/inventory/",
  "/fifa-sticker-app/v2/collection/",
  "/fifa-sticker-app/v2/compare/",
  "/fifa-sticker-app/v2/trade/",
  "/fifa-sticker-app/v2/trades/",
  "/fifa-sticker-app/v2/trade-lookup/",
  "/fifa-sticker-app/v2/need-lookup/",
  "/fifa-sticker-app/v2/assets/styles.css",
  "/fifa-sticker-app/v2/assets/app.js",
  "/fifa-sticker-app/v2/assets/inventory.js",
  "/fifa-sticker-app/v2/assets/collection_tracker.js",
  "/fifa-sticker-app/v2/assets/collection_state.js",
  "/fifa-sticker-app/v2/assets/backup_restore.js",
  "/fifa-sticker-app/v2/assets/compare.js",
  "/fifa-sticker-app/v2/assets/trade_builder.js",
  "/fifa-sticker-app/v2/assets/inventory_projection.js",
  "/fifa-sticker-app/v2/assets/inventory_source.js",
  "/fifa-sticker-app/v2/assets/catalog_source.js",
  "/fifa-sticker-app/v2/assets/ocr_backend.js",
  "/fifa-sticker-app/v2/assets/album_inventory_state.js",
  "/fifa-sticker-app/v2/assets/trade_paste_box.js",
  "/fifa-sticker-app/v2/assets/trades.js",
  "/fifa-sticker-app/v2/assets/trade_state.js",
  "/fifa-sticker-app/v2/assets/site_config.js",
  "/fifa-sticker-app/v2/assets/apps.js",
  "/fifa-sticker-app/v2/assets/v2_profile.js",
  "/fifa-sticker-app/v2/assets/getting_started.js",
  "/fifa-sticker-app/v2/assets/review_album_pages.js",
  "/fifa-sticker-app/v2/assets/photo_scanner.js",
  "/fifa-sticker-app/v2/assets/pwa.js",
  "/fifa-sticker-app/v2/data/trade_inventory.json",
  "/fifa-sticker-app/v2/data/collection_catalog.json?v=build-2c133a7da1c4",
  "/fifa-sticker-app/v2/data/collection_inventory.json?v=build-2c133a7da1c4",
  "/fifa-sticker-app/v2/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/fifa-sticker-app/v2/api/")) {
    event.respondWith(fetch(request).catch(() => cachedJsonUnavailable(url.pathname)));
    return;
  }
  if (request.mode === "navigate" || shouldPreferNetwork(url)) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

function shouldPreferNetwork(url) {
  return url.pathname.endsWith(".html")
    || url.pathname.endsWith(".js")
    || url.pathname.endsWith(".css")
    || url.pathname.endsWith("/fifa-sticker-app/v2/review-album-pages/")
    || url.pathname.endsWith("/fifa-sticker-app/v2/review-album-pages");
}

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok && !response.redirected && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match(request, { ignoreSearch: true });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && !response.redirected && response.type === "basic") {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

function cachedJsonUnavailable(pathname) {
  if (pathname === "/fifa-sticker-app/v2/api/trade-inventory") {
    return jsonResponse({
      schema_version: 1,
      updated_at: null,
      captures: [],
      cards: {},
      stats: {
        session_count: 0,
        photo_count: 0,
        unique_code_count: 0,
        matched_card_count: 0,
        offline: true
      }
    });
  }
  if (pathname === "/fifa-sticker-app/v2/api/status") {
    return jsonResponse({ offline: true, access_urls: [] });
  }
  return jsonResponse({ offline: true }, 503);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
