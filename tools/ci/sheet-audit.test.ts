import { test } from "node:test";
import assert from "node:assert/strict";
import { SURFACES, SURFACE_IDS } from "../../packages/contracts/src/index.ts";
import { DENSITY, sheetViolations, type Density } from "../../packages/tokens/src/index.ts";
import { UI_CSS } from "../../packages/ui/src/styles.ts";

/**
 * Every stylesheet a browser loads, audited the way the bulletin says to:
 * parsed, not eyeballed. The component sheet is checked at every density it
 * serves; a surface's own sheet at the density its registry row declares,
 * because the type floor is the density's.
 */
const surfaceSheet = async (app: string): Promise<string> => {
  const mod = (await import(`../../apps/${app}/src/styles.ts`)) as Record<string, unknown>;
  const sheet = Object.values(mod).find((v): v is string => typeof v === "string");
  assert.ok(sheet, `${app}/src/styles.ts exports no stylesheet string`);
  return sheet;
};

/**
 * Named exemptions, each an open question and not a ruling. The S3 Dispatch
 * Board keeps the partners' reference layout, whose legend keys job stages
 * (scheduled, completed, waiting) to the status inks — a Rule 1 conflict the
 * bulletin's owners have not yet decided. Listed here so it stays visible.
 */
const EXEMPT: readonly { readonly app: string; readonly rule: string; readonly selector: RegExp }[] = [
  { app: "s3-dispatch-console", rule: "state-as-category", selector: /^\.dispatch-(?:board__segment|legend__item)\[data-tone=/ },
];

test("no surface stylesheet paints a fill as a word, draws a fill as a rule, sets type below its floor, keys a category to a status ink, or leaves a control unsized", async () => {
  const failures: string[] = [];
  for (const id of SURFACE_IDS) {
    const s = SURFACES[id];
    for (const v of sheetViolations(await surfaceSheet(s.app), s.density)) {
      if (EXEMPT.some((e) => e.app === s.app && e.rule === v.rule && e.selector.test(v.selector))) continue;
      failures.push(`${s.app} (${s.density}) ${v.selector}: ${v.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("the component stylesheet is clean at every density it serves", () => {
  for (const d of Object.keys(DENSITY) as Density[])
    assert.deepEqual(sheetViolations(UI_CSS, d).map((v) => `${v.selector}: ${v.message}`), [], d);
});

/**
 * The chrome packages/ui draws — nav, link, form, field, input, notice, facts
 * — is drawn once. A surface that redeclares one of these families has forked
 * it, and a fork is where the next fill-as-word comes from. Modifiers
 * and surface-owned parts (`.s2-form__actions`) are the
 * surface's arrangement and are not caught here; S1's masthead row is its own
 * thing, not the segmented nav, and is exempt by name.
 */
const SHARED_FAMILIES = /\.s\d-(?:nav(?:__(?:link|who|logout))?|link(?:--button)?|form|field|input|textarea|refusal(?:__[a-z]+)?|sent|queued|facts)\b(?![-_])/g;

test("no surface stylesheet redeclares the chrome the component sheet owns", async () => {
  const forks: string[] = [];
  for (const id of SURFACE_IDS) {
    const sheet = (await surfaceSheet(SURFACES[id].app)).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of sheet.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const selector = m[1]!.trim();
      for (const hit of selector.matchAll(SHARED_FAMILIES)) {
        forks.push(`${SURFACES[id].app}: ${selector} redeclares ${hit[0]}`);
      }
    }
  }
  assert.deepEqual(forks, []);
});

/**
 * The other direction: a surface reaching into the component sheet's classes
 * (`.s2-app .ac-grid__td{…}`) restyles the chrome for one surface without
 * forking its name, which the test above cannot see. A layout the chrome lacks
 * belongs in packages/ui as a prop or modifier.
 */
test("no surface stylesheet restyles a class the component sheet owns", async () => {
  const reaches: string[] = [];
  for (const id of SURFACE_IDS) {
    const sheet = (await surfaceSheet(SURFACES[id].app)).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of sheet.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const selector = m[1]!.trim();
      for (const hit of selector.matchAll(/\.ac-[a-z][\w-]*/g)) reaches.push(`${SURFACES[id].app}: ${selector} restyles ${hit[0]}`);
    }
  }
  assert.deepEqual(reaches, []);
});

/**
 * Widths come from the schedule (packages/tokens: measure, layout). A literal
 * measure or tile minimum in a surface sheet is a width nobody else can find,
 * and the next screen picks a third value beside it. Breakpoints are exempt —
 * a media query cannot read a variable — and so are a data column's own
 * minimum (a date, an amount) and artwork geometry like S3's illustrative map,
 * which size to their content rather than to the page.
 */
test("no surface stylesheet types a measure, a page width or a tile minimum", async () => {
  const literals: string[] = [];
  for (const id of SURFACE_IDS) {
    const sheet = (await surfaceSheet(SURFACES[id].app)).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2]!;
      for (const hit of body.matchAll(/max-width:\s*\d+(?:ch|px)|repeat\(auto-(?:fit|fill),\s*minmax\((?:min\(100%,)?\d+(?:ch|px)/g))
        literals.push(`${SURFACES[id].app}: ${m[1]!.trim()} types ${hit[0]}`);
    }
  }
  assert.deepEqual(literals, []);
});
