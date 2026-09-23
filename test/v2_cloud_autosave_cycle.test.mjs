import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COLLECTION_KEY, saveCollectionState } from "../v2/assets/collection_state.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("saving an unchanged collection does not announce another cloud write", () => {
  const storage = memoryStorage();
  const previousDispatch = globalThis.dispatchEvent;
  const previousCustomEvent = globalThis.CustomEvent;
  const events = [];
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  globalThis.dispatchEvent = (event) => {
    events.push(event);
    return true;
  };
  try {
    const state = { collected: ["SUI1"], filter: "missing", hasLocalState: true };
    assert.equal(saveCollectionState(state, storage), true);
    assert.equal(saveCollectionState(state, storage), false);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "panini:local-state-saved");
    assert.equal(JSON.parse(storage.getItem(COLLECTION_KEY)).collected[0], "SUI1");
  } finally {
    if (previousDispatch === undefined) delete globalThis.dispatchEvent;
    else globalThis.dispatchEvent = previousDispatch;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  }
});

test("an empty cloud read does not announce that remote state was applied", () => {
  const source = readFileSync(new URL("../v2/assets/cloud_sync.js", import.meta.url), "utf8");
  assert.match(source, /const changeCount = Number\(result\.transactionCount \?\? result\.transactions\.length\);/);
  assert.match(source, /if \(apply && changeCount > 0\) \{\s*dispatchWindowEvent\(windowRef, APPLIED_EVENT/);
});
