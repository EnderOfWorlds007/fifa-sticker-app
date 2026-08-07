const STORAGE_KEY = "panini.recognitionBaseUrl.v1";

export function normalizeRecognitionBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function applyRecognitionBaseUrlFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("ocr") || params.get("recognitionBaseUrl");
  if (value === null) return;
  const normalized = normalizeRecognitionBaseUrl(value);
  if (normalized) {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  } else if (value.trim() === "") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function recognitionBaseUrl() {
  const stored = normalizeRecognitionBaseUrl(window.localStorage.getItem(STORAGE_KEY));
  if (stored) return stored;
  return normalizeRecognitionBaseUrl(window.PANINI_CONFIG?.recognitionBaseUrl);
}

export function recognitionUrl(path) {
  const base = recognitionBaseUrl();
  if (!base) throw new Error("photo OCR backend is not configured");
  return `${base}${path}`;
}

export function recognitionErrorMessage(error) {
  if (error?.message === "photo OCR backend is not configured") {
    return "Photo OCR backend is not configured.";
  }
  if (error?.message === "browser OCR did not load") {
    return "Browser photo OCR could not start. Check your connection and try again.";
  }
  return "Could not read those photos. Make sure the scanner backend is running.";
}
