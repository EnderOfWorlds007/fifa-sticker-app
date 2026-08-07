const config = window.PANINI_CONFIG || {};
const recognitionBaseUrl = String(config.recognitionBaseUrl || "").replace(/\/$/, "");
const scannerLinks = document.querySelectorAll("[data-scan-link]");

if (recognitionBaseUrl) {
  for (const scannerLink of scannerLinks) {
    scannerLink.href = `${recognitionBaseUrl}/scanner`;
  }
}
