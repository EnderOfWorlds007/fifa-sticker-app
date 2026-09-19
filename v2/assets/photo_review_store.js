const DATABASE_NAME = "panini-photo-review-queue";
const DATABASE_VERSION = 1;
const BATCH_STORE = "review_batches";
const PHOTO_STORE = "review_photos";

export async function savePhotoReviewBatch(batch, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  const transaction = database.transaction([BATCH_STORE, PHOTO_STORE], "readwrite");
  transaction.objectStore(BATCH_STORE).put(batchRecord(batch));
  for (const photo of batch.photos || []) {
    transaction.objectStore(PHOTO_STORE).put(photoRecord(batch.id, photo));
  }
  await transactionComplete(transaction);
  database.close();
  return batch;
}

export async function savePhotoReviewBatchMeta(batch, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  const transaction = database.transaction(BATCH_STORE, "readwrite");
  transaction.objectStore(BATCH_STORE).put(batchRecord(batch));
  await transactionComplete(transaction);
  database.close();
  return batch;
}

export async function savePhotoReviewPhoto(batchId, photo, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  const transaction = database.transaction(PHOTO_STORE, "readwrite");
  transaction.objectStore(PHOTO_STORE).put(photoRecord(batchId, photo));
  await transactionComplete(transaction);
  database.close();
  return photo;
}

export async function loadLatestPhotoReviewBatch(profileId, options = {}) {
  const database = await openReviewDatabase(options.indexedDB);
  const batchTransaction = database.transaction(BATCH_STORE, "readonly");
  const batchComplete = transactionComplete(batchTransaction);
  const batches = await requestResult(batchTransaction.objectStore(BATCH_STORE).getAll());
  await batchComplete;
  const batch = (batches || [])
    .filter((candidate) => String(candidate.profileId || "") === String(profileId || ""))
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0];
  if (!batch) {
    database.close();
    return null;
  }
  const photoTransaction = database.transaction(PHOTO_STORE, "readonly");
  const photoComplete = transactionComplete(photoTransaction);
  const photos = await requestResult(photoTransaction.objectStore(PHOTO_STORE).getAll());
  await photoComplete;
  database.close();
  return {
    ...batch,
    photos: (photos || [])
      .filter((photo) => photo.batchId === batch.id)
      .sort((left, right) => Number(left.index || 0) - Number(right.index || 0)),
  };
}

export function batchRecord(batch) {
  const {
    photos: _photos,
    imageUrl: _imageUrl,
    slots: _slots,
    selectedSlotId: _selectedSlotId,
    ...record
  } = batch || {};
  return {
    ...record,
    id: String(record.id || ""),
    profileId: String(record.profileId || ""),
    updatedAt: Number(record.updatedAt || Date.now()),
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
    slots: Array.isArray(record.slots) ? record.slots : [],
    view: record.view || { focused: false, zoomFactor: 1 },
  };
}

export function openReviewDatabase(indexedDBFactory = globalThis.indexedDB) {
  if (!indexedDBFactory?.open) {
    return Promise.reject(new Error("Review storage is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BATCH_STORE)) {
        database.createObjectStore(BATCH_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(PHOTO_STORE)) {
        database.createObjectStore(PHOTO_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Review storage could not be opened."));
    request.onblocked = () => reject(new Error("Review storage upgrade is blocked by another open tab."));
  });
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
