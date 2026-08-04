const TEAM_ALIASES = aliasMap({
  alg: "ALG", algeria: "ALG", argelia: "ALG", algerie: "ALG", algerien: "ALG",
  arg: "ARG", argentina: "ARG", argentine: "ARG", argentinien: "ARG",
  aus: "AUS", australia: "AUS", australie: "AUS", australien: "AUS",
  aut: "AUT", austria: "AUT", autriche: "AUT", osterreich: "AUT", österreich: "AUT",
  bih: "BIH", bosnia: "BIH", bosniaherzegovina: "BIH", "bosnia herzegovina": "BIH", bosnie: "BIH", bosnien: "BIH",
  bra: "BRA", brazil: "BRA", brasil: "BRA", bresil: "BRA", brésil: "BRA", brasilien: "BRA",
  can: "CAN", canada: "CAN", canadá: "CAN", kanada: "CAN",
  cc: "CC", coca: "CC", cocacola: "CC", "coca cola": "CC",
  civ: "CIV", ivorycoast: "CIV", "ivory coast": "CIV", costademarfil: "CIV", "costa de marfil": "CIV", cotedivoire: "CIV", "cote divoire": "CIV",
  cod: "COD", congo: "COD", drcongo: "COD", "dr congo": "COD", rdcongo: "COD", "rd congo": "COD",
  cro: "CRO", croatia: "CRO", croacia: "CRO", croatie: "CRO", kroatien: "CRO",
  cuw: "CUW", curacao: "CUW", curaçao: "CUW",
  cze: "CZE", czechia: "CZE", czech: "CZE", czechrepublic: "CZE", "czech republic": "CZE", tchequie: "CZE", tschechien: "CZE",
  ecu: "ECU", ecuador: "ECU", equateur: "ECU", équateur: "ECU", ekuador: "ECU",
  egy: "EGY", egypt: "EGY", egipto: "EGY", egypte: "EGY", agypten: "EGY", ägypten: "EGY",
  eng: "ENG", england: "ENG", inglaterra: "ENG", angleterre: "ENG",
  esp: "ESP", spain: "ESP", espana: "ESP", españa: "ESP", espagne: "ESP", spanien: "ESP",
  fra: "FRA", france: "FRA", francia: "FRA", frankreich: "FRA",
  fwc: "FWC", worldcup: "FWC", "world cup": "FWC", mundial: "FWC", coupe: "FWC",
  ger: "GER", germ: "GER", germany: "GER", german: "GER", alemania: "GER", allemagne: "GER", deutschland: "GER",
  gha: "GHA", ghana: "GHA",
  hai: "HAI", haiti: "HAI", haití: "HAI",
  irq: "IRQ", iraq: "IRQ", irak: "IRQ",
  irn: "IRN", iran: "IRN",
  jor: "JOR", jordan: "JOR", jordania: "JOR", jordanie: "JOR", jordanien: "JOR",
  jpn: "JPN", japan: "JPN", japon: "JPN", japón: "JPN",
  ksa: "KSA", saudi: "KSA", saudiarabia: "KSA", "saudi arabia": "KSA", arabiasaudita: "KSA", "arabia saudita": "KSA",
  mar: "MAR", morocco: "MAR", marruecos: "MAR", maroc: "MAR", marokko: "MAR",
  mex: "MEX", mexico: "MEX", méxico: "MEX", mexique: "MEX", mexiko: "MEX",
  ned: "NED", netherlands: "NED", holland: "NED", holanda: "NED", paysbas: "NED", "pays bas": "NED", niederlande: "NED",
  nor: "NOR", norway: "NOR", noruega: "NOR", norvege: "NOR", norvège: "NOR", norwegen: "NOR",
  nzl: "NZL", newzealand: "NZL", "new zealand": "NZL", nuevazelanda: "NZL", "nueva zelanda": "NZL", nouvellezelande: "NZL", "nouvelle zelande": "NZL", neuseeland: "NZL",
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

const ALIAS_PATTERN = new RegExp(
  `(?<![A-Z0-9])(${[...TEAM_ALIASES.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})\\s*[-–—_./]?\\s*(\\d{1,2})(?![A-Z0-9])`,
  "g",
);

export function extractCodeOccurrences(value) {
  const upper = normalizeParseText(value);
  const occurrences = new Map();
  const inlineSpans = [];
  const add = (team, number) => {
    const normalizedNumber = Number(number);
    if (normalizedNumber < 1 || normalizedNumber > 20) return;
    const normalizedTeam = normalizeTeam(team);
    if (!normalizedTeam) return;
    const code = `${normalizedTeam}${normalizedNumber}`;
    occurrences.set(code, (occurrences.get(code) || 0) + 1);
  };
  const inlinePattern = /(?<![A-Z0-9])([A-Z]{2,4})\s*[-–—_./]?\s*(\d{1,2})(?![A-Z0-9])/g;
  for (const match of upper.matchAll(inlinePattern)) {
    add(match[1], match[2]);
    inlineSpans.push([match.index, match.index + match[0].length]);
  }
  for (const match of upper.matchAll(ALIAS_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (inlineSpans.some(([spanStart, spanEnd]) => spanStart < end && start < spanEnd)) continue;
    add(TEAM_ALIASES.get(match[1]), match[2]);
  }
  const groupedPattern = /^\s*([A-Z]{2,4})(?:\s+[^:\d\n]+)?\s*:\s*([0-9][0-9\s,;/&+.-]*)/gm;
  for (const match of upper.matchAll(groupedPattern)) {
    const start = match.index;
    if (inlineSpans.some(([spanStart, spanEnd]) => spanStart <= start && start < spanEnd)) continue;
    for (const number of match[2].match(/\d{1,2}/g) || []) add(match[1], number);
  }
  return occurrences;
}

function normalizeTeam(team) {
  const normalized = normalizeParseText(team).replace(/\s+/g, "");
  return TEAM_ALIASES.get(normalized) || TEAM_ALIASES.get(normalizeParseText(team)) || normalized;
}

function normalizeParseText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function aliasMap(values) {
  return new Map(Object.entries(values).map(([alias, code]) => [normalizeParseText(alias), code]));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
