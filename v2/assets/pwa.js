export const V2_BUILD_ID = "build-ea110a3c78a2";
const RELOAD_KEY = `fifa-v2-controller-reload-${V2_BUILD_ID}`;
const statusElement = typeof document === "undefined" ? null : document.querySelector("[data-pwa-status]");
const reloadRequested = new WeakSet();

export function serviceWorkerUsesBuild(worker, buildId = V2_BUILD_ID) {
  if (!worker?.scriptURL) return false;
  try { return new URL(worker.scriptURL).searchParams.get("v") === buildId; } catch { return false; }
}

export function buildReloadUrl(href, buildId = V2_BUILD_ID, nonce = Date.now()) {
  const url = new URL(href);
  url.searchParams.set("v", buildId);
  url.searchParams.set("sw-refresh", String(nonce));
  return url.href;
}

export function reloadOnceForBuild(environment = globalThis) {
  if (reloadRequested.has(environment)) return false;
  reloadRequested.add(environment);
  try {
    if (environment.sessionStorage.getItem(RELOAD_KEY) === "1") return false;
    environment.sessionStorage.setItem(RELOAD_KEY, "1");
    environment.location.replace(buildReloadUrl(environment.location.href));
    return true;
  } catch {
    environment.location.reload();
    return true;
  }
}

export async function updateV2ServiceWorker(environment = globalThis) {
  const serviceWorker = environment.navigator?.serviceWorker;
  if (!serviceWorker) return null;
  serviceWorker.addEventListener("controllerchange", () => {
    if (serviceWorkerUsesBuild(serviceWorker.controller)) reloadOnceForBuild(environment);
  });
  const registration = await serviceWorker.register(
    `/fifa-sticker-app/v2/sw.js?v=${V2_BUILD_ID}`,
    { updateViaCache: "none" },
  );
  const requestActivation = () => registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", requestActivation);
  });
  await registration.update();
  requestActivation();
  return registration;
}

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  document.documentElement.dataset.v2Build = V2_BUILD_ID;
  window.addEventListener("load", async () => {
    try {
      const registration = await updateV2ServiceWorker(window);
      const ready = serviceWorkerUsesBuild(registration?.active) && registration.active.state === "activated";
      if (statusElement) statusElement.textContent = ready
        ? `Ready for local use · ${V2_BUILD_ID}`
        : `Preparing local app cache · ${V2_BUILD_ID}`;
    } catch {
      if (statusElement) statusElement.textContent = "Local app cache unavailable.";
    }
  });
} else if (statusElement) {
  statusElement.textContent = "Local app cache unavailable in this browser.";
}
