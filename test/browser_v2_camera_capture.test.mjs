import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const CHROME = process.env.CHROME_BIN || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/usr/bin/google-chrome");
const PORT = 8792;
const DEBUG_PORT = 9332;

test("V2 photo picker stays reusable and camera sends captured files through OCR", async () => {
  const serverRoot = await mkdtemp(join(tmpdir(), "fifa-v2-camera-server-"));
  await symlink(process.cwd(), join(serverRoot, "fifa-sticker-app"));
  const photoPath = join(serverRoot, "sample.png");
  const secondPhotoPath = join(serverRoot, "sample-2.png");
  await writeFile(photoPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ));
  await writeFile(secondPhotoPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ));
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: serverRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chromeProfile = await mkdtemp(join(tmpdir(), "fifa-v2-camera-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${chromeProfile}`,
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/fifa-sticker-app/v2/scanner/`);
    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const page = await createPage("about:blank");
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    try {
      await send(cdp, "Runtime.enable");
      await send(cdp, "Page.enable");
      await send(cdp, "Page.addScriptToEvaluateOnNewDocument", { source: cameraMockSource() });
      await send(cdp, "Page.navigate", { url: `http://127.0.0.1:${PORT}/fifa-sticker-app/v2/scanner/` });
      await waitForExpression(cdp, `document.querySelector("#photoScannerCameraButton")`);
      await delay(500);
      await evaluate(cdp, installOcrMockSource());

      await send(cdp, "Page.setInterceptFileChooserDialog", { enabled: true });
      for (const expectedUploadCount of [1, 2]) {
        const photoRect = await evaluate(cdp, `(() => {
          const rect = document.querySelector("#photoScannerButton").getBoundingClientRect();
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        })()`);
        const chooserPromise = withTimeout(cdp.waitFor("Page.fileChooserOpened"), 2000, "Choose photo did not open its native file input");
        await clickCenter(cdp, photoRect);
        const chooser = await chooserPromise;
        assert.equal(chooser.mode, "selectSingle");
        assert.ok(chooser.backendNodeId, "Choose photo should expose its native input");
        await send(cdp, "DOM.setFileInputFiles", { backendNodeId: chooser.backendNodeId, files: [photoPath] });
        await waitForExpression(cdp, `window.__cameraUploadCount === ${expectedUploadCount}`);
        const pickerDuringUpload = await evaluate(cdp, `({
          inputDisabled: document.querySelector("#photoScannerInput").disabled,
          controlBusy: document.querySelector("#photoScannerInput").closest(".photoPickerControl").classList.contains("isBusy"),
        })`);
        assert.deepEqual(pickerDuringUpload, { inputDisabled: false, controlBusy: true });
        await waitForExpression(cdp, `document.querySelector("#photoScannerResult").value === "TUR5" && !document.querySelector("#photoScannerInput").disabled`);
      }
      const reusablePicker = await evaluate(cdp, `({
        connected: document.querySelector("#photoScannerInput").isConnected,
        disabled: document.querySelector("#photoScannerInput").disabled,
        busy: document.querySelector("#photoScannerInput").closest(".photoPickerControl").classList.contains("isBusy"),
        value: document.querySelector("#photoScannerInput").value,
        label: document.querySelector("#photoScannerButton").textContent,
      })`);
      assert.deepEqual(reusablePicker, { connected: true, disabled: false, busy: false, value: "", label: "Choose photo" });

      await evaluate(cdp, `localStorage.setItem("panini.ocrToken.v1", "saved-review-token")`);

      const reviewsPage = await createPage("about:blank");
      const reviewsCdp = await connectCdp(reviewsPage.webSocketDebuggerUrl);
      try {
        await send(reviewsCdp, "Runtime.enable");
        await send(reviewsCdp, "Page.enable");
        await send(reviewsCdp, "Page.addScriptToEvaluateOnNewDocument", {
          source: `sessionStorage.setItem("fifa-v2-controller-reload-build-5d846227af90", "1")`,
        });
        await send(reviewsCdp, "Page.navigate", { url: `http://127.0.0.1:${PORT}/fifa-sticker-app/v2/reviews/` });
        await waitForExpression(reviewsCdp, `document.querySelector("#photoScannerResult")?.value === "TUR5"`);
        await waitForExpression(reviewsCdp, `document.querySelector("#photoReviewPanel")?.hidden === false`);
        const restoredReview = await evaluate(reviewsCdp, `({
          currentTab: document.querySelector('.phoneTabBar a[aria-current="page"]')?.textContent,
          imageSource: document.querySelector("#photoReviewImage")?.src,
          pendingText: document.querySelector("#photoReviewQueueText")?.textContent,
          backendToken: document.querySelector("[data-ocr-backend-token]")?.value,
          backendTokenType: document.querySelector("[data-ocr-backend-token]")?.type,
        })`);
        assert.equal(restoredReview.currentTab, "Reviews");
        assert.match(restoredReview.imageSource, /^blob:/);
        assert.match(restoredReview.pendingText, /Review 1 of 1 · TUR5 · choose back insignia/i);
        assert.equal(restoredReview.backendToken, "saved-review-token");
        assert.equal(restoredReview.backendTokenType, "password");

        await waitForExpression(reviewsCdp, `document.querySelector("#restoreCloudIdButton")?.disabled === false`);
        await evaluate(reviewsCdp, `(() => {
          document.querySelector("#cloudRestoreIdInput").value = "not-a-restore-code";
          document.querySelector("#restoreCloudIdButton").click();
        })()`);
        await waitForExpression(reviewsCdp, `document.querySelector("#cloudSyncStatus span")?.textContent.includes("valid restore code")`);
        const queueAfterFailedLoad = await evaluate(reviewsCdp, `({
          codes: document.querySelector("#photoScannerResult")?.value,
          reviewVisible: document.querySelector("#photoReviewPanel")?.hidden === false,
          restoreInputType: document.querySelector("#cloudRestoreIdInput")?.type,
        })`);
        assert.deepEqual(queueAfterFailedLoad, { codes: "TUR5", reviewVisible: true, restoreInputType: "password" });
      } finally {
        reviewsCdp.close();
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${reviewsPage.id}`);
      }

      await evaluate(cdp, `window.__simulateLostUploadAck = true`);
      const recoveryRect = await evaluate(cdp, `(() => {
        const rect = document.querySelector("#photoScannerButton").getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })()`);
      const recoveryChooserPromise = withTimeout(cdp.waitFor("Page.fileChooserOpened"), 2000, "recovery-test photo chooser did not open");
      await clickCenter(cdp, recoveryRect);
      const recoveryChooser = await recoveryChooserPromise;
      await send(cdp, "DOM.setFileInputFiles", { backendNodeId: recoveryChooser.backendNodeId, files: [photoPath] });
      await waitForExpression(cdp, `document.querySelector("#photoScannerStatus").textContent.includes("Connection interrupted")`);
      await waitForExpression(cdp, `document.querySelector("#photoScannerResult").value === "ENG5"`);
      const recoveredUpload = await evaluate(cdp, `({
        requestLog: window.__recoveryRequestLog,
        uploadCount: window.__cameraUploadCount,
        status: document.querySelector("#photoScannerStatus").textContent,
        busy: document.querySelector("#photoScannerInput").closest(".photoPickerControl").classList.contains("isBusy"),
        inputDisabled: document.querySelector("#photoScannerInput").disabled,
        scanButtonDisabled: document.querySelector("#photoScannerButton").disabled,
        cameraButtonDisabled: document.querySelector("#photoScannerCameraButton").disabled,
        cancelHidden: document.querySelector("#photoScannerCancelButton").hidden,
        ariaBusy: document.querySelector("#photoScannerButton").getAttribute("aria-busy"),
        label: document.querySelector("#photoScannerButton").textContent,
      })`);
      assert.deepEqual(recoveredUpload.requestLog, [
        `PUT:${recoveredUpload.requestLog[0].slice(4)}`,
        `GET:${recoveredUpload.requestLog[0].slice(4)}`,
        `GET:${recoveredUpload.requestLog[0].slice(4)}`,
      ]);
      assert.equal(recoveredUpload.uploadCount, 3, "lost acknowledgement must not trigger a second upload");
      assert.equal(recoveredUpload.status, "1 card recognized in 1 photo.");
      assert.equal(recoveredUpload.busy, false);
      assert.equal(recoveredUpload.inputDisabled, false);
      assert.equal(recoveredUpload.scanButtonDisabled, false);
      assert.equal(recoveredUpload.cameraButtonDisabled, false);
      assert.equal(recoveredUpload.cancelHidden, true);
      assert.equal(recoveredUpload.ariaBusy, "false");
      assert.equal(recoveredUpload.label, "Choose photo");
      await waitForExpression(cdp, `document.querySelector("#photoReviewUnplaced .photoReviewUnplacedCard")?.textContent.includes("ENG5")`);
      const unplacedCard = await evaluate(cdp, `({
        text: document.querySelector("#photoReviewUnplaced .photoReviewUnplacedCard").textContent,
        reviewRequired: !document.querySelector("#photoReviewQueue").hidden,
      })`);
      assert.match(unplacedCard.text, /ENG5/);
      assert.match(unplacedCard.text, /Ezri Konsa/);
      assert.match(unplacedCard.text, /England/);
      assert.equal(unplacedCard.reviewRequired, true);
      await evaluate(cdp, `document.querySelector("#photoReviewUnplaced .photoReviewUnplacedCard").click()`);
      await waitForExpression(cdp, `document.querySelector("#photoReviewInspector")?.textContent.includes("ENG5")`);

      await evaluate(cdp, `document.querySelector("#photoScannerCameraButton").click()`);
      await waitForExpression(cdp, `document.querySelector(".cameraCaptureDialog")`);
      await waitForExpression(cdp, `document.querySelector(".cameraTakeButton:not([disabled])")`);
      const livePreview = await evaluate(cdp, `document.querySelector(".cameraCaptureStatus").textContent`);
      assert.match(livePreview, /Preview 1920×1080/);
      assert.match(livePreview, /still-photo flash ready/);

      await evaluate(cdp, `document.querySelector(".cameraTakeButton").click()`);
      await waitForExpression(cdp, `window.__cameraUploadCount === 4`);
      await waitForExpression(cdp, `document.querySelector("#photoScannerResult").value === "TUR5"`);
      const result = await evaluate(cdp, `({
        upload: window.__cameraUpload,
        diagnostics: document.querySelector("#photoCameraDiagnostics").textContent,
        reviewTitle: document.querySelector("#photoReviewInspector > strong")?.textContent,
        estimatedLegend: document.querySelector(".photoReviewLegendSwatch.isEstimated")?.parentElement.textContent,
        cardStatus: document.querySelector("#photoScannerCodes .compactScanResultDetail")?.textContent,
        editionUnknown: document.querySelector("#photoScannerCodes .compactScanEdition.is-unknown")?.textContent,
        tracksStopped: window.__cameraTracksStopped,
        torch: window.__cameraTorch,
        cameraButtonDisabled: document.querySelector("#photoScannerCameraButton").disabled,
      })`);
      assert.equal(result.upload.name.startsWith("sticker-camera-"), true);
      assert.equal(result.upload.type, "image/png");
      assert.ok(result.upload.size > 0);
      assert.match(result.diagnostics, /captured 1×1/);
      assert.match(result.diagnostics, /native still photo/);
      assert.match(result.diagnostics, /still-photo flash requested/);
      assert.equal(result.reviewTitle, "TUR5 · Abdulkerim Bardakci");
      assert.match(result.estimatedLegend, /Magenta dash-dot\s+Code accepted; card outline estimated/);
      assert.equal(result.cardStatus, "Duplicate +1 · spares 1→2");
      assert.equal(result.editionUnknown, "?1");
      assert.equal(result.tracksStopped, true);
      assert.equal(result.torch, false, "cleanup should turn the torch off");
      assert.equal(result.cameraButtonDisabled, false);

      await evaluate(cdp, `(() => {
        Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
        Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
      })()`);
      await evaluate(cdp, `document.querySelector("#photoScannerCameraButton").click()`);
      await waitForExpression(cdp, `document.querySelector(".cameraTakeButton:not([disabled])")`);
      const iosPreview = await evaluate(cdp, `document.querySelector(".cameraCaptureStatus").textContent`);
      assert.match(iosPreview, /torch confirmed active/);
      await evaluate(cdp, `document.querySelector(".cameraTakeButton").click()`);
      await waitForExpression(cdp, `window.__cameraUploadCount === 5`);
      const iosResult = await evaluate(cdp, `({
        nativeCalls: window.__nativeTakePhotoCalls,
        diagnostics: document.querySelector("#photoCameraDiagnostics").textContent,
        upload: window.__cameraUpload,
      })`);
      assert.equal(iosResult.nativeCalls, 1, "iPhone capture must not call ImageCapture.takePhoto");
      assert.ok(iosResult.upload.size > 0);
      assert.match(iosResult.diagnostics, /iPhone\/iPad camera frame \(native still bypassed\)/);

      await waitForExpression(cdp, `document.querySelector("#photoScannerStatus").textContent.includes("recognized") && !document.querySelector("#photoScannerCameraButton").disabled`);
      await evaluate(cdp, `window.__holdPhotoJob = true`);
      const cancelPhotoRect = await evaluate(cdp, `(() => {
        const rect = document.querySelector("#photoScannerButton").getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })()`);
      const cancelChooserPromise = withTimeout(cdp.waitFor("Page.fileChooserOpened"), 2000, "cancel-test photo chooser did not open");
      await clickCenter(cdp, cancelPhotoRect);
      const cancelChooser = await cancelChooserPromise;
      await send(cdp, "DOM.setFileInputFiles", { backendNodeId: cancelChooser.backendNodeId, files: [photoPath] });
      await waitForExpression(cdp, `window.__heldPhotoPollStarted === true`);
      await evaluate(cdp, `document.querySelector("#photoScannerCancelButton").click()`);
      await waitForExpression(cdp, `document.querySelector("#photoScannerCancelButton").hidden && document.querySelector("#photoScannerStatus").textContent.includes("cancelled")`);
      const cancelledScanner = await evaluate(cdp, `({
        pickerBusy: document.querySelector("#photoScannerInput").closest(".photoPickerControl").classList.contains("isBusy"),
        cameraDisabled: document.querySelector("#photoScannerCameraButton").disabled,
        cancelHidden: document.querySelector("#photoScannerCancelButton").hidden,
      })`);
      assert.deepEqual(cancelledScanner, { pickerBusy: false, cameraDisabled: false, cancelHidden: true });
      await evaluate(cdp, `window.__holdPhotoJob = false`);

      await evaluate(cdp, `document.querySelector("#photoScannerCameraButton").click()`);
      await waitForExpression(cdp, `document.querySelector(".cameraFallbackButton")`);
      const fallbackRect = await evaluate(cdp, `(() => {
        const rect = document.querySelector(".cameraFallbackButton").getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })()`);
      const chooserPromise = withTimeout(cdp.waitFor("Page.fileChooserOpened"), 2000, "fallback file chooser did not open");
      await clickCenter(cdp, fallbackRect);
      const chooser = await chooserPromise;
      assert.equal(chooser.mode, "selectSingle", "camera fallback should use the reliable single-photo picker on iPhone");

      await send(cdp, "Page.navigate", { url: `http://127.0.0.1:${PORT}/fifa-sticker-app/v2/compare/` });
      await waitForExpression(cdp, `document.querySelector("#compareText")`);
      await evaluate(cdp, installOcrMockSource());
      await evaluate(cdp, `window.__holdPhotoJob = true`);
      const tradePhotoRect = await evaluate(cdp, `(() => {
        const rect = document.querySelector(".photoUploadButton").getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })()`);
      const tradeChooserPromise = withTimeout(cdp.waitFor("Page.fileChooserOpened"), 2000, "trade photo chooser did not open");
      await clickCenter(cdp, tradePhotoRect);
      const tradeChooser = await tradeChooserPromise;
      assert.equal(tradeChooser.mode, "selectMultiple");
      await send(cdp, "DOM.setFileInputFiles", { backendNodeId: tradeChooser.backendNodeId, files: [photoPath] });
      await waitForExpression(cdp, `window.__heldPhotoPollStarted === true && document.querySelector(".photoUploadButton").textContent === "Cancel scan"`);
      await evaluate(cdp, `document.querySelector(".photoUploadButton").click()`);
      await waitForExpression(cdp, `document.querySelector(".photoUploadButton").textContent === "Use Photos" && document.querySelector(".pasteCapabilityStatus:not(.liveTranscriptPanel)").textContent.includes("cancelled")`);
      await evaluate(cdp, `window.__holdPhotoJob = false`);

      await evaluate(cdp, `(() => {
        const input = document.querySelector("#compareText");
        input.value = "TUR5 ×2, AUS16";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await waitForExpression(cdp, `document.querySelector(".pasteCardStatusPreview [data-paste-card-summary]")?.textContent.includes("duplicate trading cards")`);
      const pasteSummary = await evaluate(cdp, `document.querySelector(".pasteCardStatusPreview [data-paste-card-summary]").textContent`);
      assert.equal(pasteSummary, "1 new for album · 0 new trading cards · 2 duplicate trading cards");
      const pasteRows = await evaluate(cdp, `[...document.querySelectorAll(".pasteCardStatusList li")].map((row) => row.textContent)`);
      assert.deepEqual(pasteRows, [
        "AUS161 new for album",
        "TUR5 ×22 duplicate trading cards",
      ]);

      await send(cdp, "Page.navigate", { url: `http://127.0.0.1:${PORT}/fifa-sticker-app/v2/scanner/` });
      await waitForExpression(cdp, `document.querySelector("#photoScannerBatchInput")`);
      await delay(500);
      await evaluate(cdp, installOcrMockSource());
      const batchRect = await evaluate(cdp, `(() => {
        const rect = document.querySelector("#photoScannerBatchButton").getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })()`);
      const batchChooserPromise = withTimeout(cdp.waitFor("Page.fileChooserOpened"), 2000, "batch photo chooser did not open");
      await clickCenter(cdp, batchRect);
      const batchChooser = await batchChooserPromise;
      assert.equal(batchChooser.mode, "selectMultiple");
      await send(cdp, "DOM.setFileInputFiles", {
        backendNodeId: batchChooser.backendNodeId,
        files: [photoPath, secondPhotoPath],
      });
      await waitForExpression(cdp, `window.__cameraUploadCount === 2`);
      await waitForExpression(cdp, `document.querySelector("#photoScannerResult").value === "TUR5\\nTUR5"`);
      const batchState = await evaluate(cdp, `({
        photoNavigationHidden: document.querySelector("#photoReviewPhotoNav").hidden,
        photoLabel: document.querySelector("#photoReviewPhotoText").textContent,
        openReviewsHidden: document.querySelector("#photoOpenReviews").hidden,
      })`);
      assert.deepEqual(batchState, {
        photoNavigationHidden: false,
        photoLabel: "Photo 1 of 2 · sample.png",
        openReviewsHidden: false,
      });

      const batchReviewsPage = await createPage("about:blank");
      const batchReviewsCdp = await connectCdp(batchReviewsPage.webSocketDebuggerUrl);
      let syncedReviewsPage = null;
      let syncedReviewsCdp = null;
      try {
        await send(batchReviewsCdp, "Runtime.enable");
        await send(batchReviewsCdp, "Page.enable");
        await send(batchReviewsCdp, "Page.addScriptToEvaluateOnNewDocument", {
          source: `sessionStorage.setItem("fifa-v2-controller-reload-build-5d846227af90", "1")`,
        });
        await send(batchReviewsCdp, "Page.navigate", { url: `http://127.0.0.1:${PORT}/fifa-sticker-app/v2/reviews/` });
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoScannerResult")?.value === "TUR5\\nTUR5"`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoReviewPhotoText")?.textContent.includes("Photo 1 of 2")`);

        syncedReviewsPage = await createPage("about:blank");
        syncedReviewsCdp = await connectCdp(syncedReviewsPage.webSocketDebuggerUrl);
        await send(syncedReviewsCdp, "Runtime.enable");
        await send(syncedReviewsCdp, "Page.enable");
        await send(syncedReviewsCdp, "Page.addScriptToEvaluateOnNewDocument", {
          source: `sessionStorage.setItem("fifa-v2-controller-reload-build-5d846227af90", "1")`,
        });
        await send(syncedReviewsCdp, "Page.navigate", { url: `http://127.0.0.1:${PORT}/fifa-sticker-app/v2/reviews/` });
        await waitForExpression(syncedReviewsCdp, `document.querySelector("#photoReviewQueueText")?.textContent.includes("Review 1 of 2")`);
        await evaluate(batchReviewsCdp, installReviewFeedbackMockSource(true));
        await evaluate(syncedReviewsCdp, installReviewFeedbackMockSource(false));

        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoReviewQueueText")?.textContent.includes("Review 1 of 2")`);
        await evaluate(batchReviewsCdp, `document.querySelector('[data-insignia-decision="blue"]').click()`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoReviewPhotoText")?.textContent.includes("Photo 2 of 2")`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoReviewQueueText")?.textContent.includes("Review 2 of 2")`);
        await waitForExpression(syncedReviewsCdp, `document.querySelector("#photoReviewQueueText")?.textContent.includes("Review 2 of 2")`);
        const revisionBeforeIdle = await activeReviewBatchRevision(batchReviewsCdp);
        await delay(400);
        const revisionAfterIdle = await activeReviewBatchRevision(batchReviewsCdp);
        assert.deepEqual(revisionAfterIdle, revisionBeforeIdle, "cross-tab hydration must settle without writing another revision");

        await evaluate(syncedReviewsCdp, `document.querySelector("#photoReviewPreviousPhoto").click()`);
        await waitForExpression(syncedReviewsCdp, `document.querySelector("#photoReviewPhotoText")?.textContent.includes("Photo 1 of 2")`);
        await evaluate(syncedReviewsCdp, `document.querySelector('[data-insignia-decision="green"]').click()`);
        await delay(200);
        const syncedFeedbackUrls = await evaluate(syncedReviewsCdp, `window.__reviewFeedbackUrls`);
        assert.equal(syncedFeedbackUrls.length, 1);
        assert.match(syncedFeedbackUrls[0], /\/api\/back-insignia-review\/labels$/);
        await evaluate(batchReviewsCdp, `window.__releaseHeldReviewFeedback()`);
        await delay(200);
        const firstSlotAfterLateFeedback = await activeReviewSlotState(batchReviewsCdp, 0, 0);
        assert.deepEqual(firstSlotAfterLateFeedback, {
          decision: "green",
          variant: "united_edition",
          decisionRevision: 2,
          feedbackStatus: "sent",
        });
        const staleFeedbackStatus = await evaluate(batchReviewsCdp, `document.querySelector("#photoScannerStatus").textContent`);
        assert.doesNotMatch(staleFeedbackStatus, /saved as Blue/);

        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoReviewPanel")?.getAttribute("aria-busy") === "false"`);
        await evaluate(batchReviewsCdp, `document.querySelector('[data-insignia-decision="skip"]').click()`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoReviewQueue")?.hidden === true`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoCollectionSummary")?.textContent.includes("1 green · 1 colour unknown")`);

        await evaluate(batchReviewsCdp, `document.querySelector("#photoReviewPreviousPhoto").click()`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoReviewPhotoText")?.textContent.includes("Photo 1 of 2")`);
        await evaluate(batchReviewsCdp, `document.querySelector("#photoReviewNextPhoto").click()`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoReviewPhotoText")?.textContent.includes("Photo 2 of 2")`);
        const secondPhoto = await evaluate(batchReviewsCdp, `({
          label: document.querySelector("#photoReviewPhotoText").textContent,
          imageSource: document.querySelector("#photoReviewImage").src,
        })`);
        assert.equal(secondPhoto.label, "Photo 2 of 2 · sample-2.png");
        assert.match(secondPhoto.imageSource, /^blob:/);

        await evaluate(batchReviewsCdp, `document.querySelector("#photoAddCollectionButton").click()`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoScannerStatus").textContent.includes("Added 2 scanned cards")`);
        const addedTransaction = await evaluate(batchReviewsCdp, `(() => {
          const ledger = JSON.parse(localStorage.getItem("panini.tradeTransactions.v1") || "{}");
          const transaction = (ledger.transactions || []).at(-1);
          return { id: transaction?.id || "", received: transaction?.received || [] };
        })()`);
        assert.match(addedTransaction.id, /^scan_review_[a-z0-9]+_[a-f0-9]+_add_1$/);
        assert.deepEqual(addedTransaction.received, [
          { code: "TUR5", quantity: 1, variant: "united_edition" },
          { code: "TUR5", quantity: 1 },
        ]);
        await send(batchReviewsCdp, "Page.reload");
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoScannerResult")?.value === "TUR5\\nTUR5"`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoAddCollectionButton")?.disabled === true`);
        const restoredAdd = await evaluate(batchReviewsCdp, `({
          addLabel: document.querySelector("#photoAddCollectionButton").textContent,
          undoHidden: document.querySelector("#photoUndoCollectionButton").hidden,
        })`);
        assert.deepEqual(restoredAdd, { addLabel: "Added to collection", undoHidden: false });
        await evaluate(batchReviewsCdp, `document.querySelector("#photoUndoCollectionButton").click()`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoScannerStatus").textContent.includes("Scan add undone")`);
        await send(batchReviewsCdp, "Page.reload");
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoScannerResult")?.value === "TUR5\\nTUR5"`);
        await waitForExpression(batchReviewsCdp, `document.querySelector("#photoAddCollectionButton")?.disabled === false`);
        const restoredUndo = await evaluate(batchReviewsCdp, `({
          addLabel: document.querySelector("#photoAddCollectionButton").textContent,
          undoHidden: document.querySelector("#photoUndoCollectionButton").hidden,
        })`);
        assert.deepEqual(restoredUndo, { addLabel: "Add to collection", undoHidden: true });
      } finally {
        syncedReviewsCdp?.close();
        if (syncedReviewsPage) {
          await withTimeout(
            fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${syncedReviewsPage.id}`),
            2000,
            "synced Reviews tab did not close",
          ).catch(() => {});
        }
        batchReviewsCdp.close();
        await withTimeout(
          fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${batchReviewsPage.id}`),
          2000,
          "Reviews tab did not close",
        ).catch(() => {});
      }
    } finally {
      cdp.close();
    }
  } finally {
    server.kill();
    chrome.kill();
    await Promise.allSettled([once(server, "exit"), once(chrome, "exit")]);
    await rm(serverRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function cameraMockSource() {
  return `(() => {
    sessionStorage.setItem("fifa-v2-controller-reload-build-5d846227af90", "1");
    localStorage.setItem("panini.inventorySnapshot.v1", JSON.stringify({
      updated_at: "2026-09-03T00:00:00Z",
      cards: { TUR5: { code: "TUR5", album_count: 1, count: 1 } },
    }));
    localStorage.setItem("panini.inventorySnapshotMeta.v1", JSON.stringify({
      cachedAt: "2026-09-03T00:00:00Z",
      sourceLabel: "browser test",
    }));
    window.__cameraTorch = false;
    window.__cameraTracksStopped = false;
    window.__nativeTakePhotoCalls = 0;
    const track = {
      getCapabilities: () => ({ width: { max: 4096 }, height: { max: 3072 }, torch: true, resizeMode: ["none"] }),
      getSettings: () => ({ width: 1920, height: 1080, facingMode: "environment", torch: window.__cameraTorch }),
      applyConstraints: async (constraints) => {
        const requested = constraints?.advanced?.[0]?.torch;
        if (typeof requested === "boolean") window.__cameraTorch = requested;
      },
      stop: () => { window.__cameraTracksStopped = true; },
    };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1920 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 1080 });
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() { return this.__mockStream || null; },
      set(value) { this.__mockStream = value; },
    });
    HTMLVideoElement.prototype.play = async function () {};
    HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
      get(target, property) {
        if (property === "measureText") return (value) => ({ width: String(value || "").length * 8 });
        if (!(property in target)) target[property] = () => {};
        return target[property];
      },
      set(target, property, value) { target[property] = value; return true; },
    });
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));
      callback(new Blob([bytes], { type: "image/png" }));
    };
    window.ImageCapture = class {
      constructor() {}
      async getPhotoCapabilities() { return { imageWidth: { max: 4032 }, imageHeight: { max: 3024 }, fillLightMode: ["flash"] }; }
      async takePhoto() {
        window.__nativeTakePhotoCalls += 1;
        const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));
        return new Blob([bytes], { type: "image/png" });
      }
    };
  })()`;
}

function installOcrMockSource() {
  return `(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, init) => {
      const photoJobMatch = String(url).match(new RegExp("/api/photo-code-jobs/([0-9a-f]{32})$"));
      if (photoJobMatch && init?.method === "PUT") {
        const file = init.body;
        window.__cameraJobId = photoJobMatch[1];
        window.__cameraUploadCount = (window.__cameraUploadCount || 0) + 1;
        window.__cameraUpload = file ? { name: file.name, type: file.type, size: file.size } : null;
        if (window.__simulateLostUploadAck) {
          window.__simulateLostUploadAck = false;
          window.__recoveryJobId = window.__cameraJobId;
          window.__recoveryGetCount = 0;
          window.__recoveryRequestLog = ["PUT:" + window.__cameraJobId];
          return Promise.reject(new TypeError("simulated lost upload acknowledgement"));
        }
        return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify({ job_id: window.__cameraJobId, status: "queued" }), { status: 202, headers: { "content-type": "application/json" } })), 150));
      }
      if (photoJobMatch && photoJobMatch[1] === window.__recoveryJobId) {
        const method = init?.method || "GET";
        window.__recoveryRequestLog.push(method + ":" + photoJobMatch[1]);
        if (method !== "GET") return Promise.reject(new Error("unexpected recovery method " + method));
        window.__recoveryGetCount += 1;
        if (window.__recoveryGetCount === 1) {
          return Promise.resolve(new Response(JSON.stringify({
            job_id: window.__recoveryJobId,
            status: "running",
          }), { status: 200, headers: { "content-type": "application/json" } }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          job_id: window.__recoveryJobId,
          status: "done",
          result: { codes: ["ENG5"] },
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (photoJobMatch && photoJobMatch[1] === window.__cameraJobId) {
        if (window.__holdPhotoJob) {
          window.__heldPhotoPollStarted = true;
          return new Promise((_resolve, reject) => {
            const abort = () => reject(new DOMException("aborted", "AbortError"));
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        return Promise.resolve(new Response(JSON.stringify({
          job_id: window.__cameraJobId,
          upload_id: window.__cameraJobId,
          status: "done",
          result: {
            codes: ["TUR5"],
            overview_map: {
              slots: [{
                id: "slot-tur5",
                code: "TUR5",
                state: "confirmed",
                review_status: "matched",
                geometry_status: "estimated",
                normalized_polygon: [[0.12, 0.12], [0.42, 0.12], [0.42, 0.52], [0.12, 0.52]],
                normalized_code_anchor_box: [[0.32, 0.14], [0.39, 0.14], [0.39, 0.18], [0.32, 0.18]],
                back_insignia_type: "no_clue",
              }],
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return originalFetch(url, init);
    };
    window.PANINI_CONFIG.recognitionBaseUrl = "https://ocr.test";
  })()`;
}

function installReviewFeedbackMockSource(holdFirst) {
  return `(() => {
    const originalFetch = window.fetch.bind(window);
    let requestCount = 0;
    let releaseHeld = null;
    window.__reviewFeedbackUrls = [];
    window.__releaseHeldReviewFeedback = () => releaseHeld?.();
    window.fetch = (url, init) => {
      if (String(url).endsWith("/api/back-insignia-review/labels") && init?.method === "POST") {
        window.__reviewFeedbackUrls.push(String(url));
        requestCount += 1;
        if (${holdFirst} && requestCount === 1) {
          return new Promise((resolve) => {
            releaseHeld = () => resolve(new Response(JSON.stringify({ saved: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }));
          });
        }
        return Promise.resolve(new Response(JSON.stringify({ saved: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      return originalFetch(url, init);
    };
  })()`;
}

async function createPage(url) {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not create Chrome page: ${response.status}`);
  return response.json();
}

async function waitForHttp(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const waiters = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
      return;
    }
    const listeners = waiters.get(message.method) || [];
    for (const listener of listeners.splice(0)) listener(message.params || {});
  });
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    waitFor(method) {
      return new Promise((resolve) => {
        const listeners = waiters.get(method) || [];
        listeners.push(resolve);
        waiters.set(method, listeners);
      });
    },
  };
}

function send(cdp, method, params) { return cdp.send(method, params); }

async function evaluate(cdp, expression) {
  const result = await send(cdp, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function activeReviewBatchRevision(cdp) {
  return evaluate(cdp, `(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("panini-photo-review-queue", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const active = await new Promise((resolve, reject) => {
        const request = database.transaction("active_review_batches", "readonly")
          .objectStore("active_review_batches").get(localStorage.getItem("panini.cloudSync.activeProfileId.v1") || localStorage.getItem("panini.v2.activeProfileId") || "");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const batch = await new Promise((resolve, reject) => {
        const request = database.transaction("review_batches", "readonly")
          .objectStore("review_batches").get(active?.batchId || "");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return { id: batch?.id || "", revision: Number(batch?.revision || 0) };
    } finally {
      database.close();
    }
  })()`);
}

async function activeReviewSlotState(cdp, photoIndex, slotIndex) {
  return evaluate(cdp, `(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("panini-photo-review-queue", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const active = await new Promise((resolve, reject) => {
        const request = database.transaction("active_review_batches", "readonly")
          .objectStore("active_review_batches").get(localStorage.getItem("panini.cloudSync.activeProfileId.v1") || localStorage.getItem("panini.v2.activeProfileId") || "");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const photos = await new Promise((resolve, reject) => {
        const request = database.transaction("review_photos", "readonly")
          .objectStore("review_photos").index("batchId").getAll(active?.batchId || "");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const slot = photos.sort((left, right) => left.index - right.index)[${photoIndex}]?.slots?.[${slotIndex}];
      return {
        decision: slot?.insignia_review_status || "",
        variant: slot?.back_insignia_type || "",
        decisionRevision: Number(slot?.insignia_decision_revision || 0),
        feedbackStatus: slot?.insignia_feedback_status || "",
      };
    } finally {
      database.close();
    }
  })()`);
}

async function waitForExpression(cdp, expression) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(cdp, expression)) return;
    await delay(50);
  }
  const debug = await evaluate(cdp, `({
    cameraStatus: document.querySelector(".cameraCaptureStatus")?.textContent || "",
    scannerStatus: document.querySelector("#photoScannerStatus")?.textContent || "",
    result: document.querySelector("#photoScannerResult")?.value || "",
    upload: window.__cameraUpload || null,
    uploadCount: window.__cameraUploadCount || 0,
    photoButton: document.querySelector(".photoUploadButton")?.textContent || "",
    capabilityStatus: document.querySelector(".pasteCapabilityStatus:not(.liveTranscriptPanel)")?.textContent || "",
    capabilityBusy: document.querySelector(".pasteCapabilityStatus:not(.liveTranscriptPanel)")?.getAttribute("aria-busy") || "",
    heldPollStarted: window.__heldPhotoPollStarted || false,
    href: location.href,
  })`);
  throw new Error(`Timed out waiting for ${expression}. State: ${JSON.stringify(debug)}`);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function clickCenter(cdp, rect) {
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  await send(cdp, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send(cdp, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
