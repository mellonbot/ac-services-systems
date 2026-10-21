import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPassword } from "../../../apps/gateway/src/auth.ts";
import { INTERNAL_ORG_ID } from "../../../packages/schema/src/tenancy.ts";
import { accessChanged, buildUserRow, checkPassword, LoginInputError } from "./rows.ts";
import type { Access, NewLogin } from "./rows.ts";

const R = "a0000000-0000-0000-0000-0000000000aa";
const ORG = "a0000000-0000-0000-0000-0000000000bb";
const NODE = "a0000000-0000-0000-0000-0000000000cc";
const FIRM = "a0000000-0000-0000-0000-0000000000dd";
const CREW = "a0000000-0000-0000-0000-0000000000ee";
const CREW_HOME = "a0000000-0000-0000-0000-0000000000ff";
const pw = "correct horse battery";
const base = { email: "a@b.co", displayName: "A B", password: pw };

const shape = (r: ReturnType<typeof buildUserRow>) =>
  [r.namespace, r.org_id, r.region_id, r.scope_tier, r.scope_id, r.firm_id, r.crew_id];

test("internal org-wide", () => {
  const r = buildUserRow({ ...base, kind: "internal", roles: ["principal"], scope: "org", regionId: R });
  assert.deepEqual(shape(r), ["internal", INTERNAL_ORG_ID, R, "parent", INTERNAL_ORG_ID, null, null]);
  assert.equal(verifyPassword(pw, r.password_hash), true);
});

test("internal region", () => {
  const r = buildUserRow({ ...base, kind: "internal", roles: ["principal"], scope: "region", regionId: R });
  assert.equal(r.scope_tier, "region");
  assert.equal(r.scope_id, R);
});

test("technician", () => {
  const r = buildUserRow({ ...base, kind: "technician", crewId: CREW, crewHomeRegionId: CREW_HOME });
  assert.deepEqual(shape(r), ["internal", INTERNAL_ORG_ID, CREW_HOME, "region", CREW_HOME, null, CREW]);
  assert.deepEqual(r.roles, ["technician"]);
});

test("customer whole company and site", () => {
  const c = buildUserRow({ ...base, kind: "customer", orgId: ORG, tier: "parent", nodeId: ORG, regionId: R });
  assert.deepEqual(shape(c).slice(0, 5), ["customer", ORG, R, "parent", ORG]);
  assert.deepEqual(c.roles, ["payer", "requester"], "one person on an account pays and asks");
  assert.deepEqual(buildUserRow({ ...base, kind: "customer", orgId: ORG, tier: "parent", nodeId: ORG, regionId: R, roles: ["payer"] }).roles, ["payer"]);
  assert.throws(() => buildUserRow({ ...base, kind: "customer", orgId: ORG, tier: "parent", nodeId: ORG, regionId: R, roles: [] }), /tick at least one/);
  const s = buildUserRow({ ...base, kind: "customer", orgId: ORG, tier: "site", nodeId: NODE, regionId: R });
  assert.equal(s.scope_id, NODE);
});

test("subcontractor", () => {
  const r = buildUserRow({ ...base, kind: "subcontractor", firmId: FIRM, regionId: R });
  assert.deepEqual(shape(r), ["subcontractor", FIRM, R, "parent", FIRM, FIRM, null]);
});

test("refusals", () => {
  const internal: NewLogin = { ...base, kind: "internal", roles: ["principal"], scope: "org", regionId: R };
  assert.throws(() => buildUserRow({ ...internal, password: "x".repeat(11) }), /at least 12/);
  assert.throws(() => checkPassword("short"), LoginInputError);
  assert.throws(() => buildUserRow({ ...internal, email: "nope" }), /email/);
  assert.throws(() => buildUserRow({ ...internal, roles: [] }), /role/);
  assert.equal(buildUserRow({ ...internal, email: "  A@B.Co " }).email, "a@b.co");
});

test("accessChanged", () => {
  const a: Access = { roles: ["principal", "dispatcher"], regionId: R, scopeTier: "parent", scopeId: ORG, orgId: ORG, crewId: null };
  assert.equal(accessChanged(a, { ...a }), false);
  assert.equal(accessChanged(a, { ...a, roles: ["dispatcher", "principal"] }), false);
  assert.equal(accessChanged(a, { ...a, roles: ["principal"] }), true);
  assert.equal(accessChanged(a, { ...a, regionId: NODE }), true);
  assert.equal(accessChanged(a, { ...a, scopeTier: "region" }), true);
  assert.equal(accessChanged(a, { ...a, scopeId: NODE }), true);
  assert.equal(accessChanged(a, { ...a, orgId: NODE }), true);
  assert.equal(accessChanged(a, { ...a, crewId: CREW }), true);
});
