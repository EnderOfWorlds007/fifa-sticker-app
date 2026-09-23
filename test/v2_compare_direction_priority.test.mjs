import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../v2/compare/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../v2/assets/compare.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../v2/assets/styles.css", import.meta.url), "utf8");

test("Compare leads with the highlighted I need action", () => {
  const needPosition = html.indexOf('id="ambiguousAsOffersButton"');
  const offerPosition = html.indexOf('id="ambiguousAsWantsButton"');
  assert.ok(needPosition >= 0 && offerPosition >= 0 && needPosition < offerPosition);
  assert.match(html, /id="ambiguousAsOffersButton" class="secondaryButton compareDirectionPrimary"[^>]*>I need these<\/button>/);
  assert.match(html, /id="ambiguousAsWantsButton" class="secondaryButton"[^>]*>I offer these<\/button>/);
  assert.match(html, /Looking for cards\? Start with <strong>I need these<\/strong>/);
  assert.match(styles, /\.compareDirectionPrimary:not\(\[aria-pressed="false"\]\)/);
});

test("I need and I offer keep their existing comparison meanings", () => {
  assert.match(script, /ambiguousAsOffersButton\.addEventListener\("click", \(\) => \{\s*compare\("offers"\);/);
  assert.match(script, /ambiguousAsWantsButton\.addEventListener\("click", \(\) => \{\s*compare\("wants"\);/);
  assert.match(script, /async function compare\(mode = "offers"\)/);
});
