const DATABASE_NAME = "panini-photo-review-queue";
const DATABASE_VERSION = 2;
const BATCH_STORE = "review_batches";
const PHOTO_STORE = "review_photos";
const ACTIVE_STORE = "active_review_batches";

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
