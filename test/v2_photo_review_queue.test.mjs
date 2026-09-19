import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildPhotoReviewItems,
  nextPendingReviewItem,
  reviewItemKey,
} from "../v2/assets/photo_review_queue.js";
import {
  batchRecord,
  loadLatestPhotoReviewBatch,
  photoRecord,
  ReviewStateConflictError,
  savePhotoReviewBatch,
  savePhotoReviewBatchMeta,
  savePhotoReviewPhoto,
} from "../v2/assets/photo_review_store_v2.js";

test("queue identity stays photo-scoped and orders code before insignia", () => {
  const predicates = {
    needsCodeReview: (slot) => slot.codePending,
    needsInsigniaReview: (slot) => slot.insigniaPending,
  };
  const first = buildPhotoReviewItems({
    id: "photo-a",
    slots: [{ id: "slot-1", codePending: true, insigniaPending: true }],
  }, predicates);
  const second = buildPhotoReviewItems({
    id: "photo-b",
    slots: [{ id: "slot-1", codePending: true, insigniaPending: false }],
  }, predicates);

  assert.deepEqual([...first, ...second].map((item) => item.key), [
    "photo-a:slot-1:code",
    "photo-a:slot-1:insignia",
    "photo-b:slot-1:code",
  ]);
  assert.equal(reviewItemKey("photo-b", "slot-1", "code"), "photo-b:slot-1:code");
});

test("queue navigation crosses photo boundaries and wraps unresolved work", () => {
  const items = [
    { key: "p1:s1:code" },
    { key: "p1:s1:insignia" },
    { key: "p2:s1:code" },
  ];
  const pending = [items[1], items[2]];
  assert.equal(nextPendingReviewItem(items, pending, items[1].key), items[2]);
  assert.equal(nextPendingReviewItem(items, [items[1]], items[2].key), items[1]);
  assert.equal(nextPendingReviewItem(items, [], items[2].key), null);
});

test("review storage records keep blobs but never persist object URLs or active mirrors", () => {
  const blob = new Blob(["photo"], { type: "image/jpeg" });
  const batch = batchRecord({
    id: "batch-1",
    profileId: "profile-1",
    photos: [{ id: "photo-1" }],
    imageUrl: "blob:batch",
    slots: [{ id: "mirror" }],
    selectedSlotId: "mirror",
  });
  const photo = photoRecord("batch-1", {
    id: "photo-1",
    blob,
    imageUrl: "blob:photo",
    slots: [{ id: "slot-1" }],
  });
  assert.equal("photos" in batch, false);
  assert.equal("imageUrl" in batch, false);
  assert.equal("slots" in batch, false);
  assert.equal("selectedSlotId" in batch, false);
  assert.equal(photo.blob, blob);
  assert.equal("imageUrl" in photo, false);
  assert.equal(photo.key, "batch-1:photo-1");
});

test("review batches and per-photo decisions round-trip through IndexedDB", async () => {
  const indexedDB = fakeIndexedDB();
  const blob = new Blob(["original photo"], { type: "image/jpeg" });
  const batch = {
    id: "batch-1",
    profileId: "profile-1",
    createdAt: 10,
    updatedAt: 20,
    activePhotoId: "photo-1",
    activeReviewKey: "photo-1:slot-1:code",
    reviewItems: [{ key: "photo-1:slot-1:code", photoId: "photo-1", slotId: "slot-1", kind: "code" }],
    photos: [{
      id: "photo-1",
      index: 0,
      blob,
      status: "succeeded",
      slots: [{ id: "slot-1", code_review_status: "pending" }],
    }],
  };
  await savePhotoReviewBatch(batch, { indexedDB });
  await savePhotoReviewPhoto("batch-1", {
    ...batch.photos[0],
    slots: [{ id: "slot-1", code_review_status: "corrected", code: "CAN15" }],
  }, { indexedDB });

  const restored = await loadLatestPhotoReviewBatch("profile-1", { indexedDB });
  assert.equal(restored.id, "batch-1");
  assert.equal(restored.photos.length, 1);
  assert.equal(await restored.photos[0].blob.text(), "original photo");
  assert.equal(restored.photos[0].slots[0].code_review_status, "corrected");
  assert.equal(restored.photos[0].slots[0].code, "CAN15");
  assert.equal(await loadLatestPhotoReviewBatch("another-profile", { indexedDB }), null);
});

test("the explicit active batch cannot be displaced by writes from an older tab", async () => {
  const indexedDB = fakeIndexedDB();
  const first = reviewBatchFixture("batch-old", "profile-1", 10);
  const second = reviewBatchFixture("batch-new", "profile-1", 20);
  await savePhotoReviewBatch(first, { indexedDB });
  await savePhotoReviewBatch(second, { indexedDB });
  first.updatedAt = 999;
  await savePhotoReviewBatchMeta(first, { indexedDB });
  assert.equal((await loadLatestPhotoReviewBatch("profile-1", { indexedDB })).id, "batch-new");
});

test("revision checks reject a stale whole-photo overwrite", async () => {
  const indexedDB = fakeIndexedDB();
  const batch = reviewBatchFixture("batch-1", "profile-1", 10);
  await savePhotoReviewBatch(batch, { indexedDB });
  const stale = structuredClone(batch.photos[0]);
  batch.photos[0].slots = [{ id: "slot-1", code: "CAN15" }];
  await savePhotoReviewPhoto(batch.id, batch.photos[0], { indexedDB });
  stale.slots = [{ id: "slot-1", code: "CAN14" }];
  await assert.rejects(
    savePhotoReviewPhoto(batch.id, stale, { indexedDB }),
    ReviewStateConflictError,
  );
});

test("Reviews is a first-class current tab and the PWA caches its route and modules", () => {
  const reviewHtml = readFileSync("v2/reviews/index.html", "utf8");
  const serviceWorker = readFileSync("v2/sw.js", "utf8");
  const profile = readFileSync("v2/assets/v2_profile.js", "utf8");
  assert.match(reviewHtml, /href="\/fifa-sticker-app\/v2\/reviews\/" aria-current="page">Reviews/);
  assert.match(reviewHtml, /data-photo-review-mode="reviews"/);
  assert.match(serviceWorker, /\/fifa-sticker-app\/v2\/reviews\//);
  assert.match(serviceWorker, /photo_review_store_v2\.js/);
  assert.match(serviceWorker, /photo_review_queue\.js/);
  assert.match(profile, /"reviews"/);

  for (const path of primaryTabPages("v2")) {
    const html = readFileSync(path, "utf8");
    assert.match(html, /<a href="\/fifa-sticker-app\/v2\/reviews\/"[^>]*>Reviews<\/a>/, path);
  }
});

test("scanner persists photo identity and aggregates every successful photo", () => {
  const source = readFileSync("v2/assets/photo_scanner.js", "utf8");
  assert.match(source, /photo\.payload = resultPayload/);
  assert.match(source, /photo\.slots = reviewSlotsForPayload\(resultPayload\)/);
  assert.match(source, /photoReviewState\.photos\.flatMap/);
  assert.match(source, /code_review_status = slot\.code/);
  assert.match(source, /selectNextReviewSlot\(\{ afterReviewKey: completedReviewKey \}\)/);
  assert.match(source, /window\.addEventListener\("pagehide", releasePhotoReviewUrls\)/);
});

function primaryTabPages(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...primaryTabPages(path));
    else if (entry.name.endsWith(".html") && readFileSync(path, "utf8").includes("phoneTabBar")) files.push(path);
  }
  return files.filter((path) => !path.includes("cache-reset-build-"));
}

function reviewBatchFixture(id, profileId, createdAt) {
  return {
    id,
    profileId,
    createdAt,
    updatedAt: createdAt,
    activePhotoId: `${id}-photo`,
    activeReviewKey: "",
    reviewItems: [],
    photos: [{
      id: `${id}-photo`,
      index: 0,
      blob: new Blob([id], { type: "image/jpeg" }),
      status: "succeeded",
      slots: [{ id: "slot-1" }],
    }],
  };
}

function fakeIndexedDB() {
  const stores = new Map();
  let database = null;
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        if (!database) {
          database = createDatabase(stores);
          request.result = database;
          request.transaction = database.transaction([...stores.keys()], "versionchange");
          request.onupgradeneeded?.();
        } else {
          request.result = database;
        }
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function createDatabase(stores) {
  const storeFacade = (name) => {
    const definition = stores.get(name);
    return {
      indexNames: { contains: (indexName) => definition.indexes.has(indexName) },
      createIndex(indexName, keyPath) {
        definition.indexes.set(indexName, { keyPath });
        return this;
      },
      put(value) {
        definition.values.set(value[definition.keyPath], structuredClone(value));
        return asyncRequest(undefined);
      },
      get(key) {
        return asyncRequest(structuredClone(definition.values.get(key)));
      },
      getAll() {
        return asyncRequest([...definition.values.values()].map((value) => structuredClone(value)));
      },
      index(indexName) {
        const index = definition.indexes.get(indexName);
        return {
          getAll(key) {
            return asyncRequest([...definition.values.values()]
              .filter((value) => value[index.keyPath] === key)
              .map((value) => structuredClone(value)));
          },
        };
      },
    };
  };
  return {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name, options = {}) {
      stores.set(name, { keyPath: options.keyPath, values: new Map(), indexes: new Map() });
      return storeFacade(name);
    },
    transaction(names) {
      const transaction = {
        objectStore(name) {
          return storeFacade(name);
        },
      };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    },
    close() {},
  };
}

function asyncRequest(result) {
  const request = {};
  queueMicrotask(() => {
    request.result = result;
    request.onsuccess?.();
  });
  return request;
}
