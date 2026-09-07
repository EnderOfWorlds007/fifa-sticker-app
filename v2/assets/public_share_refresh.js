export function publicShareRefreshNeededOnPage(settings, location = globalThis.location) {
  if (settings?.enabled !== true) return false;
  return /\/v2\/(?:compare|collection)\/?$/.test(String(location?.pathname || ""));
}
