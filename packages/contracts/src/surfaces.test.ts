import { test } from "node:test";
import assert from "node:assert/strict";
import { SURFACES, SURFACE_IDS, mayWrite, WHITE_LABEL_SURFACES, isWhiteLabel } from "./surfaces.ts";
import { OPERATIONS } from "./operations.ts";
import { WRITE_ENTITIES } from "./entities.ts";

test("S4 is read-only by construction", () => {
  assert.deepEqual(SURFACES.S4.writes, []);
  assert.equal(mayWrite("S4", "assignment"), false);
});

test("S2 is the only surface that authors hierarchy, contract and network state", () => {
  const authoring = ["account", "contract", "subcontractor_firm", "rate_card"] as const;
  for (const entity of authoring) {
    const authors = SURFACE_IDS.filter((id) => mayWrite(id, entity));
    assert.deepEqual(authors, ["S2"], `${entity} is authored by ${authors.join(", ")}`);
  }
});

test("assignment is written only by dispatch — the gate lives at exactly one door", () => {
  assert.deepEqual(SURFACE_IDS.filter((id) => mayWrite(id, "assignment")), ["S3"]);
});

test("S2 never writes offline — it must not fork the truth", () => {
  assert.equal(SURFACES.S2.offline, false);
});

test("field density belongs to S5 alone; no other surface claims it", () => {
  assert.deepEqual(SURFACE_IDS.filter((id) => SURFACES[id].density === "field"), ["S5"]);
});

test("namespaces separate customer, subcontractor and vendor", () => {
  assert.notEqual(SURFACES.S6.namespace, SURFACES.S8.namespace);
  assert.notEqual(SURFACES.S7.namespace, SURFACES.S8.namespace);
});

test("every surface declares a degraded mode (S0 obligation)", () => {
  for (const id of SURFACE_IDS) assert.ok(SURFACES[id].degraded.length > 20, id);
});

test("no surface writes an entity outside the declared universe", () => {
  for (const id of SURFACE_IDS) {
    for (const w of SURFACES[id].writes) assert.ok(WRITE_ENTITIES.includes(w), `${id}:${w}`);
  }
});

test("Phase 1 is exactly S1,S2,S3,S5,S6,S8", () => {
  assert.deepEqual(SURFACE_IDS.filter((id) => SURFACES[id].phase === 1), ["S1","S2","S3","S5","S6","S8"]);
});

// ---------------------------------------------------------------------------
// White-label. One flag, read by three things that must not drift apart: the
// operation catalogue, the frame emitter, and the shell.
// ---------------------------------------------------------------------------
test("a tenant may repaint exactly the customer portal", () => {
  assert.deepEqual(WHITE_LABEL_SURFACES, ["S6"]);
  for (const id of SURFACE_IDS) assert.equal(isWhiteLabel(id), id === "S6", id);
});

test("no internal surface is white-label — a tenant does not repaint the house", () => {
  for (const id of SURFACE_IDS) {
    if (SURFACES[id].namespace === "internal") assert.equal(SURFACES[id].whiteLabel, false, id);
  }
});

test("NO white-label surface is field density, and that is the instrument argument as a registry rule", () => {
  // packages/tokens TENANT_SCOPE says the same thing as a CSS selector: a
  // tenant theme is validated against the light stock and excluded from the
  // plate. If a field surface were ever marked white-label, the flag would
  // promise something the stylesheet refuses to deliver, and the two would
  // disagree silently. They cannot both be right, so only one of them may move.
  for (const id of WHITE_LABEL_SURFACES) {
    assert.notEqual(SURFACES[id].density, "field", `${id} is field density and white-label`);
  }
});

test("brand.theme is served to exactly the surfaces the flag names, because it is derived from it", () => {
  assert.deepEqual(OPERATIONS["brand.theme"].surfaces, WHITE_LABEL_SURFACES);
  assert.equal(OPERATIONS["brand.theme"].auth, "none", "a portal is branded on its sign-in screen");
  // And the write is the other way round: authored by the one surface that
  // authors account truth, never by the portal being repainted.
  assert.deepEqual(OPERATIONS["brand.setTheme"].surfaces, ["S2"]);
  assert.ok(SURFACES.S2.writes.includes("brand_theme"));
  for (const id of WHITE_LABEL_SURFACES) assert.ok(!SURFACES[id].writes.includes("brand_theme"), `${id} repaints itself`);
});
