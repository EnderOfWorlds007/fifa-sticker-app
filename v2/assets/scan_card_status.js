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

export function expandCodeOccurrences(occurrences) {
  if (!occurrences || typeof occurrences[Symbol.iterator] !== "function") return [];
  return [...occurrences].flatMap(([code, quantity]) => (
    Array.from({ length: nonNegativeQuantity(quantity) }, () => normalizeCode(code)).filter(Boolean)
  ));
}

export function groupScannedCardStatuses(statuses) {
  const groups = new Map();
  for (const item of Array.isArray(statuses) ? statuses : []) {
    if (!item?.code) continue;
    if (!groups.has(item.code)) {
      groups.set(item.code, {
        code: item.code,
        quantity: 0,
        newForAlbum: 0,
        newTradingCards: 0,
        duplicateTradingCards: 0,
        priorTradingQuantity: 0,
      });
    }
    const group = groups.get(item.code);
    group.quantity += 1;
    group.priorTradingQuantity = Math.max(group.priorTradingQuantity, Number(item.priorTradingQuantity || 0));
    if (item.status === SCANNED_CARD_STATUS.NEW_FOR_ALBUM) group.newForAlbum += 1;
    if (item.status === SCANNED_CARD_STATUS.NEW_TRADING_CARD) group.newTradingCards += 1;
    if (item.status === SCANNED_CARD_STATUS.DUPLICATE_TRADING_CARD) group.duplicateTradingCards += 1;
  }
  return [...groups.values()];
}

export function scannedCardStatusSummaryText(summary) {
  return [
    quantityLabel(summary?.newForAlbum, "new for album", "new for album"),
    quantityLabel(summary?.newTradingCards, "new trading card", "new trading cards"),
    quantityLabel(summary?.duplicateTradingCards, "duplicate trading card", "duplicate trading cards"),
  ].join(" · ");
}

export function scannedCardGroupDetail(group) {
  return [
    group?.newForAlbum ? quantityLabel(group.newForAlbum, "new for album", "new for album") : "",
    group?.newTradingCards ? quantityLabel(group.newTradingCards, "new trading card", "new trading cards") : "",
    group?.duplicateTradingCards ? quantityLabel(group.duplicateTradingCards, "duplicate trading card", "duplicate trading cards") : "",
  ].filter(Boolean).join(" · ");
}

export function dominantScannedCardStatus(group) {
  if (group?.newForAlbum) return SCANNED_CARD_STATUS.NEW_FOR_ALBUM;
  if (group?.newTradingCards) return SCANNED_CARD_STATUS.NEW_TRADING_CARD;
  return SCANNED_CARD_STATUS.DUPLICATE_TRADING_CARD;
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

function quantityLabel(value, singular, plural) {
  const quantity = nonNegativeQuantity(value);
  return `${quantity} ${quantity === 1 ? singular : plural}`;
}
