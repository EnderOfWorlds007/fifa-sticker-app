import { deriveCollectionModel, sortCode } from "./trade_state.js?v=build-be392feeb8ef";

export const PUBLIC_SHARE_SETTINGS_KEY = "panini.publicShare.settings.v1";
const TOKEN_PATTERN = /^PNP1_[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_CONTEXT = "panini-public-share-token-v1:";

export function generatePublicShareToken(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  return `PNP1_${base64UrlEncode(bytes)}`;
}

export function normalizePublicShareToken(value) {
  const token = String(value || "").trim();
  return TOKEN_PATTERN.test(token) ? token : "";
}

export async function publicShareTokenHash(token, cryptoImpl = globalThis.crypto) {
  const normalized = normalizePublicShareToken(token);
  if (!normalized) throw new Error("Invalid public share token.");
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(TOKEN_HASH_CONTEXT + normalized),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function loadPublicShareSettings(storage = globalThis.localStorage) {
  let parsed;
  try {
    parsed = JSON.parse(storage.getItem(PUBLIC_SHARE_SETTINGS_KEY) || "null");
  } catch {
    parsed = null;
  }
  const token = normalizePublicShareToken(parsed?.token);
  return {
    schemaVersion: 1,
    enabled: parsed?.enabled === true && Boolean(token),
    token: parsed?.enabled === true ? token : "",
  };
}

export function savePublicShareSettings(storage, settings) {
  const token = normalizePublicShareToken(settings?.token);
  const normalized = {
    schemaVersion: 1,
    enabled: settings?.enabled === true && Boolean(token),
    token: settings?.enabled === true ? token : "",
  };
  storage.setItem(PUBLIC_SHARE_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function publicShareUrl(token, location = globalThis.location) {
  const normalized = normalizePublicShareToken(token);
  if (!normalized) return "";
  const url = new URL("/fifa-sticker-app/v2/share/", location.href);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export function publicShareTokenFromLocation(location = globalThis.location, historyRef = globalThis.history) {
  const params = new URLSearchParams(String(location?.hash || "").replace(/^#/, ""));
  const token = normalizePublicShareToken(params.get("token"));
  if (location?.href && typeof historyRef?.replaceState === "function") {
    const url = new URL(location.href);
    url.hash = "";
    historyRef.replaceState(null, "", url);
  }
  return token;
}

export async function fetchPublicProjection({ baseUrl, token, fetchImpl = globalThis.fetch } = {}) {
  const normalized = normalizePublicShareToken(token);
  if (!normalized) throw Object.assign(new Error("This trade link is invalid or no longer shared."), { status: 404 });
  const response = await fetchImpl(`${String(baseUrl || "").replace(/\/+$/, "")}/v1/public/collection`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${normalized}` },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok) {
    throw Object.assign(new Error(response.status === 404
      ? "This trade link is invalid or no longer shared."
      : "The shared trade list could not be loaded."), { status: response.status });
  }
  return payload;
}

export function buildPublicProjection({ catalog, collectionState, ledger, inventory } = {}) {
  if (inventory?.stats?.adjusted === true) {
    throw new Error("Public projections require the raw inventory snapshot.");
  }
  const model = deriveCollectionModel({
    catalog,
    legacyCollected: Array.isArray(collectionState?.collected) ? collectionState.collected : [],
    ledger,
    inventory,
  });
  return {
    schemaVersion: 1,
    catalog: {
      edition: String(catalog?.edition || ""),
      canonicalCount: Number(catalog?.canonical_count ?? model.summary.catalogCount),
    },
    needs: model.cards.filter((card) => card.missing).map((card) => card.code).sort(sortCode),
    offers: model.cards
      .filter((card) => card.inventory.availableToTradeQuantity > 0)
      .map((card) => ({ code: card.code, quantity: card.inventory.availableToTradeQuantity }))
      .sort((a, b) => sortCode(a.code, b.code)),
  };
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replace(/\//g, "_").replace(/=+$/, "");
}
