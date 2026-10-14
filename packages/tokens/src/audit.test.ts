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

test("relative sizes and variables are the density's business, not the audit's", () => {
  assert.deepEqual(sheetViolations(`.a{font-size:0.85em}.b{font-size:var(--text-xs)}.c{font-size:95%}`, "field"), []);
});

test("comments are not rules — a role named in a comment is not painted", () => {
  assert.deepEqual(sheetViolations(`/* never color:var(--color-action) */ .a{color:var(--color-text)}`, "comfort"), []);
});
