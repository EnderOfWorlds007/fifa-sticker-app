import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadOcrBackend() {
  globalThis.window = {
    PANINI_CONFIG: { recognitionBaseUrl: "https://scanner.test" },
    location: { href: "https://app.test/scanner/", protocol: "https:" },
  };
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  globalThis.document = { cookie: "" };
  const source = await readFile(new URL("../v2/assets/ocr_backend.js", import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`);
}

test("photo jobs keep polling beyond the former 90-second client cutoff", async () => {
  const { waitForPhotoCodeJob } = await loadOcrBackend();
  let polls = 0;
  const statuses = [];
  globalThis.fetch = async () => {
    polls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => polls > 95
        ? { status: "done", result: { codes: ["ESP4"] } }
        : { status: polls === 1 ? "queued" : "running" },
    };
  };

  const payload = await waitForPhotoCodeJob("slow-job", {
    pollIntervalMs: 0,
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(polls, 96);
  assert.deepEqual(payload.result.codes, ["ESP4"]);
  assert.equal(statuses[0], "Waiting for recognizer...");
  assert.equal(statuses.at(-1), "Recognizing photo...");
});

test("photo jobs surface backend failures", async () => {
  const { waitForPhotoCodeJob } = await loadOcrBackend();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "error", error: "Recognizer exited." }),
  });

  await assert.rejects(
    waitForPhotoCodeJob("failed-job", { pollIntervalMs: 0 }),
    /Recognizer exited/,
  );
});

test("photo jobs fail closed on unknown backend states", async () => {
  const { waitForPhotoCodeJob } = await loadOcrBackend();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "paused" }),
  });

  await assert.rejects(
    waitForPhotoCodeJob("unknown-job", { pollIntervalMs: 0 }),
    /unknown status: paused/,
  );
});
