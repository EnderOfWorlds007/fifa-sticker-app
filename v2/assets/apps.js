import { applyOcrBackendFromQuery } from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-b77d42c8e9a1";
import { redirectNewBrowserToGettingStarted } from "/fifa-sticker-app/v2/assets/v2_profile.js?v=build-b77d42c8e9a1";

applyOcrBackendFromQuery();
redirectNewBrowserToGettingStarted({ isHub: document.body.classList.contains("appsBody") });

// Scan links stay on the static v2 app. The configured recognition backend is
// only used by OCR API calls from the scanner page.

globalThis.PANINI_CLOUD_SYNC_READY = import("/fifa-sticker-app/v2/assets/cloud_sync.js?v=build-b77d42c8e9a1")
  .then(({ mountCollectionCloudSync }) => mountCollectionCloudSync()?.ready)
  .catch(() => null);
