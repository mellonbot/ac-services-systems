import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FIGURES, FIGURE_TOLERANCE, figureDrift, format, stateLuminance, thinnestGreyscaleGap, type FigureName } from "./figures.ts";
import { STATUS_GLYPH } from "./whitelabel.ts";

const repo = (p: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), "utf8");

// ---------------------------------------------------------------------------
// E-21. The thresholds were always enforced; the FIGURES were hand-carried, and
// four had drifted — 2.65 for 2.22, 3.17 for 3.27, 2.13 for 1.84, 1.2° for
// 0.55°. Not one of them moved a pixel, which is why nothing caught them. A
// wrong number in the reasoning is how a correct decision gets reversed later
// by someone who checks the arithmetic and concludes the rule was never real.
// ---------------------------------------------------------------------------

test("every published figure equals its measurement", () => {
  assert.deepEqual(figureDrift(), []);
});

test("a figure is stated to the precision the prose quotes it at", () => {
  for (const [name, f] of Object.entries(FIGURES) as [FigureName, typeof FIGURES[FigureName]][]) {
    assert.ok(
      Math.abs(f.published - f.measured) <= FIGURE_TOLERANCE,
      `${name}: ${f.published} vs measured ${f.measured.toFixed(4)} — ${f.claim}`,
    );
    // A figure nobody cites is a figure that cannot drift, and does not belong here.
    assert.ok(f.cited.length > 0, `${name} names no citation`);
  }
});

test("docs/BRAND.md quotes the corrected figures and none of the superseded ones", () => {
  const brand = repo("docs/BRAND.md");
  for (const name of ["borderHard", "inkLight", "redFromFault", "faultToWarning"] as const) {
    const f = FIGURES[name];
    if (!f.cited.some((c) => c.startsWith("docs/BRAND.md"))) continue;
    assert.ok(brand.includes(format(f)), `docs/BRAND.md does not quote ${name} as ${format(f)}`);
  }
  // The four values this commit corrects, so a revert cannot pass quietly.
  for (const stale of ["2.65:1", "3.17:1", "2.13:1", "1.2°"])
    assert.ok(!brand.includes(stale), `docs/BRAND.md still quotes the superseded ${stale}`);
});

/**
 * E-22. `cited` named the files a figure is quoted in, and nothing read it.
 * arcFromNearestState cited packages/ui/src/styles.ts for 38.41° while that
 * file said "16.3° from ochre" — Bulletin 1's copper, three accents ago. The
 * drift test compares a figure to the TOKENS; this one compares it to the
 * PROSE, which is where a stale number actually does its damage.
 */
test("every file a figure cites actually quotes it", () => {
  const broken: string[] = [];
  for (const [name, f] of Object.entries(FIGURES) as [FigureName, typeof FIGURES[FigureName]][])
    for (const c of f.cited) {
      const path = c.split(" ")[0]!;
      if (!repo(path).includes(format(f)))
        broken.push(`${name}: ${path} does not quote ${format(f)} — ${f.claim}`);
    }
  assert.deepEqual(broken, []);
});

test("the errata rows carry the measurement, not a remembered one", () => {
  const brandTs = repo("packages/tokens/src/brand.ts");
  assert.ok(brandTs.includes(format(FIGURES.borderHard)), `brand.ts E-08 does not quote ${format(FIGURES.borderHard)}`);
  assert.ok(brandTs.includes(format(FIGURES.inkLight)), `brand.ts E-07 does not quote ${format(FIGURES.inkLight)}`);
  for (const stale of ["2.65:1", "3.17:1"])
    assert.ok(!brandTs.includes(stale), `brand.ts still quotes the superseded ${stale}`);
});

// ---------------------------------------------------------------------------
// E-20. Greyscale. `contrastFailures` asks whether an ink is READABLE on its
// ground; it never asks whether the three states are DISTINGUISHABLE from each
// other once hue is gone. That is the premise Form R-4 rests on, and until now
// nothing in CI held it.
// ---------------------------------------------------------------------------

test("the state ramp still ORDERS in greyscale, in both stocks", () => {
  for (const stock of ["light", "plate"] as const) {
    const ramp = stateLuminance(stock);
    for (let i = 1; i < ramp.length; i++)
      assert.ok(
        ramp[i]!.pct < ramp[i - 1]!.pct,
        `${stock}: ${ramp[i]!.role} at ${ramp[i]!.pct.toFixed(2)}% is not darker than ${ramp[i - 1]!.role} at ${ramp[i - 1]!.pct.toFixed(2)}% — the ramp does not order without hue`,
      );
  }
});

test("the light stock's ramp is thin in greyscale, and that is recorded rather than discovered", () => {
  // jade 10.84% and amber 10.62% are ONE VALUE to a reader without hue. Both
  // clear AA as words and retuning either costs the ratio that makes it
  // readable, so the gap is accepted — and the glyph and the word are then not
  // belt-and-braces, they are the channel doing the work.
  const light = thinnestGreyscaleGap("light");
  assert.ok(light < 1, `the light ramp's thinnest gap is ${light.toFixed(2)} pts — if this grew, say so here`);
  // The plate ground is the tier built for exactly this, and it separates.
  assert.ok(thinnestGreyscaleGap("plate") > 1, "the plate ramp must separate in greyscale — it is the sunlight tier");
});

test("because colour carries least, every state carries a distinct glyph AND a distinct word", () => {
  const entries = Object.entries(STATUS_GLYPH);
  const glyphs = entries.map(([, s]) => s.glyph);
  const words = entries.map(([, s]) => s.word);
  const forms = entries.map(([, s]) => s.form);
  assert.equal(new Set(glyphs).size, glyphs.length, "two states share a glyph");
  assert.equal(new Set(words).size, words.length, "two states share a word");
  for (const [status, s] of entries) {
    assert.ok(s.glyph.length > 0, `${status} has no glyph`);
    assert.ok(s.word.trim().length > 0, `${status} has no word`);
  }
  // Form is the third channel, and the salience ladder is what survives
  // greyscale on the plate: outline-mute, outline, solid.
  assert.ok(new Set(forms).size >= 3, "the salience ladder has collapsed to fewer than three forms");
});
