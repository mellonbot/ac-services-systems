import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIMITIVES as P } from "./primitives.ts";
import { SEMANTIC, BRAND_OVERRIDABLE, type SemanticToken } from "./semantic.ts";
import { SEMANTIC_DARK, tokenCss } from "./css.ts";
import { contrastRatio } from "./whitelabel.ts";
import { DENSITY, type Density } from "./density.ts";

const DENSITIES = Object.keys(DENSITY) as Density[];

/**
 * Copper is the brand and copper is not a text colour. Both halves are load
 * bearing, and the second half is the one a designer reaches past at 2am.
 * If copper.500 ever clears 4.5:1 this test should be deleted along with
 * copper.700 — until then, deleting it ships unreadable copper words.
 */
test("copper.500 is a display ink, not a text ink — which is why copper.700 exists", () => {
  const onStock = contrastRatio(P.copper[500], P.stock[100]);
  assert.ok(onStock >= 3.0, `copper.500 is ${onStock.toFixed(2)}:1, a control needs 3:1`);
  assert.ok(onStock < 4.5, `copper.500 is ${onStock.toFixed(2)}:1 — if it clears 4.5:1, copper.700 is dead weight`);

  const textSafe = contrastRatio(P.copper[700], P.stock[100]);
  assert.ok(textSafe >= 4.5, `copper.700 is ${textSafe.toFixed(2)}:1 and must clear 4.5:1 — it is the shade words use`);
});

/**
 * A tenant buys a surface, a text colour and an action colour. A tenant does
 * not buy the meaning of the board: a breach rendered in someone's brand green
 * is a breach nobody escalated.
 */
test("no status role is brand-overridable", () => {
  const overridable = new Set<string>(BRAND_OVERRIDABLE);
  const status = (Object.keys(SEMANTIC) as SemanticToken[]).filter((k) => k.startsWith("color.status-"));
  assert.ok(status.length === 4, "four status roles expected");
  for (const s of status) assert.ok(!overridable.has(s), `${s} must not be themeable`);
  assert.ok(!overridable.has("color.focus-ring"), "the focus ring is not themeable");
});

/**
 * The rule survives the palette. It read "amber, because the action is blue"
 * and the action is now copper — so the values moved and the rule did not.
 * A ring the same colour as the control it rings is a ring nobody sees.
 */
test("the focus ring never shares the action colour, on either surface", () => {
  for (const [name, tier] of [["light", SEMANTIC], ["dark", SEMANTIC_DARK]] as const) {
    assert.notEqual(tier["color.focus-ring"], tier["color.action"], `${name}: ring matches the action`);
    assert.notEqual(tier["color.focus-ring"], tier["color.action-pressed"], `${name}: ring matches the pressed action`);
    const seen = contrastRatio(tier["color.focus-ring"], tier["color.action"]);
    assert.ok(seen >= 3.0, `${name}: ring against its own control is ${seen.toFixed(2)}:1, needs 3:1 to be a ring`);
  }
});

/**
 * A filled action carries a white label on both surfaces. This is the test that
 * rejected copper.300 as the field action: it cleared every surface check and
 * put a 2.92:1 label on the button, in the one tier that exists for sunlight.
 */
test("a filled action can carry its label, on either surface", () => {
  for (const [name, tier] of [["light", SEMANTIC], ["dark", SEMANTIC_DARK]] as const) {
    const label = contrastRatio(P.stock[0], tier["color.action"]);
    assert.ok(label >= 4.5, `${name}: white label on the action is ${label.toFixed(2)}:1, needs 4.5:1`);
  }
});

/** Every numeral in the company is set in one face. A face is a role too. */
test("every density carries the four faces, and the instrument face is monospaced", () => {
  for (const d of DENSITIES) {
    const css = tokenCss(d);
    for (const role of ["display", "engraved", "text", "instrument"]) {
      assert.match(css, new RegExp(`--font-${role}:`), `${d} lacks --font-${role}`);
    }
    assert.match(css, /--font-instrument:[^;]*monospace/, `${d}: the instrument face must fall back to monospace`);
  }
});

/**
 * Two inks on stock. A family added here without a reason is a third ink
 * somebody will use decoratively, and the ink schedule stops meaning anything.
 */
test("the palette holds exactly the families the ink schedule names", () => {
  const families = Object.keys(P).filter((k) => !["space", "radius", "text", "font"].includes(k));
  assert.deepEqual(families.sort(), ["copper", "ink", "ochre", "olive", "oxblood", "stock"]);
});
