import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scanner = readFileSync("v2/assets/photo_scanner.js", "utf8");

test("OCR backend status distinguishes connectivity from saved authentication", () => {
  assert.match(scanner, /OCR backend connected\. No token is needed\./);
  assert.match(scanner, /OCR backend connected\. A token is saved on this phone\./);
  assert.match(scanner, /Enter the laptop OCR token below, then tap Save backend\./);
  assert.doesNotMatch(scanner, /Backend ready:.*token required/);
});
