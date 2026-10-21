import { test } from "node:test";
import assert from "node:assert/strict";
import { sheetViolations, FILL_ROLES } from "./audit.ts";

// ---------------------------------------------------------------------------
// The audit the bulletin asks for ("parse the artefact and check every colour
// mechanically") existed for UI_CSS and for nothing a surface wrote itself.
// Eight surfaces each carry a stylesheet the guard reads only for hex
// literals, and fourteen of their rules painted the arc FILL — 2.09:1 on the
// header ground, "never a word" — as link and button text. Nothing failed,
// because nothing looked. This is what looks.
// ---------------------------------------------------------------------------

test("a fill role painted as a WORD is a violation, and the message names the text-safe role", () => {
  const out = sheetViolations(`.x-link{color:var(--color-action);text-decoration:none}`, "comfort");
  assert.equal(out.length, 1);
  assert.equal(out[0]!.rule, "fill-as-word");
  assert.equal(out[0]!.selector, ".x-link");
  assert.match(out[0]!.message, /--color-action-text/);
});

test("every fill role is gated, each with its own ink", () => {
  for (const role of Object.keys(FILL_ROLES)) {
    const out = sheetViolations(`.x{color:var(${role})}`, "console");
    assert.equal(out.length, 1, role);
    assert.match(out[0]!.message, new RegExp(FILL_ROLES[role as keyof typeof FILL_ROLES]!.replace(/[-]/g, "\\-")), role);
  }
});

test("the text-safe roles and a scoped indirection are not flagged", () => {
  const clean = `
    .a{color:var(--color-action-text)}
    .b{color:var(--color-action-ink);background:var(--color-action)}
    .c{color:var(--color-brand-text)}
    .d{--status-color:var(--color-status-ok);color:var(--status-color)}
    .e{color:inherit}
  `;
  assert.deepEqual(sheetViolations(clean, "comfort"), []);
});

test("a fill mixed toward the surface is a soft fill, not a word — color-mix is exempt", () => {
  const css = `.chip[aria-pressed="true"]{background:color-mix(in srgb,var(--color-action) 14%,var(--color-surface));color:var(--color-action-text)}
  .halo{box-shadow:0 0 0 4px color-mix(in srgb,var(--color-action) 25%,transparent)}`;
  assert.deepEqual(sheetViolations(css, "comfort"), []);
});

test("a fill role drawn as a RULE is a violation — the envelope carries shape, the fill carries salience", () => {
  const out = sheetViolations(`.state[data-tone="live"]{border-color:var(--color-action);color:var(--color-text)}`, "console");
  assert.equal(out.length, 1);
  assert.equal(out[0]!.rule, "fill-as-rule");
  assert.match(out[0]!.message, /--color-action-text/);
  // The envelope IS the rule role; a border in it is correct.
  assert.deepEqual(sheetViolations(`.ac-action{border:1px solid var(--color-action-text)}`, "console"), []);
});

test("type set below the density's floor in absolute px is a violation; at the floor it is not", () => {
  // comfort floors at 11px, field at 15px (TYPE_FLOOR).
  const below = sheetViolations(`@media (max-width:640px){.step__label{font-size:10px}}`, "comfort");
  assert.equal(below.length, 1);
  assert.equal(below[0]!.rule, "below-floor");
  assert.equal(below[0]!.selector, ".step__label");
  assert.match(below[0]!.message, /10px.*11px/);
  assert.deepEqual(sheetViolations(`.ok{font-size:11px}`, "comfort"), []);
  assert.equal(sheetViolations(`.field{font-size:14px}`, "field").length, 1, "14px is under the plate's 15px floor");
  assert.deepEqual(sheetViolations(`.field{font-size:15px}`, "field"), []);
});

test("a size below 1em or 100% is flagged — a fraction of an unknown parent cannot be held to the floor; variables and 1em are not", () => {
  // The .85em pill glyph inside an 11px pill rendered at 9.35px and passed for years because it was never in px.
  assert.deepEqual(sheetViolations(`.a{font-size:0.85em}.c{font-size:95%}`, "field").map((v) => v.rule), ["relative-type", "relative-type"]);
  assert.deepEqual(sheetViolations(`.b{font-size:var(--text-xs)}.d{font-size:1em}.e{font-size:100%}`, "field"), []);
});

test("a status ink keyed to a tone that is not a state is a category drawn as a state — Rule 1", () => {
  const v = sheetViolations(`.legend[data-tone="scheduled"]::before{background:var(--color-status-ok)}`, "console");
  assert.deepEqual(v.map((x) => x.rule), ["state-as-category"]);
  assert.match(v[0]!.message, /"scheduled" is not a state/);
  assert.deepEqual(sheetViolations(`.pill[data-status="at_risk"]{color:var(--color-status-at-risk)}.n[data-tone="info"]{color:var(--color-action-text)}`, "console"), [], "a state tone in its own ink, and a category in a non-state ink, are both fine");
});

test("anything clickable needs a height from some rule for that selector", () => {
  assert.deepEqual(sheetViolations(`.act{cursor:pointer;padding:2px 4px}`, "console").map((v) => v.selector), [".act"]);
  assert.deepEqual(sheetViolations(`.act{cursor:pointer}.act{min-height:var(--control-height)}`, "console"), [], "split across rules is fine");
});

test("comments are not rules — a role named in a comment is not painted", () => {
  assert.deepEqual(sheetViolations(`/* never color:var(--color-action) */ .a{color:var(--color-text)}`, "comfort"), []);
});
