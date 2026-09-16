import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenCss, brandCss, cssVar, contrastFailures, semanticFor, SEMANTIC_DARK, GROUNDS, WORD_ROLES, ON_FILL, TENANT_SCOPE, rolesFor } from "./css.ts";
import { SEMANTIC, type SemanticToken } from "./semantic.ts";
import { DENSITY, TYPE_SCALE, TYPE_FLOOR, type Density } from "./density.ts";
import { FACES, FACE_ROLES, SUBSET_GLYPHS, MARK_GLYPHS } from "./type.ts";
import { PRIMITIVES as P } from "./primitives.ts";
import { STATUS_GLYPH } from "./whitelabel.ts";
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
  assert.equal(SEMANTIC["color.text-muted"], "#3C4A55", "muted text is ink.mid, not the 3.17:1 ink.light");
  assert.equal(SEMANTIC["color.status-blocked"], "#3C4A55", "the muted state chip carries a word, so it is ink.mid");
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
  assert.equal(SEMANTIC_DARK["color.status-breached-fill"], "#7A2A2E");
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

test("THE BRAND LAYER IS FENCED BY SURFACE — red reaches marketing and nothing that shows state", () => {
  for (const d of DENSITIES) {
    const wearing = rolesFor(d, { brandLayer: true });
    const barred = rolesFor(d, { brandLayer: false });
    assert.equal(wearing["color.brand"], "#D91F11", `${d} should wear the brand red`);
    // Plate 04's own verdict, applied to the house: an accent inside the state
    // ramp's hue range falls back to Ink Black wherever a state renders.
    assert.equal(barred["color.brand"], barred["color.text"], `${d} must fall back to Ink Black`);
    assert.notEqual(barred["color.brand"], "#D91F11");
  }
  // The default is the SAFE one. A surface that forgets to declare renders neutral.
  assert.equal(rolesFor("comfort")["color.brand"], rolesFor("comfort", { brandLayer: false })["color.brand"]);
  assert.match(tokenCss("comfort"), /--brand-layer:0/);
  assert.match(tokenCss("comfort", { brandLayer: true }), /--brand-layer:1/);
});

test("a brand stylesheet is validated before it is a string, and scoped to the stock it was measured on", () => {
  // Re-pointing a FILL obliges the tenant to supply an ink that clears it.
  assert.equal(brandCss({ "color.action": "#1b56cc", "color.action-ink": "#FFFFFF" }),
    `${TENANT_SCOPE}{--color-action:#1b56cc;--color-action-ink:#FFFFFF}`);
  assert.throws(() => brandCss({ "color.action": "#1b56cc" }), /the word on the action fill/);
  // The hole an unscoped :root{} block is: every pair in validateBrandTheme is
  // measured against the LIGHT stock, and the field frame is <html
  // data-density="field"> with frost for --color-text. A tenant ground admitted
  // against Ink Black must not be able to reach it.
  assert.match(TENANT_SCOPE, /:not\(\[data-density="field"\]\)/);
  assert.ok(!brandCss({ "color.surface": "#ffffff" }).startsWith(":root{"), "an unscoped block reaches the plate");
  assert.throws(() => brandCss({ "color.text": "#c8c8c8" }), /needs 4\.5:1/);
  assert.throws(() => brandCss({ "color.focus-ring": "#ff00ff" }), /not overridable/);
  assert.throws(() => brandCss({ "color.status-breached": "#e01b24" }), /not overridable/);
});

// ---------------------------------------------------------------------------
// The type scale is the density's. It was a shared constant, and the field
// frame shipped 56px targets over an 11px chip word — a console button with a
// bigger hit box.
// ---------------------------------------------------------------------------
const px = (v: string): number => Number.parseFloat(v);

test("every step of the type scale moves with the density, and nothing is set below the tier's floor", () => {
  for (const d of DENSITIES) {
    const scale = TYPE_SCALE[d];
    for (const [step, v] of Object.entries(scale))
      assert.ok(px(v) >= TYPE_FLOOR[d], `${d}: --text-${step} is ${v}, below the ${TYPE_FLOOR[d]}px floor`);
    const steps = Object.values(scale).map(px);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i]! >= steps[i - 1]!, `${d}: the ramp is not monotonic at step ${i}`);
    // A label may not be smaller than the body it labels, minus one step.
    assert.ok(px(scale.md) === px(DENSITY[d].bodyText), `${d}: --text-md and --body-text disagree`);
  }
  // The field tablet is the reason this exists: nothing on it under 15px.
  assert.equal(TYPE_FLOOR.field, 15);
  assert.ok(px(TYPE_SCALE.field.xs) > px(TYPE_SCALE.console.xs), "the field chip word was SMALLER than console body copy");
  // comfort is the reference ramp the bulletin's plates are drawn at.
  assert.deepEqual(TYPE_SCALE.comfort, P.text);
});

test("the frame carries its own density's scale, and no artwork radius a surface could round a corner with", () => {
  for (const d of DENSITIES) {
    const css = tokenCss(d);
    for (const [step, v] of Object.entries(TYPE_SCALE[d])) assert.ok(css.includes(`--text-${step}:${v}`), `${d} lacks --text-${step}:${v}`);
    assert.ok(css.includes("--radius-none:0px"));
    assert.doesNotMatch(css, /--radius-(icon|app)/, "an icon and a patch are artwork with their own substrate rules");
  }
  assert.notEqual(tokenCss("field").match(/--text-xs:[^;]+/)?.[0], tokenCss("console").match(/--text-xs:[^;]+/)?.[0]);
});

test("the second channel is in the subset that has to carry it", () => {
  // Form R-4 leans on form where hue has stopped working, and form is drawn
  // with these. A subset without them hands the channel to the fallback chain.
  for (const [name, glyph] of Object.entries(MARK_GLYPHS))
    assert.ok(SUBSET_GLYPHS.includes(glyph), `MARK_GLYPHS.${name} (${glyph}) is not in SUBSET_GLYPHS`);
  for (const [status, s] of Object.entries(STATUS_GLYPH))
    assert.ok(SUBSET_GLYPHS.includes(s.glyph), `the ${status} glyph is not in SUBSET_GLYPHS`);
  assert.ok(SUBSET_GLYPHS.includes("°"), "the degree sign the trade actually needs");
});
