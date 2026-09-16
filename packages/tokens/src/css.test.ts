import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenCss, brandCss, cssVar, contrastFailures, semanticFor, SEMANTIC_DARK, GROUNDS, WORD_ROLES, ON_FILL } from "./css.ts";
import { SEMANTIC, type SemanticToken } from "./semantic.ts";
import { DENSITY, type Density } from "./density.ts";
import { FACES, FACE_ROLES } from "./type.ts";
import { contrastRatio } from "./whitelabel.ts";

const DENSITIES = Object.keys(DENSITY) as Density[];

test("every density's ink schedule clears WCAG against every ground it is permitted on", () => {
  for (const d of DENSITIES) assert.deepEqual(contrastFailures(d), [], d);
});

test("a ratio is stated against the WORST ground, not the paper — errata E-01", () => {
  // The header ground is darker than the panel in the light stock, and lighter
  // than the well on the plate. Neither is nominated; the minimum governs.
  for (const d of DENSITIES) {
    const sem = semanticFor(d);
    for (const role of WORD_ROLES) {
      const worst = Math.min(...GROUNDS.map((g) => contrastRatio(sem[role], sem[g])));
      assert.ok(worst >= 4.5, `${d}: ${role} is ${worst.toFixed(2)}:1 on its worst ground`);
    }
  }
});

test("the published ink.light and rule-hard are NOT used where they fail — errata E-07, E-08", () => {
  assert.equal(SEMANTIC["color.text-muted"], "#4E463A", "muted text is ink.mid, not the 3.17:1 ink.light");
  assert.equal(SEMANTIC["color.status-blocked"], "#4E463A", "the muted state chip carries a word, so it is ink.mid");
  // The border role is decorative and openly below 3:1 — which is why no chip
  // rule may be drawn in it. packages/ui/src/styles.test.ts holds that line.
  assert.ok(contrastRatio(SEMANTIC["color.border"], SEMANTIC["color.surface"]) < 3);
});

test("Form R-4: the word is measured against its own fill, and the fill is free", () => {
  const field = semanticFor("field");
  // The oxide fault fill is 2.13:1 against the plate ground and that is correct:
  // it carries neither the word nor the shape.
  assert.ok(contrastRatio(field["color.status-breached-fill"], field["color.surface"]) < 3);
  // The word on it is what has to clear AA.
  assert.ok(contrastRatio(field["color.status-breached"], field["color.status-breached-fill"]) >= 4.5);
  for (const [ink, fill] of ON_FILL) {
    for (const d of DENSITIES) {
      const sem = semanticFor(d);
      if (sem[fill] === "transparent") continue;
      assert.ok(contrastRatio(sem[ink], sem[fill]) >= 4.5, `${d}: ${ink} on ${fill}`);
    }
  }
});

test("the light stock renders a fault as an outline; the plate ground is the only place a chip is solid", () => {
  assert.equal(SEMANTIC["color.status-breached-fill"], "transparent");
  assert.equal(SEMANTIC_DARK["color.status-breached-fill"], "#8C2E22");
});

test("a role is a CSS variable by mechanical renaming, for every semantic token", () => {
  assert.equal(cssVar("color.status-breached"), "--color-status-breached");
  for (const d of DENSITIES) {
    const css = tokenCss(d);
    for (const k of Object.keys(SEMANTIC) as SemanticToken[]) assert.ok(css.includes(`${cssVar(k)}:`), `${d} lacks ${k}`);
  }
});

test("the field surface is the plate ground and the other two are light; the roles are the same set", () => {
  assert.equal(semanticFor("field"), SEMANTIC_DARK);
  assert.equal(semanticFor("console"), SEMANTIC);
  assert.deepEqual(Object.keys(SEMANTIC_DARK).sort(), Object.keys(SEMANTIC).sort());
  assert.match(tokenCss("field"), /--color-scheme:dark/);
  assert.match(tokenCss("field"), /--hover:0/);
  assert.match(tokenCss("console"), /--hover:1/);
});

test("density structure travels as variables the component stylesheet reads", () => {
  assert.match(tokenCss("field"), /--control-height:56px/);
  assert.match(tokenCss("console"), /--control-height:36px;--row-height:28px;--body-text:13px/);
});

test("all four faces reach every density, and none of them is fetched from a third party", () => {
  for (const d of DENSITIES) {
    const css = tokenCss(d);
    for (const role of FACE_ROLES) assert.ok(css.includes(`--font-${role}:`), `${d} lacks --font-${role}`);
    assert.doesNotMatch(css, /https?:/, "a font stack must never carry a URL");
  }
  // The instrument stack's every fallback is genuinely monospaced, because the
  // column has to hold when the subset never arrives.
  for (const f of ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"])
    assert.ok(FACES.instrument.stack.includes(f), `instrument stack lacks ${f}`);
});

test("the emitter is deterministic — the frame is byte-comparable", () => {
  assert.equal(tokenCss("comfort"), tokenCss("comfort"));
});

test("a brand stylesheet is validated before it is a string", () => {
  assert.equal(brandCss({ "color.action": "#1b56cc" }), ":root{--color-action:#1b56cc}");
  assert.throws(() => brandCss({ "color.text": "#c8c8c8" }), /needs 4\.5:1/);
  assert.throws(() => brandCss({ "color.focus-ring": "#ff00ff" }), /not overridable/);
  assert.throws(() => brandCss({ "color.status-breached": "#e01b24" }), /not overridable/);
});
