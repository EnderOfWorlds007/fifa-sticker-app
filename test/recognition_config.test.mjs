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

test("configured Laptop OCR failure does not silently fall back to Railway", async () => {
  const { recognizePhotoCodes } = await loadRecognitionConfig();
  const storage = new Map([
    ["panini.localOcrUrl.v1", "https://laptop.test"],
    ["panini.localOcrToken.v1", "token"],
  ]);
  const calls = [];
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = {
    PANINI_CONFIG: {
      photoOcrSide: "back",
      recognitionBackends: [{ label: "Railway OCR", url: "https://railway.test" }],
    },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout,
    clearTimeout,
  };
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error("Failed to fetch");
  };

  try {
    await assert.rejects(
      () => recognizePhotoCodes(new File(["image"], "cards.jpg", { type: "image/jpeg" })),
      (error) => {
        assert.deepEqual(error.details, ["Laptop OCR: Failed to fetch"]);
        return true;
      },
    );
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }

  assert.deepEqual(calls, ["https://laptop.test/readyz"]);
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
