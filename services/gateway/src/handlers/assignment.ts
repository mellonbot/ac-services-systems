import type { UnitOfWork } from "../db/unit-of-work.ts";
import { evaluate, isRefusal, type Crew, type Credential } from "../../../../packages/domain/src/compliance/gate.ts";
import { buildAssignment } from "../../../../packages/domain/src/compliance/assignment.ts";
import type { Refusal } from "../../../../packages/domain/src/compliance/clearance.ts";
import { InputRefused } from "../http/refusals.ts";
import { requireUuid } from "./jobs.ts";
import type { CandidateCrewsInput, CandidateCrewsOutput, CandidateCrewWire, CrewKind, JobWorkClass, ReleaseAssignmentInput, ReleaseAssignmentOutput } from "../../../../packages/contracts/src/operations.ts";
import { crewKindFor } from "../../../../packages/contracts/src/operations.ts";

/**
 * Shared by `assignCrew` and `candidateCrews` — one query shape, one mapping, so a dry run reads exactly what the gated door reads. One query for any number of crews.
 * A certificate's dates are days where the work is: they run from midnight
 * of valid_from to the end of valid_to in the job's region's timezone — the
 * same days 0029's clearance trigger reads.
 */
const credentialsOf = async (uow: UnitOfWork, crewIds: readonly string[], regionId: string): Promise<Map<string, Credential[]>> => {
  const creds = await uow.tx.query<{ crew_id: string; id: string; kind: string; valid_to: string; from_ms: string; to_ms: string; verified_at: string | null }>(
    `SELECT c.crew_id, c.id, c.kind, to_char(c.valid_to,'YYYY-MM-DD') AS valid_to,
            (extract(epoch FROM c.valid_from::timestamp AT TIME ZONE r.timezone) * 1000)::bigint::text AS from_ms,
            (extract(epoch FROM (c.valid_to + 1)::timestamp AT TIME ZONE r.timezone) * 1000 - 1)::bigint::text AS to_ms,
            c.verified_at
       FROM crew_credentials c, regions r WHERE c.crew_id = ANY($1::uuid[]) AND r.id = $2`,
    [crewIds, regionId],
  );
  const byCrew = new Map<string, Credential[]>(crewIds.map((id) => [id, []]));
  for (const c of creds) {
    byCrew.get(c.crew_id)!.push({
      id: c.id, kind: c.kind,
      validFrom: Number(c.from_ms),
      validTo: Number(c.to_ms),
      verifiedAt: c.verified_at ? Date.parse(c.verified_at) : null,
      lastDay: c.valid_to,
    });
  }
  return byCrew;
};

/** The crew as the gate reads it — with its firm's status, so a suspended firm's crew is refused at the same door. */
const CREW_SELECT = `SELECT c.id, c.label, c.active, c.employment_type, c.kind, f.status AS firm_status
  FROM crews c LEFT JOIN subcontractor_firms f ON f.id = c.firm_id`;
type CrewRow = { id: string; label: string; active: boolean; employment_type: Crew["employmentType"]; kind: CrewKind; firm_status: string | null };
const crewOf = (r: CrewRow): Crew => ({ id: r.id, active: r.active, employmentType: r.employment_type, firmStatus: r.firm_status });

/** The states a job may be dispatched from. Anything else — on site, done, cancelled, waiting on a quote — is not a dispatch. */
const DISPATCHABLE = ["created", "reassigned"];

/**
 * S3 → gateway: assign a crew to a job. THE ONE GATED DOOR.
 *
 * The gate is a type: buildAssignment() requires a ComplianceClearance that
 * only evaluate() can mint. This handler cannot construct one, cannot fake
 * one, and has no flag. If the crew does not clear the WHOLE service window,
 * the refusal goes back to the dispatcher in plain words, is recorded as an
 * event (crew.compliance_refused — the quality-scoring signal C9 feeds on),
 * and nothing is written to `assignments`.
 *
 * Layer 2, the trigger in migrations/0002, re-verifies the clearance covers
 * the window. Layer 3 is the clearance row itself, kept for the subrogation
 * conversation afterwards.
 */
export type AssignInput = {
  readonly jobId: string;
  readonly crewId: string;
  readonly orgId: string;
  readonly regionId: string;
};

export type AssignResult =
  | { readonly ok: true; readonly assignmentId: string; readonly clearanceId: string; readonly eventId: string }
  | { readonly ok: false; readonly refusal: Refusal; readonly eventId: string };

export const assignCrew = async (uow: UnitOfWork, actorId: string, input: AssignInput, evaluatedAt: Date): Promise<AssignResult> => {
  requireUuid(input.jobId, "jobId");
  requireUuid(input.crewId, "crewId");
  // FOR UPDATE: two dispatchers (or one double-click) on the same job queue
  // here, and the second reads the state the first left behind.
  const job = (await uow.tx.query<{ id: string; ws: string; we: string; state: string; region_id: string; org_id: string; work_class: JobWorkClass }>(
    `SELECT id, lower(service_window) AS ws, upper(service_window) AS we, state, region_id, org_id, work_class FROM jobs WHERE id = $1 FOR UPDATE`, [input.jobId],
  ))[0];
  if (!job) throw new InputRefused(`job ${input.jobId} not found in scope`, "unknown_job");
  if (job.region_id !== input.regionId || job.org_id !== input.orgId) throw new InputRefused(`job ${input.jobId} tenancy does not match input`, "tenancy_mismatch");
  if (!DISPATCHABLE.includes(job.state)) {
    throw new InputRefused(`job ${input.jobId} is "${job.state}" — only a job waiting for a crew can be dispatched`, "job_not_dispatchable");
  }

  const crewRow = (await uow.tx.query<CrewRow>(`${CREW_SELECT} WHERE c.id = $1`, [input.crewId]))[0];
  if (!crewRow) throw new InputRefused(`crew ${input.crewId} not found in scope`, "unknown_crew");
  // 0024: the work decides the kind of crew. Not a compliance verdict — no
  // credential was read — so it is refused by name, not recorded as one.
  const needed = crewKindFor(job.work_class);
  if (crewRow.kind !== needed) {
    throw new InputRefused(
      `job ${input.jobId} is ${job.work_class} work and ${crewRow.label} is ${crewRow.kind === "install" ? "an install crew" : "a technician"} — install work goes to an install crew; service and commissioning go to a technician`,
      "crew_kind_mismatch",
    );
  }
  const crew = crewOf(crewRow);
  const credentials = (await credentialsOf(uow, [input.crewId], job.region_id)).get(input.crewId)!;
  const window = { start: Date.parse(job.ws), end: Date.parse(job.we) };
  const verdict = evaluate(crew, credentials, window, evaluatedAt.getTime());

  if (isRefusal(verdict)) {
    // Refusals are events too: they are the only quality signal on crews not on our payroll (C9).
    const eventId = await uow.apply(
      {
        entity: "assignment", entityId: input.jobId, action: "assign.refused", topic: "crew.compliance_refused",
        before: null, after: { crewId: input.crewId, reason: verdict.reason, credentialKind: verdict.credentialKind },
        orgId: input.orgId, regionId: input.regionId,
        payload: { jobId: input.jobId, crewId: input.crewId, reason: verdict.reason, detail: verdict.detail },
      },
      async () => { /* nothing to write: the refusal IS the record */ },
    );
    return { ok: false, refusal: verdict, eventId };
  }

  // The only call site of buildAssignment in the gateway. It takes the clearance positionally; there is no other overload.
  const assignment = buildAssignment(input.jobId, input.crewId, verdict, actorId);
  let clearanceId = "";
  let assignmentId = "";
  const eventId = await uow.apply(
    {
      entity: "assignment", entityId: input.jobId, action: "assign", topic: "job.assigned",
      before: { state: job.state }, after: { crewId: input.crewId, credentialIds: verdict.credentialIds },
      orgId: input.orgId, regionId: input.regionId,
      payload: { jobId: input.jobId, crewId: input.crewId },
    },
    async (tx) => {
      const c = await tx.query<{ id: string }>(
        `INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by)
         VALUES ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), $6::jsonb, $7, $8) RETURNING id`,
        [input.orgId, input.regionId, assignment.crewId, new Date(verdict.windowStart).toISOString(), new Date(verdict.windowEnd).toISOString(),
         JSON.stringify(verdict.credentialIds), evaluatedAt.toISOString(), actorId],
      );
      clearanceId = c[0]!.id;
      // A job the field handed back (reassigned) still holds the crew that
      // handed it back. One live crew per job (0022): that one comes off first.
      await tx.query(`UPDATE assignments SET released_at = $2, release_reason = 'reassigned' WHERE job_id = $1 AND released_at IS NULL`, [input.jobId, evaluatedAt.toISOString()]);
      const a = await tx.query<{ id: string }>(
        `INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.orgId, input.regionId, assignment.jobId, assignment.crewId, clearanceId, assignment.assignedBy],
      );
      assignmentId = a[0]!.id;
      await tx.query(`UPDATE jobs SET state = 'assigned', version = version + 1 WHERE id = $1 AND state IN ('created','reassigned')`, [input.jobId]);
      await tx.insert("job_state_events", {
        org_id: input.orgId, region_id: input.regionId, job_id: input.jobId, from_state: job.state, to_state: "assigned",
        actor_id: actorId, surface_id: "S3", mutation_id: `assign:${assignmentId}`, occurred_at: evaluatedAt.toISOString(),
      });
      // The response the cascade is timing. Idempotent: a second assignment
      // after a release does not re-satisfy an already-satisfied timer, and a
      // job opened before item 4 (so it never got one) simply has none to set.
      await tx.query(`UPDATE sla_timers SET satisfied_at = $2 WHERE job_id = $1 AND satisfied_at IS NULL`, [input.jobId, evaluatedAt.toISOString()]);
    },
  );
  return { ok: true, assignmentId, clearanceId, eventId };
};

/**
 * S3 → gateway: THE SAME GATE, read-only. Every active crew in the job's
 * region, evaluated against the same `evaluate()` `dispatch.assign` calls —
 * not a second opinion with its own logic to drift from the real door. Ties
 * nothing, writes nothing; a dispatcher reads this and then walks through the
 * one gated door with the crew they picked.
 */
export const candidateCrews = async (uow: UnitOfWork, input: CandidateCrewsInput, evaluatedAt: Date): Promise<CandidateCrewsOutput> => {
  requireUuid(input.jobId, "jobId");
  const job = (await uow.tx.query<{ id: string; ws: string; we: string; region_id: string; org_id: string; work_class: JobWorkClass }>(
    `SELECT id, lower(service_window) AS ws, upper(service_window) AS we, region_id, org_id, work_class FROM jobs WHERE id = $1`, [input.jobId],
  ))[0];
  if (!job) throw new InputRefused(`job ${input.jobId} not found in scope`, "unknown_job");
  if (job.region_id !== input.regionId || job.org_id !== input.orgId) throw new InputRefused(`job ${input.jobId} tenancy does not match input`, "tenancy_mismatch");
  const window = { start: Date.parse(job.ws), end: Date.parse(job.we) };

  const crews = await uow.tx.query<CrewRow>(
    // The job's own region, not the caller's — RLS narrows further for a
    // region-locked principal; an org-scoped one may legitimately be looking
    // at a job outside their home region. Only the kind the work needs (0024).
    `${CREW_SELECT} WHERE c.home_region_id = $1 AND c.active AND c.kind = $2 ORDER BY c.label`, [job.region_id, crewKindFor(job.work_class)],
  );
  const credentials = await credentialsOf(uow, crews.map((c) => c.id), job.region_id);

  const candidates: CandidateCrewWire[] = [];
  for (const c of crews) {
    const verdict = evaluate(crewOf(c), credentials.get(c.id)!, window, evaluatedAt.getTime());
    candidates.push(
      isRefusal(verdict)
        ? { crewId: c.id, label: c.label, employmentType: c.employment_type, cleared: false, refusal: { reason: verdict.reason, credentialKind: verdict.credentialKind, detail: verdict.detail } }
        : { crewId: c.id, label: c.label, employmentType: c.employment_type, cleared: true, refusal: null },
    );
  }
  return { jobId: input.jobId, candidates };
};

/**
 * S3 → gateway: pull a crew off a job before field execution has begun.
 * `crew_release` — S3's own entity, not `assignment` — because the compliance
 * gate guards exactly one door (schema-guard's "one gated door" check) and
 * releasing is not walking back through it; nothing here reads a credential.
 *
 * Refused by name once the job has moved past 'assigned': a technician who
 * has already gone en_route is a cancellation or a reassignment conversation
 * S3 does not have a screen for yet, not a release.
 */
export const releaseAssignment = async (uow: UnitOfWork, actorId: string, input: ReleaseAssignmentInput, releasedAt: Date): Promise<ReleaseAssignmentOutput> => {
  requireUuid(input.assignmentId, "assignmentId");
  const found = (await uow.tx.query<{ job_id: string }>(`SELECT job_id FROM assignments WHERE id = $1`, [input.assignmentId]))[0];
  if (!found) throw new InputRefused(`assignment ${input.assignmentId} not found in scope`, "unknown_assignment");

  // FOR UPDATE, job first and then the assignment — the order assignCrew and
  // sync take them in — so two releases (or a release racing the field's
  // en_route) queue here and the second reads what the first left behind.
  const job = (await uow.tx.query<{ state: string }>(`SELECT state FROM jobs WHERE id = $1 FOR UPDATE`, [found.job_id]))[0];
  if (!job) throw new InputRefused(`job ${found.job_id} not found in scope`, "unknown_job");
  const a = (await uow.tx.query<{ id: string; job_id: string; crew_id: string; org_id: string; region_id: string; released_at: string | null }>(
    `SELECT id, job_id, crew_id, org_id, region_id, released_at FROM assignments WHERE id = $1 FOR UPDATE`, [input.assignmentId],
  ))[0];
  if (!a) throw new InputRefused(`assignment ${input.assignmentId} not found in scope`, "unknown_assignment");
  if (a.org_id !== input.orgId || a.region_id !== input.regionId) throw new InputRefused(`assignment ${input.assignmentId} tenancy does not match input`, "tenancy_mismatch");
  if (a.released_at) throw new InputRefused(`assignment ${input.assignmentId} was already released at ${a.released_at}`, "already_released");
  if (job.state !== "assigned") {
    throw new InputRefused(
      `job ${a.job_id} is "${job.state}" — past assignment, so release is not the right door. A job a technician has already acted on needs a cancellation or a reassignment conversation, not a release.`,
      "job_in_progress",
    );
  }

  const eventId = await uow.apply(
    {
      entity: "crew_release", entityId: a.job_id, action: "assignment.release", topic: "job.reassigned",
      before: { crewId: a.crew_id, state: job.state }, after: { released: true, reason: input.reason ?? null },
      orgId: input.orgId, regionId: input.regionId,
      payload: { jobId: a.job_id, crewId: a.crew_id, reason: input.reason ?? null },
    },
    async (tx) => {
      // Both guarded, both counted: a guard that misses is a refusal, never a
      // half-release with an event claiming the job went back to 'created'.
      const released = await tx.query(`UPDATE assignments SET released_at = $2, release_reason = $3 WHERE id = $1 AND released_at IS NULL RETURNING id`, [a.id, releasedAt.toISOString(), input.reason ?? null]);
      if (released.length === 0) throw new InputRefused(`assignment ${a.id} was already released`, "already_released");
      const reopened = await tx.query(`UPDATE jobs SET state = 'created', version = version + 1 WHERE id = $1 AND state = 'assigned' RETURNING id`, [a.job_id]);
      if (reopened.length === 0) throw new InputRefused(`job ${a.job_id} is no longer "assigned" — release is not the right door`, "job_in_progress");
      await tx.insert("job_state_events", {
        org_id: input.orgId, region_id: input.regionId, job_id: a.job_id, from_state: "assigned", to_state: "created",
        actor_id: actorId, surface_id: "S3", mutation_id: `release:${a.id}`, occurred_at: releasedAt.toISOString(),
      });
    },
  );
  return { jobId: a.job_id, eventId };
};
