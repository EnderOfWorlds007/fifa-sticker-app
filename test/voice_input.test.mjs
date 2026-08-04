import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCodeInput } from "../assets/card_parser.js";
import { attachVoiceInput } from "../assets/voice_input.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor() {
    this.listeners = {};
    this.classList = new FakeClassList();
    this.textContent = "";
    this.value = "";
    this.hidden = true;
    this.attributes = {};
    this.focused = false;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    this.listeners.click?.();
  }

  focus() {
    this.focused = true;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

class FakeRecognition {
  constructor() {
    this.listeners = {};
    FakeRecognition.instance = this;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  start() {
    this.listeners.start?.();
  }

  stop() {
    this.listeners.end?.();
  }

  result(transcript, isFinal = false) {
    const item = [{ transcript }];
    item.isFinal = isFinal;
    this.listeners.result?.({
      resultIndex: 0,
      results: [item],
    });
  }
}

test("voice input shows raw dictation, then appends normalized codes", async () => {
  globalThis.window = {
    SpeechRecognition: FakeRecognition,
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en-US" },
  });

  const button = new FakeElement();
  const textarea = new FakeElement();
  const statusElement = new FakeElement();
  let lookupInput = "";

  attachVoiceInput({
    button,
    textarea,
    statusElement,
    transformTranscript: normalizeCodeInput,
    onTranscript: async (codes) => {
      lookupInput = codes;
    },
  });

  button.click();
  assert.equal(button.textContent, "Listening...");
  assert.equal(statusElement.textContent, "Listening...");

  FakeRecognition.instance.result("France three", false);
  assert.equal(statusElement.hidden, false);
  assert.equal(statusElement.textContent, "Listening: France three");

  FakeRecognition.instance.stop();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(textarea.value, "FRA3");
  assert.equal(lookupInput, "FRA3");
  assert.equal(statusElement.textContent, "Heard: France three. Normalized: FRANCE THREE -> FRA3.");
});

test("voice parser explains likely France three mishears", () => {
  assert.deepEqual(normalizeCodeInput("friends three"), {
    text: "FRA3",
    details: ["FRIENDS THREE -> FRA3"],
  });
  assert.deepEqual(normalizeCodeInput("Francis tree"), {
    text: "FRA3",
    details: ["FRANCIS TREE -> FRA3"],
  });
});
