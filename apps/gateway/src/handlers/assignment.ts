import type { UnitOfWork } from "../unit-of-work.ts";
import { evaluate, isRefusal, type Crew, type Credential } from "../../../../packages/domain/src/compliance/gate.ts";
import { buildAssignment } from "../../../../packages/domain/src/compliance/assignment.ts";
import type { Refusal } from "../../../../packages/domain/src/compliance/clearance.ts";

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
  if (!job) throw new Error(`job ${input.jobId} not found in scope`);
  if (job.region_id !== input.regionId || job.org_id !== input.orgId) throw new Error(`job ${input.jobId} tenancy does not match input`);

  const crewRow = (await uow.tx.query<{ id: string; active: boolean; employment_type: Crew["employmentType"] }>(
    `SELECT id, active, employment_type FROM crews WHERE id = $1`, [input.crewId],
  ))[0];
  if (!crewRow) throw new Error(`crew ${input.crewId} not found in scope`);
  const crew: Crew = { id: crewRow.id, active: crewRow.active, employmentType: crewRow.employment_type };

  const creds = await uow.tx.query<{ id: string; kind: string; valid_from: string; valid_to: string; verified_at: string | null }>(
    `SELECT id, kind, to_char(valid_from,'YYYY-MM-DD') AS valid_from, to_char(valid_to,'YYYY-MM-DD') AS valid_to, verified_at FROM crew_credentials WHERE crew_id = $1`,
    [input.crewId],
  );
  const credentials: Credential[] = creds.map((c) => ({
    id: c.id, kind: c.kind,
    validFrom: Date.parse(`${c.valid_from}T00:00:00Z`),
    // valid_to is inclusive on the certificate; cover through the end of that day.
    validTo: Date.parse(`${c.valid_to}T23:59:59.999Z`),
    verifiedAt: c.verified_at ? Date.parse(c.verified_at) : null,
  }));

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
    },
  );
  return { ok: true, assignmentId, clearanceId, eventId };
};
