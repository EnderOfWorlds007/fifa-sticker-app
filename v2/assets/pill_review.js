const progress = document.querySelector("#reviewProgress");
const progressTrack = document.querySelector("#reviewProgressTrack");
const progressValue = document.querySelector("#reviewProgressValue");
const reviewCode = document.querySelector("#reviewCode");
const reviewVote = document.querySelector("#reviewVote");
const h0Image = document.querySelector("#h0Image");
const markPill = document.querySelector("#markPill");
const explanation = document.querySelector("#decisionExplanation");
const rawScore = document.querySelector("#rawScore");
const detectorSource = document.querySelector("#detectorSource");
const markNonPill = document.querySelector("#markNonPill");
const skipDecision = document.querySelector("#skipDecision");

let decisions = [];
let currentIndex = 0;

init();

async function init() {
  const response = await fetch("/fifa-sticker-app/v2/api/pill-orientation-review", { cache: "no-store" });
  if (!response.ok) {
    progress.textContent = "Could not load review queue.";
    return;
  }
  const payload = await response.json();
  decisions = payload.decisions || [];
  currentIndex = Math.max(0, decisions.findIndex((item) => !item.reviewed));
  if (currentIndex < 0) currentIndex = 0;
  renderCurrent(payload);
}

function renderCurrent(payload = null) {
  if (!decisions.length) {
    progress.textContent = "No decisions found.";
    setProgress(0, 0);
    return;
  }
  if (currentIndex >= decisions.length) {
    progress.textContent = "Review complete.";
    setProgress(decisions.length, decisions.length);
    reviewCode.textContent = "-";
    reviewVote.textContent = "All done";
    explanation.textContent = "Every decision in this queue has been reviewed.";
    h0Image.removeAttribute("src");
    return;
  }
  const item = decisions[currentIndex];
  const reviewed = decisions.filter((decision) => decision.reviewed).length;
  const total = payload?.count || decisions.length;
  progress.textContent = `${currentIndex + 1} / ${total} · ${reviewed} reviewed`;
  setProgress(reviewed, total);
  reviewCode.textContent = item.code || "UNKNOWN";
  reviewVote.textContent = `Model score: ${formatScore(item.raw_score)}`;
  h0Image.src = item.h0_url;
  rawScore.textContent = formatScore(item.raw_score);
  detectorSource.textContent = compactSource(item.detector_source);
  explanation.textContent = explainDecision(item);
}

function setProgress(reviewed, total) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, reviewed / total)) : 0;
  progressValue.style.width = `${Math.round(ratio * 100)}%`;
  progressTrack.setAttribute("aria-valuemax", String(total));
  progressTrack.setAttribute("aria-valuenow", String(reviewed));
  progressTrack.setAttribute("aria-valuetext", `${reviewed} of ${total} reviews complete`);
}

function explainDecision(item) {
  return "Ignore the code and orientation. Mark it as a pill only when this crop contains the dark rounded country-number capsule; otherwise choose Not a pill.";
}

async function saveDecision(decision) {
  if (currentIndex >= decisions.length) return;
  const item = decisions[currentIndex];
  const response = await fetch("/fifa-sticker-app/v2/api/pill-orientation-review/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: item.id,
      code: item.code,
      decision,
      model_vote: item.vote,
      model_score: item.vote_score,
      raw_score: item.raw_score,
      rotated_score: item.rotated_score,
    }),
  });
  if (!response.ok) {
    progress.textContent = "Save failed. Try again.";
    return;
  }
  item.reviewed = decision !== "skip";
  item.skipped = decision === "skip";
  currentIndex += 1;
  while (currentIndex < decisions.length && decisions[currentIndex].reviewed) {
    currentIndex += 1;
  }
  renderCurrent();
}

function formatScore(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toFixed(3);
}

function compactSource(value) {
  if (!value) return "-";
  return String(value).replaceAll(":appearance", "").slice(0, 80);
}

markPill.addEventListener("click", () => saveDecision("h0"));
markNonPill.addEventListener("click", () => saveDecision("non_pill"));
skipDecision.addEventListener("click", () => saveDecision("skip"));
