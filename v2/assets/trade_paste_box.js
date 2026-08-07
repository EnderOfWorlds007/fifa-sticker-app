import {
  createPhotoCodeJob,
  recognitionBaseUrl,
  waitForPhotoCodeJob,
} from "/fifa-sticker-app/v2/assets/ocr_backend.js?v=build-eea91a46959f";

let photoDisclosureCounter = 0;

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
  if (enabledCapabilities.photo || enabledCapabilities.voice) {
    root.append(buildCapabilityRow(textarea, capabilityStatus, enabledCapabilities));
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

function buildCapabilityRow(textarea, status, capabilities) {
  const row = document.createElement("div");
  row.className = "tradeLookupActions pasteCapabilityActions";

  if (capabilities.photo) {
    const cameraInput = buildPhotoInput("data-paste-camera-input");
    cameraInput.capture = "environment";
    cameraInput.setAttribute("capture", "environment");
    cameraInput.setAttribute("data-paste-photo-input", "true");
    const libraryInput = buildPhotoInput("data-paste-library-input");
    const disclosureId = `pastePhotoSources${photoDisclosureCounter += 1}`;

    const photoButton = document.createElement("button");
    photoButton.type = "button";
    photoButton.className = "secondaryButton";
    photoButton.textContent = "Photo";
    photoButton.setAttribute("aria-controls", disclosureId);
    photoButton.setAttribute("aria-expanded", "false");

    const menu = document.createElement("div");
    menu.id = disclosureId;
    menu.className = "pasteCapabilityMenu";
    menu.hidden = true;

    let takePhotoButton;
    {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondaryButton";
      button.textContent = "Take photo";
      button.addEventListener("click", () => {
        hidePhotoMenu(photoButton, menu);
        cameraInput.click();
      });
      takePhotoButton = button;
    }

    let choosePhotoButton;
    {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondaryButton";
      button.textContent = "Choose photo";
      button.addEventListener("click", () => {
        hidePhotoMenu(photoButton, menu);
        libraryInput.click();
      });
      choosePhotoButton = button;
    }

    photoButton.addEventListener("click", () => {
      const willOpen = menu.hidden;
      if (willOpen) {
        showPhotoMenu(photoButton, menu, takePhotoButton);
        status.textContent = "Choose camera or photo library.";
      } else {
        hidePhotoMenu(photoButton, menu);
        status.textContent = "";
      }
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      hidePhotoMenu(photoButton, menu, { restoreFocus: true });
    });
    cameraInput.addEventListener("change", () => scanPhotoIntoText(cameraInput, textarea, status));
    libraryInput.addEventListener("change", () => scanPhotoIntoText(libraryInput, textarea, status));

    menu.append(takePhotoButton, choosePhotoButton);
    row.append(photoButton, menu, cameraInput, libraryInput);
  }

  if (capabilities.voice) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondaryButton";
    button.setAttribute("data-paste-voice-button", "true");
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Voice";
    button.addEventListener("click", () => captureVoiceIntoText(textarea, status, button));
    row.append(button);
  }

  return row;
}

function buildPhotoInput(marker) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.hidden = true;
  input.setAttribute(marker, "true");
  return input;
}

function showPhotoMenu(button, menu, focusTarget) {
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  focusTarget?.focus();
}

function hidePhotoMenu(button, menu, { restoreFocus = false } = {}) {
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
  if (restoreFocus) button.focus();
}

async function scanPhotoIntoText(input, textarea, status) {
  const file = input.files?.[0];
  if (!file) return;
  if (!recognitionBaseUrl()) {
    status.textContent = "Photo input needs the laptop OCR backend. Set it on Scan first.";
    input.value = "";
    return;
  }
  status.textContent = "Scanning photo...";
  try {
    const job = await createPhotoCodeJob(file);
    const payload = await waitForPhotoCodeJob(job.job_id, {
      onStatus: (message) => { status.textContent = message; },
    });
    const result = payload.result || payload;
    const text = String(result?.grouped_text || (Array.isArray(result?.codes) ? result.codes.join(", ") : "")).trim();
    if (!text) {
      status.textContent = "No card codes recognized in that photo.";
      return;
    }
    appendText(textarea, text);
    const count = Array.isArray(result?.codes) ? result.codes.length : text.split(/[,;\n]+/).filter(Boolean).length;
    status.textContent = `${count} recognized card${count === 1 ? "" : "s"} added from photo.`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Photo scan failed.";
  } finally {
    input.value = "";
  }
}

function captureVoiceIntoText(textarea, status, button) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    status.textContent = "Voice input is not available in this browser. Use keyboard dictation in the text box.";
    textarea.focus();
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  button.disabled = true;
  button.textContent = "Listening...";
  button.setAttribute("aria-pressed", "true");
  status.textContent = "Listening...";
  recognition.addEventListener("result", (event) => {
    const transcript = [...event.results]
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim();
    if (transcript) {
      appendText(textarea, transcript);
      status.textContent = "Voice text added.";
    }
  });
  recognition.addEventListener("error", () => {
    resetVoiceButton(button);
    status.textContent = "Voice input stopped before any text was added.";
  });
  recognition.addEventListener("end", () => {
    resetVoiceButton(button);
    if (status.textContent === "Listening...") status.textContent = "Voice input ended.";
  });
  try {
    recognition.start();
  } catch (error) {
    resetVoiceButton(button);
    status.textContent = error instanceof Error ? error.message : "Voice input could not start.";
    textarea.focus();
  }
}

function resetVoiceButton(button) {
  button.disabled = false;
  button.textContent = "Voice";
  button.setAttribute("aria-pressed", "false");
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
