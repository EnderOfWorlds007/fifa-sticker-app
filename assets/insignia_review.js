const progress = document.querySelector("#reviewProgress");
const progressValue = document.querySelector("#reviewProgressValue");
const code = document.querySelector("#reviewCode");
const prediction = document.querySelector("#reviewPrediction");
const crop = document.querySelector("#cardCrop");
const centerCrop = document.querySelector("#centerCrop");
let decisions = []; let index = 0;

async function init() {
  const response = await fetch("/fifa-sticker-app/api/back-insignia-review", { cache: "no-store" });
  if (!response.ok) { progress.textContent = "Could not load the review queue."; return; }
  const payload = await response.json(); decisions = payload.decisions || [];
  index = Math.max(0, decisions.findIndex((item) => !item.reviewed)); if (index < 0) index = 0; render();
}
function render() {
  const reviewed = decisions.filter((item) => item.reviewed).length;
  progress.textContent = decisions.length ? `${index + 1} / ${decisions.length} · ${reviewed} reviewed` : "No cards queued.";
  progressValue.style.width = `${decisions.length ? Math.round(reviewed / decisions.length * 100) : 0}%`;
  if (!decisions[index]) return;
  const item = decisions[index]; code.textContent = item.code; prediction.textContent = `Current guess: ${item.predicted_label}`; crop.src = item.crop_url; centerCrop.src = item.center_crop_url;
}
async function decide(decision) {
  const item = decisions[index]; if (!item) return;
  const response = await fetch("/fifa-sticker-app/api/back-insignia-review/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, decision, code: item.code, predicted_type: item.predicted_type, predicted_confidence: item.predicted_confidence }) });
  if (!response.ok) { progress.textContent = "Save failed. Try again."; return; }
  item.reviewed = decision !== "skip"; index += 1; while (decisions[index]?.reviewed) index += 1; render();
}
document.querySelector("#markGreen").addEventListener("click", () => decide("green"));
document.querySelector("#markBlue").addEventListener("click", () => decide("blue"));
document.querySelector("#markOther").addEventListener("click", () => decide("other_layout"));
document.querySelector("#markWrongCrop").addEventListener("click", () => decide("wrong_crop"));
document.querySelector("#markNotVisible").addEventListener("click", () => decide("not_visible"));
document.querySelector("#skipDecision").addEventListener("click", () => decide("skip"));
init();
