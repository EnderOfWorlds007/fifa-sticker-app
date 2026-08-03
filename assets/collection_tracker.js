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
const TRADED_AWAY_KEY = "panini.tradeInventoryRemoved.v1";
const teamList = document.querySelector("#teamList");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const updateText = document.querySelector("#collectionUpdateText");
const status = document.querySelector("#collectionStatus");
const missingCount = document.querySelector("#missingCount");
const collectedCount = document.querySelector("#collectedCount");
const teamCount = document.querySelector("#teamCount");
const progressCount = document.querySelector("#progressCount");
const copyMissingButton = document.querySelector("#copyMissingButton");
const gotCardsButton = document.querySelector("#gotCardsButton");
const tradedAwayButton = document.querySelector("#tradedAwayButton");
const resetButton = document.querySelector("#resetButton");
const filterButtons = [...document.querySelectorAll("[data-filter]")];

const cards = Object.entries(STARTING_MISSING).flatMap(([team, numbers]) =>
  numbers.map((number) => ({
    team,
    number,
    code: `${team}${number}`,
    label: `${team} ${number}`,
  })),
);

let state = loadState();

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      filter: ["missing", "all", "collected"].includes(parsed.filter) ? parsed.filter : "missing",
      collected: Array.isArray(parsed.collected) ? parsed.collected : [],
    };
  } catch {
    return { filter: "missing", collected: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function collectedSet() {
  return new Set(state.collected);
}

function setCardCollected(code, isCollected) {
  const next = collectedSet();
  if (isCollected) next.add(code);
  else next.delete(code);
  state.collected = [...next].sort(sortCode);
  saveState();
  render();
}

function trackedCodeSet() {
  return new Set(cards.map((card) => card.code));
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

function parsedUpdateCodes() {
  const value = updateText.value.trim();
  if (!value) {
    status.textContent = "Paste some card text first.";
    return null;
  }
  const occurrences = extractCodeOccurrences(value);
  if (!occurrences.size) {
    status.textContent = "No card codes found in that text.";
    return null;
  }
  return occurrences;
}

function markGotCards() {
  const occurrences = parsedUpdateCodes();
  if (!occurrences) return;
  const tracked = trackedCodeSet();
  const found = collectedSet();
  const changed = [];
  const ignored = [];
  for (const code of occurrences.keys()) {
    if (!tracked.has(code)) {
      ignored.push(code);
      continue;
    }
    if (!found.has(code)) changed.push(code);
    found.add(code);
  }
  state.collected = [...found].sort(sortCode);
  saveState();
  render();
  const ignoredText = ignored.length ? ` · ignored ${ignored.length} untracked` : "";
  status.textContent = changed.length
    ? `Marked ${changed.length} card${changed.length === 1 ? "" : "s"} as collected${ignoredText}.`
    : `Those tracked cards were already marked collected${ignoredText}.`;
}

function loadTradedAwayCounts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADED_AWAY_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveTradedAwayCounts(counts) {
  localStorage.setItem(TRADED_AWAY_KEY, JSON.stringify(counts));
}

function markTradedAway() {
  const occurrences = parsedUpdateCodes();
  if (!occurrences) return;
  const counts = loadTradedAwayCounts();
  let total = 0;
  for (const [code, count] of occurrences.entries()) {
    counts[code] = Math.max(0, Number(counts[code] || 0)) + count;
    total += count;
  }
  saveTradedAwayCounts(counts);
  status.textContent = `Removed ${total} traded-away card${total === 1 ? "" : "s"} from Cards I Can Give on this phone.`;
}

function sortCode(a, b) {
  const aMatch = a.match(/^([A-Z]+)(\d+)$/);
  const bMatch = b.match(/^([A-Z]+)(\d+)$/);
  if (!aMatch || !bMatch) return a.localeCompare(b);
  return aMatch[1].localeCompare(bMatch[1]) || Number(aMatch[2]) - Number(bMatch[2]);
}

function visibleCards() {
  const found = collectedSet();
  const query = searchInput.value.trim().toUpperCase().replace(/[-_]/g, " ");
  return cards.filter((card) => {
    const isCollected = found.has(card.code);
    if (state.filter === "missing" && isCollected) return false;
    if (state.filter === "collected" && !isCollected) return false;
    if (!query) return true;
    const compactQuery = query.replace(/\s+/g, "");
    return (
      card.team.includes(query) ||
      card.label.includes(query) ||
      card.code.includes(compactQuery)
    );
  });
}

function groupedByTeam(items) {
  return items.reduce((groups, card) => {
    if (!groups.has(card.team)) groups.set(card.team, []);
    groups.get(card.team).push(card);
    return groups;
  }, new Map());
}

function render() {
  const found = collectedSet();
  const visible = visibleCards();
  const groups = groupedByTeam(visible);
  const missing = cards.length - found.size;
  const progress = cards.length ? Math.round((found.size / cards.length) * 100) : 0;

  missingCount.textContent = String(missing);
  collectedCount.textContent = String(found.size);
  teamCount.textContent = String(new Set(cards.map((card) => card.team)).size);
  progressCount.textContent = `${progress}%`;
  status.textContent = `${visible.length} cards shown from ${cards.length} tracked cards.`;

  filterButtons.forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  teamList.replaceChildren(
    ...[...groups.entries()].map(([team, teamCards]) => teamSection(team, teamCards, found)),
  );
  emptyState.hidden = visible.length > 0;
}

function teamSection(team, teamCards, found) {
  const section = document.createElement("section");
  section.className = "collectionTeam";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = team;
  const meta = document.createElement("span");
  const collected = teamCards.filter((card) => found.has(card.code)).length;
  meta.textContent = `${teamCards.length - collected} missing`;
  header.append(title, meta);

  const list = document.createElement("div");
  list.className = "collectionCards";
  list.append(...teamCards.map((card) => cardButton(card, found.has(card.code))));

  section.append(header, list);
  return section;
}

function cardButton(card, isCollected) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "collectionCard";
  button.classList.toggle("collected", isCollected);
  button.setAttribute("aria-pressed", String(isCollected));
  button.setAttribute("aria-label", `${card.label}, ${isCollected ? "collected" : "missing"}`);
  button.innerHTML = `<strong>${card.number}</strong><span>${isCollected ? "Have" : "Need"}</span>`;
  button.addEventListener("click", () => setCardCollected(card.code, !isCollected));
  return button;
}

function missingText() {
  const found = collectedSet();
  return Object.entries(STARTING_MISSING)
    .map(([team, numbers]) => {
      const remaining = numbers.filter((number) => !found.has(`${team}${number}`));
      return remaining.length ? `${team}: ${remaining.join(", ")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function copyMissingList() {
  const text = missingText();
  if (!text) {
    status.textContent = "Everything in this hunt list is marked collected.";
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Missing list copied.";
  } catch {
    status.textContent = text;
  }
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    saveState();
    render();
  });
});

searchInput.addEventListener("input", render);
copyMissingButton.addEventListener("click", copyMissingList);
gotCardsButton.addEventListener("click", markGotCards);
tradedAwayButton.addEventListener("click", markTradedAway);
updateText.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") markGotCards();
});
resetButton.addEventListener("click", () => {
  if (!window.confirm("Reset all collected marks for this tracker?")) return;
  state = { filter: "missing", collected: [] };
  saveState();
  searchInput.value = "";
  render();
});

render();
