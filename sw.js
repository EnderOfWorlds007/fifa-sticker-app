const CACHE_NAME = "fifa-card-apps-v8";
const APP_SHELL = [
  "/fifa-sticker-app/",
  "/fifa-sticker-app/apps/",
  "/fifa-sticker-app/scanner/",
  "/fifa-sticker-app/inventory/",
  "/fifa-sticker-app/collection/",
  "/fifa-sticker-app/trade-lookup/",
  "/fifa-sticker-app/need-lookup/",
  "/fifa-sticker-app/assets/styles.css",
  "/fifa-sticker-app/assets/app.js",
  "/fifa-sticker-app/assets/inventory.js",
  "/fifa-sticker-app/assets/collection_tracker.js",
  "/fifa-sticker-app/assets/trade_lookup.js",
  "/fifa-sticker-app/assets/need_lookup.js",
  "/fifa-sticker-app/assets/card_parser.js",
  "/fifa-sticker-app/assets/site_config.js",
  "/fifa-sticker-app/assets/apps.js",
  "/fifa-sticker-app/assets/pwa.js",
  "/fifa-sticker-app/data/collection_inventory.json",
  "/fifa-sticker-app/data/trade_inventory.json",
  "/fifa-sticker-app/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/fifa-sticker-app/api/")) {
    event.respondWith(fetch(request).catch(() => cachedJsonUnavailable(url.pathname)));
    return;
  }
  event.respondWith(cacheFirst(request));
});

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
  if (pathname === "/fifa-sticker-app/api/trade-inventory") {
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
  if (pathname === "/fifa-sticker-app/api/collection-inventory") {
    return jsonResponse({
      schema_version: 1,
      cards: [],
      stats: {
        catalog_count: 0,
        owned_unique_count: 0,
        missing_count: 0,
        tradeable_card_count: 0,
        offline: true
      }
    });
  }
  if (pathname === "/fifa-sticker-app/api/status") {
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
