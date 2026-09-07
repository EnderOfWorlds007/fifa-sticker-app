import { applyOcrBackendFromQuery } from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-cf1e606d819a";
import { redirectNewBrowserToGettingStarted } from "/fifa-sticker-app/v2/assets/v2_profile.js?v=build-cf1e606d819a";

applyOcrBackendFromQuery();
redirectNewBrowserToGettingStarted({ isHub: document.body.classList.contains("appsBody") });

// Scan links stay on the static v2 app. The configured recognition backend is
// only used by OCR API calls from the scanner page.

import("/fifa-sticker-app/v2/assets/cloud_sync.js?v=build-cf1e606d819a")
  .then(({ mountCollectionCloudSync }) => mountCollectionCloudSync())
  .catch(() => {});
