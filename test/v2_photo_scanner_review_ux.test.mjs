import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../v2/assets/photo_scanner.js", import.meta.url), "utf8");
const backendSource = readFileSync(new URL("../v2/assets/ocr_backend.js", import.meta.url), "utf8");
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
  assert.match(body, /!slot\.code \|\| slot\.needs_user_help \|\| \(hasNoSourceLocation && !slot\.saved_review\) \|\| slotStatus\(slot\) !== "matched"/);
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
  assert.match(functionBody("renderReviewSummary"), /pendingReviewItems/);
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
  assert.match(html, /id="photoScannerCancelButton"[^>]*hidden[^>]*>Cancel scan<\/button>/);
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

test("both V2 photo entry points expose cancellation and share one signal across create and poll", () => {
  assert.match(source, /activePhotoScanController = new AbortController\(\)/);
  assert.match(source, /activePhotoScanController\?\.abort\(\)/);
  assert.ok((source.match(/signal,/g) || []).length >= 2);
  assert.match(html, /id="photoScannerCancelButton"[^>]*>Cancel scan<\/button>/);

  assert.match(tradePasteSource, /photoScanController = new AbortController\(\)/);
  assert.match(tradePasteSource, /photoScanController\?\.abort\(\)/);
  assert.ok((tradePasteSource.match(/signal: options\.signal/g) || []).length >= 2);
  assert.match(tradePasteSource, /button\.textContent = "Cancel scan"/);
});

test("overview labels scale to and stay clipped inside each detected card", () => {
  const metrics = functionBody("reviewLabelMetrics");
  const draw = functionBody("drawReviewSlot");
  assert.match(metrics, /maxWidth = bounds\.width \* 0\.86/);
  assert.match(metrics, /maxHeight = bounds\.height \* 0\.24/);
  assert.match(metrics, /maxWidth \/ characterWidth/);
  assert.match(metrics, /focused \? 18 : 13/);
  assert.match(metrics, /paddingY = Math\.max\(2, fontSize \* 0\.18\)/);
  assert.match(metrics, /backgroundHeight: Math\.min\(bounds\.height \* 0\.46, textHeight \+ paddingY \* 2\)/);
  assert.match(draw, /reviewCtx\.clip\(\)/);
  assert.match(draw, /Math\.min\(labelMetrics\.maxWidth, Math\.max\(primaryWidth, secondaryWidth\) \+ labelMetrics\.paddingX \* 2\)/);
  assert.match(draw, /center\[1\] - labelMetrics\.backgroundHeight \/ 2/);
  assert.match(draw, /fillText\(primary, center\[0\], primaryY, labelMetrics\.maxTextWidth\)/);
  assert.doesNotMatch(draw, /fillRect\(center\[0\] - 48/);
});

test("back-card outlines distinguish insignia variants and explain every review color", () => {
  const appearance = functionBody("reviewSlotAppearance");
  assert.match(appearance, /statusValue !== "matched"[^\n]*#ffb000[^\n]*dashed: true/);
  assert.match(appearance, /geometry_status === "estimated"[\s\S]*#ff5cf4/);
  assert.match(appearance, /SCAN_INSIGNIA_VARIANTS\.blue[\s\S]*#3fa9ff/);
  assert.match(appearance, /SCAN_INSIGNIA_VARIANTS\.green[\s\S]*#35d07f/);
  assert.match(functionBody("drawReviewSlot"), /reviewSlotAppearance\(slot, statusValue\)/);
  assert.match(html, /aria-label="Card outline legend"/);
  assert.match(html, /<strong>Blue<\/strong> Rest of the World Edition/);
  assert.match(html, /<strong>Green<\/strong> Swiss Edition/);
  assert.match(html, /<strong>Magenta dash-dot<\/strong> Code accepted; card outline estimated/);
  assert.match(html, /<strong>Amber dashed<\/strong> Needs review/);
  assert.doesNotMatch(html, /<strong>Red<\/strong>/);
  assert.match(styles, /\.photoReviewLegendSwatch\.isBlue/);
  assert.match(styles, /\.photoReviewLegendSwatch\.isEstimated/);
  assert.match(styles, /\.photoReviewLegendSwatch\.isReview/);
  assert.match(html, /class="estimatedSwatchStroke"/);
  assert.match(styles, /stroke-dasharray: 6 2 1 2/);
});

test("estimated card geometry renders a locally calibrated full outline with its code", () => {
  const polygon = functionBody("reviewSlotPolygon");
  assert.match(polygon, /geometry_status === "estimated" && card\.length >= 4/);
  assert.match(polygon, /isPlausibleEstimatedReviewPolygon\(card, anchor\)/);
  assert.match(polygon, /calibrateEstimatedReviewPolygon\(card, photoReviewState\.slots\)/);
  assert.match(polygon, /slot\.geometry_status !== "resolved" && anchor\.length >= 4/);
  assert.match(functionBody("reviewImageRect"), /reviewSlotPolygon\(slot\)/);
  assert.match(functionBody("drawReviewSlot"), /reviewSlotPolygon\(slot\)/);
  assert.match(functionBody("selectReviewSlotAtEvent"), /reviewSlotPolygon\(slot\)/);
  assert.match(functionBody("geometryLabel"), /code accepted; card outline estimated/);

  const calibrate = new Function("card", "slots", functionBody("calibrateEstimatedReviewPolygon"));
  const card = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5], [0.1, 0.5]];
  const resolved = [
    { geometry_status: "resolved", normalized_polygon: [[0.5, 0.1], [0.8, 0.1], [0.8, 0.5], [0.5, 0.5]] },
    { geometry_status: "resolved", normalized_polygon: [[0.5, 0.52], [0.8, 0.52], [0.8, 0.92], [0.5, 0.92]] },
  ];
  assert.deepEqual(calibrate(card, resolved), card);
  const small = [[0.15, 0.2], [0.3, 0.2], [0.3, 0.4], [0.15, 0.4]];
  const calibrated = calibrate(small, resolved);
  assert.ok(calibrated[1][0] - calibrated[0][0] > 0.25);
  assert.ok(calibrated[2][1] - calibrated[1][1] > 0.34);

  const plausible = new Function("card", "anchor", functionBody("isPlausibleEstimatedReviewPolygon"));
  const anchor = [[0.32, 0.12], [0.38, 0.12], [0.38, 0.15], [0.32, 0.15]];
  assert.equal(plausible(card, anchor), true);
  assert.equal(plausible(anchor, anchor), false);
  assert.equal(plausible([[0.1, 0.1], [0.4, 0.5], [0.4, 0.1], [0.1, 0.5]], anchor), false);
  assert.equal(plausible([[-0.2, 0.1], [0.4, 0.1], [0.4, 0.5], [-0.2, 0.5]], anchor), false);
  assert.equal(plausible([[0.1, 0.1], [0.1, 0.1], [0.4, 0.5], [0.1, 0.5]], anchor), false);

  const appearance = new Function("slot", "statusValue", functionBody("reviewSlotAppearance"));
  assert.deepEqual(appearance({ geometry_status: "estimated" }, "matched"), {
    color: "#ff5cf4",
    fillAlpha: 0.06,
    dashed: true,
    dashPattern: [10, 4, 2, 4],
    keylineColor: "rgba(0, 0, 0, 0.78)",
    lineWidth: 3,
  });
  const label = new Function("value", functionBody("geometryLabel"));
  assert.equal(label("estimated"), "code accepted; card outline estimated");
});

test("estimated outlines use a dark keyline and dash-dot stroke before drawing the card code", () => {
  const draw = functionBody("drawReviewSlot");
  assert.match(draw, /appearance\.keylineColor/);
  assert.match(draw, /reviewCtx\.setLineDash\(dashPattern\)/);
  assert.match(draw, /reviewSlotLabel\(slot, statusValue\)/);
  assert.match(draw, /fillText\(primary/);
  assert.match(draw, /fillText\(secondary/);
  const label = new Function("slot", "statusValue", functionBody("reviewSlotLabel"));
  assert.deepEqual(label({ code: "CAN14", name: "Alphonso Davies" }, "matched"), {
    primary: "CAN14",
    secondary: "Alphonso Davies",
  });
  assert.deepEqual(label({ code: "CAN14" }, "matched"), { primary: "CAN14", secondary: "" });
  assert.deepEqual(label({ code: "", name: "" }, "review"), { primary: "Review", secondary: "" });
});

test("estimated geometry stays magenta when only the insignia needs review", () => {
  const draw = functionBody("drawReviewSlot");
  assert.match(draw, /codeReviewRequired \|\| \(insigniaReviewRequired && slot\.geometry_status !== "estimated"\)/);
  assert.match(draw, /insigniaReviewRequired && !codeReviewRequired && slot\.geometry_status === "estimated"/);
  assert.match(draw, /drawReviewAttentionBadge\(points\)/);
  assert.match(draw, /reviewCtx\.save\(\)[\s\S]*reviewCtx\.clip\(\)[\s\S]*reviewCtx\.restore\(\)/);
  const badgeCenter = new Function("points", functionBody("reviewAttentionBadgeCenter"));
  assert.deepEqual(badgeCenter([[50, 0], [100, 50], [50, 100], [0, 50]]), [50, 22.5]);
});

test("catalogue projection loads before review slots are normalized", () => {
  const scan = functionBody("scanPhotos");
  assert.ok(scan.indexOf("await refreshScannerCollectionProjection()") < scan.indexOf("reviewSlotsForPayload(resultPayload)"));
  assert.match(functionBody("normalizeReviewSlots"), /reviewSlotCatalogName\(slot\.code\)/);
});

test("recognized cards without card geometry remain selectable for review", () => {
  const normalize = functionBody("normalizeReviewSlots");
  const append = functionBody("appendUnplacedPayloadCodes");
  const render = functionBody("renderUnplacedReviewSlots");
  assert.match(normalize, /normalized_back_insignia_box: normalizeBackInsigniaBox\(slot\)/);
  assert.match(normalize, /slot\.code \|\| slot\.name/);
  assert.doesNotMatch(normalize, /\(slot\.normalized_polygon\?\.length \|\| slot\.normalized_code_anchor_box\?\.length\) >= 4/);
  assert.match(append, /geometry_status: "unavailable"/);
  assert.match(append, /reviewSlotCatalogCard\(code\)/);
  assert.match(render, /reviewSlotPolygon\(slot\)\.length < 4/);
  assert.match(render, /Tap a card to confirm or correct it/);
  assert.match(render, /photoReviewState\.selectedSlotId = slot\.id/);
  assert.match(functionBody("persistReviewLabel"), /normalized_back_insignia_box/);
  assert.match(html, /id="photoReviewUnplaced"/);
  assert.match(styles, /\.photoReviewUnplacedCard/);
});

test("an insignia location anchors a readable clickable label when card geometry is absent", () => {
  const polygon = functionBody("reviewSlotPolygon");
  assert.match(polygon, /normalized_back_insignia_box/);
  assert.match(polygon, /expandReviewAnchorPolygon\(insignia\)/);
  const expand = new Function("anchor", functionBody("expandReviewAnchorPolygon"));
  const expanded = expand([[0.49, 0.49], [0.51, 0.49], [0.51, 0.51], [0.49, 0.51]]);
  assert.ok(expanded[1][0] - expanded[0][0] >= 0.14);
  assert.ok(expanded[2][1] - expanded[1][1] > 0.069);
  assert.equal(expand([]).length, 0);
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
