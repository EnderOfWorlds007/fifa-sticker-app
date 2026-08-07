import {
  createPhotoCodeJob,
  recognitionBaseUrl,
  waitForPhotoCodeJob,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-d09098ecb759";
import {
  normalizeCodeInput,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-d09098ecb759";

export function mountTradePasteBox(target, options) {
  const root = typeof target === "string" ? document.querySelector(target) : target;
  if (!root) return null;

  const {
    label,
    textareaId,
    rows = 5,
    placeholder = "",
    autofocus = false,
    actions = [],
    hint,
    summary,
    notice,
    notices,
    capabilities = {},
    onTextAcquired,
  } = options;
  const enabledCapabilities = {
    photo: capabilities.photo === true,
    voice: capabilities.voice === true,
  };

  root.replaceChildren();
  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  labelElement.htmlFor = textareaId;
  if (options.labelId) labelElement.id = options.labelId;
  root.append(labelElement);

  const textarea = document.createElement("textarea");
  textarea.id = textareaId;
  textarea.rows = rows;
  textarea.placeholder = placeholder;
  if (autofocus) textarea.autofocus = true;
  root.append(textarea);

  const capabilityStatus = document.createElement("p");
  capabilityStatus.className = "hint pasteCapabilityStatus";
  capabilityStatus.setAttribute("aria-live", "polite");
  capabilityStatus.hidden = true;
  if (enabledCapabilities.photo || enabledCapabilities.voice) {
    root.append(buildCapabilityRow(textarea, capabilityStatus, enabledCapabilities, { onTextAcquired }));
    root.append(capabilityStatus);
  }

  const actionRow = document.createElement("div");
  actionRow.className = "tradeLookupActions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.id = action.id;
    button.type = "button";
    button.textContent = action.label;
    if (action.hidden) button.hidden = true;
    if (action.secondary) button.className = "secondaryButton";
    actionRow.append(button);
  }
  root.append(actionRow);

  if (hint) root.append(buildParagraph(hint.id, "hint", hint.text || "", { ariaLive: hint.ariaLive }));
  if (summary) root.append(buildParagraph(summary.id, "hint", summary.text || "", { ariaLive: summary.ariaLive }));
  for (const noticeConfig of notices || (notice ? [notice] : [])) root.append(buildNotice(noticeConfig));

  return { root, textarea, actionRow, capabilityStatus };
}

function buildCapabilityRow(textarea, status, capabilities, options = {}) {
  const row = document.createElement("div");
  row.className = "tradeLookupActions pasteCapabilityActions";
  const acquisitionButtons = [];
  let photoScanRunning = false;
  let lastPhotoSelectionSignature = "";
  const voiceState = {
    recognition: null,
    listening: false,
    stopTimer: null,
    errorMessage: "",
  };
  const setOtherAcquisitionButtonsDisabled = (activeButton, disabled) => {
    for (const item of acquisitionButtons) {
      if (item !== activeButton) item.disabled = disabled;
    }
  };

  if (capabilities.photo) {
    const photoInput = buildPhotoInput();

    const photoButton = document.createElement("button");
    photoButton.type = "button";
    photoButton.className = "photoUploadButton";
    photoButton.textContent = "Use Photos";
    photoButton.addEventListener("click", () => {
      lastPhotoSelectionSignature = "";
      photoInput.click();
    });
    const handlePhotoSelection = () => {
      const files = [...(photoInput.files || [])];
      const signature = files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
      if (!signature || signature === lastPhotoSelectionSignature) return;
      lastPhotoSelectionSignature = signature;
      if (photoScanRunning) return;
      photoScanRunning = true;
      setOtherAcquisitionButtonsDisabled(photoButton, true);
      scanPhotosIntoText(files, textarea, status, photoButton, options).finally(() => {
        photoScanRunning = false;
        setOtherAcquisitionButtonsDisabled(photoButton, false);
        photoInput.value = "";
      });
    };
    photoInput.addEventListener("input", handlePhotoSelection);
    photoInput.addEventListener("change", handlePhotoSelection);

    acquisitionButtons.push(photoButton);
    row.append(photoButton, photoInput);
  }

  if (capabilities.voice) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "voiceInputButton";
    button.setAttribute("data-paste-voice-button", "true");
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Use Voice";
    button.addEventListener("click", () => captureVoiceIntoText(textarea, status, button, voiceState, {
      ...options,
      setPeerControlsDisabled: (disabled) => setOtherAcquisitionButtonsDisabled(button, disabled),
    }));
    acquisitionButtons.push(button);
    row.append(button);
  }

  return row;
}

function buildPhotoInput() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.hidden = true;
  input.setAttribute("data-paste-photo-input", "true");
  return input;
}

async function scanPhotosIntoText(files, textarea, status, button, options = {}) {
  const selected = [...(files || [])];
  if (!selected.length) return;
  if (!recognitionBaseUrl()) {
    status.hidden = false;
    status.textContent = "Photo input needs the laptop OCR backend. Set it on Scan first.";
    return;
  }
  const recognized = [];
  let failureCount = 0;
  let lastError = null;
  setPhotoProgress(button, status, "Preparing photos...");
  try {
    for (let index = 0; index < selected.length; index += 1) {
      setPhotoProgress(button, status, `Scanning... ${index + 1}/${selected.length}`);
      try {
        const job = await createPhotoCodeJob(selected[index]);
        const payload = await waitForPhotoCodeJob(job.job_id, {
          onStatus: (message) => setPhotoProgress(button, status, message),
        });
        const result = payload.result || payload;
        const text = String(result?.grouped_text || (Array.isArray(result?.codes) ? result.codes.join(", ") : "")).trim();
        if (text) {
          recognized.push(text);
        } else {
          failureCount += 1;
        }
      } catch (error) {
        failureCount += 1;
        lastError = error;
      }
    }
    if (!recognized.length) {
      status.textContent = lastError instanceof Error ? lastError.message : "No card numbers were found in those photos.";
      return;
    }
    const recognizedText = recognized.join("\n");
    appendText(textarea, recognizedText);
    await options.onTextAcquired?.({ source: "photo", text: recognizedText });
    const success = `Filled card codes from ${recognized.length}/${selected.length} photo${selected.length === 1 ? "" : "s"}.`;
    const failures = failureCount ? ` ${failureCount} photo${failureCount === 1 ? "" : "s"} could not be read.` : "";
    status.textContent = `${success}${failures}`;
  } catch (error) {
    status.hidden = false;
    status.textContent = error instanceof Error ? error.message : "Photo scan failed.";
  } finally {
    resetPhotoButton(button);
    status.setAttribute("aria-busy", "false");
  }
}

function setPhotoProgress(button, status, text) {
  button.disabled = true;
  button.classList.add("scanning");
  button.setAttribute("aria-busy", "true");
  button.textContent = text;
  status.hidden = false;
  status.textContent = text;
  status.setAttribute("aria-busy", "true");
}

function resetPhotoButton(button) {
  button.disabled = false;
  button.classList.remove("scanning");
  button.setAttribute("aria-busy", "false");
  button.textContent = "Use Photos";
}

function captureVoiceIntoText(textarea, status, button, state, options = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showVoiceMessage(status, "Voice input is not available in this browser. Use keyboard dictation in the text box.");
    textarea.focus();
    return;
  }
  if (state.listening && state.recognition) {
    state.recognition.stop();
    return;
  }
  const recognition = new SpeechRecognition();
  state.recognition = recognition;
  state.errorMessage = "";
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let latestTranscript = "";

  recognition.addEventListener("start", () => {
    setVoiceButtonState(button, state, "Stop listening", true);
    showVoiceMessage(status, "Listening... Tap Stop listening when you are done.", { busy: true });
    clearVoiceStopTimer(state);
    state.stopTimer = window.setTimeout(() => state.recognition?.stop(), 12000);
  });
  recognition.addEventListener("result", (event) => {
    clearVoiceStopTimer(state);
    state.stopTimer = window.setTimeout(() => state.recognition?.stop(), 2500);
    const parts = [];
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript || "";
      if (transcript) parts.push(transcript);
    }
    latestTranscript = parts.join(" ").trim() || latestTranscript;
    showVoiceMessage(status, latestTranscript ? `Listening: ${latestTranscript}` : "Listening...", { busy: true });
  });
  recognition.addEventListener("error", (event) => {
    clearVoiceStopTimer(state);
    resetVoiceButton(button, state);
    state.recognition = null;
    const reason = event.error === "not-allowed" ? "Microphone permission was blocked." : "Voice input could not start.";
    state.errorMessage = `${reason} Tap the text box and use the keyboard microphone.`;
    options.setPeerControlsDisabled?.(false);
    showVoiceMessage(status, state.errorMessage);
  });
  recognition.addEventListener("end", async () => {
    clearVoiceStopTimer(state);
    resetVoiceButton(button, state);
    state.recognition = null;
    options.setPeerControlsDisabled?.(false);
    if (state.errorMessage) {
      showVoiceMessage(status, state.errorMessage);
      state.errorMessage = "";
      return;
    }
    const transcript = latestTranscript.trim();
    if (transcript) {
      await appendProcessedTranscript(textarea, status, transcript, options);
    } else {
      showVoiceMessage(status, "No voice text captured.");
    }
  });
  try {
    setVoiceButtonState(button, state, "Starting...", true);
    options.setPeerControlsDisabled?.(true);
    recognition.start();
  } catch {
    clearVoiceStopTimer(state);
    resetVoiceButton(button, state);
    state.recognition = null;
    options.setPeerControlsDisabled?.(false);
    showVoiceMessage(status, "Voice input could not start. Tap the text box and use the keyboard microphone.");
    textarea.focus();
  }
}

async function appendProcessedTranscript(textarea, status, transcript, options = {}) {
  const cleaned = transcript.trim();
  if (!cleaned) return;
  showVoiceMessage(status, "Analyzing...", { busy: true });
  const transformed = normalizeCodeInput(cleaned);
  const textToAppend = String(transformed?.text || "").trim();
  const details = Array.isArray(transformed?.details) ? transformed.details : [];
  if (!textToAppend) {
    showVoiceMessage(status, `Heard: ${cleaned}. No card codes found.`);
    return;
  }
  appendText(textarea, textToAppend);
  await options.onTextAcquired?.({ source: "voice", text: textToAppend, transcript: cleaned });
  const mapping = details.length ? details.join(", ") : textToAppend.split(/\s+/).join(", ");
  showVoiceMessage(status, `Heard: ${cleaned}. Normalized: ${mapping}.`);
}

function showVoiceMessage(status, message, { busy = false } = {}) {
  status.hidden = false;
  status.textContent = message;
  status.setAttribute("aria-busy", String(busy));
}

function clearVoiceStopTimer(state) {
  if (!state.stopTimer) return;
  window.clearTimeout(state.stopTimer);
  state.stopTimer = null;
}

function resetVoiceButton(button, state) {
  setVoiceButtonState(button, state, "Use Voice", false);
}

function setVoiceButtonState(button, state, label, active = false) {
  state.listening = active;
  button.classList.toggle("listening", active);
  button.textContent = label;
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-busy", String(active));
}

function appendText(textarea, addition) {
  const current = textarea.value.trim();
  textarea.value = current ? `${current}\n${addition}` : addition;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function buildParagraph(id, className, text, { ariaLive } = {}) {
  const paragraph = document.createElement("p");
  paragraph.id = id;
  paragraph.className = className;
  paragraph.textContent = text;
  if (ariaLive) paragraph.setAttribute("aria-live", ariaLive);
  return paragraph;
}

function buildNotice({ id, summaryId, buttonId, buttonLabel }) {
  const notice = document.createElement("div");
  notice.id = id;
  notice.className = "receiveIgnoredNotice";
  notice.hidden = true;

  const summary = document.createElement("p");
  summary.id = summaryId;
  notice.append(summary);

  const button = document.createElement("button");
  button.id = buttonId;
  button.className = "secondaryButton";
  button.type = "button";
  button.textContent = buttonLabel;
  notice.append(button);

  return notice;
}
