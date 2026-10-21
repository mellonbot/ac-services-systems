import { test } from "node:test";
import assert from "node:assert/strict";
import { SURFACES, SURFACE_IDS, admits, surfacesAdmitting } from "../../packages/contracts/src/surfaces.ts";
import { ROLES } from "../../packages/contracts/src/scope.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { TEST_LOGINS, CUSTOMER_TEST_LOGIN, TEST_LOGIN_DOMAIN, testLoginRow } from "./test-logins.ts";

const REGION = "a0000000-0000-0000-0000-0000000000aa";
const CUSTOMER_ORG = "c0000000-0000-0000-0000-0000000000cc";
const byLogin = (name: string) => TEST_LOGINS.find((t) => t.login === name)!;

test("the three test logins exist, with the names asked for, at a reserved domain", () => {
  assert.deepEqual(TEST_LOGINS.map((t) => t.login), ["superadmin-test", "dispatcher-test", "service_manager-test"]);
  for (const t of TEST_LOGINS) assert.equal(t.email, `${t.login}@${TEST_LOGIN_DOMAIN}`);
  for (const t of TEST_LOGINS) for (const r of t.roles) assert.ok((ROLES as readonly string[]).includes(r), `${t.login}: ${r} is a registered role`);
});

test("the registry admits each test login to exactly the surfaces it is meant to see", () => {
  for (const t of TEST_LOGINS) {
    assert.deepEqual(surfacesAdmitting({ namespace: "internal", roles: t.roles }), t.surfaces, t.login);
  }
  assert.deepEqual(byLogin("superadmin-test").surfaces, ["S2", "S3", "S4"]);
  assert.deepEqual(byLogin("dispatcher-test").surfaces, ["S3"]);
  assert.deepEqual(byLogin("service_manager-test").surfaces, ["S2"]);
});

test("no internal login opens an external, device or anonymous surface, whatever its roles — namespaces sit below roles", () => {
  for (const id of SURFACE_IDS) {
    if (SURFACES[id].namespace === "internal") continue;
    assert.equal(admits(id, { namespace: "internal", roles: ROLES }), false, id);
  }
});

test("admits: a surface with no roles admits its namespace; a surface with roles admits only those", () => {
  assert.equal(admits("S6", { namespace: "customer", roles: [] }), true);
  assert.equal(admits("S2", { namespace: "internal", roles: [] }), false);
  assert.equal(admits("S4", { namespace: "internal", roles: ["dispatcher"] }), false);
  assert.equal(admits("S4", { namespace: "internal", roles: ["readonly"] }), true);
});

test("the users rows: org-wide logins scope to the internal org, the dispatcher to its one region", () => {
  const sa = testLoginRow(byLogin("superadmin-test"), REGION);
  assert.deepEqual([sa.namespace, sa.org_id, sa.region_id, sa.scope_tier, sa.scope_id], ["internal", INTERNAL_ORG_ID, REGION, "parent", INTERNAL_ORG_ID]);
  const sm = testLoginRow(byLogin("service_manager-test"), REGION);
  assert.deepEqual([sm.scope_tier, sm.scope_id], ["parent", INTERNAL_ORG_ID]);
  const d = testLoginRow(byLogin("dispatcher-test"), REGION);
  assert.deepEqual([d.scope_tier, d.scope_id, d.region_id], ["region", REGION, REGION]);
});

test("the customer login: customer namespace, no roles, the named customer org at parent tier → S6 alone", () => {
  assert.equal(CUSTOMER_TEST_LOGIN.email, `customer-test@${TEST_LOGIN_DOMAIN}`);
  assert.deepEqual(surfacesAdmitting({ namespace: "customer", roles: CUSTOMER_TEST_LOGIN.roles }), ["S6"]);
  assert.deepEqual(CUSTOMER_TEST_LOGIN.surfaces, ["S6"]);
  const c = testLoginRow(CUSTOMER_TEST_LOGIN, REGION, CUSTOMER_ORG);
  assert.deepEqual([c.namespace, c.org_id, c.region_id, c.scope_tier, c.scope_id], ["customer", CUSTOMER_ORG, REGION, "parent", CUSTOMER_ORG]);
  assert.throws(() => testLoginRow(CUSTOMER_TEST_LOGIN, REGION), /needs the customer org/);
});
