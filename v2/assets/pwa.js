const statusElement = document.querySelector("[data-pwa-status]");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/fifa-sticker-app/v2/sw.js?v=build-a6d4f09c2e71", { updateViaCache: "none" });
      await registration.update();
      if (statusElement) statusElement.textContent = registration.active ? "Ready for local use." : "Preparing local app cache.";
    } catch {
      if (statusElement) statusElement.textContent = "Local app cache unavailable.";
    }
  });
} else if (statusElement) {
  statusElement.textContent = "Local app cache unavailable in this browser.";
}
