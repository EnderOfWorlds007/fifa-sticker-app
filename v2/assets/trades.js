import {
  loadLedger,
  saveLedger,
  transactionDetailLines,
  tradeGroups,
  transitionTransactionStatus,
} from "/fifa-sticker-app/v2/assets/trade_state.js?v=build-93af2b41d674";

const lists = {
  draft: document.querySelector("#draftTradesList"),
  reserved: document.querySelector("#reservedTradesList"),
  completed: document.querySelector("#completedTradesList"),
  cancelled: document.querySelector("#cancelledTradesList"),
};
const status = document.querySelector("#tradesStatus");

function renderTrades() {
  const groups = tradeGroups(loadLedger());
  for (const state of Object.keys(lists)) {
    const items = groups[state] || [];
    lists[state].replaceChildren(...(items.length ? items.map((transaction) => rowFor(transaction)) : [emptyRow(state)]));
  }
}

function rowFor(transaction) {
  const row = document.createElement("li");
  row.className = transaction.status === "completed" || transaction.status === "reserved" ? "found" : "missing";

  const code = document.createElement("strong");
  code.textContent = transaction.status;

  const detail = document.createElement("span");
  detail.textContent = `${lineCount(transaction.received)} in · ${lineCount(transaction.given)} out`;

  row.append(code, detail, activityDetailList(transaction));

  if (transaction.status === "draft" || transaction.status === "reserved") {
    const open = document.createElement("a");
    open.className = "buttonLike secondary";
    open.href = `/fifa-sticker-app/v2/trade/#trade=${encodeURIComponent(transaction.id)}`;
    open.textContent = "Open";
    const cancel = document.createElement("button");
    cancel.className = "secondaryButton";
    cancel.type = "button";
    cancel.dataset.cancelTrade = transaction.id;
    cancel.textContent = "Cancel";
    row.append(open, cancel);
  } else if (transaction.status === "completed") {
    const collection = document.createElement("a");
    collection.className = "buttonLike secondary";
    collection.href = "/fifa-sticker-app/v2/collection/#activity";
    collection.textContent = "Activity";
    row.append(collection);
  }
  return row;
}

function activityDetailList(transaction) {
  const lines = transactionDetailLines(transaction);
  const list = document.createElement("ul");
  list.className = "transactionDetails";
  if (!lines.length) {
    const item = document.createElement("li");
    item.textContent = "No card changes.";
    list.append(item);
    return list;
  }
  list.append(...lines.map((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    return item;
  }));
  return list;
}

function emptyRow(state) {
  const row = document.createElement("li");
  row.className = "empty";
  row.textContent = `No ${state} trades.`;
  return row;
}

function lineCount(lines) {
  return lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
}

function cancelTrade(transactionId) {
  if (!window.confirm("Cancel this trade and release any reservation?")) return;
  try {
    saveLedger(transitionTransactionStatus(loadLedger(), transactionId, "cancelled"));
    status.textContent = "Trade cancelled.";
    renderTrades();
  } catch (error) {
    status.textContent = error.message || "Could not cancel trade.";
  }
}

document.addEventListener("click", (event) => {
  const transactionId = event.target?.dataset?.cancelTrade;
  if (transactionId) cancelTrade(transactionId);
});

renderTrades();
