import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("browser OCR text is normalized to card codes", async () => {
  const { codesPayloadFromText } = await loadPhotoOcrModule();

  const payload = codesPayloadFromText("So I have Algeria won Algeria to Egypt five France 13");

  assert.deepEqual(payload.codes, ["ALG1", "ALG2", "EGY5", "FRA13"]);
  assert.equal(payload.grouped_text, "ALG1\nALG2\nEGY5\nFRA13");
  assert.equal(payload.source, "browser-ocr");
});

async function loadPhotoOcrModule() {
  const sourceRoot = new URL("../assets/", import.meta.url);
  const dir = await mkdtemp(join(tmpdir(), "photo-ocr-module-"));
  const files = ["card_parser.js", "recognition_config.js", "photo_ocr.js"];
  for (const file of files) {
    let source = await readFile(new URL(file, sourceRoot), "utf8");
    source = source
      .replaceAll("./card_parser.js?v=voice-lang-1", "./card_parser.mjs")
      .replaceAll("./recognition_config.js?v=stable-ocr-1", "./recognition_config.mjs");
    await writeFile(join(dir, file.replace(".js", ".mjs")), source);
  }
  try {
    return await import(pathToFileURL(join(dir, "photo_ocr.mjs")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
