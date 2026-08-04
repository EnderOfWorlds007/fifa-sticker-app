export function attachVoiceInput({ button, textarea, onTranscript, setMessage }) {
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
    textarea.value = [textarea.value.trim(), cleaned].filter(Boolean).join("\n");
    textarea.focus();
    onTranscript?.(cleaned);
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

    recognition.addEventListener("start", () => {
      setListening(true);
      setMessage?.("Listening...");
    });

    recognition.addEventListener("result", (event) => {
      const parts = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalTranscript += ` ${result[0].transcript}`;
        else parts.push(result[0].transcript);
      }
      if (parts.length) setMessage?.(`Listening... ${parts.join(" ")}`);
    });

    recognition.addEventListener("error", () => {
      setMessage?.("Voice input could not start. You can still use the keyboard microphone.");
    });

    recognition.addEventListener("end", () => {
      setListening(false);
      if (finalTranscript.trim()) appendTranscript(finalTranscript);
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
