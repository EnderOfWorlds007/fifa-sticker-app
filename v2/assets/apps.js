import { applyOcrBackendFromQuery } from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-e115ae4d55ae";
import { redirectNewBrowserToGettingStarted } from "/fifa-sticker-app/v2/assets/v2_profile.js?v=build-e115ae4d55ae";

applyOcrBackendFromQuery();
redirectNewBrowserToGettingStarted({ isHub: document.body.classList.contains("appsBody") });

// Scan links stay on the static v2 app. The configured recognition backend is
// only used by OCR API calls from the scanner page.

import("/fifa-sticker-app/v2/assets/cloud_sync.js?v=build-e115ae4d55ae")
  .then(({ mountCollectionCloudSync }) => mountCollectionCloudSync())
  .catch(() => {});
