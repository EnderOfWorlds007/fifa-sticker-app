import assert from "node:assert/strict";
import test from "node:test";

import {
  createTransaction,
  extractCodeOccurrences,
  extractDirectedCodeOccurrences,
  missingListText,
  normalizePastedCardText,
  transactionDetailLines,
  transactionSummary,
} from "../v2/assets/trade_state.js";

test("v2 parser handles grouped country codes with flag emoji before colons", () => {
  const text = `Sorry, we got Tur 7 from a friend , belie is updated list.
I need
GER 🇩🇪: 9
ECU 🇪🇨: 8
COD 🇨🇩: 8
GHA 🇬🇭: 12`;

  assert.deepEqual([...extractCodeOccurrences(text).entries()], [
    ["COD8", 1],
    ["ECU8", 1],
    ["GER9", 1],
    ["GHA12", 1],
    ["TUR7", 1],
  ]);

  const directed = extractDirectedCodeOccurrences(text);
  assert.deepEqual([...directed.ambiguous.entries()], [["TUR7", 1]]);
  assert.deepEqual([...directed.offers.entries()], []);
  assert.deepEqual([...directed.wants.entries()], [
    ["COD8", 1],
    ["ECU8", 1],
    ["GER9", 1],
    ["GHA12", 1],
  ]);
});

test("v2 parser handles dash-grouped codes with x-before-copy counts", () => {
  assert.deepEqual(
    [...extractCodeOccurrences("JPN — 1, 5, 7 (x3), 15, 18 (x2), 20 (x2)").entries()],
    [
      ["JPN1", 1],
      ["JPN5", 1],
      ["JPN7", 3],
      ["JPN15", 1],
      ["JPN18", 2],
      ["JPN20", 2],
    ],
  );
});

test("v2 parser handles bare multiplication counts and continues along each grouped line", () => {
  assert.deepEqual(
    [...extractCodeOccurrences("* ARG — 2 ×2, 7, 15, 19, 20 ×2").entries()],
    [
      ["ARG2", 2],
      ["ARG7", 1],
      ["ARG15", 1],
      ["ARG19", 1],
      ["ARG20", 2],
    ],
  );
  assert.deepEqual(
    [...extractCodeOccurrences("* KOR — 1, 5, 7 x2, 8 x2, 12, 16").entries()],
    [
      ["KOR1", 1],
      ["KOR5", 1],
      ["KOR7", 2],
      ["KOR8", 2],
      ["KOR12", 1],
      ["KOR16", 1],
    ],
  );
});

const SHARED_DOUBLES_LIST = `👋, I have just updated my list of doubles, sharing here if anyone is interested, I am still exchanging
* ALG — 3, 5
* ARG — 2 ×2, 7, 15, 19, 20 ×2
* AUS — 2, 11, 12
* BEL — 2, 3, 8, 9, 10, 14 ×2, 15 ×2, 16, 17, 20
* BIH — 5, 7, 10, 13
* BRA — 1 ×3, 5, 9 ×2, 11, 12 ×3, 13, 18
* CAN — 2 ×2, 5 ×2, 6, 7, 8, 11, 12, 14, 17, 19, 20
* CHI — 10
* CHN — 2, 4, 5, 9, 11, 12 ×3, 20
* CIV — 2 ×2, 4, 5, 6, 7, 11, 12, 15, 17, 19
* CMR — 2
* COL — 15, 17, 18, 20
* CRO — 3, 12
* CZE — 2, 8, 9, 10, 20
* ECU — 9, 11, 12
* EGY — 3, 5, 9, 20
* ESP — 1, 6, 8, 12, 16, 18, 20
* FRA — 5
* HAI — 9, 15
* IRN — 2, 4, 11, 12
* JAM — 16, 18 ×2
* KAZ — 2, 3
* KOR — 1, 5, 7 ×2, 8 ×2, 12, 16
* KSA — 8, 13, 15, 17 ×3
* MAR — 2, 3, 4, 5, 8, 14, 19, 20
* MEX — 1, 4 ×2, 6, 7, 9, 14, 20
* PAR — 1 ×2, 7, 9
* POL — 1, 2
* POR — 20
* QAT — 8, 15, 16, 20
* RSA — 5, 8, 9, 14 ×2, 15, 17, 18
* SCO — 8, 19
* SRB — 8, 12, 16, 18, 20 ×2
* SUI — 2, 17
* SWE — 1, 2, 8, 11, 12 ×2, 16, 17
* TUN — 2 ×2, 3, 4, 5 ×2, 11, 13, 20
* URU — 13 ×2, 15`;

test("v2 parser preserves every card and quantity in a shared multiline doubles list", () => {
  assert.deepEqual(Object.fromEntries(extractCodeOccurrences(SHARED_DOUBLES_LIST)), {
    ALG3: 1, ALG5: 1,
    ARG2: 2, ARG7: 1, ARG15: 1, ARG19: 1, ARG20: 2,
    AUS2: 1, AUS11: 1, AUS12: 1,
    BEL2: 1, BEL3: 1, BEL8: 1, BEL9: 1, BEL10: 1, BEL14: 2, BEL15: 2, BEL16: 1, BEL17: 1, BEL20: 1,
    BIH5: 1, BIH7: 1, BIH10: 1, BIH13: 1,
    BRA1: 3, BRA5: 1, BRA9: 2, BRA11: 1, BRA12: 3, BRA13: 1, BRA18: 1,
    CAN2: 2, CAN5: 2, CAN6: 1, CAN7: 1, CAN8: 1, CAN11: 1, CAN12: 1, CAN14: 1, CAN17: 1, CAN19: 1, CAN20: 1,
    CHI10: 1,
    CHN2: 1, CHN4: 1, CHN5: 1, CHN9: 1, CHN11: 1, CHN12: 3, CHN20: 1,
    CIV2: 2, CIV4: 1, CIV5: 1, CIV6: 1, CIV7: 1, CIV11: 1, CIV12: 1, CIV15: 1, CIV17: 1, CIV19: 1,
    CMR2: 1,
    COL15: 1, COL17: 1, COL18: 1, COL20: 1,
    CRO3: 1, CRO12: 1,
    CZE2: 1, CZE8: 1, CZE9: 1, CZE10: 1, CZE20: 1,
    ECU9: 1, ECU11: 1, ECU12: 1,
    EGY3: 1, EGY5: 1, EGY9: 1, EGY20: 1,
    ESP1: 1, ESP6: 1, ESP8: 1, ESP12: 1, ESP16: 1, ESP18: 1, ESP20: 1,
    FRA5: 1,
    HAI9: 1, HAI15: 1,
    IRN2: 1, IRN4: 1, IRN11: 1, IRN12: 1,
    JAM16: 1, JAM18: 2,
    KAZ2: 1, KAZ3: 1,
    KOR1: 1, KOR5: 1, KOR7: 2, KOR8: 2, KOR12: 1, KOR16: 1,
    KSA8: 1, KSA13: 1, KSA15: 1, KSA17: 3,
    MAR2: 1, MAR3: 1, MAR4: 1, MAR5: 1, MAR8: 1, MAR14: 1, MAR19: 1, MAR20: 1,
    MEX1: 1, MEX4: 2, MEX6: 1, MEX7: 1, MEX9: 1, MEX14: 1, MEX20: 1,
    PAR1: 2, PAR7: 1, PAR9: 1,
    POL1: 1, POL2: 1,
    POR20: 1,
    QAT8: 1, QAT15: 1, QAT16: 1, QAT20: 1,
    RSA5: 1, RSA8: 1, RSA9: 1, RSA14: 2, RSA15: 1, RSA17: 1, RSA18: 1,
    SCO8: 1, SCO19: 1,
    SRB8: 1, SRB12: 1, SRB16: 1, SRB18: 1, SRB20: 2,
    SUI2: 1, SUI17: 1,
    SWE1: 1, SWE2: 1, SWE8: 1, SWE11: 1, SWE12: 2, SWE16: 1, SWE17: 1,
    TUN2: 2, TUN3: 1, TUN4: 1, TUN5: 2, TUN11: 1, TUN13: 1, TUN20: 1,
    URU13: 2, URU15: 1,
  });
});

test("v2 parser handles messy space and comma grouped duplicate lists", () => {
  const text = `Doubles:
USA 9,15,18
MEX 3, 7, 14,16,18,19
COD,,9, 16,15,
SUI 4,5,13
PAR1,3, 7,11,14,15,6,
URU,6,15
TUN 1,12,27,20`;

  assert.deepEqual([...extractCodeOccurrences(text).entries()], [
    ["COD9", 1],
    ["COD15", 1],
    ["COD16", 1],
    ["MEX3", 1],
    ["MEX7", 1],
    ["MEX14", 1],
    ["MEX16", 1],
    ["MEX18", 1],
    ["MEX19", 1],
    ["PAR1", 1],
    ["PAR3", 1],
    ["PAR6", 1],
    ["PAR7", 1],
    ["PAR11", 1],
    ["PAR14", 1],
    ["PAR15", 1],
    ["SUI4", 1],
    ["SUI5", 1],
    ["SUI13", 1],
    ["TUN1", 1],
    ["TUN12", 1],
    ["TUN20", 1],
    ["TUN27", 1],
    ["URU6", 1],
    ["URU15", 1],
    ["USA9", 1],
    ["USA15", 1],
    ["USA18", 1],
  ]);
});

test("v2 parser preserves separate inline hyphenated codes", () => {
  assert.deepEqual([...extractCodeOccurrences("ENG-7, POR-11").entries()], [
    ["ENG7", 1],
    ["POR11", 1],
  ]);
});

const COUNTRY_NAME_MISSING_LIST = `Mexico: 15, 17
South Africa: 4, 10
Czechia: 8, 13
Canada: 4
Bosnia and Herzegovina: 2, 3, 14
Qatar: 19
Switzerland: 9, 13
Brazil: 10
Morocco: 15
Haiti: 3, 4, 7
Scotland: 10
USA: 2, 7
Paraguay: 2
Australia: 8, 13, 14, 16, 18
Germany: 3, 14, 15, 16
Curaçao: 15
Ivory Coast: 2, 8, 17
Ecuador: 5, 7, 15
Netherlands: 15
Tunisia: 3, 8, 9, 10
Egypt: 12
Iran: 6
Spain: 7
Cape Verde: 14
Saudi Arabia: 7
Uruguay: 19
France: 1, 17, 19
Senegal: 9, 13
Iraq: 2, 9, 13
Norway: 3, 20
Argentina: 10, 15, 16, 17
Algeria: 12
Austria: 2, 18
Jordan: 6, 10
Congo DR: 1, 2, 10
England: 4, 13, 19
Croatia: 13
Ghana: 20`;

const EXPECTED_COUNTRY_NAME_CODES = [
  "ALG12", "ARG10", "ARG15", "ARG16", "ARG17", "AUS8", "AUS13", "AUS14", "AUS16", "AUS18",
  "AUT2", "AUT18", "BIH2", "BIH3", "BIH14", "BRA10", "CAN4", "CIV2", "CIV8", "CIV17",
  "COD1", "COD2", "COD10", "CPV14", "CRO13", "CUW15", "CZE8", "CZE13", "ECU5", "ECU7",
  "ECU15", "EGY12", "ENG4", "ENG13", "ENG19", "ESP7", "FRA1", "FRA17", "FRA19", "GER3",
  "GER14", "GER15", "GER16", "GHA20", "HAI3", "HAI4", "HAI7", "IRN6", "IRQ2", "IRQ9",
  "IRQ13", "JOR6", "JOR10", "KSA7", "MAR15", "MEX15", "MEX17", "NED15", "NOR3", "NOR20",
  "PAR2", "QAT19", "RSA4", "RSA10", "SCO10", "SEN9", "SEN13", "SUI9", "SUI13", "TUN3",
  "TUN8", "TUN9", "TUN10", "URU19", "USA2", "USA7",
];

test("v2 parser converts grouped country names to codes without skipping adjacent lines", () => {
  assert.deepEqual(
    [...extractCodeOccurrences(COUNTRY_NAME_MISSING_LIST).entries()],
    EXPECTED_COUNTRY_NAME_CODES.map((code) => [code, 1]),
  );
});

test("v2 parser decodes URL-encoded and form-encoded country-name lists", () => {
  const urlEncoded = encodeURIComponent(COUNTRY_NAME_MISSING_LIST);
  const formEncoded = urlEncoded.replaceAll("%20", "+");

  assert.deepEqual(
    [...extractCodeOccurrences(urlEncoded).entries()],
    EXPECTED_COUNTRY_NAME_CODES.map((code) => [code, 1]),
  );
  assert.deepEqual(
    [...extractCodeOccurrences(formEncoded).entries()],
    EXPECTED_COUNTRY_NAME_CODES.map((code) => [code, 1]),
  );
});

test("v2 parser decodes valid escapes when pasted text also contains a stray percent sign", () => {
  const malformed = `${encodeURIComponent(COUNTRY_NAME_MISSING_LIST)}%`;
  assert.deepEqual(
    [...extractCodeOccurrences(malformed).entries()],
    EXPECTED_COUNTRY_NAME_CODES.map((code) => [code, 1]),
  );
});

test("v2 paste normalization visibly decodes text and replaces grouped country names", () => {
  const normalized = normalizePastedCardText(encodeURIComponent(COUNTRY_NAME_MISSING_LIST));

  assert.match(normalized, /^MEX: 15, 17\nRSA: 4, 10\nCZE: 8, 13/);
  assert.match(normalized, /\nCUW: 15\nCIV: 2, 8, 17/);
  assert.match(normalized, /\nCOD: 1, 2, 10\nENG: 4, 13, 19/);
  assert.doesNotMatch(normalized, /%[0-9A-Fa-f]{2}/);
  assert.deepEqual(
    [...extractCodeOccurrences(normalized).entries()],
    EXPECTED_COUNTRY_NAME_CODES.map((code) => [code, 1]),
  );
});

test("v2 copied missing list uses sticker prefixes instead of display country names", () => {
  assert.equal(
    missingListText([
      { code: "RSA10", team: "South Africa", number: "10", missing: true },
      { code: "CZE13", team: "Czechia", number: "13", missing: true },
      { code: "BIH2", team: "Bosnia and Herzegovina", number: "2", missing: true },
      { code: "QAT19", team: "Qatar", number: "19", missing: true },
      { code: "HAI3", team: "Haiti", number: "3", missing: true },
      { code: "HAI4", team: "Haiti", number: "4", missing: true },
      { code: "ENG13", team: "England", number: "13", missing: false },
    ]),
    [
      "RSA: 10",
      "CZE: 13",
      "BIH: 2",
      "QAT: 19",
      "HAI: 3, 4",
    ].join("\n"),
  );
});

test("album update transactions keep their kind and activity labels", () => {
  const ledger = createTransaction({ schemaVersion: 1, transactions: [] }, {
    idFactory: () => "txn_album_update_test",
    now: () => "2026-08-16T00:00:00.000Z",
    kind: "album-update",
    received: [],
    given: [{ code: "RSA6", quantity: 1, variant: "united_edition" }],
  });

  const [summary] = transactionSummary(ledger);
  assert.equal(summary.kind, "album-update");
  assert.equal(summary.label, "Moved 1 to album");
  assert.deepEqual(transactionDetailLines(summary), ["Move to album: RSA6 Green"]);
});
