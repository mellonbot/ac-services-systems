import { test } from "node:test";
import assert from "node:assert/strict";
import { SURFACES } from "../../../packages/contracts/src/surfaces.ts";
import { KINDS, kindsOf } from "./kinds.ts";

const kind = (id: string) => KINDS.find((k) => k.id === id)!;

test("KINDS names come from SURFACES", () => {
  for (const id of ["S2", "S3", "S4", "S6", "S7", "S8"] as const) assert.equal(kind(id).name, SURFACES[id].name);
  assert.equal(kind("S5").name, "Technician");
  assert.equal(kind("other").name, "Other");
  assert.deepEqual(KINDS.map((k) => k.id), ["S2", "S3", "S4", "S5", "S6", "S8", "S7", "other"]);
});

test("canAdd", () => {
  assert.equal(kind("S7").canAdd, false);
  assert.equal(kind("S7").note, "not live yet");
  assert.equal(kind("other").canAdd, false);
  for (const id of ["S2", "S3", "S4", "S5", "S6", "S8"]) assert.equal(kind(id).canAdd, true, id);
});

test("superadmin-test opens S2, S3, S4", () => {
  assert.deepEqual(kindsOf({ namespace: "internal", roles: ["principal"], crewId: null }), ["S2", "S3", "S4"]);
});

test("single-surface logins", () => {
  assert.deepEqual(kindsOf({ namespace: "internal", roles: ["dispatcher"], crewId: null }), ["S3"]);
  assert.deepEqual(kindsOf({ namespace: "internal", roles: ["office_manager"], crewId: null }), ["S2"]);
  assert.deepEqual(kindsOf({ namespace: "internal", roles: ["principal"], crewId: null, scopeTier: "region" }), ["S3"], "S2 and S4 are org-wide; a regional login opens S3 alone");
  assert.deepEqual(kindsOf({ namespace: "customer", roles: [], crewId: null }), ["S6"]);
  assert.deepEqual(kindsOf({ namespace: "subcontractor", roles: [], crewId: null }), ["S8"]);
  assert.deepEqual(kindsOf({ namespace: "vendor", roles: [], crewId: null }), ["S7"]);
});

test("a crew makes a technician, whatever the namespace", () => {
  assert.deepEqual(kindsOf({ namespace: "internal", roles: ["technician"], crewId: "c" }), ["S5"]);
  assert.deepEqual(kindsOf({ namespace: "subcontractor", roles: [], crewId: "c" }), ["S8", "S5"]);
});

test("nothing matches -> other", () => {
  assert.deepEqual(kindsOf({ namespace: "internal", roles: ["technician"], crewId: null }), ["other"]);
  assert.deepEqual(kindsOf({ namespace: "internal", roles: [], crewId: null }), ["other"]);
});
