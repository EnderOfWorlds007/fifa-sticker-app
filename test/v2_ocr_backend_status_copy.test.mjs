import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scanner = readFileSync("v2/assets/photo_scanner.js", "utf8");
const reviews = readFileSync("v2/reviews/index.html", "utf8");

test("OCR backend status distinguishes connectivity from saved authentication", () => {
  assert.match(scanner, /OCR backend connected\. No token is needed\./);
  assert.match(scanner, /OCR backend connected\. A token is saved on this phone\./);
  assert.match(scanner, /Enter the laptop OCR token below, then tap Save backend\./);
  assert.doesNotMatch(scanner, /Backend ready:.*token required/);
});

test("Reviews exposes the shared OCR backend token without embedding a secret", () => {
  assert.match(reviews, /<summary>OCR connection<\/summary>/);
  assert.match(reviews, /Shared with Scan on this browser/);
  assert.match(reviews, /data-ocr-backend-url/);
  assert.match(reviews, /data-ocr-backend-token type="password"/);
  assert.match(reviews, /data-ocr-backend-save/);
  assert.match(reviews, /data-ocr-backend-test/);
  assert.match(reviews, /data-ocr-backend-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.doesNotMatch(reviews, /data-ocr-backend-token[^>]*\svalue=/);
});
