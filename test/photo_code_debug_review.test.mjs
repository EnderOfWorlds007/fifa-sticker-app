import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("photo code debug reviewer runs from v2 pages and reuses scanner OCR auth", async () => {
  const html = await readFile(new URL("../v2/photo-code-debug-review/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../v2/assets/photo_code_debug_review.js", import.meta.url), "utf8");
  const apps = await readFile(new URL("../v2/apps/index.html", import.meta.url), "utf8");
  const sw = await readFile(new URL("../v2/sw.js", import.meta.url), "utf8");

  assert.match(html, /\/fifa-sticker-app\/v2\/assets\/site_config\.js/);
  assert.match(html, /\/fifa-sticker-app\/v2\/assets\/photo_code_debug_review\.js/);
  assert.doesNotMatch(html, /src="\/assets\/photo_code_debug_review\.js/);
  assert.doesNotMatch(html, /OCR bearer token/);

  assert.match(apps, /\/fifa-sticker-app\/v2\/photo-code-debug-review\//);
  assert.match(apps, /Photo Code Deep Dive/);

  assert.match(js, /from "\/fifa-sticker-app\/v2\/assets\/ocr_backend\.js/);
  assert.match(js, /ocrToken\(\)/);
  assert.match(js, /recognitionUrl\(url\)/);
  assert.match(js, /headers\.set\("Authorization", `Bearer \$\{activeToken\}`\)/);
  assert.match(js, /const SNAPSHOTS =/);
  assert.match(js, /01 Big Photo/);
  assert.match(js, /02 Card Zone/);
  assert.match(js, /03 Pill And OCR/);
  assert.match(js, /04 Orientation \/ Anchors/);
  assert.match(js, /function drawSnapshots\(slot\)/);
  assert.match(js, /normalized_code_text_box/);
  assert.doesNotMatch(js, /const OCR_TOKEN_KEY =/);

  assert.match(sw, /fifa-card-apps-fifa-sticker-app-v2-build-photo-debug-2/);
  assert.match(sw, /\/fifa-sticker-app\/v2\/photo-code-debug-review\//);
  assert.match(sw, /\/fifa-sticker-app\/v2\/assets\/photo_code_debug_review\.js/);
});
