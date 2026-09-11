export const SCAN_INSIGNIA_VARIANTS = Object.freeze({
  blue: "standard_fifa_licensed",
  green: "united_edition",
});

const VARIANT_ORDER = new Map([
  [SCAN_INSIGNIA_VARIANTS.blue, 0],
  [SCAN_INSIGNIA_VARIANTS.green, 1],
  ["", 2],
]);

export function recognizedScanInsignia(value) {
  const normalized = String(value || "").trim();
  return Object.values(SCAN_INSIGNIA_VARIANTS).includes(normalized) ? normalized : "";
}

export function receivedLinesForScan({ slots = [], fallbackCodes = [] } = {}) {
  const recognizedSlots = Array.isArray(slots)
    ? slots.map((slot) => ({
      code: normalizeCode(slot?.code),
      variant: recognizedScanInsignia(slot?.back_insignia_type),
    })).filter((slot) => slot.code)
    : [];
  const observations = recognizedSlots.length
    ? recognizedSlots
    : (Array.isArray(fallbackCodes) ? fallbackCodes : [])
      .map((code) => ({ code: normalizeCode(code), variant: "" }))
      .filter((slot) => slot.code);
  const quantities = new Map();
  for (const observation of observations) {
    const key = `${observation.code}\u0000${observation.variant}`;
    const current = quantities.get(key) || { ...observation, quantity: 0 };
    current.quantity += 1;
    quantities.set(key, current);
  }
  return [...quantities.values()]
    .map(({ code, variant, quantity }) => ({
      code,
      quantity,
      ...(variant ? { variant } : {}),
    }))
    .sort((left, right) => (
      sortCode(left.code, right.code)
      || (VARIANT_ORDER.get(left.variant || "") ?? 99) - (VARIANT_ORDER.get(right.variant || "") ?? 99)
    ));
}

export function summarizeScanInsignias(lines = []) {
  const summary = { blue: 0, green: 0, unknown: 0 };
  for (const line of Array.isArray(lines) ? lines : []) {
    const quantity = Math.max(0, Number(line?.quantity || 0));
    if (line?.variant === SCAN_INSIGNIA_VARIANTS.blue) summary.blue += quantity;
    else if (line?.variant === SCAN_INSIGNIA_VARIANTS.green) summary.green += quantity;
    else summary.unknown += quantity;
  }
  return summary;
}

export function scanReceiptSignature(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => `${normalizeCode(line?.code)}:${recognizedScanInsignia(line?.variant) || "unknown"}:${Math.max(0, Number(line?.quantity || 0))}`)
    .filter((part) => !part.startsWith(":"))
    .join("|");
}

function normalizeCode(value) {
  return String(value || "").trim().replace(/[\s_-]/g, "").toUpperCase();
}

function sortCode(left, right) {
  const leftMatch = String(left || "").match(/^([A-Z]+)(\d+)$/);
  const rightMatch = String(right || "").match(/^([A-Z]+)(\d+)$/);
  if (!leftMatch || !rightMatch) return String(left || "").localeCompare(String(right || ""));
  return leftMatch[1].localeCompare(rightMatch[1]) || Number(leftMatch[2]) - Number(rightMatch[2]);
}
