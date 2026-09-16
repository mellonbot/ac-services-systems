import { test } from "node:test";
import assert from "node:assert/strict";
import { BADGE, BADGE_LETTER, ICON_SIZES, badgeSvg, faviconDataUri, thickenFor, BRAND, BULLETIN_ERRATA } from "./brand.ts";
import { PRIMITIVES as P } from "./primitives.ts";

/**
 * THE BADGE GEOMETRY IS FROZEN HERE, deliberately and by exact value.
 *
 * It was settled by eye in the tuner and then approved: "save this exact
 * position and style for all favicon/logo icons". A mark agreed by eye has no
 * derivation to re-check it against, so the only thing that can defend it is a
 * test that fails when a number moves. Changing one of these is a reviewed
 * diff on a named file, which is the point.
 */
test("the badge geometry is exactly the approved position", () => {
  assert.deepEqual(BADGE.ring, { cx: 18, cy: 21, r: 5, width: 5 });
  assert.deepEqual(BADGE.letter, { size: 46, x: 40, baseline: 47 });
  assert.deepEqual(BADGE.bar, { x: 12, y: 53, width: 40, height: 4 });
});

test("the badge style is exactly the approved treatment", () => {
  assert.equal(BADGE.treatment.ground, P.plate.ground, "furnace ground");
  assert.equal(BADGE.treatment.letter, P.brand.fill, "the letter is brand red");
  assert.equal(BADGE.treatment.ring, P.arc.core, "the degree ring is arc core");
  assert.equal(BADGE.treatment.bar, P.arc.core, "the bar matches the ring");
});

test("the optical correction grows as the mark shrinks, and only below 32px", () => {
  assert.equal(thickenFor(ICON_SIZES.favicon), 2.6);
  assert.equal(thickenFor(ICON_SIZES.faviconHi), 1.2);
  assert.equal(thickenFor(ICON_SIZES.masthead), 0);
  assert.equal(thickenFor(ICON_SIZES.appIcon), 0);
  assert.equal(thickenFor(ICON_SIZES.store), 0);
});

test("every icon size draws the SAME mark — one geometry, one treatment", () => {
  for (const px of Object.values(ICON_SIZES)) {
    const svg = badgeSvg(px);
    assert.match(svg, /viewBox="0 0 64 64"/, `${px} must keep the 64-unit square`);
    assert.ok(svg.includes(`cx="${BADGE.ring.cx}" cy="${BADGE.ring.cy}"`), `${px} moved the ring`);
    // The letter's position is baked into the outline's coordinates now, so
    // asserting the path itself is stricter than checking two attributes were.
    assert.ok(svg.includes(BADGE_LETTER.path), `${px} redrew or moved the letter`);
    assert.ok(svg.includes(BADGE.treatment.ground) && svg.includes(BADGE.treatment.letter), `${px} changed the treatment`);
  }
});

test("the favicon is the badge, not a second drawing of it", () => {
  assert.ok(faviconDataUri().startsWith("data:image/svg+xml,"));
  assert.equal(decodeURIComponent(faviconDataUri().slice("data:image/svg+xml,".length)),
    badgeSvg(ICON_SIZES.favicon), "the favicon must be badgeSvg and nothing else");
});

test("the monogram is a unit, and the ring precedes the letter", () => {
  assert.equal(BRAND.monogram, "°R");
  assert.match(BRAND.monogram, /^°/, "°R is one symbol; a number precedes it, the ring never follows the letter");
});

/**
 * E-17: the mark may not depend on a font being installed.
 *
 * This is the one asset fetched before any stylesheet we control, so there is
 * no fallback chain to catch a miss and nobody to notice it — the mark just
 * quietly becomes a different mark on a machine we will never see.
 */
test("the badge names no font, at any size — it is an outline", () => {
  for (const px of Object.values(ICON_SIZES)) {
    const svg = badgeSvg(px);
    assert.doesNotMatch(svg, /font-family|font-size|<text/, `${px}px still depends on a font`);
    assert.match(svg, /<path d="M/, `${px}px has no outline`);
  }
  assert.doesNotMatch(decodeURIComponent(faviconDataUri()), /font-family/);
});

test("the outline is the Yellowtail R, and says so", () => {
  assert.match(BADGE_LETTER.source, /Yellowtail/);
  assert.match(BADGE_LETTER.source, /Apache License 2\.0/, "an embedded outline carries its licence");
  assert.deepEqual(BADGE_LETTER.glyph, { id: 53, unitsPerEm: 2048, advance: 1502, contours: 1, points: 86 });
  // One closed contour: a script R is a single stroke, so a second Z would mean
  // the extraction picked up something that is not the letter.
  assert.equal((BADGE_LETTER.path.match(/Z/g) ?? []).length, 1);
  assert.match(BADGE_LETTER.path, /^M/);
});

test("the ink box is recorded from the outline, including the part that bleeds", () => {
  const nums = BADGE_LETTER.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  assert.ok(Math.abs(Math.max(...xs) - BADGE_LETTER.ink.x2) < 0.02, "recorded right edge must match the path");
  assert.ok(Math.abs(Math.min(...xs) - BADGE_LETTER.ink.x1) < 0.02, "recorded left edge must match the path");
  assert.ok(Math.abs(Math.max(...ys) - BADGE_LETTER.ink.y2) < 0.02, "recorded bottom edge must match the path");
  assert.ok(Math.abs(Math.min(...ys) - BADGE_LETTER.ink.y1) < 0.02, "recorded top edge must match the path");
  // E-19: the whole mark stays inside the square. This is the assertion that
  // was impossible while the letter was a font reference — a glyph's ink box
  // is not knowable from a font-family and a size, so the 2.17 units the
  // viewport was trimming went unnoticed until the outline made them a number.
  const ink = BADGE_LETTER.ink;
  assert.ok(ink.x1 >= 0 && ink.x2 <= 64, `ink spans ${ink.x1}..${ink.x2}, outside the 64-unit square`);
  assert.ok(ink.y1 >= 0 && ink.y2 <= 64, `ink spans ${ink.y1}..${ink.y2} vertically`);
  assert.equal(BULLETIN_ERRATA.find((e) => e.code === "E-19")?.status, "closed");
  assert.equal(BULLETIN_ERRATA.find((e) => e.code === "E-17")?.status, "closed");
});
