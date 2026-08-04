export function attachVoiceInput({ button, textarea, transformTranscript, onTranscript, setMessage }) {
  if (!button || !textarea) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  function setListening(value) {
    listening = value;
    button.classList.toggle("listening", listening);
    button.textContent = listening ? "Listening..." : "Use Voice";
    button.setAttribute("aria-pressed", String(listening));
  }

  function appendTranscript(transcript) {
    const cleaned = transcript.trim();
    if (!cleaned) return;
    const textToAppend = transformTranscript ? transformTranscript(cleaned).trim() : cleaned;
    if (!textToAppend) {
      setMessage?.("No card codes found in voice text.");
      return;
    }
    textarea.value = [textarea.value.trim(), textToAppend].filter(Boolean).join("\n");
    textarea.focus();
    onTranscript?.(textToAppend, cleaned);
  }

  if (!SpeechRecognition) {
    button.addEventListener("click", () => {
      textarea.focus();
      setMessage?.("Voice recognition is not available in this browser. Use the keyboard microphone to dictate card names.");
    });
    return;
  }

  button.addEventListener("click", () => {
    if (listening && recognition) {
      recognition.stop();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";
    let latestTranscript = "";

    recognition.addEventListener("start", () => {
      setListening(true);
      setMessage?.("Listening...");
    });

    recognition.addEventListener("result", (event) => {
      const parts = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0].transcript;
        parts.push(transcript);
        if (result.isFinal) finalTranscript += ` ${transcript}`;
      }
      latestTranscript = parts.join(" ").trim() || latestTranscript;
      if (parts.length) setMessage?.("Listening...");
    });

    recognition.addEventListener("error", () => {
      setMessage?.("Voice input could not start. You can still use the keyboard microphone.");
    });

    recognition.addEventListener("end", () => {
      setListening(false);
      const transcript = finalTranscript.trim() || latestTranscript.trim();
      if (transcript) appendTranscript(transcript);
      else setMessage?.("No voice text captured.");
    });

    try {
      recognition.start();
    } catch {
      setListening(false);
      setMessage?.("Voice input is already starting.");
    }
  });
}
