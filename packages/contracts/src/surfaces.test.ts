import { test } from "node:test";
import assert from "node:assert/strict";
import { SURFACES, SURFACE_IDS, mayWrite } from "./surfaces.ts";
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
