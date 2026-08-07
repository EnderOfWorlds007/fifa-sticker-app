import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("normalizes stable OCR backend URLs", async () => {
  const { normalizeRecognitionBaseUrl } = await loadRecognitionConfig();
  assert.equal(
    normalizeRecognitionBaseUrl(" https://cards.example.com/api/status?x=1#top "),
    "https://cards.example.com",
  );
  assert.equal(normalizeRecognitionBaseUrl("https://cards.example.com/"), "https://cards.example.com");
  assert.equal(normalizeRecognitionBaseUrl("ftp://cards.example.com"), "");
  assert.equal(normalizeRecognitionBaseUrl("not a url"), "");
  assert.equal(normalizeRecognitionBaseUrl(""), "");
});

async function loadRecognitionConfig() {
  const source = await readFile(new URL("../assets/recognition_config.js", import.meta.url), "utf8");
  const dir = await mkdtemp(join(tmpdir(), "recognition-config-"));
  const modulePath = join(dir, "recognition_config.mjs");
  await writeFile(modulePath, source);
  try {
    return await import(pathToFileURL(modulePath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
