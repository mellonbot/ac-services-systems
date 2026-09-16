import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFrame, renderMain } from "./emit-surfaces.ts";
import { SURFACES, SURFACE_IDS, WHITE_LABEL_SURFACES } from "../../packages/contracts/src/index.ts";

/**
 * The frame emitter's half of the white-label contract. The registry flag is
 * read in three places and this is the one that ends up in a file a browser
 * loads, so the ORDER matters as much as the presence.
 */
test("only a white-label surface carries a brand slot", () => {
  for (const id of SURFACE_IDS) {
    const frame = renderFrame(SURFACES[id]);
    const has = frame.includes(`<style id="ac-brand">`);
    assert.equal(has, SURFACES[id].whiteLabel, `${id}: slot presence disagrees with the registry`);
  }
  assert.ok(WHITE_LABEL_SURFACES.length > 0, "a test that passes because nothing is white-label is not a test");
});

test("the slot is EMPTY and comes AFTER the plate — that order is the fallback", () => {
  const frame = renderFrame(SURFACES.S6);
  // Empty in the file: a portal whose gateway never answers renders with the
  // inline :root block above, which is Rankine's own livery, not nothing.
  assert.match(frame, /<style id="ac-brand"><\/style>/);
  assert.ok(frame.indexOf(":root{--color-action") < frame.indexOf(`<style id="ac-brand"`), "a tenant block before the plate is a tenant block the plate overrides");
  assert.ok(frame.indexOf(`<style id="ac-brand"`) < frame.indexOf("</head>"));
});

test("the field frame has no slot to fill, whatever anything else believes", () => {
  const frame = renderFrame(SURFACES.S5);
  assert.doesNotMatch(frame, /ac-brand/);
  assert.match(frame, /data-density="field"/, "and it is the density TENANT_SCOPE excludes");
});

test("a white-label surface's entrypoint exposes the install, and the others do not", () => {
  for (const id of SURFACE_IDS) {
    const main = renderMain(SURFACES[id]);
    assert.equal(/export const brand = /.test(main), SURFACES[id].whiteLabel, id);
    assert.equal(/installBrand/.test(main), SURFACES[id].whiteLabel, id);
  }
  assert.match(renderMain(SURFACES.S6), /before connect\(\)/, "the order is the point: branding precedes login");
});
