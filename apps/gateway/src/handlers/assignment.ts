import type { UnitOfWork } from "../unit-of-work.ts";
import { evaluate, isRefusal, type Crew, type Credential } from "../../../../packages/domain/src/compliance/gate.ts";
import { buildAssignment } from "../../../../packages/domain/src/compliance/assignment.ts";
import type { Refusal } from "../../../../packages/domain/src/compliance/clearance.ts";
import { InputRefused } from "../refusals.ts";
import type { CandidateCrewsInput, CandidateCrewsOutput, CandidateCrewWire, ReleaseAssignmentInput, ReleaseAssignmentOutput } from "../../../../packages/contracts/src/operations.ts";

/** Shared by `assignCrew` and `candidateCrews` — one query shape, one mapping, so a dry run reads exactly what the gated door reads. */
const credentialsOf = async (uow: UnitOfWork, crewId: string): Promise<Credential[]> => {
  const creds = await uow.tx.query<{ id: string; kind: string; valid_from: string; valid_to: string; verified_at: string | null }>(
    `SELECT id, kind, to_char(valid_from,'YYYY-MM-DD') AS valid_from, to_char(valid_to,'YYYY-MM-DD') AS valid_to, verified_at FROM crew_credentials WHERE crew_id = $1`,
    [crewId],
  );
  return creds.map((c) => ({
    id: c.id, kind: c.kind,
    validFrom: Date.parse(`${c.valid_from}T00:00:00Z`),
    // valid_to is inclusive on the certificate; cover through the end of that day.
    validTo: Date.parse(`${c.valid_to}T23:59:59.999Z`),
    verifiedAt: c.verified_at ? Date.parse(c.verified_at) : null,
  }));
};

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
  const job = (await uow.tx.query<{ id: string; ws: string; we: string; state: string; region_id: string; org_id: string }>(
    `SELECT id, lower(service_window) AS ws, upper(service_window) AS we, state, region_id, org_id FROM jobs WHERE id = $1`, [input.jobId],
  ))[0];
  if (!job) throw new InputRefused(`job ${input.jobId} not found in scope`, "unknown_job");
  if (job.region_id !== input.regionId || job.org_id !== input.orgId) throw new InputRefused(`job ${input.jobId} tenancy does not match input`, "tenancy_mismatch");

  const crewRow = (await uow.tx.query<{ id: string; active: boolean; employment_type: Crew["employmentType"] }>(
    `SELECT id, active, employment_type FROM crews WHERE id = $1`, [input.crewId],
  ))[0];
  if (!crewRow) throw new InputRefused(`crew ${input.crewId} not found in scope`, "unknown_crew");
  const crew: Crew = { id: crewRow.id, active: crewRow.active, employmentType: crewRow.employment_type };
  const credentials = await credentialsOf(uow, input.crewId);
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
  const job = (await uow.tx.query<{ id: string; ws: string; we: string; region_id: string; org_id: string }>(
    `SELECT id, lower(service_window) AS ws, upper(service_window) AS we, region_id, org_id FROM jobs WHERE id = $1`, [input.jobId],
  ))[0];
  if (!job) throw new InputRefused(`job ${input.jobId} not found in scope`, "unknown_job");
  if (job.region_id !== input.regionId || job.org_id !== input.orgId) throw new InputRefused(`job ${input.jobId} tenancy does not match input`, "tenancy_mismatch");
  const window = { start: Date.parse(job.ws), end: Date.parse(job.we) };

  const crews = await uow.tx.query<{ id: string; label: string; active: boolean; employment_type: Crew["employmentType"] }>(
    // The job's own region, not the caller's — RLS narrows further for a
    // region-locked principal; an org-scoped one may legitimately be looking
    // at a job outside their home region.
    `SELECT id, label, active, employment_type FROM crews WHERE home_region_id = $1 AND active ORDER BY label`, [job.region_id],
  );

  const candidates: CandidateCrewWire[] = [];
  for (const c of crews) {
    const crew: Crew = { id: c.id, active: c.active, employmentType: c.employment_type };
    const credentials = await credentialsOf(uow, c.id);
    const verdict = evaluate(crew, credentials, window, evaluatedAt.getTime());
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
  const a = (await uow.tx.query<{ id: string; job_id: string; crew_id: string; org_id: string; region_id: string; released_at: string | null }>(
    `SELECT id, job_id, crew_id, org_id, region_id, released_at FROM assignments WHERE id = $1`, [input.assignmentId],
  ))[0];
  if (!a) throw new InputRefused(`assignment ${input.assignmentId} not found in scope`, "unknown_assignment");
  if (a.org_id !== input.orgId || a.region_id !== input.regionId) throw new InputRefused(`assignment ${input.assignmentId} tenancy does not match input`, "tenancy_mismatch");
  if (a.released_at) throw new InputRefused(`assignment ${input.assignmentId} was already released at ${a.released_at}`, "already_released");

  const job = (await uow.tx.query<{ state: string }>(`SELECT state FROM jobs WHERE id = $1`, [a.job_id]))[0];
  if (!job) throw new InputRefused(`job ${a.job_id} not found in scope`, "unknown_job");
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
      await tx.query(`UPDATE assignments SET released_at = $2, release_reason = $3 WHERE id = $1`, [a.id, releasedAt.toISOString(), input.reason ?? null]);
      await tx.query(`UPDATE jobs SET state = 'created', version = version + 1 WHERE id = $1 AND state = 'assigned'`, [a.job_id]);
      await tx.insert("job_state_events", {
        org_id: input.orgId, region_id: input.regionId, job_id: a.job_id, from_state: "assigned", to_state: "created",
        actor_id: actorId, surface_id: "S3", mutation_id: `release:${a.id}`, occurred_at: releasedAt.toISOString(),
      });
    },
  );
  return { jobId: a.job_id, eventId };
};
