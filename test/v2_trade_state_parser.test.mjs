import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCodeOccurrences,
  extractDirectedCodeOccurrences,
  normalizePastedCardText,
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
