import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../v2/assets/photo_scanner.js", import.meta.url), "utf8");
const backendSource = readFileSync(new URL("../v2/assets/ocr_backend.js", import.meta.url), "utf8");
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
  assert.match(body, /Official Licensed/);
  assert.match(body, /Green/);
  assert.match(body, /United Edition/);
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
  assert.match(html, /id="photoScannerInput" type="file" accept="image\/\*" hidden/);
  assert.doesNotMatch(html, /id="photoScannerInput"[^>]*multiple/);
  assert.match(html, /id="photoScannerBatchInput" type="file" accept="image\/\*" multiple hidden/);
  assert.match(html, /id="photoScannerButton"[^>]*>Choose photo<\/button>/);
  assert.match(html, /id="photoScannerBatchButton"[^>]*>Select several<\/button>/);
  assert.match(source, /picker\?\.addEventListener\("input", scanSelectedPhotos\)/);
  assert.match(source, /picker\?\.addEventListener\("change", scanSelectedPhotos\)/);
  assert.match(functionBody("scanSelectedPhotos"), /event\?\.currentTarget \|\| input/);
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
