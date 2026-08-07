import { formatCodeInput } from "./card_parser.js?v=voice-lang-1";
import { recognitionBaseUrl, recognitionUrl } from "./recognition_config.js?v=stable-ocr-1";

const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

let tesseractPromise;

export async function scanPhotoForCodes(file) {
  if (recognitionBaseUrl()) return scanPhotoWithBackend(file);
  return scanPhotoInBrowser(file);
}

async function scanPhotoWithBackend(file) {
  const response = await fetch(recognitionUrl("/api/photo-codes"), {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) throw new Error("photo OCR unavailable");
  return response.json();
}

export async function scanPhotoInBrowser(file) {
  const Tesseract = await loadTesseract();
  const result = await Tesseract.recognize(file, "eng");
  return codesPayloadFromText(result?.data?.text || "");
}

export function codesPayloadFromText(rawText) {
  const groupedText = formatCodeInput(rawText);
  const codes = groupedText.split(/\s+/).filter(Boolean);
  return {
    schema_version: 1,
    source: "browser-ocr",
    raw_text: rawText,
    codes,
    grouped_text: groupedText,
    code_count: codes.length,
    unique_code_count: new Set(codes).size,
  };
}

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TESSERACT_SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error("browser OCR did not load"));
      };
      script.onerror = () => reject(new Error("browser OCR did not load"));
      document.head.append(script);
    });
  }
  return tesseractPromise;
}
