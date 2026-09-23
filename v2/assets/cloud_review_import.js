import {
  commitCloudPhotoReviewImport,
  stageCloudPhotoReviewPart,
} from "./photo_review_store_v2.js?v=build-015bab324c53";

export const CLOUD_REVIEW_PART_KIND = "photo-review-import-part-v1";
export const CLOUD_REVIEW_COMMIT_KIND = "photo-review-import-commit-v1";

export async function importCloudReviewPayload(payload, profileId, options = {}) {
  if (payload?.kind === CLOUD_REVIEW_PART_KIND) {
    validatePart(payload);
    await assertDigest(payload.digest, canonicalPart(payload), options.cryptoImpl);
    const blob = dataUrlBlob(payload.imageDataUrl);
    await stageCloudPhotoReviewPart({ ...payload, photo: { ...payload.photo, blob } }, profileId, options);
    return "staged";
  }
  if (payload?.kind === CLOUD_REVIEW_COMMIT_KIND) {
    validateCommit(payload);
    await assertDigest(payload.digest, canonicalCommit(payload), options.cryptoImpl);
    const result = await commitCloudPhotoReviewImport(payload, profileId, options);
    return result.created ? "committed" : "unchanged";
  }
  return "ignored";
}

export async function reviewImportDigest(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error("Secure review import hashing is unavailable.");
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalPart(payload) {
  return {
    batchId: String(payload.batchId || ""),
    partId: String(payload.partId || ""),
    photo: payload.photo,
    imageDataUrl: String(payload.imageDataUrl || ""),
  };
}

function canonicalCommit(payload) {
  return {
    batch: payload.batch,
    photos: payload.photos,
    expectedPhotoCount: Number(payload.expectedPhotoCount),
    expectedReviewItemCount: Number(payload.expectedReviewItemCount),
  };
}

async function assertDigest(expected, canonical, cryptoImpl) {
  const actual = await reviewImportDigest(canonical, cryptoImpl);
  if (actual !== String(expected || "")) throw new Error("Cloud review payload digest mismatch.");
}

function validatePart(payload) {
  if (!String(payload?.importId || "") || !String(payload?.partId || "") || !String(payload?.digest || "")
    || !String(payload?.batchId || "") || !payload?.photo || !String(payload.photo.id || "")) {
    throw new Error("Cloud review photo is invalid.");
  }
  if (!Array.isArray(payload.photo.slots)) throw new Error("Cloud review photo has no recognition slots.");
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(payload.imageDataUrl || ""))) {
    throw new Error("Cloud review photo image is invalid.");
  }
}

function validateCommit(payload) {
  if (!String(payload?.importId || "") || !String(payload?.digest || "")
    || !payload?.batch || !String(payload.batch.id || "") || !Array.isArray(payload.batch.reviewItems)
    || !Array.isArray(payload.photos)) {
    throw new Error("Cloud review commit is invalid.");
  }
}

function dataUrlBlob(value) {
  const [header, encoded] = String(value || "").split(",", 2);
  const mimeType = header.match(/^data:([^;]+);base64$/i)?.[1] || "application/octet-stream";
  const binary = globalThis.atob(encoded || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}
