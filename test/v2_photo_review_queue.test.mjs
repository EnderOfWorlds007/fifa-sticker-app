import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildPhotoReviewItems,
  nextPendingReviewItem,
  reviewItemKey,
} from "../v2/assets/photo_review_queue.js";
import {
  activateCloudPhotoReviewBatch,
  activePhotoReviewProfileId,
  activeCloudPhotoReviewProfileId,
  batchRecord,
  cloudPhotoReviewBatchId,
  loadLatestPhotoReviewBatch,
  migrateLegacyPhotoReviewProfile,
  photoRecord,
  ReviewStateConflictError,
  savePhotoReviewBatch,
  savePhotoReviewBatchMeta,
  savePhotoReviewPhoto,
} from "../v2/assets/photo_review_store_v2.js";
import {
  CLOUD_REVIEW_COMMIT_KIND,
  CLOUD_REVIEW_PART_KIND,
  importCloudReviewPayload,
  reviewImportDigest,
} from "../v2/assets/cloud_review_import.js";

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

test("cloud review parts stay invisible until a complete commit activates the account-scoped batch", async () => {
  const indexedDB = fakeIndexedDB();
  const batch = {
    id: "cloud-batch-1",
    createdAt: 10,
    updatedAt: 20,
    activePhotoId: "photo-1",
    activeReviewKey: "photo-1:slot-1:insignia",
    reviewItems: [{ key: "photo-1:slot-1:insignia", photoId: "photo-1", slotId: "slot-1", kind: "insignia" }],
  };
  const part = {
    kind: CLOUD_REVIEW_PART_KIND,
    importId: "import-1",
    partId: "photo:photo-1",
    digest: "",
    batchId: batch.id,
    imageDataUrl: "data:image/jpeg;base64,cGhvdG8=",
    photo: {
      id: "photo-1",
      index: 0,
      sourceRevision: 1,
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      status: "succeeded",
      slots: [{ id: "slot-1", code: "CAN15", back_insignia_type: "no_clue" }],
    },
  };
  part.digest = await partDigest(part);
  assert.equal(await importCloudReviewPayload(part, "cloud-profile", { indexedDB, cryptoImpl: webcrypto }), "staged");
  assert.equal(await loadLatestPhotoReviewBatch("cloud-profile", { indexedDB }), null);
  const commit = {
    kind: CLOUD_REVIEW_COMMIT_KIND,
    importId: "import-1",
    digest: "",
    batch,
    photos: [{ partId: part.partId, photoId: part.photo.id, index: part.photo.index, digest: part.digest }],
    expectedPhotoCount: 1,
    expectedReviewItemCount: 1,
  };
  commit.digest = await commitDigest(commit);
  assert.equal(await importCloudReviewPayload(commit, "cloud-profile", { indexedDB, cryptoImpl: webcrypto }), "committed");

  const restored = await loadLatestPhotoReviewBatch("cloud-profile", { indexedDB });
  assert.equal(restored.profileId, "cloud-profile");
  assert.equal(restored.photos.length, 1);
  assert.equal(await restored.photos[0].blob.text(), "photo");
  assert.equal(restored.photos[0].slots[0].code, "CAN15");
  assert.equal(await loadLatestPhotoReviewBatch("different-cloud-profile", { indexedDB }), null);
});

test("cloud review imports are immutable, idempotent, and reject conflicting replay", async () => {
  const indexedDB = fakeIndexedDB();
  const part = {
    kind: CLOUD_REVIEW_PART_KIND,
    importId: "import-1",
    partId: "photo:photo-1",
    digest: "",
    batchId: "cloud-batch-1",
    imageDataUrl: "data:image/jpeg;base64,bmV3",
    photo: { id: "photo-1", slots: [{ id: "slot-1", code: "CAN15" }] },
  };
  part.digest = await partDigest(part);
  assert.equal(await importCloudReviewPayload(part, "cloud-profile", { indexedDB, cryptoImpl: webcrypto }), "staged");
  assert.equal(await importCloudReviewPayload(part, "cloud-profile", { indexedDB, cryptoImpl: webcrypto }), "staged");
  await assert.rejects(
    importCloudReviewPayload({ ...part, photo: { ...part.photo, fileName: "different.jpg" } }, "cloud-profile", { indexedDB, cryptoImpl: webcrypto }),
    /digest mismatch/,
  );
});

test("cloud recovery keeps the previous queue active until the complete replay is promoted", async () => {
  const indexedDB = fakeIndexedDB();
  await savePhotoReviewBatch(reviewBatchFixture("previous-batch", "cloud-profile", 1), { indexedDB });
  const batch = {
    id: "recovered-source-batch",
    createdAt: 10,
    updatedAt: 20,
    activePhotoId: "recovered-photo",
    activeReviewKey: "recovered-photo:slot-1:insignia",
    reviewItems: [{ key: "recovered-photo:slot-1:insignia", photoId: "recovered-photo", slotId: "slot-1", kind: "insignia" }],
  };
  const part = {
    kind: CLOUD_REVIEW_PART_KIND,
    importId: "recovery-import",
    partId: "photo:recovered-photo",
    digest: "",
    batchId: batch.id,
    imageDataUrl: "data:image/jpeg;base64,cmVjb3ZlcmVk",
    photo: { id: "recovered-photo", index: 0, slots: [{ id: "slot-1", code: "CAN15" }] },
  };
  part.digest = await partDigest(part);
  await importCloudReviewPayload(part, "cloud-profile", { indexedDB, cryptoImpl: webcrypto, activate: false });
  const commit = {
    kind: CLOUD_REVIEW_COMMIT_KIND,
    importId: "recovery-import",
    digest: "",
    batch,
    photos: [{ partId: part.partId, photoId: part.photo.id, index: 0, digest: part.digest }],
    expectedPhotoCount: 1,
    expectedReviewItemCount: 1,
  };
  commit.digest = await commitDigest(commit);
  assert.equal(await importCloudReviewPayload(commit, "cloud-profile", {
    indexedDB,
    cryptoImpl: webcrypto,
    activate: false,
  }), "committed");
  assert.equal((await loadLatestPhotoReviewBatch("cloud-profile", { indexedDB })).id, "previous-batch");

  const recoveredBatchId = cloudPhotoReviewBatchId("cloud-profile", commit.importId, batch.id);
  await activateCloudPhotoReviewBatch("cloud-profile", recoveredBatchId, { indexedDB });
  const recovered = await loadLatestPhotoReviewBatch("cloud-profile", { indexedDB });
  assert.equal(recovered.id, recoveredBatchId);
  assert.equal(recovered.photos[0].slots[0].code, "CAN15");
});

test("an incomplete cloud review commit never activates a partial queue", async () => {
  const indexedDB = fakeIndexedDB();
  const part = {
    kind: CLOUD_REVIEW_PART_KIND,
    importId: "import-1",
    partId: "photo:photo-1",
    digest: "",
    batchId: "cloud-batch-1",
    imageDataUrl: "data:image/jpeg;base64,b25l",
    photo: { id: "photo-1", slots: [{ id: "slot-1" }] },
  };
  part.digest = await partDigest(part);
  await importCloudReviewPayload(part, "cloud-profile", { indexedDB, cryptoImpl: webcrypto });
  const commit = {
    kind: CLOUD_REVIEW_COMMIT_KIND,
    importId: "import-1",
    digest: "",
    batch: { id: "cloud-batch-1", reviewItems: [] },
    photos: [
      { partId: "photo:photo-1", photoId: "photo-1", index: 0, digest: part.digest },
      { partId: "photo:photo-2", photoId: "photo-2", index: 1, digest: "digest-photo-2" },
    ],
    expectedPhotoCount: 2,
    expectedReviewItemCount: 0,
  };
  commit.digest = await commitDigest(commit);
  await assert.rejects(importCloudReviewPayload(commit, "cloud-profile", { indexedDB, cryptoImpl: webcrypto }), /incomplete/);
  assert.equal(await loadLatestPhotoReviewBatch("cloud-profile", { indexedDB }), null);
});

test("the retained 35-photo and 117-item queue commits in source order", async () => {
  const indexedDB = fakeIndexedDB();
  const importId = "import-35";
  const sourceBatchId = "retained-19sep";
  const photos = [];
  const reviewItems = [];
  for (let index = 0; index < 35; index += 1) {
    const photoId = `photo-${index + 1}`;
    const slotCount = index < 12 ? 4 : 3;
    const slots = Array.from({ length: slotCount }, (_, slotIndex) => ({ id: `slot-${slotIndex + 1}`, code: `TST${slotIndex + 1}` }));
    for (const slot of slots) reviewItems.push({
      key: `${photoId}:${slot.id}:insignia`, photoId, slotId: slot.id, kind: "insignia",
    });
    const part = {
      kind: CLOUD_REVIEW_PART_KIND,
      importId,
      partId: `photo:${photoId}`,
      digest: "",
      batchId: sourceBatchId,
      imageDataUrl: `data:image/jpeg;base64,${Buffer.from(photoId).toString("base64")}`,
      photo: { id: photoId, index, status: "succeeded", slots },
    };
    part.digest = await partDigest(part);
    await importCloudReviewPayload(part, "cloud-profile", { indexedDB, cryptoImpl: webcrypto });
    photos.push({ partId: part.partId, photoId, index, digest: part.digest });
  }
  const commit = {
    kind: CLOUD_REVIEW_COMMIT_KIND,
    importId,
    digest: "",
    batch: { id: sourceBatchId, createdAt: 10, updatedAt: 20, activePhotoId: "photo-1", reviewItems },
    photos,
    expectedPhotoCount: 35,
    expectedReviewItemCount: 117,
  };
  commit.digest = await commitDigest(commit);
  await importCloudReviewPayload(commit, "cloud-profile", { indexedDB, cryptoImpl: webcrypto });
  const restored = await loadLatestPhotoReviewBatch("cloud-profile", { indexedDB });
  assert.equal(restored.photos.length, 35);
  assert.equal(restored.reviewItems.length, 117);
  assert.deepEqual(restored.photos.map((photo) => photo.index), Array.from({ length: 35 }, (_, index) => index));
});

test("duplicate commit manifest identities are rejected before activation", async () => {
  const indexedDB = fakeIndexedDB();
  const parts = [];
  for (let index = 0; index < 2; index += 1) {
    const part = {
      kind: CLOUD_REVIEW_PART_KIND,
      importId: "import-dup",
      partId: `photo:p${index}`,
      digest: "",
      batchId: "batch-dup",
      imageDataUrl: "data:image/jpeg;base64,eA==",
      photo: { id: `p${index}`, index, slots: [] },
    };
    part.digest = await partDigest(part);
    await importCloudReviewPayload(part, "cloud-profile", { indexedDB, cryptoImpl: webcrypto });
    parts.push(part);
  }
  const commit = {
    kind: CLOUD_REVIEW_COMMIT_KIND,
    importId: "import-dup",
    digest: "",
    batch: { id: "batch-dup", reviewItems: [] },
    photos: [0, 0].map(() => ({ partId: parts[0].partId, photoId: parts[0].photo.id, index: 0, digest: parts[0].digest })),
    expectedPhotoCount: 2,
    expectedReviewItemCount: 0,
  };
  commit.digest = await commitDigest(commit);
  await assert.rejects(
    importCloudReviewPayload(commit, "cloud-profile", { indexedDB, cryptoImpl: webcrypto }),
    /duplicate or missing part ids/,
  );
  assert.equal(await loadLatestPhotoReviewBatch("cloud-profile", { indexedDB }), null);
});

test("pre-upgrade local review queues migrate once into the active cloud account", async () => {
  const indexedDB = fakeIndexedDB();
  const batch = reviewBatchFixture("legacy-batch", "local-profile", 10);
  await savePhotoReviewBatch(batch, { indexedDB });
  assert.equal(await migrateLegacyPhotoReviewProfile("local-profile", "cloud-profile", { indexedDB }), true);
  assert.equal(await migrateLegacyPhotoReviewProfile("local-profile", "cloud-profile", { indexedDB }), false);
  const restored = await loadLatestPhotoReviewBatch("cloud-profile", { indexedDB });
  assert.equal(restored.id, "legacy-batch");
  assert.equal(restored.profileId, "cloud-profile");
  assert.equal(restored.photos.length, 1);
  assert.equal(await restored.photos[0].blob.text(), "legacy-batch");
});

test("review storage prefers the active cloud account and falls back to the local profile", () => {
  const values = new Map([["panini.v2.activeProfileId", "local-profile"]]);
  const storage = { getItem: (key) => values.get(key) || null };
  assert.equal(activePhotoReviewProfileId(storage), "local-profile");
  values.set("panini.cloudSync.activeProfileId.v1", "cloud-profile");
  assert.equal(activePhotoReviewProfileId(storage), "cloud-profile");
  assert.equal(activeCloudPhotoReviewProfileId(storage), "cloud-profile");
  values.delete("panini.cloudSync.activeProfileId.v1");
  assert.equal(activeCloudPhotoReviewProfileId(storage), "");
});

test("Reviews distinguishes encrypted queue loading from OCR authorization", () => {
  const reviewHtml = readFileSync("v2/reviews/index.html", "utf8");
  const scanner = readFileSync("v2/assets/photo_scanner.js", "utf8");
  const cloudSync = readFileSync("v2/assets/cloud_sync.js", "utf8");
  assert.match(reviewHtml, /id="cloudRestoreIdInput" type="password"/);
  assert.match(reviewHtml, /id="restoreCloudIdButton"[^>]*>Load reviews<\/button>/);
  assert.match(reviewHtml, /id="cloudSyncStatus"[^>]*aria-live="polite"/);
  assert.match(reviewHtml, /OCR token below cannot identify or decrypt a queue/);
  assert.match(reviewHtml, /This token authorizes OCR and submitting review decisions; it does not load a cloud queue/);
  assert.doesNotMatch(reviewHtml, /id="cloudRestoreIdInput"[^>]*\svalue=/);
  assert.match(scanner, /activeCloudPhotoReviewProfileId/);
  assert.match(scanner, /No saved reviews were found for this cloud account/);
  assert.match(cloudSync, /controls\.setAccountBusy\(true\)/);
  assert.match(cloudSync, /if \(loaded\) controls\.prefillRestoreCode\(""\)/);
  assert.match(cloudSync, /fetchDeltas\(\{ context, startRevision: 0, limit: 50 \}\)/);
  assert.match(cloudSync, /validateSparseCloudHistory\(history\)/);
  assert.match(cloudSync, /reviewRecoveryMode: documentRef\?\.body\?\.dataset\?\.photoReviewMode === "reviews"/);
  assert.match(cloudSync, /importCloudReviewPayload\(payload, context\.profileId, \{ activate: false \}\)/);
  assert.match(cloudSync, /activateCloudPhotoReviewBatch\(context\.profileId, recovery\.recoveredBatchId\)/);
  assert.match(cloudSync, /cachedProjection && !recoverReviews/);
});

test("Reviews is a first-class current tab and the PWA caches its route and modules", () => {
  const reviewHtml = readFileSync("v2/reviews/index.html", "utf8");
  const serviceWorker = readFileSync("v2/sw.js", "utf8");
  const profile = readFileSync("v2/assets/v2_profile.js", "utf8");
  assert.match(reviewHtml, /href="\/fifa-sticker-app\/v2\/reviews\/" aria-current="page">Reviews/);
  assert.match(reviewHtml, /data-photo-review-mode="reviews"/);
  assert.match(serviceWorker, /\/fifa-sticker-app\/v2\/reviews\//);
  assert.match(serviceWorker, /photo_review_store_v2\.js/);
  assert.match(serviceWorker, /cloud_review_import\.js/);
  assert.match(serviceWorker, /photo_review_queue\.js/);
  assert.match(profile, /"reviews"/);

  for (const path of primaryTabPages("v2")) {
    const html = readFileSync(path, "utf8");
    assert.match(html, /<a href="\/fifa-sticker-app\/v2\/reviews\/"[^>]*>Reviews<\/a>/, path);
  }
});

test("scanner persists photo identity and aggregates every successful photo", () => {
  const source = readFileSync("v2/assets/photo_scanner.js", "utf8");
  const cloudSync = readFileSync("v2/assets/cloud_sync.js", "utf8");
  assert.match(source, /photo\.payload = resultPayload/);
  assert.match(source, /photo\.slots = reviewSlotsForPayload\(resultPayload\)/);
  assert.match(source, /photoReviewState\.photos\.flatMap/);
  assert.match(source, /code_review_status = slot\.code/);
  assert.match(source, /selectNextReviewSlot\(\{ afterReviewKey: completedReviewKey \}\)/);
  assert.match(source, /window\.addEventListener\("pagehide", releasePhotoReviewUrls\)/);
  assert.match(source, /window\.addEventListener\("panini:cloud-sync-applied"/);
  assert.match(cloudSync, /APPLIED_EVENT, \{ revision: result\.revision, profileId: client\.profileId \}/);
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

function partDigest(part) {
  return reviewImportDigest({
    batchId: part.batchId,
    partId: part.partId,
    photo: part.photo,
    imageDataUrl: part.imageDataUrl,
  }, webcrypto);
}

function commitDigest(commit) {
  return reviewImportDigest({
    batch: commit.batch,
    photos: commit.photos,
    expectedPhotoCount: commit.expectedPhotoCount,
    expectedReviewItemCount: commit.expectedReviewItemCount,
  }, webcrypto);
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
