import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBrandTheme, contrastRatio, STATUS_GLYPH } from "./whitelabel.ts";

test("a brand theme that would break the portal is rejected with the number", () => {
  const r = validateBrandTheme({ "color.text": "#c8c8c8" });
  assert.equal(r.length, 1);
  assert.match(r[0]!.reason, /needs 4\.5:1/);
});

test("structural tokens are not themeable, whatever the brand team wants", () => {
  const r = validateBrandTheme({ "color.focus-ring": "#ff00ff" });
  assert.match(r[0]!.reason, /not overridable/);
});

test("a legitimate brand palette passes", () => {
  assert.deepEqual(validateBrandTheme({ "color.action": "#1b56cc", "color.text": "#101010" }), []);
});

test("every status carries a glyph and a word, not only a colour", () => {
  for (const s of Object.values(STATUS_GLYPH)) {
    assert.ok(s.glyph.length > 0);
    assert.ok(s.word.length > 0);
  }
});

test("contrast maths is right at the extremes", () => {
  assert.equal(Math.round(contrastRatio("#ffffff", "#000000")), 21);
});
