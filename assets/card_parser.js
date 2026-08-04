const TEAM_ALIASES = aliasMap({
  alg: "ALG", algeria: "ALG", argelia: "ALG", algerie: "ALG", algerien: "ALG",
  arg: "ARG", argentina: "ARG", argentine: "ARG", argentinien: "ARG",
  aus: "AUS", australia: "AUS", australie: "AUS", australien: "AUS",
  aut: "AUT", austria: "AUT", autriche: "AUT", osterreich: "AUT", österreich: "AUT",
  bel: "BEL", belgium: "BEL", belgica: "BEL", bélgica: "BEL", belgique: "BEL", belgien: "BEL",
  bih: "BIH", bosnia: "BIH", bosniaherzegovina: "BIH", "bosnia herzegovina": "BIH", bosnie: "BIH", bosnien: "BIH",
  bra: "BRA", brazil: "BRA", brasil: "BRA", bresil: "BRA", brésil: "BRA", brasilien: "BRA",
  can: "CAN", canada: "CAN", canadá: "CAN", kanada: "CAN",
  cc: "CC", coca: "CC", cocacola: "CC", "coca cola": "CC",
  civ: "CIV", ivorycoast: "CIV", "ivory coast": "CIV", costademarfil: "CIV", "costa de marfil": "CIV", cotedivoire: "CIV", "cote divoire": "CIV",
  cod: "COD", congo: "COD", drcongo: "COD", "dr congo": "COD", rdcongo: "COD", "rd congo": "COD",
  col: "COL", colombia: "COL", colombie: "COL", kolumbien: "COL",
  cpv: "CPV", capeverde: "CPV", "cape verde": "CPV", caboverde: "CPV", "cabo verde": "CPV", capvert: "CPV", "cap vert": "CPV", kapverde: "CPV",
  cro: "CRO", croatia: "CRO", croacia: "CRO", croatie: "CRO", kroatien: "CRO",
  cuw: "CUW", curacao: "CUW", curaçao: "CUW",
  cze: "CZE", czechia: "CZE", czech: "CZE", czechrepublic: "CZE", "czech republic": "CZE", tchequie: "CZE", tschechien: "CZE",
  ecu: "ECU", ecuador: "ECU", equateur: "ECU", équateur: "ECU", ekuador: "ECU",
  egy: "EGY", egypt: "EGY", egipto: "EGY", egypte: "EGY", agypten: "EGY", ägypten: "EGY",
  eng: "ENG", england: "ENG", inglaterra: "ENG", angleterre: "ENG",
  esp: "ESP", spain: "ESP", espana: "ESP", españa: "ESP", espagne: "ESP", spanien: "ESP",
  fra: "FRA", france: "FRA", francia: "FRA", frankreich: "FRA",
  fwc: "FWC", worldcup: "FWC", "world cup": "FWC", mundial: "FWC", coupe: "FWC",
  ger: "GER", gr: "GER", germ: "GER", germany: "GER", german: "GER", alemania: "GER", allemagne: "GER", deutschland: "GER",
  gha: "GHA", ghana: "GHA",
  hai: "HAI", haiti: "HAI", haití: "HAI",
  irq: "IRQ", iraq: "IRQ", irak: "IRQ",
  irn: "IRN", iran: "IRN",
  jor: "JOR", jordan: "JOR", jordania: "JOR", jordanie: "JOR", jordanien: "JOR",
  jpn: "JPN", japan: "JPN", japon: "JPN", japón: "JPN",
  kor: "KOR", korea: "KOR", southkorea: "KOR", "south korea": "KOR", corea: "KOR", coreedusud: "KOR", "coree du sud": "KOR", koreasud: "KOR", "korea sud": "KOR", sudkorea: "KOR",
  ksa: "KSA", saudi: "KSA", saudiarabia: "KSA", "saudi arabia": "KSA", arabiasaudita: "KSA", "arabia saudita": "KSA",
  mar: "MAR", morocco: "MAR", marruecos: "MAR", maroc: "MAR", marokko: "MAR",
  mex: "MEX", mexico: "MEX", méxico: "MEX", mexique: "MEX", mexiko: "MEX",
  ned: "NED", netherlands: "NED", holland: "NED", holanda: "NED", paysbas: "NED", "pays bas": "NED", niederlande: "NED",
  nor: "NOR", norway: "NOR", noruega: "NOR", norvege: "NOR", norvège: "NOR", norwegen: "NOR",
  nzl: "NZL", newzealand: "NZL", "new zealand": "NZL", nuevazelanda: "NZL", "nueva zelanda": "NZL", nouvellezelande: "NZL", "nouvelle zelande": "NZL", neuseeland: "NZL",
  pan: "PAN", panama: "PAN",
  par: "PAR", paraguay: "PAR",
  por: "POR", portugal: "POR",
  qat: "QAT", qatar: "QAT",
  rsa: "RSA", southafrica: "RSA", "south africa": "RSA", sudafrica: "RSA", "afrique du sud": "RSA", sudafrika: "RSA",
  sco: "SCO", scotland: "SCO", escocia: "SCO", ecosse: "SCO", schottland: "SCO",
  sen: "SEN", senegal: "SEN",
  sui: "SUI", swiss: "SUI", switzerland: "SUI", suisse: "SUI", suiza: "SUI", schweiz: "SUI",
  swe: "SWE", sweden: "SWE", suecia: "SWE", suede: "SWE", suède: "SWE", schweden: "SWE",
  tun: "TUN", tunisia: "TUN", tunez: "TUN", túnez: "TUN", tunisie: "TUN", tunesien: "TUN",
  tur: "TUR", turkey: "TUR", turkiye: "TUR", türkiye: "TUR", turquia: "TUR", turquie: "TUR", turkei: "TUR", türkei: "TUR",
  uru: "URU", uruguay: "URU",
  usa: "USA", unitedstates: "USA", "united states": "USA", estadosunidos: "USA", "estados unidos": "USA", etatsunis: "USA", "etats unis": "USA", vereinigtestaaten: "USA", "vereinigte staaten": "USA", eeuu: "USA",
  uzb: "UZB", uzbekistan: "UZB", ousbekistan: "UZB",
});

const TEAM_CODES = new Set(TEAM_ALIASES.values());
const NUMBER_WORDS = new Map(Object.entries({
  ZERO: 0,
  OH: 0,
  O: 0,
  ONE: 1,
  WON: 1,
  TWO: 2,
  TO: 2,
  TOO: 2,
  THREE: 3,
  FOUR: 4,
  FOR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  ATE: 8,
  NINE: 9,
  TEN: 10,
  ELEVEN: 11,
  TWELVE: 12,
  THIRTEEN: 13,
  FOURTEEN: 14,
  FIFTEEN: 15,
  SIXTEEN: 16,
  SEVENTEEN: 17,
  EIGHTEEN: 18,
  NINETEEN: 19,
  TWENTY: 20,
}));

const NUMBER_TOKEN = `(?:\\d{1,2}|${[...NUMBER_WORDS.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})`;
const NUMBER_VALUE_PATTERN = new RegExp(`${NUMBER_TOKEN}(?:\\s+${NUMBER_TOKEN})?`, "g");
const NUMBER_CAPTURE = `(${NUMBER_TOKEN}(?:\\s+${NUMBER_TOKEN})?)`;
const TEAM_ALIAS_TOKEN = `${[...TEAM_ALIASES.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")}|[A-Z]{2,4}`;
const ALIAS_PATTERN = new RegExp(
  `(?<![A-Z0-9])(${[...TEAM_ALIASES.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})\\s*[-–—_./]?\\s*${NUMBER_CAPTURE}(?![A-Z0-9])`,
  "g",
);

export function extractCodeOccurrences(value) {
  const upper = normalizeParseText(value);
  const occurrences = new Map();
  const firstPositions = new Map();
  const inlineSpans = [];
  const add = (team, number, position) => {
    const normalizedNumber = normalizeNumber(number);
    if (normalizedNumber < 1 || normalizedNumber > 20) return false;
    const normalizedTeam = normalizeTeam(team);
    if (!normalizedTeam) return false;
    const code = `${normalizedTeam}${normalizedNumber}`;
    occurrences.set(code, (occurrences.get(code) || 0) + 1);
    firstPositions.set(code, Math.min(firstPositions.get(code) ?? Number.MAX_SAFE_INTEGER, position));
    return true;
  };
  const inlinePattern = new RegExp(`(?<![A-Z0-9])([A-Z]{2,4})\\s*[-–—_./]?\\s*${NUMBER_CAPTURE}(?![A-Z0-9])`, "g");
  for (const match of upper.matchAll(inlinePattern)) {
    if (add(match[1], match[2], match.index)) inlineSpans.push([match.index, match.index + match[0].length]);
  }
  for (const match of upper.matchAll(ALIAS_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (inlineSpans.some(([spanStart, spanEnd]) => spanStart < end && start < spanEnd)) continue;
    add(TEAM_ALIASES.get(match[1]), match[2], start);
  }
  const groupedPattern = new RegExp(`^\\s*(${TEAM_ALIAS_TOKEN})(?:\\s+[^:\\d\\n]+)?\\s*:\\s*([^\\n]+)`, "gm");
  for (const match of upper.matchAll(groupedPattern)) {
    const start = match.index;
    if (inlineSpans.some(([spanStart, spanEnd]) => spanStart <= start && start < spanEnd)) continue;
    for (const numberMatch of match[2].matchAll(NUMBER_VALUE_PATTERN)) {
      add(match[1], numberMatch[0], start + match[0].indexOf(match[2]) + numberMatch.index);
    }
  }
  return new Map([...occurrences.entries()].sort(([a], [b]) => firstPositions.get(a) - firstPositions.get(b)));
}

export function formatCodeInput(value) {
  return [...extractCodeOccurrences(value).keys()].join("\n");
}

function normalizeTeam(team) {
  const normalized = normalizeParseText(team).replace(/\s+/g, "");
  const alias = TEAM_ALIASES.get(normalized) || TEAM_ALIASES.get(normalizeParseText(team));
  if (alias) return alias;
  return TEAM_CODES.has(normalized) ? normalized : "";
}

function normalizeParseText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function normalizeNumber(value) {
  const tokens = normalizeParseText(value).match(/\d{1,2}|[A-Z]+/g) || [];
  if (!tokens.length) return Number.NaN;
  if (tokens.length === 1) return tokenNumber(tokens[0]);
  const first = tokenNumber(tokens[0]);
  const second = tokenNumber(tokens[1]);
  if (first === 1 && second >= 0 && second <= 9) return 10 + second;
  if (first === 2 && second === 0) return 20;
  return first;
}

function tokenNumber(token) {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  return NUMBER_WORDS.get(token) ?? Number.NaN;
}

function aliasMap(values) {
  return new Map(Object.entries(values).map(([alias, code]) => [normalizeParseText(alias), code]));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
