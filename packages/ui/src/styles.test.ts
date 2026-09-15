import { test } from "node:test";
import assert from "node:assert/strict";
import { UI_CSS, cssVariablesRead, cssVariablesDefined } from "./styles.ts";
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
  for (const cls of ["ac-pill", "ac-action", "ac-grid", "ac-badge", "ac-refusal", "ac-degraded"]) assert.match(UI_CSS, new RegExp(`\\.${cls}\\b`));
});
