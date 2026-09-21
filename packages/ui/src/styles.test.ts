import { test } from "node:test";
import assert from "node:assert/strict";
import { UI_CSS, cssVariablesRead, cssVariablesDefined, STATE_BEARING_SELECTORS, ACCENT_ROLES } from "./styles.ts";
import { tokenCss } from "../../tokens/src/index.ts";
import { DENSITY, type Density } from "../../tokens/src/index.ts";

test("the component stylesheet names no colour — every colour is a role variable", () => {
  assert.doesNotMatch(UI_CSS, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(UI_CSS, /\b(rgb|rgba|hsl|hsla)\(/i);
});

test("every variable the stylesheet reads is defined by tokenCss for every density, or scoped inside the sheet", () => {
  const scoped = new Set(cssVariablesDefined(UI_CSS));
  for (const d of Object.keys(DENSITY) as Density[]) {
    const defined = new Set(cssVariablesDefined(tokenCss(d)));
    const missing = cssVariablesRead(UI_CSS).filter((v) => !defined.has(v) && !scoped.has(v));
    assert.deepEqual(missing, [], `${d}: undefined variables — a silent render bug`);
  }
});

test("hover affordances are gated by --hover, so field density has none", () => {
  for (const m of UI_CSS.matchAll(/:hover\{([^}]*)\}/g)) assert.match(m[1]!, /var\(--hover\)/, `hover rule without the gate: ${m[0]}`);
});

test("every component class family has a rule", () => {
  for (const cls of ["ac-pill", "ac-action", "ac-grid", "ac-badge", "ac-refusal", "ac-degraded", "ac-mast", "ac-wordmark"])
    assert.match(UI_CSS, new RegExp(`\\.${cls}\\b`));
});

test("NO ACCENT INK ENTERS A STATE-BEARING COLUMN — neither the house red nor the arc", () => {
  // The bulletin solves hue proximity structurally rather than with a better
  // colour: every state carries a word, and the accent never decorates a chip.
  // The house red is 1.2° from the fault ink, so this is the rule that makes
  // shipping it at all defensible. It is enforced here rather than remembered.
  for (const rule of UI_CSS.split("}")) {
    const selector = rule.split("{")[0] ?? "";
    if (!STATE_BEARING_SELECTORS.some((sel) => selector.includes(sel))) continue;
    for (const role of ACCENT_ROLES)
      assert.ok(!rule.includes(role), `${selector.trim()} paints ${role} — a dispatcher reads the column, not the palette`);
  }
});

test("the wordmark script is confined to the masthead, and never sets an interface", () => {
  for (const rule of UI_CSS.split("}")) {
    if (!rule.includes("var(--font-wordmark)")) continue;
    assert.match(rule.split("{")[0]!, /ac-wordmark/, "the script escaped the masthead");
  }
});

/**
 * The stylesheet as rules, comments stripped. Crude on purpose: the sheet is a
 * string in this repo precisely so it can be read like one, and a CSS parser
 * would be a dependency bought to check four invariants.
 */
const DECLARED = UI_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

const RULES: readonly { selector: string; decls: string }[] = [...DECLARED.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1]!.trim(), decls: m[2]! }));

test("no `font` shorthand except `inherit` — it resets every font-variant-* longhand", () => {
  // This is not style. `body{font:var(--body-text)/1.6 var(--font-text)}` sat one
  // line under `html,body{font-variant-numeric:tabular-nums}`, won on source
  // order, and computed `normal` — which body then inherited to the entire
  // document. Measured in Chromium: html tabular-nums, body normal. Every SLA
  // timer and invoice total in the system was proportional, silently, and the
  // one rule tokens/type.ts calls load-bearing was off everywhere.
  for (const { selector, decls } of RULES)
    for (const m of decls.matchAll(/(?:^|;)\s*font\s*:\s*([^;]+)/g))
      assert.equal(m[1]!.trim(), "inherit", `${selector} uses the font shorthand: it resets font-variant-numeric`);
  assert.match(UI_CSS, /body\{[^}]*font-family:var\(--font-text\)/);
  assert.match(UI_CSS, /html,body\{font-variant-numeric:tabular-nums\}/);
});

test("nothing unsets `all` — it wins over :focus-visible on source order and takes the outline with it", () => {
  // `.ac-grid__sort{all:unset}` ties `:focus-visible` on specificity (0,1,0) and
  // is declared later, and the cascade resolves per property, not per state. The
  // dispatch board's only keyboard control had no focus indicator. Measured in
  // Chromium: outline-style none on a focused sort button.
  assert.doesNotMatch(DECLARED, /\ball\s*:\s*(unset|initial|revert)/);
  assert.match(UI_CSS, /:focus-visible\{outline:var\(--focus-ring\) var\(--color-focus-ring\)/);
});

test("a press that moves the fill moves the ink with it", () => {
  // color.action-pressed IS color.action-text by value, so a variant that set its
  // own resting colour and inherited only the :active background pressed its own
  // label to 1.00:1 — every secondary route on a RefusalCard.
  for (const { selector, decls } of RULES) {
    if (!selector.includes(":active")) continue;
    if (!/(?:^|;)\s*background\s*:/.test(decls)) continue;
    assert.match(decls, /(?:^|;)\s*color\s*:/, `${selector} repaints the fill and leaves the label behind`);
  }
});

test("the action role never paints a state-bearing column — the invariant, not the comment", () => {
  // The arc clears the gate at 38.41° from jade, and the rule did not relax
  // when the accent changed: the system never solved a hue collision with a
  // better orange, it solves it by keeping the action roles out of the two
  // selectors that render state. STATE_BEARING_SELECTORS said a test held this
  // line and no test read the list.
  let checked = 0;
  for (const { selector, decls } of RULES) {
    if (!STATE_BEARING_SELECTORS.some((sel) => selector.includes(sel))) continue;
    checked++;
    assert.doesNotMatch(decls, /--color-action/, `${selector} paints an action role into a state column`);
  }
  assert.ok(checked >= STATE_BEARING_SELECTORS.length, "the selectors in the list must actually appear in the sheet");
});

test("the fault mark carries a fill, because on the plate ground the word role IS the text role", () => {
  // SEMANTIC_DARK maps color.status-breached to cream — the same ink as body
  // copy — on purpose: hue has stopped working there and form is the channel.
  // A banner drawn only in the word role therefore had no channel at all.
  const mark = RULES.find((r) => r.selector === ".ac-degraded__mark");
  assert.ok(mark, ".ac-degraded__mark");
  assert.match(mark.decls, /background:var\(--color-status-breached-fill\)/);
});
