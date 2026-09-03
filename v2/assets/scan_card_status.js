export const SCANNED_CARD_STATUS = Object.freeze({
  NEW_FOR_ALBUM: "new-for-album",
  NEW_TRADING_CARD: "new-trading-card",
  DUPLICATE_TRADING_CARD: "duplicate-trading-card",
});

export function classifyScannedCards(codes, collectionModel) {
  const byCode = collectionModel?.byCode && typeof collectionModel.byCode === "object"
    ? collectionModel.byCode
    : {};
  const seen = new Map();

  return (Array.isArray(codes) ? codes : [])
    .map(normalizeCode)
    .filter(Boolean)
    .map((code) => {
      const card = byCode[code];
      const albumOwned = card ? card.missing !== true : false;
      const availableBeforeScan = nonNegativeQuantity(
        card?.inventory?.availableToTradeQuantity ?? card?.availableToTrade,
      );
      const earlierScanCopies = seen.get(code) || 0;
      seen.set(code, earlierScanCopies + 1);

      if (!albumOwned && earlierScanCopies === 0) {
        return scanStatus(code, SCANNED_CARD_STATUS.NEW_FOR_ALBUM, 0);
      }

      const albumCopiesFromScan = albumOwned ? 0 : 1;
      const earlierTradingCopiesFromScan = Math.max(0, earlierScanCopies - albumCopiesFromScan);
      const priorTradingQuantity = availableBeforeScan + earlierTradingCopiesFromScan;
      if (priorTradingQuantity === 0) {
        return scanStatus(code, SCANNED_CARD_STATUS.NEW_TRADING_CARD, 0);
      }
      return scanStatus(code, SCANNED_CARD_STATUS.DUPLICATE_TRADING_CARD, priorTradingQuantity);
    });
}

export function summarizeScannedCardStatuses(statuses) {
  const summary = {
    newForAlbum: 0,
    newTradingCards: 0,
    duplicateTradingCards: 0,
  };
  for (const item of Array.isArray(statuses) ? statuses : []) {
    if (item?.status === SCANNED_CARD_STATUS.NEW_FOR_ALBUM) summary.newForAlbum += 1;
    if (item?.status === SCANNED_CARD_STATUS.NEW_TRADING_CARD) summary.newTradingCards += 1;
    if (item?.status === SCANNED_CARD_STATUS.DUPLICATE_TRADING_CARD) summary.duplicateTradingCards += 1;
  }
  return summary;
}

function scanStatus(code, status, priorTradingQuantity) {
  return { code, status, priorTradingQuantity };
}

function nonNegativeQuantity(value) {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
}

function normalizeCode(value) {
  return String(value || "").trim().replace(/[\s_-]/g, "").toUpperCase();
}
