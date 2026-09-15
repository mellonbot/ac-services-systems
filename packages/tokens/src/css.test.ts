import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenCss, brandCss, cssVar, contrastFailures, semanticFor, SEMANTIC_DARK } from "./css.ts";
import { SEMANTIC, type SemanticToken } from "./semantic.ts";
import { DENSITY, type Density } from "./density.ts";

const DENSITIES = Object.keys(DENSITY) as Density[];

test("every density's semantic tier clears WCAG contrast — the at-risk amber did not, and was darkened", () => {
  for (const d of DENSITIES) assert.deepEqual(contrastFailures(d), [], d);
});

test("a role is a CSS variable by mechanical renaming, for every semantic token", () => {
  assert.equal(cssVar("color.status-breached"), "--color-status-breached");
  for (const d of DENSITIES) {
    const css = tokenCss(d);
    for (const k of Object.keys(SEMANTIC) as SemanticToken[]) assert.ok(css.includes(`${cssVar(k)}:`), `${d} lacks ${k}`);
  }
});

test("the field surface is dark and the other two are light; the roles are the same set", () => {
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

test("the emitter is deterministic — the frame is byte-comparable", () => {
  assert.equal(tokenCss("comfort"), tokenCss("comfort"));
});

test("a brand stylesheet is validated before it is a string", () => {
  assert.equal(brandCss({ "color.action": "#1b56cc" }), ":root{--color-action:#1b56cc}");
  assert.throws(() => brandCss({ "color.text": "#c8c8c8" }), /needs 4\.5:1/);
  assert.throws(() => brandCss({ "color.focus-ring": "#ff00ff" }), /not overridable/);
});
