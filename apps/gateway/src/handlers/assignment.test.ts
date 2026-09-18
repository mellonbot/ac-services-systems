import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { assignCrew, candidateCrews, releaseAssignment } from "./assignment.ts";
import { InputRefused } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";

/**
 * The one gated door (existing), its dry run, and its release — decisions
 * only. Whether the trigger re-verifies the clearance, and whether a real
 * sla_timers row is really satisfied, is test/integration/s3-s5.test.ts.
 */
const U = (n: number) => `a0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), REGION = U(2), JOB = U(3), CREW = U(4);

const scripted = (answers: readonly (readonly [string, unknown[]])[]) => {
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

const dispatcher: Principal = {
  namespace: "internal", subjectId: U(9), orgId: INTERNAL_ORG_ID, regionId: REGION, scopeTier: "region", scopeId: REGION,
  roles: ["dispatcher"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
let seq = 0;
const uowFor = async (tx: Tx) => createUnitOfWork({ surfaceId: "S3", principal: dispatcher, requestId: "r", now: () => new Date("2026-09-17T12:00:00Z"), newId: () => U(500 + ++seq) }, tx);
const now = new Date("2026-09-17T12:00:00Z");

const job = { id: JOB, ws: "2026-09-18T09:00:00.000Z", we: "2026-09-18T17:00:00.000Z", state: "created", region_id: REGION, org_id: ORG };
const clearedCrew = { id: CREW, label: "Crew A1", active: true, employment_type: "employed" };
const clearedCreds = [{ id: U(10), kind: "license", valid_from: "2026-01-01", valid_to: "2026-12-31", verified_at: "2026-01-02T00:00:00Z" },
  { id: U(11), kind: "background_check", valid_from: "2026-01-01", valid_to: "2026-12-31", verified_at: "2026-01-02T00:00:00Z" }];

test("assignCrew satisfies the job's open SLA timer on success — the response the cascade is timing", async () => {
  const s = scripted([
    ["FROM jobs WHERE id", [job]],
    ["FROM crews WHERE id", [clearedCrew]],
    ["FROM crew_credentials", clearedCreds],
    ["INSERT INTO compliance_clearances", [{ id: U(20) }]],
    ["INSERT INTO assignments", [{ id: U(21) }]],
  ]);
  const uow = await uowFor(s.tx);
  const out = await assignCrew(uow, U(9), { jobId: JOB, crewId: CREW, orgId: ORG, regionId: REGION }, now);
  assert.equal(out.ok, true);
  const satisfy = s.queries.find((q) => q.sql.includes("UPDATE sla_timers SET satisfied_at"));
  assert.ok(satisfy, "the timer this job opened is satisfied in the same unit of work as the assignment");
  assert.equal(satisfy!.params[0], JOB);
});

test("candidateCrews is a DRY RUN over every active crew in the job's region — the same gate, nothing written", async () => {
  const uncleared = { id: U(30), label: "Crew B1", active: true, employment_type: "employed" };
  // A crew-keyed credentials answer, not a single fixed one: candidateCrews
  // evaluates several crews in one call, and each must see only its own file.
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params: readonly unknown[] = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM jobs WHERE id")) return [job] as never;
      if (sql.includes("FROM crews WHERE home_region_id")) return [clearedCrew, uncleared] as never;
      if (sql.includes("FROM crew_credentials")) return (params[0] === CREW ? clearedCreds : []) as never;
      return [] as never;
    },
    async insert() {},
    async commit() {},
    async rollback() {},
  };
  const uow = await uowFor(tx);
  const out = await candidateCrews(uow, { jobId: JOB, orgId: ORG, regionId: REGION }, now);
  assert.equal(out.candidates.length, 2);
  const a = out.candidates.find((c) => c.crewId === CREW)!;
  const b = out.candidates.find((c) => c.crewId === uncleared.id)!;
  assert.equal(a.cleared, true);
  assert.equal(a.refusal, null);
  assert.equal(b.cleared, false);
  assert.equal(b.refusal!.reason, "missing");
  assert.equal(queries.filter((q) => q.sql.startsWith("INSERT") || q.sql.startsWith("UPDATE")).length, 0, "a dry run writes nothing");
});

const openAssignment = { id: U(40), job_id: JOB, crew_id: CREW, org_id: ORG, region_id: REGION, released_at: null };

test("releaseAssignment returns the job to 'created' and refuses a second release by name", async () => {
  const s = scripted([
    ["FROM assignments WHERE id", [openAssignment]],
    ["FROM jobs WHERE id = $1", [{ state: "assigned" }]],
  ]);
  const uow = await uowFor(s.tx);
  const out = await releaseAssignment(uow, U(9), { assignmentId: openAssignment.id, orgId: ORG, regionId: REGION, reason: "customer rescheduled" }, now);
  assert.equal(out.jobId, JOB);
  assert.ok(s.queries.some((q) => /UPDATE assignments SET released_at/.test(q.sql)));
  assert.ok(s.queries.some((q) => /UPDATE jobs SET state = 'created'/.test(q.sql)));

  const already = await uowFor(scripted([["FROM assignments WHERE id", [{ ...openAssignment, released_at: "2026-09-17T00:00:00Z" }]]]).tx);
  await assert.rejects(
    releaseAssignment(already, U(9), { assignmentId: openAssignment.id, orgId: ORG, regionId: REGION }, now),
    (e: unknown) => e instanceof InputRefused && e.code === "already_released",
  );
});

test("releaseAssignment refuses a job that has already moved past assignment — that is a reassignment conversation, not a release", async () => {
  const s = scripted([
    ["FROM assignments WHERE id", [openAssignment]],
    ["FROM jobs WHERE id = $1", [{ state: "en_route" }]],
  ]);
  const uow = await uowFor(s.tx);
  await assert.rejects(
    releaseAssignment(uow, U(9), { assignmentId: openAssignment.id, orgId: ORG, regionId: REGION }, now),
    (e: unknown) => e instanceof InputRefused && e.code === "job_in_progress",
  );
  assert.equal(s.queries.filter((q) => q.sql.startsWith("UPDATE")).length, 0, "nothing was written for the refused release");
});
