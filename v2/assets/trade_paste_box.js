import {
  createPhotoCodeJob,
  recognitionBaseUrl,
  waitForPhotoCodeJob,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-c6df73a9142b";
import {
  normalizeCodeInput,
  normalizePastedCardText,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-c6df73a9142b";
import { openCameraCapture } from "/fifa-sticker-app/v2/assets/camera_capture.js?v=build-c6df73a9142b";
import { mountPasteCardStatusPreview } from "/fifa-sticker-app/v2/assets/paste_card_status.js?v=build-c6df73a9142b";

const VOICE_LANGUAGE_KEY = "panini.voiceLanguage.v1";
const VOICE_LANGUAGES = [
  { value: "auto", label: "Phone language" },
  { value: "en-US", label: "English" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
  { value: "es-ES", label: "Spanish" },
  { value: "it-IT", label: "Italian" },
  { value: "pt-PT", label: "Portuguese" },
  { value: "nl-NL", label: "Dutch" },
  { value: "ro-RO", label: "Romanian" },
];
const VOICE_LANGUAGE_VALUES = new Set(VOICE_LANGUAGES.map((item) => item.value));

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
    cardStatusPreview = true,
  } = options;
  const enabledCapabilities = {
    photo: capabilities.photo === true,
    voice: capabilities.voice === true,
    clear: capabilities.clear === true,
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
  textarea.addEventListener("input", () => normalizeEncodedTextareaValue(textarea));
  root.append(textarea);
  const parsedCardStatus = cardStatusPreview
    ? mountPasteCardStatusPreview({
      textarea,
      title: typeof cardStatusPreview === "object" && cardStatusPreview.title
        ? cardStatusPreview.title
        : "Parsed status against your collection",
      getCollectionModel: typeof cardStatusPreview === "object" && cardStatusPreview.getCollectionModel
        ? cardStatusPreview.getCollectionModel
        : undefined,
    })
    : null;

  const capabilityStatus = document.createElement("div");
  capabilityStatus.className = "hint pasteCapabilityStatus";
  capabilityStatus.setAttribute("role", "status");
  capabilityStatus.setAttribute("aria-live", "polite");
  capabilityStatus.hidden = true;
  const voiceTranscriptStatus = enabledCapabilities.voice ? buildVoiceTranscriptStatus() : null;
  if (enabledCapabilities.photo || enabledCapabilities.voice || enabledCapabilities.clear) {
    if (voiceTranscriptStatus) root.append(voiceTranscriptStatus);
    if (enabledCapabilities.photo) root.append(capabilityStatus);
    root.append(buildCapabilityRow(textarea, capabilityStatus, voiceTranscriptStatus || capabilityStatus, enabledCapabilities, { onTextAcquired }));
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

  return { root, textarea, actionRow, capabilityStatus, voiceTranscriptStatus, parsedCardStatus };
}

export function clearTradePasteText(textarea) {
  if (!textarea) return;
  textarea.value = "";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus?.();
}

function normalizeEncodedTextareaValue(textarea) {
  if (!/%[0-9A-Fa-f]{2}/.test(textarea.value)) return;
  const normalized = normalizePastedCardText(textarea.value);
  if (normalized === textarea.value) return;
  textarea.value = normalized;
  textarea.selectionStart = normalized.length;
  textarea.selectionEnd = normalized.length;
  textarea.blur?.();
}

function buildCapabilityRow(textarea, status, voiceStatus, capabilities, options = {}) {
  const row = document.createElement("div");
  row.className = "tradeLookupActions pasteCapabilityActions";
  const acquisitionButtons = [];
  let photoScanRunning = false;
  let lastPhotoSelectionSignature = "";
  const voiceState = {
    recognition: null,
    listening: false,
    stopping: false,
    stopTimer: null,
    finishTimer: null,
    errorMessage: "",
    languageSelect: null,
    liveText: "",
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

    const cameraButton = document.createElement("button");
    cameraButton.type = "button";
    cameraButton.className = "cameraCaptureButton";
    cameraButton.textContent = "Use Camera";
    cameraButton.addEventListener("click", async () => {
      if (photoScanRunning) return;
      const capture = await openCameraCapture({
        invoker: cameraButton,
        onFallback: () => {
          lastPhotoSelectionSignature = "";
          photoInput.click();
        },
        onStatus: (message) => showCapabilityMessage(status, "Camera", message),
      });
      if (!capture?.file || photoScanRunning) return;
      photoScanRunning = true;
      setOtherAcquisitionButtonsDisabled(cameraButton, true);
      await scanPhotosIntoText([capture.file], textarea, status, cameraButton, {
        ...options,
        buttonLabel: "Use Camera",
        captureSummary: capture.summary,
        source: "camera",
      }).finally(() => {
        photoScanRunning = false;
        setOtherAcquisitionButtonsDisabled(cameraButton, false);
      });
    });

    acquisitionButtons.push(cameraButton, photoButton);
    row.append(cameraButton, photoButton, photoInput);
  }

  if (capabilities.voice) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "voiceInputButton";
    button.setAttribute("data-paste-voice-button", "true");
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Use Voice";
    button.addEventListener("click", () => captureVoiceIntoText(textarea, voiceStatus, button, voiceState, {
      ...options,
      setPeerControlsDisabled: (disabled) => setOtherAcquisitionButtonsDisabled(button, disabled),
    }));
    acquisitionButtons.push(button);
    row.append(button);
    if (capabilities.clear) {
      const clearButton = buildClearButton(textarea, voiceStatus, voiceState);
      acquisitionButtons.push(clearButton);
      row.append(clearButton);
    }
    const languageSelect = buildVoiceLanguageSelect();
    voiceState.languageSelect = languageSelect;
    row.append(buildVoiceLanguageControl(languageSelect));
  } else if (capabilities.clear) {
    const clearButton = buildClearButton(textarea, status, voiceState);
    acquisitionButtons.push(clearButton);
    row.append(clearButton);
  }

  return row;
}

function buildClearButton(textarea, status, voiceState) {
  const button = document.createElement("button");
  button.id = `${textarea.id}ClearButton`;
  button.type = "button";
  button.className = "secondaryButton";
  button.setAttribute("aria-label", "Clear card numbers");
  button.textContent = "Clear";
  button.addEventListener("click", () => {
    voiceState.liveText = "";
    clearTradePasteText(textarea);
    showVoiceMessage(status, "Card numbers cleared.", { label: "Clear" });
  });
  return button;
}

function buildVoiceTranscriptStatus() {
  const status = document.createElement("div");
  status.className = "hint pasteCapabilityStatus liveTranscriptPanel";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  showLiveTranscript(status, "No dictation yet. Press Use Voice to see raw recognized text here.", {
    phase: "Dictation transcript",
    normalized: "Processed card codes will be added to the text box after you stop.",
  });
  return status;
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
    showCapabilityMessage(status, "Photo scan", "Photo input needs the laptop OCR backend. Set it on Scan first.");
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
      showCapabilityMessage(status, "Photo scan", lastError instanceof Error ? lastError.message : "No card numbers were found in those photos.");
      return;
    }
    const recognizedText = recognized.join("\n");
    appendText(textarea, recognizedText);
    await options.onTextAcquired?.({ source: options.source || "photo", text: recognizedText });
    const success = `Filled card codes from ${recognized.length}/${selected.length} photo${selected.length === 1 ? "" : "s"}.`;
    const failures = failureCount ? ` ${failureCount} photo${failureCount === 1 ? "" : "s"} could not be read.` : "";
    const captureSummary = options.captureSummary ? ` ${options.captureSummary}` : "";
    showCapabilityMessage(status, "Photo scan", `${success}${failures}${captureSummary}`);
  } catch (error) {
    showCapabilityMessage(status, "Photo scan", error instanceof Error ? error.message : "Photo scan failed.");
  } finally {
    resetPhotoButton(button, options.buttonLabel);
    status.setAttribute("aria-busy", "false");
  }
}

function setPhotoProgress(button, status, text) {
  button.disabled = true;
  button.classList.add("scanning");
  button.setAttribute("aria-busy", "true");
  button.textContent = text;
  showCapabilityMessage(status, "Photo scan", text, { busy: true });
}

function resetPhotoButton(button, label = "Use Photos") {
  button.disabled = false;
  button.classList.remove("scanning");
  button.setAttribute("aria-busy", "false");
  button.textContent = label;
}

function captureVoiceIntoText(textarea, status, button, state, options = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showVoiceMessage(status, "Voice input is not available in this browser. Use keyboard dictation in the text box.");
    textarea.focus();
    return;
  }
  if (state.listening && state.recognition) {
    requestVoiceStop(button, state);
    return;
  }
  const recognition = new SpeechRecognition();
  state.recognition = recognition;
  state.errorMessage = "";
  const recognitionLanguage = resolveVoiceRecognitionLanguage(state.languageSelect?.value);
  recognition.lang = recognitionLanguage;
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  let latestTranscript = "";

  recognition.addEventListener("start", () => {
    setVoiceButtonState(button, state, "Stop listening", true);
    setLiveDictationText(textarea, state, "Listening...");
    showLiveTranscript(status, "Listening... tap Stop listening when you are done.", {
      language: voiceLanguageLabel(recognitionLanguage),
      busy: true,
    });
    clearVoiceStopTimer(state);
    state.stopTimer = window.setTimeout(() => state.recognition?.stop(), 20000);
  });
  recognition.addEventListener("result", (event) => {
    clearVoiceStopTimer(state);
    state.stopTimer = window.setTimeout(() => state.recognition?.stop(), 4000);
    const parts = [];
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript || "";
      if (transcript) parts.push(transcript);
    }
    latestTranscript = parts.join(" ").trim() || latestTranscript;
    setLiveDictationText(textarea, state, latestTranscript || "Listening...");
    showLiveTranscript(status, latestTranscript || "Listening...", {
      language: voiceLanguageLabel(recognitionLanguage),
      busy: true,
    });
  });
  recognition.addEventListener("error", (event) => {
    clearVoiceStopTimer(state);
    clearVoiceFinishTimer(state);
    resetVoiceButton(button, state);
    state.recognition = null;
    state.errorMessage = voiceErrorMessage(event.error);
    options.setPeerControlsDisabled?.(false);
    clearLiveDictationText(textarea, state);
    showVoiceMessage(status, state.errorMessage);
  });
  recognition.addEventListener("end", async () => {
    clearVoiceStopTimer(state);
    clearVoiceFinishTimer(state);
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
      await appendProcessedTranscript(textarea, status, transcript, {
        ...options,
        voiceState: state,
        voiceLanguageLabel: voiceLanguageLabel(recognitionLanguage),
      });
    } else {
      clearLiveDictationText(textarea, state);
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
    clearLiveDictationText(textarea, state);
    showVoiceMessage(status, "Voice input could not start. Tap the text box and use the keyboard microphone.");
    textarea.focus();
  }
}

async function appendProcessedTranscript(textarea, status, transcript, options = {}) {
  const cleaned = transcript.trim();
  if (!cleaned) return;
  showLiveTranscript(status, cleaned, { phase: "Analyzing...", language: options.voiceLanguageLabel || "" });
  const transformed = normalizeCodeInput(cleaned);
  const textToAppend = String(transformed?.text || "").trim();
  const details = Array.isArray(transformed?.details) ? transformed.details : [];
  if (!textToAppend) {
    clearLiveDictationText(textarea, options.voiceState);
    showLiveTranscript(status, cleaned, { language: options.voiceLanguageLabel || "", normalized: "No card codes found." });
    return;
  }
  replaceLiveDictationText(textarea, options.voiceState, textToAppend);
  await options.onTextAcquired?.({ source: "voice", text: textToAppend, transcript: cleaned });
  const mapping = details.length ? details.join(", ") : textToAppend.split(/\s+/).join(", ");
  showLiveTranscript(status, cleaned, { language: options.voiceLanguageLabel || "", normalized: mapping });
}

function showVoiceMessage(status, message, { busy = false, label = "Voice" } = {}) {
  showCapabilityMessage(status, label, message, { busy });
}

function showCapabilityMessage(status, label, message, { busy = false } = {}) {
  status.hidden = false;
  status.classList.remove("liveTranscriptPanel");
  status.replaceChildren();
  const title = document.createElement("strong");
  title.className = "pasteCapabilityStatusLabel";
  title.textContent = label;
  const body = document.createElement("span");
  body.className = "pasteCapabilityStatusText";
  body.textContent = message;
  status.append(title, body);
  status.setAttribute("aria-busy", String(busy));
}

function showLiveTranscript(status, transcript, { busy = false, language = "", phase = "Live transcript", normalized = "" } = {}) {
  status.hidden = false;
  status.classList.add("liveTranscriptPanel");
  status.replaceChildren();
  const header = document.createElement("div");
  header.className = "liveTranscriptHeader";
  const title = document.createElement("strong");
  title.className = "pasteCapabilityStatusLabel";
  title.textContent = phase;
  header.append(title);
  if (language) {
    const languageBadge = document.createElement("span");
    languageBadge.className = "liveTranscriptLanguage";
    languageBadge.textContent = language;
    header.append(languageBadge);
  }
  const raw = document.createElement("p");
  raw.className = "liveTranscriptText";
  raw.textContent = transcript;
  status.append(header, raw);
  if (normalized) {
    const normalizedText = document.createElement("p");
    normalizedText.className = "liveTranscriptNormalized";
    normalizedText.textContent = `Normalized: ${normalized}`;
    status.append(normalizedText);
  }
  status.setAttribute("aria-busy", String(busy));
}

function clearVoiceStopTimer(state) {
  if (!state.stopTimer) return;
  window.clearTimeout(state.stopTimer);
  state.stopTimer = null;
}

function clearVoiceFinishTimer(state) {
  if (!state.finishTimer) return;
  window.clearTimeout(state.finishTimer);
  state.finishTimer = null;
}

function requestVoiceStop(button, state) {
  if (!state.recognition || state.stopping) return;
  state.stopping = true;
  clearVoiceStopTimer(state);
  button.textContent = "Finishing...";
  button.disabled = true;
  try {
    state.recognition.stop();
  } catch {
    resetVoiceButton(button, state);
    state.recognition = null;
    return;
  }
  clearVoiceFinishTimer(state);
  state.finishTimer = window.setTimeout(() => {
    if (!state.recognition) return;
    state.recognition = null;
    resetVoiceButton(button, state);
  }, 5000);
}

function resetVoiceButton(button, state) {
  state.stopping = false;
  setVoiceButtonState(button, state, "Use Voice", false);
  button.disabled = false;
}

function setVoiceButtonState(button, state, label, active = false) {
  state.listening = active;
  button.classList.toggle("listening", active);
  button.textContent = label;
  button.setAttribute("aria-pressed", String(active));
  if (state.languageSelect) state.languageSelect.disabled = active;
}

function liveDictationBlock(value) {
  return `Dictation: ${String(value || "").trim() || "Listening..."}`;
}

function setLiveDictationText(textarea, state, transcript) {
  if (!state) return;
  const nextBlock = liveDictationBlock(transcript);
  const current = textarea.value;
  const next = state.liveText && current.includes(state.liveText)
    ? current.replace(state.liveText, nextBlock)
    : [current.trimEnd(), nextBlock].filter(Boolean).join("\n");
  state.liveText = nextBlock;
  textarea.value = next;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.selectionStart = textarea.value.length;
  textarea.selectionEnd = textarea.value.length;
}

function replaceLiveDictationText(textarea, state, replacement) {
  const nextText = String(replacement || "").trim();
  if (!state?.liveText) {
    appendText(textarea, nextText);
    return;
  }
  textarea.value = textarea.value.includes(state.liveText)
    ? textarea.value.replace(state.liveText, nextText)
    : [textarea.value.trimEnd(), nextText].filter(Boolean).join("\n");
  state.liveText = "";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function clearLiveDictationText(textarea, state) {
  if (!state?.liveText) return;
  textarea.value = textarea.value
    .replace(state.liveText, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  state.liveText = "";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function buildVoiceLanguageSelect() {
  const select = document.createElement("select");
  select.className = "voiceLanguageSelect";
  select.setAttribute("aria-label", "Voice language");
  for (const language of VOICE_LANGUAGES) {
    const option = document.createElement("option");
    option.value = language.value;
    option.textContent = language.value === "auto"
      ? `${language.label} (${voiceLanguageLabel(resolveVoiceRecognitionLanguage("auto"))})`
      : language.label;
    select.append(option);
  }
  select.value = savedVoiceLanguage();
  select.addEventListener("change", () => {
    try {
      localStorage.setItem(VOICE_LANGUAGE_KEY, select.value);
    } catch {
      // Ignore storage failures; the selected language still applies for this recording.
    }
  });
  return select;
}

function buildVoiceLanguageControl(select) {
  const control = document.createElement("label");
  control.className = "voiceLanguageControl";
  const text = document.createElement("span");
  text.textContent = "Choose dictation language";
  control.append(text, select);
  return control;
}

function savedVoiceLanguage() {
  try {
    const saved = localStorage.getItem(VOICE_LANGUAGE_KEY);
    if (VOICE_LANGUAGE_VALUES.has(saved)) return saved;
  } catch {
    // Ignore storage failures and fall back to browser language.
  }
  return "auto";
}

function resolveVoiceRecognitionLanguage(selected = "auto") {
  if (VOICE_LANGUAGE_VALUES.has(selected) && selected !== "auto") return selected;
  const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language || "en-US"];
  for (const language of browserLanguages) {
    const normalized = normalizeLanguageTag(language);
    const supported = VOICE_LANGUAGES.find((item) => item.value !== "auto" && (
      item.value.toLowerCase() === normalized.toLowerCase()
      || item.value.toLowerCase().startsWith(`${normalized.split("-")[0].toLowerCase()}-`)
    ));
    if (supported) return supported.value;
  }
  return "en-US";
}

function normalizeLanguageTag(value) {
  return String(value || "").trim().replace("_", "-");
}

function voiceLanguageLabel(language) {
  const value = resolveVoiceRecognitionLanguage(language);
  return VOICE_LANGUAGES.find((item) => item.value === value)?.label || value;
}

function voiceErrorMessage(error) {
  const messages = {
    "not-allowed": "Microphone permission was blocked. Allow microphone access or use keyboard dictation.",
    "no-speech": "No speech was heard. Try again closer to the microphone.",
    "audio-capture": "The microphone is unavailable. Check the phone microphone and try again.",
    network: "Voice recognition is unavailable right now. Check the network and try again.",
    "language-not-supported": "That voice language is not supported on this device. Choose another language and try again.",
  };
  return messages[error] || "Voice input could not start. Tap the text box and use the keyboard microphone.";
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
