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

test("v2 parser expands x-quantity counts in full dash-grouped duplicate lists", () => {
  const text = `FWC — 1, 9 (x2), 15 (x2), 17, 19
MEX — 3, 4, 9, 19
RSA — 13
KOR — 1, 3, 12, 14 (x2), 19
CZE — 5, 14, 15
CAN — 2, 8, 9, 11, 12, 13, 14, 18
BIH — 1, 4 (x2), 7, 8, 11, 12, 17
QAT — 4, 8 (x3), 15
SUI — 8, 10, 11, 15 (x2), 19
BRA — 3, 4, 7, 9, 11
MAR — 1, 5, 10, 11
HAI — 1 (x2), 6, 12, 13, 18
SCO — 1, 8, 12, 18
USA — 1, 12, 16 (x3)
PAR — 1, 3, 19
AUS — 1, 2, 5, 6, 8, 13
TUR — 1, 2, 3, 9, 11, 17, 19
GER — 4, 5, 8, 16
CUW — 1, 3, 5, 19
CIV — 3, 4
ECU — 1, 3
NED — 4, 6, 7 (x5), 8, 15, 16, 18
JPN — 1, 7 (x3), 15, 18 (x2), 20 (x2)
SWE — 1 (x2), 3, 7, 11 (x2), 16 (x2), 18, 20
TUN — 1, 3, 4, 13, 14, 16, 18
BEL — 1 (x2), 3, 7, 11, 20
EGY — 6 (x2), 8, 11, 16
IRN — 8, 9, 11, 13, 14, 15
NZL — 2 (x3), 5 (x2), 9 (x4), 10 (x2), 14 (x3), 15 (x2), 17 (x3)
ESP — 9, 17, 20 (x2)
CPV — 3, 6 (x2), 14, 16 (x3)
KSA — 1, 2, 3 (x2), 12 (x5), 14 (x2), 15 (x3), 17
URU — 3 (x2), 6, 7 (x2), 9, 12, 13, 15 (x4)
FRA — 2 (x2), 6, 8 (x3), 13 (x2), 14, 15, 16, 18, 20
SEN — 1 (x2), 2 (x2), 5, 8, 15 (x2), 17 (x2)
IRQ — 1 (x3), 8, 12, 15 (x2), 20
NOR — 3 (x2), 4 (x4), 12, 14, 18 (x2)
ARG — 1, 3 (x2), 5, 11, 13, 14
ALG — 9, 10 (x4), 13
AUT — 1 (x2), 4, 11 (x2), 19, 20
JOR — 4, 8, 12, 14, 17
POR — 1, 2, 6, 16, 19 (x2)
COD — 3, 5, 14 (x2), 16
UZB — 3, 4, 6 (x2), 8 (x3), 10 (x2), 11, 15
COL — 1 (x2), 3, 4, 5 (x3), 9, 11 (x2), 18, 20
ENG — 7, 9, 10 (x2), 20
CRO — 1, 3, 11, 14, 15, 18
GHA — 1 (x3), 5, 9 (x2), 11, 13, 14, 17, 19
PAN — 1, 7 (x2), 8, 9, 11, 18`;
  const occurrences = extractCodeOccurrences(text);

  assert.equal(occurrences.size, 251);
  assert.equal([...occurrences.values()].reduce((sum, quantity) => sum + quantity, 0), 340);
  assert.deepEqual(
    Object.fromEntries([
      "FWC9", "FWC15", "KOR14", "BIH4", "QAT8", "SUI15", "USA16", "NED7",
      "JPN7", "JPN18", "JPN20", "SWE1", "SWE11", "SWE16", "NZL9", "KSA12",
      "URU15", "FRA8", "NOR4", "ALG10", "GHA1", "PAN7",
    ].map((code) => [code, occurrences.get(code)])),
    {
      FWC9: 2,
      FWC15: 2,
      KOR14: 2,
      BIH4: 2,
      QAT8: 3,
      SUI15: 2,
      USA16: 3,
      NED7: 5,
      JPN7: 3,
      JPN18: 2,
      JPN20: 2,
      SWE1: 2,
      SWE11: 2,
      SWE16: 2,
      NZL9: 4,
      KSA12: 5,
      URU15: 4,
      FRA8: 3,
      NOR4: 4,
      ALG10: 4,
      GHA1: 3,
      PAN7: 2,
    },
  );
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
