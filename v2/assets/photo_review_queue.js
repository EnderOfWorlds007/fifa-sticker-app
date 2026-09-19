export function reviewItemKey(photoId, slotId, kind) {
  return `${photoId}:${slotId}:${kind}`;
}

export function reviewCodeCandidates(slot) {
  const source = slot && typeof slot === "object" && !Array.isArray(slot) ? slot : {};
  const warnings = [];
  const rawCandidates = [source.code];
  for (const field of ["code_candidates", "candidates", "alternatives", "ocr_candidates"]) {
    const value = source[field];
    if (value == null) continue;
    if (Array.isArray(value)) rawCandidates.push(...value);
    else warnings.push(`${field} is not an array`);
  }
  const seen = new Set();
  const candidates = rawCandidates
    .map((candidate) => typeof candidate === "string" ? { code: candidate } : candidate)
    .map((candidate) => ({
      code: String(candidate?.code || candidate?.label || candidate?.text || "").trim().toUpperCase(),
      score: Number(candidate?.score ?? candidate?.confidence ?? 0),
    }))
    .filter((candidate) => {
      if (!candidate.code || seen.has(candidate.code)) return false;
      seen.add(candidate.code);
      return true;
    })
    .slice(0, 6);
  return { candidates, warnings };
}

export function hydratePhotoReviewSlots(slots, options = {}) {
  if (!Array.isArray(slots)) return [];
  return slots.map((slot, index) => {
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
      return {
        id: `malformed:${String(options.photoId || "photo")}:${index + 1}`,
        code: "",
        code_candidates: [],
        code_review_status: "pending",
        geometry_status: "unavailable",
        needs_user_help: true,
        review_status: "unreadable",
        retained_slot_value: slot,
        hydration_error: `Stored review slot ${index + 1} is malformed.`,
      };
    }
    const normalized = reviewCodeCandidates(slot);
    const retainedWarnings = Array.isArray(slot.hydration_warnings) ? slot.hydration_warnings : [];
    return {
      ...slot,
      id: String(slot.id || `retained:${String(options.photoId || "photo")}:${index + 1}`),
      code_candidates: normalized.candidates,
      ...(normalized.warnings.length
        ? { hydration_warnings: [...retainedWarnings, ...normalized.warnings] }
        : {}),
    };
  });
}

export function buildPhotoReviewItems(photo, predicates = {}) {
  const needsCodeReview = predicates.needsCodeReview || (() => false);
  const needsInsigniaReview = predicates.needsInsigniaReview || (() => false);
  return (photo?.slots || []).flatMap((slot) => {
    const items = [];
    if (needsCodeReview(slot)) items.push(reviewItem(photo, slot, "code"));
    if (needsInsigniaReview(slot)) items.push(reviewItem(photo, slot, "insignia"));
    return items;
  });
}

export function nextPendingReviewItem(allItems, pendingItems, currentKey = "") {
  if (!pendingItems.length) return null;
  const currentPosition = allItems.findIndex((item) => item.key === currentKey);
  return pendingItems.find((item) => allItems.indexOf(item) > currentPosition) || pendingItems[0];
}

function reviewItem(photo, slot, kind) {
  return {
    key: reviewItemKey(photo.id, slot.id, kind),
    photoId: photo.id,
    slotId: slot.id,
    kind,
  };
}
