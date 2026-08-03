const config = window.PANINI_CONFIG || {};
const recognitionBaseUrl = String(config.recognitionBaseUrl || "").replace(/\/$/, "");
const scannerLink = document.querySelector("#scannerAppLink");

if (recognitionBaseUrl && scannerLink) {
  scannerLink.href = `${recognitionBaseUrl}/scanner`;
}
