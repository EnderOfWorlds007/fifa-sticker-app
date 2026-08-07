import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const screens = [
  ["trade-lookup/index.html", "lookupPhotoButton", "lookupPhotoInput", "lookupVoiceButton"],
  ["need-lookup/index.html", "needPhotoButton", "needPhotoInput", "needVoiceButton"],
  ["collection/index.html", "collectionPhotoButton", "collectionPhotoInput", "collectionVoiceButton"],
];

test("media input controls use real buttons with matching first-row controls", () => {
  for (const [path, photoButtonId, photoInputId, voiceButtonId] of screens) {
    const html = readFileSync(path, "utf8");
    assert.match(html, new RegExp(`<button id="${photoButtonId}" class="photoUploadButton" type="button">Use Photos</button>`), path);
    assert.match(html, new RegExp(`<input id="${photoInputId}" class="visuallyHiddenInput" type="file" accept="image/\\*" multiple>`), path);
    assert.match(html, new RegExp(`<button id="${voiceButtonId}" class="voiceInputButton" type="button"`), path);
  }
});

test("service worker does not app-shell-cache OCR backend config", () => {
  const sw = readFileSync("sw.js", "utf8");
  const appShell = sw.match(/APP_SHELL = \[([\s\S]*?)\];/)?.[1] || "";

  assert.match(sw, /assets\/recognition_config\.js/);
  assert.doesNotMatch(appShell, /assets\/site_config\.js/);
  assert.match(sw, /assets\/site_config\.js"\) \{\n\s*event\.respondWith\(networkFirst\(request\)\)/);
});

test("production config does not hard-code quick tunnels", () => {
  const config = readFileSync("assets/site_config.js", "utf8");

  assert.doesNotMatch(config, /trycloudflare\.com/);
});
