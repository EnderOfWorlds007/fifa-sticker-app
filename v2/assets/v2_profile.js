export const ACTIVE_PROFILE_ID_KEY = "panini.v2.activeProfileId";
const APP_ROUTE_NAMES = new Set([
  "apps",
  "collection",
  "compare",
  "getting-started",
  "inventory",
  "review-album-pages",
  "scanner",
  "trade",
  "trades",
]);

export function activeProfileId(storage = globalThis.localStorage) {
  try {
    return String(storage.getItem(ACTIVE_PROFILE_ID_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function hasActiveProfileId(storage = globalThis.localStorage) {
  return Boolean(activeProfileId(storage));
}

export function ensureActiveProfileId(storage = globalThis.localStorage, options = {}) {
  const existing = activeProfileId(storage);
  if (existing) return existing;
  const id = options.idFactory ? options.idFactory() : newProfileId();
  storage.setItem(ACTIVE_PROFILE_ID_KEY, id);
  return id;
}

export function shouldRedirectToGettingStarted({
  pathname = globalThis.location?.pathname || "",
  storage = globalThis.localStorage,
  isHub = false,
} = {}) {
  if (hasActiveProfileId(storage)) return false;
  if (!isHub && !isHubPath(pathname)) return false;
  return !isGettingStartedPath(pathname);
}

export function redirectNewBrowserToGettingStarted({
  location = globalThis.location,
  storage = globalThis.localStorage,
  isHub = false,
  gettingStartedPath,
} = {}) {
  if (!location || !shouldRedirectToGettingStarted({ pathname: location.pathname, storage, isHub })) return false;
  const targetPath = gettingStartedPath || derivedGettingStartedPath(location);
  if (typeof location.assign === "function") location.assign(targetPath);
  else location.href = targetPath;
  return true;
}

function isGettingStartedPath(pathname) {
  return String(pathname || "").replace(/\/+$/, "").endsWith("/fifa-sticker-app/v2/getting-started");
}

function isHubPath(pathname) {
  const normalized = String(pathname || "").replace(/\/+$/, "");
  return normalized === "" || normalized === "/fifa-sticker-app/v2/" || normalized.endsWith("/fifa-sticker-app/v2/apps");
}

function derivedGettingStartedPath(location) {
  const pathname = String(location?.pathname || "/fifa-sticker-app/v2/");
  const normalized = pathname.replace(/\/+$/, "");
  const segments = normalized.split("/fifa-sticker-app/v2/").filter(Boolean);
  const last = segments[segments.length - 1] || "";
  const base = APP_ROUTE_NAMES.has(last)
    ? `/${segments.slice(0, -1).join("/fifa-sticker-app/v2/")}`
    : normalized;
  return `${base || ""}/getting-started/${location.search || ""}${location.hash || ""}`;
}

function newProfileId() {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `local_${random}`;
}
