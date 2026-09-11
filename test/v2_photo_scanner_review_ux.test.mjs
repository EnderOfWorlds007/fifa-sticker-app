import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../v2/assets/photo_scanner.js", import.meta.url), "utf8");
const backendSource = readFileSync(new URL("../v2/assets/ocr_backend.js", import.meta.url), "utf8");
const reporterSource = readFileSync(new URL("../v2/assets/client_error_reports.js", import.meta.url), "utf8");
const tradePasteSource = readFileSync(new URL("../v2/assets/trade_paste_box.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../v2/scanner/index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../v2/assets/styles.css", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const bodyStart = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`${name} body closes`);
}

test("code review follows backend uncertainty instead of an arbitrary 90 percent cutoff", () => {
  const body = functionBody("slotNeedsCodeReview");
  assert.match(body, /!slot\.code \|\| slot\.needs_user_help \|\| slotStatus\(slot\) !== "matched"/);
  assert.doesNotMatch(body, /0\.90|confidence/);
});

test("back insignia has an independent human decision with explicit meanings", () => {
  const body = functionBody("insigniaDecisionSection");
  assert.match(body, /Blue/);
  assert.match(body, /Rest of the World Edition/);
  assert.match(body, /Green/);
  assert.match(body, /Swiss Edition/);
  assert.match(body, /Can’t tell/);
  assert.match(styles, /\.insigniaDecisionButtons/);
});

test("insignia decisions update collection state and retained OCR feedback independently", () => {
  const chooseBody = functionBody("chooseInsignia");
  assert.match(chooseBody, /slot\.back_insignia_type = option\.variant/);
  assert.match(chooseBody, /slot\.insignia_review_status = option\.decision/);
  assert.match(chooseBody, /persistInsigniaReviewLabel/);
  assert.match(functionBody("persistInsigniaReviewLabel"), /predicted_type: slot\.original_back_insignia_type/);
  assert.match(backendSource, /BACK_INSIGNIA_REVIEW_LABELS_PATH/);
  assert.match(backendSource, /export async function saveBackInsigniaReviewLabel/);
});

test("review summary and controls describe code and card-back work separately", () => {
  assert.match(functionBody("renderReviewSummary"), /codes matched/);
  assert.match(functionBody("renderReviewSummary"), /reviewQueueSummary/);
  assert.match(functionBody("renderReviewQueue"), /Review backs/);
  assert.match(html, /Confirm shown codes/);
  assert.doesNotMatch(html, />All correct</);
  assert.match(functionBody("reviewQueueSummary"), /need review/);
  assert.match(functionBody("reviewQueueSummary"), /review complete/);
  assert.match(html, /id="photoReviewFinish"/);
  assert.match(functionBody("finishReviewForNow"), /Unresolved backs will be saved as colour unknown/);
});

test("front scans do not ask users to classify an unseen back", () => {
  assert.match(functionBody("slotNeedsInsigniaReview"), /if \(!isBackScanSlot\(slot\)\) return false/);
  assert.match(functionBody("renderInspector"), /if \(isBackScanSlot\(slot\)\) reviewInspector\.append\(insigniaDecisionSection\(slot\)\)/);
});

test("iPhone gets a reliable single-photo picker without losing batch selection", () => {
  assert.match(html, /id="photoScannerInput" class="photoPickerNativeInput" type="file" accept="image\/\*"/);
  assert.doesNotMatch(html, /id="photoScannerInput"[^>]*multiple/);
  assert.match(html, /id="photoScannerBatchInput" class="photoPickerNativeInput" type="file" accept="image\/\*" multiple/);
  assert.match(html, /id="photoScannerButton"[^>]*>Choose photo<\/button>/);
  assert.match(html, /id="photoScannerBatchButton"[^>]*>Select several<\/button>/);
  assert.match(styles, /\.photoPickerNativeInput[\s\S]*position: absolute[\s\S]*inset: 0[\s\S]*opacity: 0/);
  assert.doesNotMatch(source, /scanButton\?\.addEventListener\("click"/);
  assert.match(source, /picker\?\.addEventListener\("input", scanSelectedPhotos\)/);
  assert.match(source, /picker\?\.addEventListener\("change", scanSelectedPhotos\)/);
  assert.match(functionBody("scanSelectedPhotos"), /event\?\.currentTarget \|\| input/);
  assert.match(functionBody("scanSelectedPhotos"), /await allowNativePickerToDismiss\(\)/);
  assert.doesNotMatch(functionBody("scanPhotos"), /input\.disabled|batchInput\.disabled/);
  assert.match(functionBody("scanPhotos"), /setPhotoPickersBusy\(true\)/);
  assert.match(styles, /\.photoPickerControl\.isBusy[\s\S]*pointer-events: none/);
});

test("overview labels scale to and stay clipped inside each detected card", () => {
  const metrics = functionBody("reviewLabelMetrics");
  const draw = functionBody("drawReviewSlot");
  assert.match(metrics, /maxWidth = bounds\.width \* 0\.86/);
  assert.match(metrics, /maxHeight = bounds\.height \* 0\.24/);
  assert.match(metrics, /maxWidth \/ characterWidth/);
  assert.match(metrics, /focused \? 18 : 13/);
  assert.match(draw, /reviewCtx\.clip\(\)/);
  assert.match(draw, /Math\.min\(labelMetrics\.maxWidth, measuredWidth \+ labelMetrics\.paddingX \* 2\)/);
  assert.match(draw, /fillText\(label, center\[0\], center\[1\], labelMetrics\.maxTextWidth\)/);
  assert.doesNotMatch(draw, /fillRect\(center\[0\] - 48/);
});

test("back-card outlines distinguish insignia variants and explain every review color", () => {
  const appearance = functionBody("reviewSlotAppearance");
  assert.match(appearance, /statusValue !== "matched"[^\n]*#ffb000[^\n]*dashed: true/);
  assert.match(appearance, /SCAN_INSIGNIA_VARIANTS\.blue[\s\S]*#3fa9ff/);
  assert.match(appearance, /SCAN_INSIGNIA_VARIANTS\.green[\s\S]*#35d07f/);
  assert.match(functionBody("drawReviewSlot"), /reviewSlotAppearance\(slot, statusValue\)/);
  assert.match(html, /aria-label="Card outline legend"/);
  assert.match(html, /<strong>Blue<\/strong> Rest of the World Edition/);
  assert.match(html, /<strong>Green<\/strong> Swiss Edition/);
  assert.match(html, /<strong>Amber dashed<\/strong> Needs review/);
  assert.doesNotMatch(html, /<strong>Red<\/strong>/);
  assert.match(styles, /\.photoReviewLegendSwatch\.isBlue/);
  assert.match(styles, /\.photoReviewLegendSwatch\.isReview/);
});

test("recognized scan results are grouped into compact rows with edition colours", () => {
  const render = functionBody("renderRecognizedCodeRows");
  const row = functionBody("compactCodeRow");
  assert.match(render, /groupScannedCardStatuses\(latestScanStatuses\)/);
  assert.match(render, /scanInsigniasByCode\(currentScanReceivedLines\(\)\)/);
  assert.match(row, /compactScannedCardGroupDetail\(group\)/);
  assert.match(row, /appendEditionBarSegment\(editionBar, "blue"/);
  assert.match(row, /appendEditionBarSegment\(editionBar, "green"/);
  assert.match(row, /appendEditionMarker\(editions, "blue"/);
  assert.match(row, /appendEditionMarker\(editions, "green"/);
  assert.match(styles, /#photoScannerCodes[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.compactScanEdition\.is-blue/);
  assert.match(styles, /\.compactScanEdition\.is-green/);
  assert.match(styles, /\.compactScanEditionBar \.is-blue[\s\S]*#3fa9ff/);
  assert.match(styles, /\.compactScanEditionBar \.is-green[\s\S]*#35d07f/);
  assert.match(styles, /\.compactScanEditionBar \.is-unknown[\s\S]*#7d8a94/);
  assert.doesNotMatch(row, /dominantScannedCardStatus/);
});

test("all photo OCR entry points retain sanitized diagnostic references", () => {
  assert.match(source, /await recordClientError\(error, \{ operationId \}/);
  assert.match(source, /diagnosticReference\(error, recorded\.queued \? recorded\.report : null\)/);
  assert.match(source, /waitForPhotoCodeJob\(job,/);
  assert.match(tradePasteSource, /await recordClientError\(error, \{ operationId \}/);
  assert.match(tradePasteSource, /waitForPhotoCodeJob\(job,/);
  assert.match(backendSource, /flushPendingClientErrorReports/);
  assert.match(backendSource, /addEventListener\?\.\("online"/);
  assert.match(reporterSource, /const DEAD_LETTER_STORE_NAME = "rejected_reports"/);
  assert.doesNotMatch(reporterSource, /error\.message|error\.stack/);
});
