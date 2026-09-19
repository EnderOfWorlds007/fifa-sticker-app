export function reviewItemKey(photoId, slotId, kind) {
  return `${photoId}:${slotId}:${kind}`;
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
