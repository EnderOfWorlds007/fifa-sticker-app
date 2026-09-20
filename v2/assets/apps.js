import { applyOcrBackendFromQuery } from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-8858ca7c61aa";
import { redirectNewBrowserToGettingStarted } from "/fifa-sticker-app/v2/assets/v2_profile.js?v=build-8858ca7c61aa";

applyOcrBackendFromQuery();
redirectNewBrowserToGettingStarted({ isHub: document.body.classList.contains("appsBody") });

// Scan links stay on the static v2 app. The configured recognition backend is
// only used by OCR API calls from the scanner page.

globalThis.PANINI_CLOUD_SYNC_READY = import("/fifa-sticker-app/v2/assets/cloud_sync.js?v=build-8858ca7c61aa")
  .then(({ mountCollectionCloudSync }) => mountCollectionCloudSync()?.ready)
  .catch(() => null);
