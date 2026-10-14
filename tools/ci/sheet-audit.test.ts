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

test("no surface stylesheet paints a fill as a word, draws a fill as a rule, or sets type below its density's floor", async () => {
  const failures: string[] = [];
  for (const id of SURFACE_IDS) {
    const s = SURFACES[id];
    for (const v of sheetViolations(await surfaceSheet(s.app), s.density))
      failures.push(`${s.app} (${s.density}) ${v.selector}: ${v.message}`);
  }
  assert.deepEqual(failures, []);
});

test("the component stylesheet is clean at every density it serves", () => {
  for (const d of Object.keys(DENSITY) as Density[])
    assert.deepEqual(sheetViolations(UI_CSS, d).map((v) => `${v.selector}: ${v.message}`), [], d);
});
