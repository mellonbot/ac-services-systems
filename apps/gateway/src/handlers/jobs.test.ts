import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { createJob, listJobs, listMyJobs } from "./jobs.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";

/**
 * What the HANDLER decides for item 4's job creation: which inputs are
 * admissible, that due_at is DERIVED (never typed in) from the site's
 * resolved sla_response term, and that a site with nothing resolvable on its
 * path refuses the job rather than inventing a commitment. Whether the
 * database agrees — the real trigger, the real resolver against a real
 * contract, the real sla_timers row — is test/integration/s3-s5.test.ts.
 */
const U = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), REGION = U(2), SITE = U(3);

const scripted = (answers: readonly (readonly [string, readonly unknown[]])[]) => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      for (const [needle, rows] of answers) if (sql.includes(needle)) return rows as never;
      return [];
    },
    async insert() {},
    async commit() {},
    async rollback() {},
  };
  return { tx, queries };
};

const ops: Principal = {
  namespace: "internal", subjectId: U(9), orgId: INTERNAL_ORG_ID, regionId: REGION, scopeTier: "parent", scopeId: INTERNAL_ORG_ID,
  roles: ["office_manager"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
const technician: Principal = {
  namespace: "device", subjectId: U(8), orgId: INTERNAL_ORG_ID, regionId: REGION, scopeTier: "region", scopeId: REGION,
  roles: ["technician"], firmId: null, deviceId: U(7), shiftId: U(6), tierClaim: null, sessionId: "sess-2",
};
let seq = 0;
const uowFor = async (tx: Tx, surfaceId: "S2" | "S3" | "S5" = "S2", principal: Principal = surfaceId === "S5" ? technician : ops) =>
  createUnitOfWork({ surfaceId, principal, requestId: "r", now: () => new Date("2026-09-17T12:00:00Z"), newId: () => U(400 + ++seq) }, tx);
const newId = () => U(500 + ++seq);
const now = new Date("2026-09-17T12:00:00Z");

const siteRow = { id: SITE, tier: "site", org_id: ORG, region_id: REGION };
const orgRow = { id: ORG, name: "Amped" };
// One node in the path, at "site" tier directly — pathLoader walks parent_id
// links regardless of skipped tiers; the ladder itself is the trigger's to enforce.
const accountsForOrg = [{ id: SITE, tier: "site", name: "Site A", parent_id: null }];
const overrideRow = (value: string) => ({
  id: U(20), contract_id: U(21), scope_tier: "site", scope_id: SITE, term_key: "sla_response", term_value: value,
  eff_from: "2026-01-01", eff_to: null,
});

const baseAnswers = (overrides: readonly unknown[]): (readonly [string, readonly unknown[]])[] => [
  ["FROM accounts WHERE id = $1", [siteRow]],
  ["FROM organizations WHERE id = $1", [orgRow]],
  ["FROM accounts WHERE org_id = $1", accountsForOrg],
  ["FROM contract_term_overrides", overrides],
];

test("createJob derives due_at from the resolved sla_response term and opens the timer in the same unit of work", async () => {
  const s = scripted(baseAnswers([overrideRow("4_hour")]));
  const uow = await uowFor(s.tx);
  const out = await createJob(uow, { siteId: SITE, serviceCode: "hvac_repair", serviceWindowStart: "2026-09-18T09:00:00Z", serviceWindowEnd: "2026-09-18T17:00:00Z" }, newId, now);

  assert.equal(out.responseTerm, "4_hour");
  assert.equal(out.dueAt, new Date(now.getTime() + 4 * 3_600_000).toISOString(), "due_at is now + the resolved window, not the service window");
  assert.equal(out.orgId, ORG);
  assert.equal(out.regionId, REGION);

  const writes = s.queries.filter((q) => q.sql.startsWith("INSERT"));
  assert.equal(writes.length, 2);
  assert.match(writes[0]!.sql, /INSERT INTO jobs/);
  assert.match(writes[1]!.sql, /INSERT INTO sla_timers/);
  assert.equal(writes[1]!.params[4], "4_hour");

  const pending = uow.pending();
  assert.deepEqual(pending.events.map((e) => e.topic), ["job.created", "sla.timer_opened"]);
});

test("createJob refuses a site that does not resolve to a site tier, an empty window, and an unresolvable sla_response", async () => {
  const notSite = await uowFor(scripted(baseAnswers([])).tx);
  await assert.rejects(
    createJob(notSite, { siteId: SITE, serviceCode: "x", serviceWindowStart: "2026-09-18T09:00:00Z", serviceWindowEnd: "2026-09-18T17:00:00Z" }, newId, now),
    // no override anywhere on the path and the register states no default — refused by name, not defaulted.
    (e: unknown) => e instanceof InputRefused && e.code === "no_value",
  );

  const s2 = scripted([["FROM accounts WHERE id = $1", [{ ...siteRow, tier: "location" }]]]);
  const notASite = await uowFor(s2.tx);
  await assert.rejects(
    createJob(notASite, { siteId: SITE, serviceCode: "x", serviceWindowStart: "2026-09-18T09:00:00Z", serviceWindowEnd: "2026-09-18T17:00:00Z" }, newId, now),
    (e: unknown) => e instanceof InputRefused && e.code === "not_a_site",
  );

  const s3 = scripted(baseAnswers([overrideRow("4_hour")]));
  const emptyWindow = await uowFor(s3.tx);
  await assert.rejects(
    createJob(emptyWindow, { siteId: SITE, serviceCode: "x", serviceWindowStart: "2026-09-18T17:00:00Z", serviceWindowEnd: "2026-09-18T09:00:00Z" }, newId, now),
    (e: unknown) => e instanceof InputRefused && e.code === "bad_window",
  );
  assert.equal(s3.queries.filter((q) => q.sql.startsWith("INSERT")).length, 0, "nothing was written for the refused window");
});

test("listJobs carries the current unreleased assignment and the open SLA timer alongside each job", async () => {
  const row = {
    id: U(30), site_id: SITE, contract_id: null, project_id: null, service_code: "hvac_repair", priority: "routine", state: "assigned",
    ws: "2026-09-18T09:00:00.000Z", we: "2026-09-18T17:00:00.000Z", version: 2, opened_at: "2026-09-17T12:00:00.000Z",
    region_id: REGION, org_id: ORG, current_crew_id: U(31), current_crew_label: "Crew A1", current_assignment_id: U(32),
    sla_due_at: "2026-09-17T16:00:00.000Z", sla_escalation_stage: 0, sla_satisfied_at: null,
  };
  const uow = await uowFor(scripted([["FROM jobs j", [row]]]).tx);
  const out = await listJobs(uow);
  assert.equal(out.jobs.length, 1);
  assert.equal(out.jobs[0]!.currentCrewLabel, "Crew A1");
  assert.equal(out.jobs[0]!.currentAssignmentId, U(32), "dispatch.release needs the assignment's own id, not the crew's");
  assert.equal(out.jobs[0]!.slaDueAt, "2026-09-17T16:00:00.000Z");
});

test("listMyJobs resolves the crew from the live shift grant, not a claim on the token, and refuses an unknown grant", async () => {
  const grantId = U(40);
  const uow = await uowFor(scripted([["FROM device_grants", [{ crew_id: U(41) }]]]).tx, "S5");
  const out = await listMyJobs(uow, grantId);
  assert.deepEqual(out.jobs, []);

  const gone = await uowFor(scripted([["FROM device_grants", []]]).tx, "S5");
  await assert.rejects(listMyJobs(gone, grantId), (e: unknown) => e instanceof InputRefused && e.code === "unknown_device");
});

test("createJob is a BadInput, not a 500, on a missing field", async () => {
  const uow = await uowFor(scripted(baseAnswers([overrideRow("4_hour")])).tx);
  await assert.rejects(createJob(uow, { serviceCode: "x" } as never, newId, now), BadInput);
});
