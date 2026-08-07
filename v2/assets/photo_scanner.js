const config = window.PANINI_CONFIG || {};
const recognitionBaseUrl = String(config.recognitionBaseUrl || "").replace(/\/$/, "");
const input = document.querySelector("#photoScannerInput");
const side = document.querySelector("#photoScannerSide");
const scanButton = document.querySelector("#photoScannerButton");
const copyButton = document.querySelector("#photoScannerCopyButton");
const status = document.querySelector("#photoScannerStatus");
const result = document.querySelector("#photoScannerResult");
const codesList = document.querySelector("#photoScannerCodes");

scanButton?.addEventListener("click", () => scanPhoto());
copyButton?.addEventListener("click", async () => {
  if (!result.value) return;
  await navigator.clipboard?.writeText(result.value);
  status.textContent = "Codes copied.";
});

async function scanPhoto() {
  const file = input?.files?.[0];
  if (!file) {
    status.textContent = "Choose a photo first.";
    return;
  }
  if (!recognitionBaseUrl) {
    status.textContent = "Recognition backend is not configured for this deployment.";
    return;
  }
  scanButton.disabled = true;
  copyButton.disabled = true;
  result.value = "";
  codesList.replaceChildren(emptyRow("Scanning..."));
  status.textContent = "Uploading photo...";
  try {
    const job = await createPhotoCodeJob(file);
    const payload = await waitForPhotoCodeJob(job.job_id);
    renderResult(payload.result || payload);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Photo scan failed.";
    codesList.replaceChildren(emptyRow("No result."));
  } finally {
    scanButton.disabled = false;
  }
}

async function createPhotoCodeJob(file) {
  const response = await fetch(`${recognitionBaseUrl}/api/photo-code-jobs`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Panini-Expected-Side": side.value || "front",
    },
    body: file,
  });
  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  return response.json();
}

async function waitForPhotoCodeJob(jobId) {
  if (!jobId) throw new Error("Backend did not return a job id.");
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await fetch(`${recognitionBaseUrl}/api/photo-code-jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Recognition status failed (${response.status}).`);
    const payload = await response.json();
    if (payload.status === "done") return payload;
    if (payload.status === "error") throw new Error(payload.error || "Photo recognition failed.");
    status.textContent = payload.status === "running" ? "Recognizing photo..." : "Waiting for recognizer...";
    await delay(1000);
  }
  throw new Error("Recognition timed out.");
}

function renderResult(payload) {
  const codes = Array.isArray(payload?.codes) ? payload.codes : [];
  const text = String(payload?.grouped_text || codes.join(", "));
  result.value = text;
  copyButton.disabled = !text;
  status.textContent = codes.length
    ? `${codes.length} cards recognized.`
    : "No cards recognized in that photo.";
  codesList.replaceChildren(...(codes.length ? codes.map(codeRow) : [emptyRow("No recognized codes.")]));
}

function codeRow(code) {
  const row = document.createElement("li");
  row.className = "found";
  row.innerHTML = `<strong>${code}</strong><span>Recognized</span>`;
  return row;
}

function emptyRow(text) {
  const row = document.createElement("li");
  row.className = "empty";
  row.textContent = text;
  return row;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
