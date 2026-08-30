import assert from "node:assert/strict";
import test from "node:test";

import {
  compareParsedCodes,
  createTransaction,
  extractCodeOccurrences,
  extractDirectedCodeOccurrences,
  missingListText,
  normalizePastedCardText,
  transactionDetailLines,
  transactionSummary,
} from "../v2/assets/trade_state.js";

const USER_DOUBLES_LIST = `Doubles:
USA 9,15,18
MEX 3, 7, 14,16,18,19
RSA 1,5,8,12,4
KOR 1,2,5,17
CZE 1,7,9,10,12,4
BRA 1,2,4,12,16
MAR 9,10,11,14,15,2
HAI 1,5,7,13,18,15,3
SCO 1, 3,6,8,12,15,19,13,20
GER 7,8,9,13,3
CUW 12,18
CIV 2,4,11
ECU 1,13,5
BEL 1,6,7,13,16,20,2,9
EGY 6,10,12,13,18
IRN 3,5,9 ,11,20
NZL 2,4,7,12,16
Sen 6,9
IRQ 1,20,5,14
NOR 2,5,11
POR 4,8,9,20,10,13
COD,,9, 16,15,
UZB 4,7,10,12,18,19,14
COL 1,4,5,6,8,9,11,16,15,17
CAN  3,2,7,14,16,19,20,8
FRA 5,11,17,7,
BIH 1,3,18
QAT 1,3,8,12,13,20
SUI 4,5,13
PAR1,3, 7,11,14,15,6,
AUS 4,5,11,19,6,1
TUR 1,4,10,12,13,17,18,19
NED ,4,5,7
JPN 1,2,6,8,9
SWE 1,5,9,10,16,19,13
TUN 1,12,27,20
ESP 2,8,20
CPV 11,16,7
KSA 2,3,8,14,16,6
URU,6,15
ARG 18,9,17
ALG 4, 8,15,16,18,20,3,17,19
AUT 1,11,12,15,20
JOR 3,15,17,20
ENG 5,14,15,19
CRO 1, 8, 20,19
GHA 1,2,7
PAN 1,11,14,18,5
FWC 3,12,17
CC 1,3,4,5, 6,7,8,10,11,12`;

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

test("v2 parser covers the full reported doubles list, not only each line's first number", () => {
  const occurrences = extractCodeOccurrences(USER_DOUBLES_LIST);

  assert.equal(occurrences.size, 250);
  assert.equal(occurrences.get("SUI13"), 1);
  assert.equal(occurrences.get("COD16"), 1);
  assert.equal(occurrences.get("URU15"), 1);
  assert.equal(occurrences.get("PAR15"), 1);
  assert.equal(occurrences.get("USA15"), 1);
  assert.equal(occurrences.get("USA18"), 1);
});

test("v2 compare treats reported doubles as cards I need when they match missing codes", () => {
  const occurrences = extractCodeOccurrences(USER_DOUBLES_LIST);
  const result = compareParsedCodes(
    occurrences,
    { cards: {} },
    new Set(["SUI13", "COD16", "URU15", "PAR15"]),
  );

  assert.deepEqual(result.needFromThem.map((item) => item.code), ["COD16", "PAR15", "SUI13", "URU15"]);
  assert.ok(!result.other.some((item) => item.code === "SUI13"), "SUI13 must not be classified as other");
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
