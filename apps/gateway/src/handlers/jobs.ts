import type { UnitOfWork } from "../unit-of-work.ts";
import { resolvedTermsAt } from "./terms.ts";
import { deriveDueAt } from "../../../../packages/domain/src/sla/index.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type {
  CreateJobInput, CreateJobOutput, JobPriority, JobStateWire, JobWire, ListJobsOutput,
  FieldJobWire, MyJobsOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * ITEM 4 — THE JOB ITSELF. A job is created in Office & Dispatch (00 §2.2)
 * and it is the one row S3's board and S5's field screens both read.
 *
 * The one rule that matters here, stated once so it cannot be re-derived
 * wrong later: the SLA timer's due_at is DERIVED from the site's resolved
 * `sla_response` term (domain/sla `deriveDueAt`), never typed in — the same
 * sentence C6 states for the cascade. A site with no resolvable term (no
 * override anywhere on its path and no register default) refuses the job
 * outright, with the resolver's own reason: an SLA nobody agreed to is not
 * one this system will silently invent.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const requireText = (v: unknown, field: string): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new BadInput(`${field} is required`);
  return v.trim();
};
const requireIso = (v: unknown, field: string): Date => {
  if (typeof v !== "string") throw new BadInput(`${field} is required`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadInput(`${field} must be an ISO datetime`);
  return d;
};

const PRIORITIES: readonly JobPriority[] = ["emergency", "urgent", "routine", "pm"];

type JobRow = {
  id: string; site_id: string; site_name: string | null; contract_id: string | null; project_id: string | null;
  service_code: string; priority: JobPriority; state: JobStateWire;
  ws: string; we: string; version: number; opened_at: string; region_id: string; org_id: string;
  current_crew_id: string | null; current_crew_label: string | null; current_assignment_id: string | null;
  sla_due_at: string | null; sla_escalation_stage: number | null; sla_satisfied_at: string | null;
};

const toWire = (r: JobRow): JobWire => ({
  id: r.id, siteId: r.site_id, siteName: r.site_name, contractId: r.contract_id, projectId: r.project_id,
  serviceCode: r.service_code, priority: r.priority, state: r.state,
  serviceWindowStart: r.ws, serviceWindowEnd: r.we, version: r.version, openedAt: r.opened_at,
  regionId: r.region_id, orgId: r.org_id,
  currentCrewId: r.current_crew_id, currentCrewLabel: r.current_crew_label, currentAssignmentId: r.current_assignment_id,
  slaDueAt: r.sla_due_at, slaEscalationStage: r.sla_escalation_stage, slaSatisfiedAt: r.sla_satisfied_at,
});

const JOB_SELECT = `
  SELECT j.id, j.site_id, s.name AS site_name, j.contract_id, j.project_id, j.service_code, j.priority, j.state,
         lower(j.service_window) AS ws, upper(j.service_window) AS we, j.version,
         to_char(j.opened_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS opened_at, j.region_id, j.org_id,
         a.crew_id AS current_crew_id, c.label AS current_crew_label, a.id AS current_assignment_id,
         to_char(st.due_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sla_due_at, st.escalation_stage AS sla_escalation_stage,
         to_char(st.satisfied_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sla_satisfied_at
    FROM jobs j
    LEFT JOIN accounts s ON s.id = j.site_id
    LEFT JOIN assignments a ON a.job_id = j.id AND a.released_at IS NULL
    LEFT JOIN crews c ON c.id = a.crew_id
    LEFT JOIN sla_timers st ON st.job_id = j.id`;

export const createJob = async (uow: UnitOfWork, input: CreateJobInput, newId: () => string, now: Date): Promise<CreateJobOutput> => {
  const siteId = requireUuid(input.siteId, "siteId");
  const serviceCode = requireText(input.serviceCode, "serviceCode");
  const priority = input.priority ?? "routine";
  if (!PRIORITIES.includes(priority)) throw new BadInput(`priority must be one of ${PRIORITIES.join(", ")}`);
  const windowStart = requireIso(input.serviceWindowStart, "serviceWindowStart");
  const windowEnd = requireIso(input.serviceWindowEnd, "serviceWindowEnd");
  if (windowEnd.getTime() <= windowStart.getTime()) throw new InputRefused("serviceWindowEnd must be after serviceWindowStart — an empty window is not a job", "bad_window");
  const contractId = input.contractId === undefined ? null : requireUuid(input.contractId, "contractId");
  const projectId = input.projectId === undefined ? null : requireUuid(input.projectId, "projectId");

  const site = (await uow.tx.query<{ id: string; tier: string; org_id: string; region_id: string }>(
    `SELECT id, tier, org_id, region_id FROM accounts WHERE id = $1`, [siteId],
  ))[0];
  if (!site) throw new InputRefused(`no node ${siteId} visible in this scope`, "unknown_site");
  if (site.tier !== "site") throw new InputRefused(`"${siteId}" is a ${site.tier}, not a site — work happens at a site, the tier with no descendants`, "not_a_site");

  // Derived, never typed in. A resolution refusal (no value anywhere on the
  // path, an authoring-tier or ratchet violation) surfaces as its own 422 —
  // `resolvedTermsAt` never throws for one bad key, so it is read out of `refused`.
  const asOf = now.toISOString().slice(0, 10);
  const r = await resolvedTermsAt(uow, site.org_id, "site", site.id, asOf, ["sla_response"]);
  const refusedSla = r.refused.sla_response;
  if (refusedSla) throw new InputRefused(`cannot open a job at this site: ${refusedSla.message}`, refusedSla.code);
  const resolution = r.resolved.sla_response!;
  const responseTerm = String(resolution.value);
  const dueAt = deriveDueAt(now, { response: responseTerm });

  const jobId = newId();
  const eventId = await uow.apply(
    {
      entity: "job", entityId: jobId, action: "job.create", topic: "job.created",
      before: null,
      after: { id: jobId, siteId: site.id, serviceCode, priority, state: "created", serviceWindowStart: windowStart.toISOString(), serviceWindowEnd: windowEnd.toISOString() },
      orgId: site.org_id, regionId: site.region_id,
      payload: { siteId: site.id, serviceCode, priority },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO jobs (id, org_id, region_id, site_id, contract_id, project_id, service_code, priority, service_window)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, tstzrange($9::timestamptz, $10::timestamptz, '[)'))`,
        [jobId, site.org_id, site.region_id, site.id, contractId, projectId, serviceCode, priority, windowStart.toISOString(), windowEnd.toISOString()],
      );
    },
  );

  const slaTimerId = newId();
  await uow.apply(
    {
      entity: "job", entityId: jobId, action: "job.sla_timer.open", topic: "sla.timer_opened",
      before: null, after: { dueAt: dueAt.toISOString(), responseTerm },
      orgId: site.org_id, regionId: site.region_id,
      payload: { jobId, dueAt: dueAt.toISOString(), responseTerm },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO sla_timers (id, org_id, region_id, job_id, response_term, opened_at, due_at, resolution_trace)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [slaTimerId, site.org_id, site.region_id, jobId, responseTerm, now.toISOString(), dueAt.toISOString(), JSON.stringify(resolution.trace)],
      );
    },
  );

  return { id: jobId, orgId: site.org_id, regionId: site.region_id, slaTimerId, dueAt: dueAt.toISOString(), responseTerm, eventId };
};

/** S2 (org-wide) and S3 (region-locked by RLS) — same query, same shape. */
export const listJobs = async (uow: UnitOfWork, state?: string): Promise<ListJobsOutput> => {
  const states = state ? state.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const rows = await uow.tx.query<JobRow>(
    `${JOB_SELECT} WHERE ($1::text[] IS NULL OR j.state = ANY($1::text[])) ORDER BY j.opened_at DESC`,
    [states],
  );
  return { jobs: rows.map(toWire) };
};

/**
 * S5's own read. A device principal has no crew claim on the token — carrying
 * one would be a token that is wrong the moment a grant is revoked — so the
 * crew comes from the live shift grant, the same row `auth.deviceLogin` read
 * to mint this token in the first place.
 */
export const listMyJobs = async (uow: UnitOfWork, shiftId: string): Promise<MyJobsOutput> => {
  const grant = (await uow.tx.query<{ crew_id: string }>(`SELECT crew_id FROM device_grants WHERE id = $1`, [shiftId]))[0];
  if (!grant) throw new InputRefused(`shift grant ${shiftId} is unknown to this gateway`, "unknown_device");
  const rows = await uow.tx.query<{ id: string; site_id: string; service_code: string; priority: JobPriority; state: JobStateWire; ws: string; we: string; version: number }>(
    `SELECT j.id, j.site_id, j.service_code, j.priority, j.state,
            lower(j.service_window) AS ws, upper(j.service_window) AS we, j.version
       FROM jobs j
       JOIN assignments a ON a.job_id = j.id AND a.released_at IS NULL
      WHERE a.crew_id = $1
      ORDER BY lower(j.service_window)`,
    [grant.crew_id],
  );
  const jobs: FieldJobWire[] = rows.map((r) => ({
    id: r.id, siteId: r.site_id, serviceCode: r.service_code, priority: r.priority, state: r.state,
    serviceWindowStart: r.ws, serviceWindowEnd: r.we, version: r.version,
  }));
  return { jobs };
};
