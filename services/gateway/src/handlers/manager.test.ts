import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../db/unit-of-work.ts";
import { managerOverview } from "./manager.ts";
import { seesManagerOverview, type Principal } from "../../../../packages/contracts/src/index.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";

/**
 * manager.overview against a scripted Tx. What this holds: the crew and
 * team reads are bound to the caller's org (users show every org to any
 * internal principal), while jobs, their events and invoices — which carry
 * the customer's org — are left to RLS at parent scope; the rows fold into the wire shape — unbilled by state, urgent work by
 * region, crews into branches and team. Who may call it is
 * seesManagerOverview, held here; that the gateway refuses everyone else
 * with a 403 is test/integration/s3-s5.test.ts.
 */
const U = (n: number) => `a6000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(1), WEST = U(2);
const exec: Principal = {
  namespace: "internal", subjectId: U(9), orgId: INTERNAL_ORG_ID, regionId: SOUTH, scopeTier: "parent", scopeId: INTERNAL_ORG_ID,
  roles: ["principal"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-6",
};
const scripted = (answers: Record<string, unknown[]>) => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) { calls.push({ sql, params }); for (const [needle, rows] of Object.entries(answers)) if (sql.includes(needle)) return rows as never; return []; },
    async insert() {}, async commit() {}, async rollback() {},
  };
  return { tx, calls };
};
const uowOf = (tx: Tx) => createUnitOfWork({ surfaceId: "S3", principal: exec, requestId: "r", now: () => new Date(), newId: () => U(99) }, tx);

test("seesManagerOverview: leadership at parent scope only — a region-scoped principal or a dispatcher is not", () => {
  assert.equal(seesManagerOverview({ roles: ["principal"], scopeTier: "parent" }), true);
  assert.equal(seesManagerOverview({ roles: ["dispatcher", "ops_leadership"], scopeTier: "parent" }), true);
  assert.equal(seesManagerOverview({ roles: ["principal"], scopeTier: "region" }), false, "region scope would mix one region's jobs with every region's invoices");
  assert.equal(seesManagerOverview({ roles: ["dispatcher"], scopeTier: "parent" }), false);
});

test("manager.overview: crews and the team are the caller's org; the customers' work is left to RLS", async () => {
  const s = scripted({});
  await managerOverview(await uowOf(s.tx), INTERNAL_ORG_ID, new Date("2026-10-13T12:00:00Z"));
  const reads = s.calls.filter((c) => !c.sql.includes("set_config"));
  const bound = reads.filter((c) => c.params.includes(INTERNAL_ORG_ID));
  assert.equal(bound.length, 2);
  assert.ok(bound.some((c) => c.sql.includes("FROM crews c")) && bound.some((c) => c.sql.includes("FROM users u")));
  for (const c of bound) assert.match(c.sql, /org_id = \$1/);
  for (const c of reads.filter((r) => /FROM (invoices|jobs|job_state_events)/.test(r.sql))) assert.doesNotMatch(c.sql, /org_id = \$1/, "a job's org is its customer's");
});

test("manager.overview: rows fold into the wire — unbilled by state, urgent work by region, crews into branches and team", async () => {
  const s = scripted({
    "FROM invoices": [{ currency: "USD", minor: "18420000", prior_minor: "17380000" }],
    "WITH done AS": [{ now: 142, prior: 133, fixed: 124 }],
    "WITH f AS": [{ request_to_scheduled_avg: 1.4, request_to_scheduled_n: 40, scheduled_to_on_site_avg: null, scheduled_to_on_site_n: 0,
      on_site_to_finished_avg: 0.8, on_site_to_finished_n: 38, finished_to_invoiced_avg: 18.2, finished_to_invoiced_n: 30 }],
    "FROM crews c": [
      { id: U(11), region_id: SOUTH, employed: true, labor_7d: 30, hours_week: 38, credential: "ok" },
      { id: U(12), region_id: SOUTH, employed: true, labor_7d: 20, hours_week: 12, credential: "at_risk" },
      { id: U(13), region_id: WEST, employed: false, labor_7d: 40, hours_week: 40, credential: "breached" },
    ],
    "GROUP BY region_id, state, urgent": [
      { region_id: SOUTH, state: "complete", urgent: false, n: 5 },
      { region_id: WEST, state: "needs_pricing", urgent: true, n: 2 },
      { region_id: WEST, state: "created", urgent: true, n: 2 },
      { region_id: SOUTH, state: "created", urgent: false, n: 7 },
    ],
    "generate_series": [{ week_start: "2026-10-12", completed: 42, invoiced: 19 }],
    "FROM regions WHERE active": [{ id: SOUTH, name: "Dallas–Fort Worth" }, { id: WEST, name: "Houston" }],
    "FROM users u": [
      { id: U(21), display_name: "Blake Keating", roles: ["technician"], crew_id: U(11), branch: "Dallas–Fort Worth", on_job: true },
      { id: U(22), display_name: "Priya Nair", roles: ["finance"], crew_id: null, branch: "Dallas–Fort Worth", on_job: false },
    ],
  });
  const out = await managerOverview(await uowOf(s.tx), INTERNAL_ORG_ID, new Date("2026-10-13T12:00:00Z"));
  assert.equal(out.asOf, "2026-10-13T12:00:00.000Z");
  assert.deepEqual(out.billed, [{ currency: "USD", minor: "18420000", priorMinor: "17380000" }]);
  assert.deepEqual(out.completed, { now: 142, prior: 133 });
  assert.equal(out.fixedFirstVisit, 124);
  assert.deepEqual(out.waits.map((w) => [w.step, w.avgDays, w.jobs]), [
    ["request_to_scheduled", 1.4, 40], ["scheduled_to_on_site", null, 0], ["on_site_to_finished", 0.8, 38], ["finished_to_invoiced", 18.2, 30],
  ]);
  assert.deepEqual(out.labor, { hours: 50, techs: 2 }, "a subcontracted crew is not our technician");
  assert.deepEqual(out.unbilled, { complete: 5, needsPricing: 2, awaitingPo: 0, awaitingPictures: 0, invoiceTrouble: 0 });
  assert.deepEqual(out.urgentUnassigned, [{ regionId: WEST, count: 2 }], "urgent work waiting on billing is not unassigned");
  assert.deepEqual(out.credentials, { expired: 1, expiring: 1 });
  assert.equal(out.nearOvertime, 1);
  assert.deepEqual(out.branches, [
    { regionId: SOUTH, name: "Dallas–Fort Worth", techs: 2, laborHours: 50, unbilled: 5 },
    { regionId: WEST, name: "Houston", techs: 0, laborHours: 0, unbilled: 2 },
  ]);
  assert.deepEqual(out.team, [
    { userId: U(21), name: "Blake Keating", roles: ["technician"], branch: "Dallas–Fort Worth", onJob: true, hoursThisWeek: 38, credential: "ok" },
    { userId: U(22), name: "Priya Nair", roles: ["finance"], branch: "Dallas–Fort Worth", onJob: false, hoursThisWeek: null, credential: null },
  ]);
});
