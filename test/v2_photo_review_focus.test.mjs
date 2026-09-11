import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("uncertain review enters a visible focused-card mode with zoom and overview controls", () => {
  const html = readFileSync("v2/scanner/index.html", "utf8");
  const js = readFileSync("v2/assets/photo_scanner.js", "utf8");
  const css = readFileSync("v2/assets/styles.css", "utf8");

  assert.match(html, /id="photoReviewToolbar"[^>]*hidden/);
  assert.match(html, /id="photoReviewZoomOut"[^>]*aria-label="Zoom out"[^>]*>−</);
  assert.match(html, /id="photoReviewZoomIn"[^>]*aria-label="Zoom in"[^>]*>\+</);
  assert.match(html, /id="photoReviewOverview"[^>]*>Overview</);

  assert.match(js, /photoReviewView = \{ focused: false, zoomFactor: 1 \}/);
  assert.match(js, /photoReviewView = \{ focused: true, zoomFactor: 1 \}/);
  assert.match(js, /reviewNextButton\.textContent = photoReviewView\.focused \? "Next uncertain" : "Review uncertain"/);
  assert.match(js, /`Reviewing \$\{focusedIndex \+ 1\} of \$\{reviewSlots\.length\} · \$\{focused\.code/);
  assert.match(js, /reviewToolbar\.hidden = !focused/);
  assert.match(js, /reviewStage\?\.scrollIntoView/);
  assert.match(js, /function adjustReviewZoom\(multiplier\)/);
  assert.match(js, /function showReviewOverview\(\)/);

  assert.match(css, /\.photoReviewStage\.isFocused/);
  assert.match(css, /\.photoReviewToolbar\s*\{/);
  assert.match(css, /\.photoReviewToolbar button\s*\{[\s\S]*?min-height:\s*44px/);
});
