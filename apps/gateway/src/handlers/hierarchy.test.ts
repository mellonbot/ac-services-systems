import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { createOrganization, createAccount, moveAccount, updateAccount } from "./hierarchy.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { admissionAxis } from "../../../../packages/contracts/src/refusals.ts";

/**
 * What the HANDLER decides — the inputs — against a scripted database. The
 * structure (ladder, cross-org, shard key following a move) is the trigger's
 * and is held over the wire in test/integration/s2-c1.test.ts; these tests
 * are for the refusals that never reach the database.
 */
const U = (n: number) => `a0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), REGION = U(2), NODE_REGION = U(3), NODE_LOCATION = U(4), NODE_SITE = U(5), OTHER_ORG = U(9);

const scripted = (answers: Record<string, unknown[]>) => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const inserted: { table: string; row: Record<string, unknown> }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      for (const [needle, rows] of Object.entries(answers)) if (sql.includes(needle)) return rows as never;
      return [];
    },
    async insert(table, row) { inserted.push({ table, row }); },
    async commit() {},
    async rollback() {},
  };
  return { tx, queries, inserted };
};

const ops: Principal = {
  namespace: "internal", subjectId: "u-ops", orgId: "org-internal", regionId: REGION, scopeTier: "parent", scopeId: "org-internal",
  roles: ["account_owner"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
const uowFor = async (tx: Tx) => createUnitOfWork({ surfaceId: "S2", principal: ops, requestId: "r", now: () => new Date("2026-09-15T20:00:00Z"), newId: (() => { let i = 0; return () => U(100 + ++i); })() }, tx);

const REGION_ROW = { id: REGION, code: "SOUTH", name: "South", timezone: "America/Chicago", min_crew_density: 0, active: true };
const regionNode = { id: NODE_REGION, tier: "region", name: "Amped / South", parent_id: null, region_id: REGION, org_id: ORG, customer_group: null, external_ref: null, timezone: null, active: true, path: [NODE_REGION] };
const locationNode = { ...regionNode, id: NODE_LOCATION, tier: "location", name: "Austin", parent_id: NODE_REGION, path: [NODE_REGION, NODE_LOCATION] };

test("createOrganization: the parent and its first region node are two applies in ONE unit of work, both carrying the real region", async () => {
  const db = scripted({ "FROM regions WHERE id": [REGION_ROW] });
  const uow = await uowFor(db.tx);
  const out = await createOrganization(uow, { name: "Amped Two", firstRegionNode: { regionId: REGION, name: "Amped Two / South" } }, uow_newId());
  const pending = uow.pending();
  assert.equal(pending.audits.length, 2);
  assert.deepEqual(pending.audits.map((a) => a.action), ["organization.create", "account.create"]);
  assert.ok(pending.audits.every((a) => a.regionId === REGION), "no audit row for a parent without a region");
  assert.ok(pending.events.every((e) => e.topic === "account.created"));
  assert.equal(out.eventId, pending.audits[0]!.eventId);
  assert.equal(db.queries.filter((q) => q.sql.startsWith("INSERT INTO organizations")).length, 1);
  assert.equal(db.queries.filter((q) => q.sql.startsWith("INSERT INTO accounts")).length, 1);
});

test("createOrganization without a first region node is a 400 — there is no such thing as a parent we do not serve", async () => {
  const uow = await uowFor(scripted({}).tx);
  await assert.rejects(createOrganization(uow, { name: "Orphan" } as never, uow_newId()), (e: unknown) => e instanceof BadInput && /firstRegionNode is required/.test(String(e)));
  assert.equal(uow.pending().audits.length, 0);
});

test("createOrganization against an inactive region refuses before either row exists", async () => {
  const uow = await uowFor(scripted({ "FROM regions WHERE id": [{ ...REGION_ROW, active: false }] }).tx);
  await assert.rejects(createOrganization(uow, { name: "X", firstRegionNode: { regionId: REGION, name: "X / South" } }, uow_newId()), (e: unknown) => e instanceof InputRefused && e.code === "unknown_region");
  assert.equal(uow.pending().audits.length, 0);
});

test("createAccount: regionId is an input for a region node and REFUSED below it — the edge decides", async () => {
  const uow = await uowFor(scripted({ "FROM accounts WHERE id": [regionNode], "FROM regions WHERE id": [REGION_ROW] }).tx);
  await assert.rejects(
    createAccount(uow, { orgId: ORG, tier: "location", parentId: NODE_REGION, regionId: REGION, name: "Austin" }, uow_newId()),
    (e: unknown) => e instanceof InputRefused && e.code === "region_not_an_input" && /derives from the parent edge/.test(e.message),
  );
  await assert.rejects(
    createAccount(uow, { orgId: ORG, tier: "region", parentId: NODE_REGION, regionId: REGION, name: "Nope" }, uow_newId()),
    (e: unknown) => e instanceof InputRefused && e.code === "region_node_has_no_parent",
  );
});

test("createAccount for a location takes the parent's region and inserts with it — the trigger then agrees or refuses in its own words", async () => {
  const db = scripted({ "FROM accounts WHERE id": [regionNode], "FROM regions WHERE id": [REGION_ROW], "FROM crews": [{ n: "0" }] });
  const uow = await uowFor(db.tx);
  const out = await createAccount(uow, { orgId: ORG, tier: "location", parentId: NODE_REGION, name: "Austin", customerGroup: "Mountain" }, uow_newId());
  assert.equal(out.regionId, REGION);
  const ins = db.queries.find((q) => q.sql.startsWith("INSERT INTO accounts"))!;
  assert.equal(ins.params[2], REGION, "region_id handed to the trigger is the parent's");
  assert.equal(ins.params[3], NODE_REGION);
  assert.equal(ins.params[6], "Mountain", "the customer's grouping is an attribute, stored beside the node");
});

test("D14 through the handler: rule 0 → admitted with the caveat; rule set and unmet → 422 commercial", async () => {
  const withRule = (rule: number, crews: number) => scripted({
    "FROM accounts WHERE id": [regionNode], "FROM regions WHERE id": [{ ...REGION_ROW, min_crew_density: rule }], "FROM crews": [{ n: String(crews) }],
  }).tx;
  const admitted = await createAccount(await uowFor(withRule(0, 0)), { orgId: ORG, tier: "location", parentId: NODE_REGION, name: "Austin" }, uow_newId());
  assert.deepEqual(admitted.caveats, ["D14 rule not set for South"]);

  const met = await createAccount(await uowFor(withRule(2, 3)), { orgId: ORG, tier: "location", parentId: NODE_REGION, name: "Austin" }, uow_newId());
  assert.deepEqual(met.caveats, []);

  const uow = await uowFor(withRule(3, 1));
  await assert.rejects(
    createAccount(uow, { orgId: ORG, tier: "location", parentId: NODE_REGION, name: "Austin" }, uow_newId()),
    (e: unknown) => e instanceof InputRefused && e.code === "supply_below_density" && admissionAxis(e.code) === "commercial" && /South has 1 active crew;/.test(e.message),
  );
  assert.equal(uow.pending().audits.length, 0, "a refused location leaves no audit row");
});

test("D14 is asked of a location only — a site under a location is not a signature", async () => {
  const db = scripted({ "FROM accounts WHERE id": [locationNode], "FROM regions WHERE id": [{ ...REGION_ROW, min_crew_density: 99 }], "FROM crews": [{ n: "0" }] });
  const out = await createAccount(await uowFor(db.tx), { orgId: ORG, tier: "site", parentId: NODE_LOCATION, name: "Rooftop units" }, uow_newId());
  assert.deepEqual(out.caveats, []);
  assert.ok(!db.queries.some((q) => q.sql.includes("FROM crews")), "no crew count for a site");
});

test("createAccount under a parent in another org is refused by the handler before the trigger sees it", async () => {
  const uow = await uowFor(scripted({ "FROM accounts WHERE id": [{ ...regionNode, org_id: OTHER_ORG }] }).tx);
  await assert.rejects(createAccount(uow, { orgId: ORG, tier: "location", parentId: NODE_REGION, name: "X" }, uow_newId()), (e: unknown) => e instanceof InputRefused && e.code === "tenancy_mismatch");
});

test("moveAccount changes one column, carries the DESTINATION region as the row's tenancy, and counts descendants", async () => {
  const site = { ...locationNode, id: NODE_SITE, tier: "site", parent_id: NODE_LOCATION, path: [NODE_REGION, NODE_LOCATION, NODE_SITE] };
  const otherRegionNode = { ...regionNode, id: U(6), name: "Amped / West", region_id: U(7), path: [U(6)] };
  const db = scripted({
    [`FROM accounts WHERE id = $1`]: [], // overridden below per id
  });
  // Script by id: the node, then the target.
  const byId: Record<string, unknown> = { [NODE_SITE]: site, [U(6)]: otherRegionNode, [NODE_LOCATION]: locationNode };
  db.tx.query = (async (sql: string, params: readonly unknown[] = []) => {
    db.queries.push({ sql, params });
    if (sql.includes("FROM accounts WHERE id = $1")) { const r = byId[String(params[0])]; return r ? [r] : []; }
    if (sql.startsWith("UPDATE accounts SET parent_id")) return [{ region_id: U(7) }];
    if (sql.includes("= ANY(path) AND id <>")) return [{ n: "3" }];
    return [];
  }) as Tx["query"];
  const uow = await uowFor(db.tx);
  const out = await moveAccount(uow, { accountId: NODE_LOCATION, newParentId: U(6) });
  assert.equal(out.regionId, U(7), "region_id came back from the trigger, not from the input");
  assert.equal(out.movedDescendants, 3);
  const ev = uow.pending().events[0]!;
  assert.equal(ev.regionId, U(7), "the event carries the region the row is now in");
  assert.equal(ev.topic, "account.updated");
  assert.equal(db.queries.filter((q) => q.sql.startsWith("UPDATE accounts")).length, 1);
  assert.match(db.queries.find((q) => q.sql.startsWith("UPDATE accounts"))!.sql, /SET parent_id = \$2 WHERE id = \$1/, "one column; region_id and path are the trigger's");

  // A region node is not moved; a node is not moved under its own descendant.
  await assert.rejects(moveAccount(await uowFor(db.tx), { accountId: U(6), newParentId: NODE_LOCATION }), (e: unknown) => e instanceof InputRefused && e.code === "region_node_not_movable");
  byId[NODE_SITE] = site;
  await assert.rejects(moveAccount(await uowFor(db.tx), { accountId: NODE_LOCATION, newParentId: NODE_SITE }), (e: unknown) => e instanceof InputRefused && e.code === "cycle");
});

test("updateAccount never takes structure; deactivation is its own topic", async () => {
  const db = scripted({ "FROM accounts WHERE id": [locationNode] });
  const uow = await uowFor(db.tx);
  await assert.rejects(updateAccount(uow, { accountId: NODE_LOCATION, parentId: NODE_REGION } as never), (e: unknown) => e instanceof InputRefused && e.code === "structure_is_not_an_attribute");
  await assert.rejects(updateAccount(uow, { accountId: NODE_LOCATION }), (e: unknown) => e instanceof BadInput);
  await updateAccount(uow, { accountId: NODE_LOCATION, active: false, customerGroup: "Southwest" });
  const ev = uow.pending().events[0]!;
  assert.equal(ev.topic, "account.deactivated");
  const upd = db.queries.find((q) => q.sql.startsWith("UPDATE accounts SET"))!;
  assert.match(upd.sql, /customer_group = \$2, active = \$3/);
  assert.deepEqual(upd.params, [NODE_LOCATION, "Southwest", false]);
});

// A deterministic id source for the handlers that mint one.
function uow_newId() { let i = 0; return () => U(200 + ++i); }
