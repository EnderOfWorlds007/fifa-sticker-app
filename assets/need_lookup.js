const STARTING_MISSING = {
  MEX: [7, 12, 15, 17],
  RSA: [6, 10],
  CZE: [5, 8, 13],
  CAN: [4, 16],
  BIH: [2, 3, 9, 14, 16],
  SUI: [9, 13],
  HAI: [3, 4, 7, 17],
  SCO: [10, 13],
  MAR: [15],
  BRA: [10],
  QAT: [16, 19, 20],
  USA: [2, 7],
  CUW: [15],
  NED: [15],
  ECU: [5, 7, 8, 15],
  CIV: [2, 8, 12, 17],
  GER: [3, 14, 15, 16],
  AUS: [8, 11, 13, 14, 16, 18],
  PAR: [2, 6, 18],
  JPN: [9, 10],
  SWE: [3, 5],
  TUN: [3, 8, 9, 10],
  EGY: [12],
  IRN: [6],
  NZL: [10],
  ESP: [7],
  CPV: [14],
  KSA: [7],
  URU: [19],
  SEN: [9, 13],
  NOR: [3, 20],
  AUT: [2, 18],
  POR: [3, 8],
  JOR: [6, 10],
  ALG: [12, 17],
  ARG: [8, 10, 15, 16, 17],
  IRQ: [2, 9, 13, 16],
  FRA: [1, 17, 19],
  COD: [1, 2, 10, 15, 16, 20],
  UZB: [2],
  GHA: [16, 20],
  CRO: [13],
  ENG: [4, 13, 19],
  FWC: [1, 12],
  CC: [1, 3],
};

const STORAGE_KEY = "panini.collectionTracker.v1";
const text = document.querySelector("#needLookupText");
const button = document.querySelector("#needLookupButton");
const clearButton = document.querySelector("#clearNeedLookupButton");
const summary = document.querySelector("#needLookupSummary");
const results = document.querySelector("#needLookupResults");
const copyReply = document.querySelector("#needCopyReply");
const replyText = document.querySelector("#needReplyText");
const copyReplyButton = document.querySelector("#copyNeedReplyButton");

const trackedCards = Object.entries(STARTING_MISSING).flatMap(([team, numbers]) =>
  numbers.map((number) => `${team}${number}`),
);

function lookupNeeds() {
  const value = text.value.trim();
  if (!value) {
    summary.textContent = "Paste at least one card code first.";
    results.replaceChildren();
    copyReply.hidden = true;
    return;
  }

  const occurrences = extractCodeOccurrences(value);
  const collected = collectedSet();
  const stillMissing = new Set(trackedCards.filter((code) => !collected.has(code)));
  const parsed = [...occurrences.entries()].sort(([a], [b]) => sortCode(a, b));
  const rows = parsed.map(([code, occurrences]) => {
    const tracked = trackedCards.includes(code);
    const needed = stillMissing.has(code);
    return {
      code,
      occurrences,
      needed,
      status: needed ? "need" : tracked ? "already" : "notTracked",
    };
  });
  const neededRows = rows.filter((row) => row.needed);

  summary.textContent = `${neededRows.length}/${rows.length} unique codes are still needed · ${[...occurrences.values()].reduce((sum, count) => sum + count, 0)} code mentions parsed`;
  results.replaceChildren(...rows.map(resultRow));
  replyText.value = neededRows.length
    ? `I need: ${groupCodes(neededRows.map((row) => row.code))}.`
    : "I do not need any of those cards.";
  copyReply.hidden = false;
}

function resultRow(item) {
  const row = document.createElement("li");
  row.className = item.needed ? "found" : "missing";
  const detail = item.needed
    ? "Still missing from your collection"
    : item.status === "already"
      ? "Already marked collected"
      : "Not on your tracked missing list";
  row.innerHTML = `<strong>${item.code}</strong><span>${detail}${item.occurrences > 1 ? ` · mentioned ${item.occurrences}x` : ""}</span>`;
  return row;
}

function collectedSet() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return new Set(Array.isArray(parsed.collected) ? parsed.collected : []);
  } catch {
    return new Set();
  }
}

function extractCodeOccurrences(value) {
  const upper = value.toUpperCase();
  const occurrences = new Map();
  const inlineSpans = [];
  const add = (team, number) => {
    const code = `${team}${Number(number)}`;
    occurrences.set(code, (occurrences.get(code) || 0) + 1);
  };
  const inlinePattern = /(?<![A-Z0-9])([A-Z]{2,3})\s*[-–—_./]?\s*(\d{1,2})(?![A-Z0-9])/g;
  for (const match of upper.matchAll(inlinePattern)) {
    add(match[1], match[2]);
    inlineSpans.push([match.index, match.index + match[0].length]);
  }
  const groupedPattern = /^\s*([A-Z]{2,3})\s*:\s*([0-9][0-9\s,;/&+.-]*)/gm;
  for (const match of upper.matchAll(groupedPattern)) {
    const start = match.index;
    if (inlineSpans.some(([spanStart, spanEnd]) => spanStart <= start && start < spanEnd)) continue;
    for (const number of match[2].match(/\d{1,2}/g) || []) add(match[1], number);
  }
  return occurrences;
}

function groupCodes(codes) {
  const groups = codes.sort(sortCode).reduce((acc, code) => {
    const match = code.match(/^([A-Z]+)(\d+)$/);
    if (!match) return acc;
    if (!acc.has(match[1])) acc.set(match[1], []);
    acc.get(match[1]).push(Number(match[2]));
    return acc;
  }, new Map());
  return [...groups.entries()].map(([team, numbers]) => `${team}: ${numbers.join(", ")}`).join("; ");
}

function sortCode(a, b) {
  const aMatch = String(a || "").match(/^([A-Z]+)(\d+)$/);
  const bMatch = String(b || "").match(/^([A-Z]+)(\d+)$/);
  if (!aMatch || !bMatch) return String(a || "").localeCompare(String(b || ""));
  return aMatch[1].localeCompare(bMatch[1]) || Number(aMatch[2]) - Number(bMatch[2]);
}

function clearLookup() {
  text.value = "";
  summary.textContent = "Paste their available cards, then check them against your missing list.";
  results.replaceChildren();
  replyText.value = "";
  copyReply.hidden = true;
  text.focus();
}

copyReplyButton.addEventListener("click", async () => {
  if (!replyText.value) return;
  try {
    await navigator.clipboard.writeText(replyText.value);
    copyReplyButton.textContent = "Copied";
    window.setTimeout(() => { copyReplyButton.textContent = "Copy reply"; }, 1200);
  } catch {
    replyText.focus();
    replyText.select();
  }
});

button.addEventListener("click", lookupNeeds);
clearButton.addEventListener("click", clearLookup);
text.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") lookupNeeds();
});
