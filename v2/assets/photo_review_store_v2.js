const DATABASE_NAME = "panini-photo-review-queue";
const DATABASE_VERSION = 3;
const BATCH_STORE = "review_batches";
const PHOTO_STORE = "review_photos";
const ACTIVE_STORE = "active_review_batches";
const IMPORT_STORE = "review_imports";
const IMPORT_PART_STORE = "review_import_parts";
const ACTIVE_CLOUD_PROFILE_ID_KEY = "panini.cloudSync.activeProfileId.v1";
const ACTIVE_LOCAL_PROFILE_ID_KEY = "panini.v2.activeProfileId";

export class ReviewStateConflictError extends Error {
  constructor(message = "This review changed in another tab. Reloading the latest version.") {
    super(message);
    this.name = "ReviewStateConflictError";
  }
}

export async function savePhotoReviewBatch(batch, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  try {
    batch.revision = 1;
    for (const photo of batch.photos || []) photo.revision = 1;
    const transaction = database.transaction([BATCH_STORE, PHOTO_STORE, ACTIVE_STORE], "readwrite");
    const complete = transactionComplete(transaction);
    transaction.objectStore(BATCH_STORE).put(batchRecord(batch));
    for (const photo of batch.photos || []) transaction.objectStore(PHOTO_STORE).put(photoRecord(batch.id, photo));
    transaction.objectStore(ACTIVE_STORE).put({
      profileId: String(batch.profileId || ""),
      batchId: String(batch.id || ""),
    });
    await complete;
    return batch;
  } finally {
    database.close();
  }
}

export async function savePhotoReviewBatchMeta(batch, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  try {
    const transaction = database.transaction(BATCH_STORE, "readwrite");
    const complete = transactionComplete(transaction);
    const store = transaction.objectStore(BATCH_STORE);
    const current = await requestResult(store.get(String(batch.id || "")));
    assertRevision(current, batch, "batch");
    const saved = { ...batchRecord(batch), revision: Number(current.revision || 0) + 1 };
    store.put(saved);
    await complete;
    batch.revision = saved.revision;
    return saved;
  } finally {
    database.close();
  }
}

export async function savePhotoReviewState(batch, photo, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  try {
    const transaction = database.transaction([BATCH_STORE, PHOTO_STORE], "readwrite");
    const complete = transactionComplete(transaction);
    const batchStore = transaction.objectStore(BATCH_STORE);
    const photoStore = transaction.objectStore(PHOTO_STORE);
    const currentBatch = await requestResult(batchStore.get(String(batch.id || "")));
    const currentPhoto = await requestResult(photoStore.get(`${batch.id}:${photo.id}`));
    assertRevision(currentBatch, batch, "batch");
    assertRevision(currentPhoto, photo, "photo");
    const savedBatch = { ...batchRecord(batch), revision: Number(currentBatch.revision || 0) + 1 };
    const savedPhoto = { ...photoRecord(batch.id, photo), revision: Number(currentPhoto.revision || 0) + 1 };
    batchStore.put(savedBatch);
    photoStore.put(savedPhoto);
    await complete;
    batch.revision = savedBatch.revision;
    photo.revision = savedPhoto.revision;
    return { batch: savedBatch, photo: savedPhoto };
  } finally {
    database.close();
  }
}

export async function savePhotoReviewPhoto(batchId, photo, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  try {
    const transaction = database.transaction(PHOTO_STORE, "readwrite");
    const complete = transactionComplete(transaction);
    const store = transaction.objectStore(PHOTO_STORE);
    const current = await requestResult(store.get(`${batchId}:${photo.id}`));
    assertRevision(current, photo, "photo");
    const saved = { ...photoRecord(batchId, photo), revision: Number(current.revision || 0) + 1 };
    store.put(saved);
    await complete;
    photo.revision = saved.revision;
    return saved;
  } finally {
    database.close();
  }
}

export async function stageCloudPhotoReviewPart(part, profileId, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  try {
    const scopedProfileId = String(profileId || "");
    if (!scopedProfileId) throw new Error("Cloud review profile is missing.");
    const importId = String(part?.importId || "");
    const partId = String(part?.partId || "");
    const digest = String(part?.digest || "");
    if (!importId || !partId || !digest) throw new Error("Cloud review part identity is incomplete.");
    const key = `${scopedProfileId}:${importId}:${partId}`;
    const transaction = database.transaction(IMPORT_PART_STORE, "readwrite");
    const complete = transactionComplete(transaction);
    const store = transaction.objectStore(IMPORT_PART_STORE);
    const current = await requestResult(store.get(key));
    if (current && current.digest !== digest) throw new Error("Cloud review part conflicts with retained evidence.");
    if (!current) {
      store.put({
        key,
        importKey: `${scopedProfileId}:${importId}`,
        profileId: scopedProfileId,
        importId,
        partId,
        digest,
        batchId: String(part.batchId || ""),
        photo: part.photo,
      });
    }
    await complete;
    return !current;
  } finally {
    database.close();
  }
}

export async function commitCloudPhotoReviewImport(commit, profileId, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  try {
    const scopedProfileId = String(profileId || "");
    if (!scopedProfileId) throw new Error("Cloud review profile is missing.");
    const importId = String(commit?.importId || "");
    const commitDigest = String(commit?.digest || "");
    if (!importId || !commitDigest) throw new Error("Cloud review commit identity is incomplete.");
    const importKey = `${scopedProfileId}:${importId}`;
    const transaction = database.transaction(
      [BATCH_STORE, PHOTO_STORE, ACTIVE_STORE, IMPORT_STORE, IMPORT_PART_STORE],
      "readwrite",
    );
    const complete = transactionComplete(transaction);
    const importStore = transaction.objectStore(IMPORT_STORE);
    const retainedCommit = await requestResult(importStore.get(importKey));
    if (retainedCommit) {
      if (retainedCommit.digest !== commitDigest) throw new Error("Cloud review commit conflicts with retained evidence.");
      await complete;
      return { activated: false, created: false, batchId: retainedCommit.batchId };
    }
    const parts = await requestResult(
      transaction.objectStore(IMPORT_PART_STORE).index("importKey").getAll(importKey),
    );
    const expectedPhotos = Array.isArray(commit.photos) ? commit.photos : [];
    if (Number(commit.expectedPhotoCount) !== expectedPhotos.length || parts.length !== expectedPhotos.length) {
      throw new Error("Cloud review import is incomplete; no queue was activated.");
    }
    assertUniqueValues(expectedPhotos.map((item) => String(item.partId || "")), "part ids");
    assertUniqueValues(expectedPhotos.map((item) => String(item.photoId || "")), "photo ids");
    assertUniqueValues(expectedPhotos.map((item) => String(Number(item.index))), "photo indexes");
    const partsById = new Map(parts.map((part) => [part.partId, part]));
    const orderedParts = expectedPhotos.map((expected) => {
      const part = partsById.get(String(expected.partId || ""));
      if (!part || part.digest !== String(expected.digest || "")) {
        throw new Error("Cloud review import evidence does not match its commit.");
      }
      if (part.batchId !== String(commit.batch?.id || "")
        || String(part.photo?.id || "") !== String(expected.photoId || "")
        || Number(part.photo?.index) !== Number(expected.index)) {
        throw new Error("Cloud review import manifest does not match its staged photo.");
      }
      return part;
    });
    if (new Set(orderedParts.map((part) => part.key)).size !== parts.length) {
      throw new Error("Cloud review import does not account for every staged photo.");
    }
    validateCommittedReviewItems(commit.batch, orderedParts, Number(commit.expectedReviewItemCount));
    const localBatchId = cloudPhotoReviewBatchId(scopedProfileId, importId, commit.batch?.id);
    const batchStore = transaction.objectStore(BATCH_STORE);
    const photoStore = transaction.objectStore(PHOTO_STORE);
    batchStore.put(batchRecord({
      ...commit.batch,
      id: localBatchId,
      sourceBatchId: String(commit.batch?.id || ""),
      importId,
      profileId: scopedProfileId,
      revision: 1,
    }));
    for (const part of orderedParts) photoStore.put(photoRecord(localBatchId, { ...part.photo, revision: 1 }));
    if (options.activate !== false) {
      transaction.objectStore(ACTIVE_STORE).put({ profileId: scopedProfileId, batchId: localBatchId });
    }
    importStore.put({ key: importKey, profileId: scopedProfileId, importId, digest: commitDigest, batchId: localBatchId });
    await complete;
    return { activated: options.activate !== false, created: true, batchId: localBatchId };
  } finally {
    database.close();
  }
}

export function cloudPhotoReviewBatchId(profileId, importId, sourceBatchId) {
  return `cloud:${String(profileId || "")}:${String(importId || "")}:${String(sourceBatchId || "batch")}`;
}

export async function activateCloudPhotoReviewBatch(profileId, batchId, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  try {
    const scopedProfileId = String(profileId || "");
    const scopedBatchId = String(batchId || "");
    if (!scopedProfileId || !scopedBatchId) throw new Error("Cloud review queue identity is incomplete.");
    const transaction = database.transaction([BATCH_STORE, ACTIVE_STORE], "readwrite");
    const complete = transactionComplete(transaction);
    const batch = await requestResult(transaction.objectStore(BATCH_STORE).get(scopedBatchId));
    if (!batch || String(batch.profileId || "") !== scopedProfileId) {
      throw new Error("Recovered cloud review queue is unavailable.");
    }
    transaction.objectStore(ACTIVE_STORE).put({ profileId: scopedProfileId, batchId: scopedBatchId });
    await complete;
    return true;
  } finally {
    database.close();
  }
}

export function activePhotoReviewProfileId(storage = globalThis.localStorage) {
  try {
    return String(
      storage?.getItem?.(ACTIVE_CLOUD_PROFILE_ID_KEY)
      || storage?.getItem?.(ACTIVE_LOCAL_PROFILE_ID_KEY)
      || "",
    ).trim();
  } catch {
    return "";
  }
}

export function activeCloudPhotoReviewProfileId(storage = globalThis.localStorage) {
  try {
    return String(storage?.getItem?.(ACTIVE_CLOUD_PROFILE_ID_KEY) || "").trim();
  } catch {
    return "";
  }
}

export async function migrateLegacyPhotoReviewProfile(localProfileId, cloudProfileId, options = {}) {
  const indexedDBFactory = options.indexedDB || globalThis.indexedDB;
  if (!indexedDBFactory?.open || !localProfileId || !cloudProfileId || localProfileId === cloudProfileId) return false;
  const database = await openReviewDatabase(indexedDBFactory);
  try {
    const transaction = database.transaction([BATCH_STORE, PHOTO_STORE, ACTIVE_STORE], "readwrite");
    const complete = transactionComplete(transaction);
    const activeStore = transaction.objectStore(ACTIVE_STORE);
    if (await requestResult(activeStore.get(String(cloudProfileId)))) {
      await complete;
      return false;
    }
    const legacyActive = await requestResult(activeStore.get(String(localProfileId)));
    if (!legacyActive?.batchId) {
      await complete;
      return false;
    }
    const batchStore = transaction.objectStore(BATCH_STORE);
    const legacyBatch = await requestResult(batchStore.get(legacyActive.batchId));
    if (!legacyBatch || String(legacyBatch.profileId || "") !== String(localProfileId)) {
      await complete;
      return false;
    }
    batchStore.put({
      ...legacyBatch,
      profileId: String(cloudProfileId),
    });
    activeStore.put({ profileId: String(cloudProfileId), batchId: legacyBatch.id });
    await complete;
    return true;
  } finally {
    database.close();
  }
}

export async function loadLatestPhotoReviewBatch(profileId, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  try {
    const profileKey = String(profileId || "");
    const metadataTransaction = database.transaction([ACTIVE_STORE, BATCH_STORE], "readonly");
    const metadataComplete = transactionComplete(metadataTransaction);
    const active = await requestResult(metadataTransaction.objectStore(ACTIVE_STORE).get(profileKey));
    let batch = active?.batchId
      ? await requestResult(metadataTransaction.objectStore(BATCH_STORE).get(active.batchId))
      : null;
    if (batch && String(batch.profileId || "") !== profileKey) batch = null;
    if (!batch) {
      const batches = await requestResult(metadataTransaction.objectStore(BATCH_STORE).getAll());
      batch = (batches || [])
        .filter((candidate) => String(candidate.profileId || "") === profileKey)
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))[0];
    }
    await metadataComplete;
    if (!batch) return null;
    const photoTransaction = database.transaction(PHOTO_STORE, "readonly");
    const photoComplete = transactionComplete(photoTransaction);
    const photos = await requestResult(photoTransaction.objectStore(PHOTO_STORE).index("batchId").getAll(batch.id));
    await photoComplete;
    return {
      ...batch,
      photos: (photos || []).sort((left, right) => Number(left.index || 0) - Number(right.index || 0)),
    };
  } finally {
    database.close();
  }
}

export function batchRecord(batch) {
  const { photos: _photos, imageUrl: _imageUrl, slots: _slots, selectedSlotId: _selectedSlotId, ...record } = batch || {};
  return {
    ...record,
    id: String(record.id || ""),
    profileId: String(record.profileId || ""),
    createdAt: Number(record.createdAt || Date.now()),
    updatedAt: Number(record.updatedAt || Date.now()),
    revision: Number(record.revision || 0),
    reviewItems: Array.isArray(record.reviewItems) ? record.reviewItems : [],
  };
}

export function photoRecord(batchId, photo) {
  const { imageUrl: _imageUrl, ...record } = photo || {};
  const photoId = String(record.id || "");
  return {
    ...record,
    key: `${batchId}:${photoId}`,
    batchId: String(batchId || ""),
    id: photoId,
    index: Number(record.index || 0),
    revision: Number(record.revision || 0),
    slots: Array.isArray(record.slots) ? record.slots : [],
    view: record.view || { focused: false, zoomFactor: 1 },
  };
}

export function openReviewDatabase(indexedDBFactory = globalThis.indexedDB) {
  if (!indexedDBFactory?.open) return Promise.reject(new Error("Review storage is unavailable in this browser."));
  return new Promise((resolve, reject) => {
    const request = indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BATCH_STORE)) database.createObjectStore(BATCH_STORE, { keyPath: "id" });
      let photoStore;
      if (!database.objectStoreNames.contains(PHOTO_STORE)) photoStore = database.createObjectStore(PHOTO_STORE, { keyPath: "key" });
      else photoStore = request.transaction.objectStore(PHOTO_STORE);
      if (!photoStore.indexNames.contains("batchId")) photoStore.createIndex("batchId", "batchId", { unique: false });
      if (!database.objectStoreNames.contains(ACTIVE_STORE)) database.createObjectStore(ACTIVE_STORE, { keyPath: "profileId" });
      if (!database.objectStoreNames.contains(IMPORT_STORE)) database.createObjectStore(IMPORT_STORE, { keyPath: "key" });
      let importPartStore;
      if (!database.objectStoreNames.contains(IMPORT_PART_STORE)) importPartStore = database.createObjectStore(IMPORT_PART_STORE, { keyPath: "key" });
      else importPartStore = request.transaction.objectStore(IMPORT_PART_STORE);
      if (!importPartStore.indexNames.contains("importKey")) importPartStore.createIndex("importKey", "importKey", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Review storage could not be opened."));
    request.onblocked = () => reject(new Error("Review storage upgrade is blocked by another open tab."));
  });
}

function assertRevision(current, incoming, label) {
  if (!current) throw new ReviewStateConflictError(`The saved ${label} no longer exists. Reloading reviews.`);
  if (Number(current.revision || 0) !== Number(incoming.revision || 0)) throw new ReviewStateConflictError();
}

function validateCommittedReviewItems(batch, parts, expectedCount) {
  const items = Array.isArray(batch?.reviewItems) ? batch.reviewItems : [];
  if (items.length !== expectedCount) throw new Error("Cloud review item count does not match its commit.");
  assertUniqueValues(items.map((item) => String(item.key || "")), "review item keys");
  assertUniqueValues(items.map((item) => `${item.photoId}:${item.slotId}:${item.kind}`), "review item identities");
  const slots = new Set(parts.flatMap((part) => (part.photo?.slots || []).map((slot) => `${part.photo.id}:${slot.id}`)));
  if (items.some((item) => !slots.has(`${item.photoId}:${item.slotId}`))) {
    throw new Error("Cloud review commit references a missing photo or card.");
  }
}

function assertUniqueValues(values, label) {
  if (values.some((value) => !value) || new Set(values).size !== values.length) {
    throw new Error(`Cloud review commit contains duplicate or missing ${label}.`);
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Review storage request failed."));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Review storage transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Review storage transaction was aborted."));
  });
}
