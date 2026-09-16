import { test } from "node:test";
import assert from "node:assert/strict";
import { BADGE, ICON_SIZES, badgeSvg, faviconDataUri, thickenFor, BRAND } from "./brand.ts";
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
  assert.deepEqual(BADGE.ring, { cx: 17, cy: 20, r: 5.5, width: 5 });
  assert.deepEqual(BADGE.letter, { size: 50, x: 41, baseline: 48 });
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
    assert.ok(svg.includes(`x="${BADGE.letter.x}" y="${BADGE.letter.baseline}"`), `${px} moved the letter`);
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
