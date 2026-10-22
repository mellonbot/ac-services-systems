import { test } from "node:test";
import assert from "node:assert/strict";
import { UI_CSS, cssVariablesRead, cssVariablesDefined, STATE_BEARING_SELECTORS, ACCENT_ROLES, LIVERY_ROLES, LIVERY_SELECTORS } from "./styles.ts";
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
  // The house red sat 0.55° from the oxide fault; Rev C moved the fault to garnet
  // and the red clears the gate, but a cleared gate is not a licence to decorate
  // a chip. It is enforced here rather than remembered.
  for (const rule of UI_CSS.split("}")) {
    const selector = rule.split("{")[0] ?? "";
    if (!STATE_BEARING_SELECTORS.some((sel) => selector.includes(sel))) continue;
    for (const role of ACCENT_ROLES)
      assert.ok(!rule.includes(role), `${selector.trim()} paints ${role} — a dispatcher reads the column, not the palette`);
  }
});

test("the livery roles are confined to the lockup — the element fence, checked", () => {
  // tokenCss never neutralises these, so nothing downstream catches an escape. This is
  // the fence. A lockup red on anything but the masthead is a red control by another name.
  for (const rule of UI_CSS.split("}")) {
    const selector = (rule.split("{")[0] ?? "").trim();
    if (!LIVERY_ROLES.some((role) => rule.includes(role))) continue;
    assert.ok(
      LIVERY_SELECTORS.some((sel) => selector.includes(sel)),
      `${selector} paints a livery role outside the lockup`,
    );
  }
});

test("the lockup renders as ONE mark — the wordmark and the rule take the same role", () => {
  // The defect this closes: the badge read P.brand.fill directly while the wordmark read a
  // role that tokenCss had resolved to Ink Black, so the two halves of one lockup rendered
  // in different identities on every state-bearing surface.
  const wordmark = UI_CSS.split("}").find((r) => r.split("{")[0]?.includes(".ac-wordmark{") || /\.ac-wordmark\{/.test(r + "{"));
  const rules = UI_CSS.split("}");
  const find = (sel: string) => rules.find((r) => (r.split("{")[0] ?? "").trim().endsWith(sel));
  for (const sel of [".ac-wordmark", ".ac-mast__rule"]) {
    const rule = find(sel);
    assert.ok(rule, `${sel} has no rule`);
    assert.match(rule!, /var\(--color-livery\)/, `${sel} must take the livery role, not the surface-fenced brand role`);
    assert.doesNotMatch(rule!, /var\(--color-brand/, `${sel} still reads a neutralised brand role`);
  }
  void wordmark;
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
  // The red clears the gate at 35.32° from the warning amber, and the rule did not relax
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

// ---------------------------------------------------------------------------
// The chrome every surface drew for itself. Eight stylesheets each carried the
// same segmented nav (twice — the pre-Rev-A rule and the Rev A override), the
// same link, input, field and form, a refusal block that was RefusalCard with
// the console's facts removed, a "sent" notice and a fact grid. One sheet owns
// them now; a surface arranges them and names nothing it could get wrong.
// ---------------------------------------------------------------------------
test("the chrome every surface shares has a rule in the component sheet", () => {
  for (const cls of [
    "ac-nav", "ac-nav__who", "ac-nav__signout",
    "ac-nav--grouped", "ac-nav__group", "ac-nav__group-label", "ac-nav__end",
    "ac-link", "ac-link--button",
    "ac-form", "ac-field", "ac-field__hint", "ac-input", "ac-textarea",
    "ac-notice", "ac-notice__heading", "ac-notice__message", "ac-notice__routes",
    "ac-facts",
  ]) assert.match(UI_CSS, new RegExp(`\\.${cls}(?![\\w-])`), cls);
});

test("a notice carries state, so no accent role may decorate it", () => {
  // The refusal notice is outlined in the fault ink and the sent notice in jade:
  // colour is state here, with a word beside it, and the arc stays out — the
  // same fence the pill and the badge sit behind.
  assert.ok(STATE_BEARING_SELECTORS.includes(".ac-notice"));
});

test("the shared input is sized by the density, never by a number of its own", () => {
  const input = RULES.find((r) => r.selector === ".ac-input");
  assert.ok(input, ".ac-input");
  assert.match(input.decls, /min-height:var\(--control-height\)/);
  assert.match(input.decls, /border-radius:var\(--radius-control\)/);
  assert.doesNotMatch(input.decls, /(?:min-height|height|font-size|padding):[^;]*\d+px/, "a hand-typed size is a size one density gets wrong");
});

// ---------------------------------------------------------------------------
// Motion. 110/170/260ms on one curve, from the tokens; a control's state change
// moves, data does not ("no entrance animation on data"); and a reader who has
// asked for reduced motion gets none.
// ---------------------------------------------------------------------------
const TRANSITIONING = RULES.filter((r) => /(?:^|;)\s*transition\s*:(?!\s*none)/.test(r.decls));

test("every transition takes its duration and curve from the motion tokens", () => {
  assert.ok(TRANSITIONING.length >= 4, "the controls that change state — action, segment, chip, link — move");
  for (const { selector, decls } of TRANSITIONING) {
    const value = /(?:^|;)\s*transition\s*:\s*([^;]+)/.exec(decls)![1]!;
    for (const part of value.split(",")) {
      assert.match(part, /var\(--motion-(?:fast|base|slow)\)/, `${selector}: "${part.trim()}" has no token duration`);
      assert.match(part, /var\(--ease\)/, `${selector}: "${part.trim()}" has no token curve`);
    }
    assert.doesNotMatch(value, /\d+m?s\b/, `${selector} types a duration`);
  }
  for (const sel of [".ac-action", ".ac-seg__item", ".ac-chip", ".ac-link"])
    assert.ok(TRANSITIONING.some((r) => r.selector === sel), `${sel} does not move`);
});

test("data does not animate in, and a reader who asked for reduced motion gets none", () => {
  assert.doesNotMatch(DECLARED, /(?:^|[;{\s])animation(?:-[a-z]+)?\s*:/, "no keyframe animation — data appears, it does not arrive");
  assert.doesNotMatch(DECLARED, /@keyframes/);
  const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}\s*\}/.exec(DECLARED);
  assert.ok(reduced, "a prefers-reduced-motion block");
  for (const { selector } of TRANSITIONING)
    assert.ok(reduced![1]!.includes(selector), `${selector} transitions but is not stilled under reduced motion`);
  assert.match(reduced![1]!, /transition:none/);
});
