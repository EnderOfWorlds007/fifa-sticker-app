export function attachVoiceInput({ button, textarea, statusElement, transformTranscript, onTranscript, setMessage }) {
  if (!button || !textarea) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let stopTimer = null;

  function setButtonState(label, active = false) {
    listening = active;
    button.classList.toggle("listening", active);
    button.textContent = label;
    button.setAttribute("aria-pressed", String(active));
  }

  function setListening(value) {
    listening = value;
    setButtonState(listening ? "Listening..." : "Use Voice", listening);
  }

  function clearStopTimer() {
    if (!stopTimer) return;
    window.clearTimeout(stopTimer);
    stopTimer = null;
  }

  function showMessage(message) {
    if (statusElement) {
      statusElement.hidden = false;
      statusElement.textContent = message;
    }
    setMessage?.(message);
  }

  async function appendTranscript(transcript) {
    const cleaned = transcript.trim();
    if (!cleaned) return;
    showMessage("Analyzing...");
    const transformed = transformTranscript ? transformTranscript(cleaned) : cleaned;
    const textToAppend = typeof transformed === "string" ? transformed.trim() : String(transformed?.text || "").trim();
    const details = Array.isArray(transformed?.details) ? transformed.details : [];
    if (!textToAppend) {
      showMessage(`Heard: ${cleaned}. No card codes found.`);
      return;
    }
    textarea.value = [textarea.value.trim(), textToAppend].filter(Boolean).join("\n");
    textarea.focus();
    await onTranscript?.(textToAppend, cleaned);
    const mapping = details.length ? details.join(", ") : textToAppend.split(/\s+/).join(", ");
    showMessage(`Heard: ${cleaned}. Normalized: ${mapping}.`);
  }

  if (!SpeechRecognition) {
    button.addEventListener("click", () => {
      textarea.focus();
      setButtonState("Use Voice");
      showMessage("Voice recognition is not available here. Tap the text box and use the keyboard microphone.");
    });
    return;
  }

  button.addEventListener("click", () => {
    if (listening && recognition) {
      recognition.stop();
      return;
    }

    setButtonState("Starting...", true);
    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";
    let latestTranscript = "";

    recognition.addEventListener("start", () => {
      setListening(true);
      showMessage("Listening...");
      clearStopTimer();
      stopTimer = window.setTimeout(() => recognition?.stop(), 12000);
    });

    recognition.addEventListener("result", (event) => {
      clearStopTimer();
      stopTimer = window.setTimeout(() => recognition?.stop(), 2500);
      const parts = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0].transcript;
        parts.push(transcript);
        if (result.isFinal) finalTranscript += ` ${transcript}`;
      }
      latestTranscript = parts.join(" ").trim() || latestTranscript;
      if (latestTranscript) showMessage(`Listening: ${latestTranscript}`);
      else if (parts.length) showMessage("Listening...");
    });

    recognition.addEventListener("error", (event) => {
      clearStopTimer();
      setListening(false);
      const reason = event.error === "not-allowed" ? "Microphone permission was blocked." : "Voice input could not start.";
      showMessage(`${reason} Tap the text box and use the keyboard microphone.`);
    });

    recognition.addEventListener("end", async () => {
      clearStopTimer();
      setListening(false);
      const transcript = finalTranscript.trim() || latestTranscript.trim();
      if (transcript) await appendTranscript(transcript);
      else showMessage("No voice text captured.");
    });

    try {
      recognition.start();
    } catch {
      clearStopTimer();
      setButtonState("Use Voice");
      showMessage("Voice input could not start. Tap the text box and use the keyboard microphone.");
    }
  });
}
