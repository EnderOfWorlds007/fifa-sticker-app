import { loadInventoryProjection } from "./inventory_projection.js?v=build-a82f4c19d6e7";
import { extractCodeOccurrences } from "./trade_state.js?v=build-a82f4c19d6e7";
import {
  classifyScannedCards,
  dominantScannedCardStatus,
  expandCodeOccurrences,
  groupScannedCardStatuses,
  scannedCardGroupDetail,
  scannedCardStatusSummaryText,
  summarizeScannedCardStatuses,
} from "./scan_card_status.js?v=build-a82f4c19d6e7";

export function mountPasteCardStatusPreview({
  textarea,
  insertAfter = textarea,
  title = "Parsed card status",
  getCollectionModel = defaultCollectionModel,
  debounceMs = 120,
} = {}) {
  if (!textarea || !insertAfter) return null;
  const panel = document.createElement("section");
  panel.className = "pasteCardStatusPreview";
  panel.hidden = true;
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = `
    <div class="pasteCardStatusHeader">
      <strong></strong>
      <span data-paste-card-count></span>
    </div>
    <p data-paste-card-summary></p>
    <ol class="pasteCardStatusList" data-paste-card-list></ol>
  `;
  panel.querySelector(".pasteCardStatusHeader strong").textContent = title;
  insertAfter.after(panel);

  let timer = null;
  let requestId = 0;
  const refresh = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => refreshNow(), debounceMs);
  };
  const refreshNow = async () => {
    const value = textarea.value.trim();
    const currentRequest = ++requestId;
    if (!value) {
      panel.hidden = true;
      return;
    }
    const occurrences = extractCodeOccurrences(value);
    panel.hidden = false;
    if (!occurrences.size) {
      renderUnavailablePreview(panel, "No card codes recognized yet.", []);
      return;
    }
    const codes = expandCodeOccurrences(occurrences);
    panel.querySelector("[data-paste-card-summary]").textContent = "Checking your collection…";
    try {
      const model = await getCollectionModel();
      if (currentRequest !== requestId || textarea.value.trim() !== value) return;
      renderPasteCardStatuses(panel, classifyScannedCards(codes, model));
    } catch {
      if (currentRequest !== requestId || textarea.value.trim() !== value) return;
      renderUnavailablePreview(panel, `${codes.length} parsed · collection status unavailable`, codes);
    }
  };
  textarea.addEventListener("input", refresh);
  refresh();
  return { panel, refresh, refreshNow };
}

export function renderPasteCardStatuses(panel, statuses) {
  const summary = summarizeScannedCardStatuses(statuses);
  const groups = groupScannedCardStatuses(statuses);
  panel.querySelector("[data-paste-card-count]").textContent = `${statuses.length} parsed`;
  panel.querySelector("[data-paste-card-summary]").textContent = scannedCardStatusSummaryText(summary);
  renderPastedCardStatusList(panel.querySelector("[data-paste-card-list]"), groups);
}

export function renderPastedCardStatusList(list, groups) {
  const visible = (Array.isArray(groups) ? groups : []).slice(0, 60);
  const rows = visible.map((group) => {
    const item = document.createElement("li");
    item.className = `found ${dominantScannedCardStatus(group)}`;
    const code = document.createElement("strong");
    code.textContent = `${group.code}${group.quantity > 1 ? ` ×${group.quantity}` : ""}`;
    const detail = document.createElement("span");
    detail.textContent = scannedCardGroupDetail(group);
    item.append(code, detail);
    return item;
  });
  if (groups.length > visible.length) {
    const overflow = document.createElement("li");
    overflow.className = "empty";
    overflow.textContent = `${groups.length - visible.length} more parsed codes…`;
    rows.push(overflow);
  }
  list.replaceChildren(...rows);
}

async function defaultCollectionModel() {
  return (await loadInventoryProjection()).collectionModel;
}

function renderUnavailablePreview(panel, message, codes) {
  panel.querySelector("[data-paste-card-count]").textContent = codes.length ? `${codes.length} parsed` : "";
  panel.querySelector("[data-paste-card-summary]").textContent = message;
  const groups = [...new Set(codes)].map((code) => ({
    code,
    quantity: codes.filter((item) => item === code).length,
  }));
  const list = panel.querySelector("[data-paste-card-list]");
  list.replaceChildren(...groups.slice(0, 60).map((group) => {
    const item = document.createElement("li");
    const code = document.createElement("strong");
    code.textContent = `${group.code}${group.quantity > 1 ? ` ×${group.quantity}` : ""}`;
    const detail = document.createElement("span");
    detail.textContent = "Collection status unavailable";
    item.append(code, detail);
    return item;
  }));
}
