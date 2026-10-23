import type { UnitOfWork } from "../unit-of-work.ts";
import { resolvedTermsAt } from "./terms.ts";
import { deriveDueAt } from "../../../../packages/domain/src/sla/index.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type {
  CreateJobInput, CreateJobOutput, JobPriority, JobStateWire, JobWire, ListJobsOutput,
  FieldJobWire, MyJobsOutput, AddressWire, TransitionJobInput, TransitionJobOutput,
  AddJobNoteInput, AddJobNoteOutput, SetReturnTripInput, SetReturnTripOutput, CustomerSegment, JobWorkClass,
} from "../../../../packages/contracts/src/operations.ts";
import { OFFICE_JOB_TRANSITIONS, JOB_WORK_CLASSES } from "../../../../packages/contracts/src/operations.ts";

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
export const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
export const requireText = (v: unknown, field: string): string => {
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

export type JobRow = {
  id: string; site_id: string; site_name: string | null; site_address: AddressWire | null; contract_id: string | null; project_id: string | null;
  service_code: string; priority: JobPriority; state: JobStateWire; work_class: JobWorkClass;
  ws: string; we: string; version: number; opened_at: string; state_changed_at: string; region_id: string; org_id: string; customer_segment: CustomerSegment | null;
  current_crew_id: string | null; current_crew_label: string | null; current_assignment_id: string | null;
  sla_due_at: string | null; sla_escalation_stage: number | null; sla_satisfied_at: string | null;
  return_trip: boolean; note_body: string | null; note_at: string | null;
};

export const toWire = (r: JobRow): JobWire => ({
  id: r.id, siteId: r.site_id, siteName: r.site_name, siteAddress: r.site_address, contractId: r.contract_id, projectId: r.project_id,
  serviceCode: r.service_code, priority: r.priority, state: r.state, workClass: r.work_class,
  serviceWindowStart: r.ws, serviceWindowEnd: r.we, version: r.version, openedAt: r.opened_at, stateChangedAt: r.state_changed_at,
  regionId: r.region_id, orgId: r.org_id, customerSegment: r.customer_segment ?? null,
  currentCrewId: r.current_crew_id, currentCrewLabel: r.current_crew_label, currentAssignmentId: r.current_assignment_id,
  slaDueAt: r.sla_due_at, slaEscalationStage: r.sla_escalation_stage, slaSatisfiedAt: r.sla_satisfied_at,
  returnTrip: r.return_trip, latestNote: r.note_body !== null && r.note_at !== null ? { body: r.note_body, at: r.note_at } : null,
});

export const JOB_SELECT = `
  SELECT j.id, j.site_id, s.name AS site_name, s.address AS site_address, j.contract_id, j.project_id, j.service_code, j.priority, j.state, j.work_class,
         lower(j.service_window) AS ws, upper(j.service_window) AS we, j.version,
         to_char(j.opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS opened_at,
         to_char(COALESCE((SELECT max(e.occurred_at) FROM job_state_events e WHERE e.job_id = j.id AND e.to_state = j.state), j.opened_at)
                 AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS state_changed_at,
         j.region_id, j.org_id, o.segment AS customer_segment,
         a.crew_id AS current_crew_id, c.label AS current_crew_label, a.id AS current_assignment_id,
         to_char(st.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sla_due_at, st.escalation_stage AS sla_escalation_stage,
         to_char(st.satisfied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sla_satisfied_at,
         j.return_trip, n.body AS note_body, to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS note_at
    FROM jobs j
    LEFT JOIN accounts s ON s.id = j.site_id
    LEFT JOIN organizations o ON o.id = j.org_id
    LEFT JOIN assignments a ON a.job_id = j.id AND a.released_at IS NULL
    LEFT JOIN crews c ON c.id = a.crew_id
    LEFT JOIN sla_timers st ON st.job_id = j.id
    LEFT JOIN LATERAL (SELECT body, created_at FROM job_notes WHERE job_id = j.id AND kind = 'note' ORDER BY created_at DESC, id DESC LIMIT 1) n ON true`;

/** YYYY-MM-DD of an instant in an IANA zone. A zone the runtime does not know falls back to UTC rather than refusing the job. */
export const localDate = (at: Date, timeZone: string): string => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
  catch { return at.toISOString().slice(0, 10); }
};

export const createJob = async (uow: UnitOfWork, input: CreateJobInput, newId: () => string, now: Date): Promise<CreateJobOutput> => {
  const siteId = requireUuid(input.siteId, "siteId");
  const serviceCode = requireText(input.serviceCode, "serviceCode");
  const priority = input.priority ?? "routine";
  if (!PRIORITIES.includes(priority)) throw new BadInput(`priority must be one of ${PRIORITIES.join(", ")}`);
  const workClass = input.workClass ?? "service";
  if (!JOB_WORK_CLASSES.includes(workClass)) throw new BadInput(`workClass must be one of ${JOB_WORK_CLASSES.join(", ")}`);
  const windowStart = requireIso(input.serviceWindowStart, "serviceWindowStart");
  const windowEnd = requireIso(input.serviceWindowEnd, "serviceWindowEnd");
  if (windowEnd.getTime() <= windowStart.getTime()) throw new InputRefused("serviceWindowEnd must be after serviceWindowStart — an empty window is not a job", "bad_window");
  const contractId = input.contractId === undefined ? null : requireUuid(input.contractId, "contractId");
  const projectId = input.projectId === undefined ? null : requireUuid(input.projectId, "projectId");
  // 0024: an install is sold, scheduled and crewed — never an emergency, and
  // never without the person who sold it. Said here by name; 0024's checks
  // and trigger say it for every other path.
  if (workClass === "install" && priority === "emergency") {
    throw new InputRefused("an install is never an emergency — an emergency is a technician's call; open it as service work", "install_not_emergency");
  }
  if (workClass === "install" && !projectId) {
    throw new InputRefused("an install job sits under the project of the person who sold it — name the project", "install_needs_project");
  }
  if (input.equipmentIds !== undefined && !Array.isArray(input.equipmentIds)) throw new BadInput("equipmentIds must be a list of uuids");
  const equipmentIds = [...new Set((input.equipmentIds ?? []).map((e, i) => requireUuid(e, `equipmentIds[${i}]`)))];

  const site = (await uow.tx.query<{ id: string; tier: string; org_id: string; region_id: string }>(
    `SELECT id, tier, org_id, region_id FROM accounts WHERE id = $1`, [siteId],
  ))[0];
  if (!site) throw new InputRefused(`no node ${siteId} visible in this scope`, "unknown_site");
  if (site.tier !== "site") throw new InputRefused(`"${siteId}" is a ${site.tier}, not a site — work happens at a site, the tier with no descendants`, "not_a_site");
  // The agreement and project a job cites are the site's customer's — never another org's.
  if (contractId) {
    const c = (await uow.tx.query<{ org_id: string }>(`SELECT org_id FROM contracts WHERE id = $1`, [contractId]))[0];
    if (!c) throw new InputRefused(`no agreement ${contractId} visible in this scope`, "unknown_contract");
    if (c.org_id !== site.org_id) throw new InputRefused(`agreement ${contractId} is not this site's customer's`, "tenancy_mismatch");
  }
  if (projectId) {
    const pr = (await uow.tx.query<{ org_id: string; name: string; foreman_id: string | null }>(`SELECT org_id, name, foreman_id FROM projects WHERE id = $1`, [projectId]))[0];
    if (!pr) throw new InputRefused(`no project ${projectId} visible in this scope`, "unknown_project");
    if (pr.org_id !== site.org_id) throw new InputRefused(`project ${projectId} is not this site's customer's`, "tenancy_mismatch");
    if (workClass === "install" && !pr.foreman_id) {
      throw new InputRefused(`project ${pr.name} names no foreman — an install sits under the person who sold it; name them on the project first`, "project_has_no_seller");
    }
  }

  // Item 9: the units this job is about must be units at THIS site. The
  // trigger on job_equipment (0009) holds the same sentence for every other
  // path; here it is a named refusal before anything is written.
  if (equipmentIds.length > 0) {
    const units = await uow.tx.query<{ id: string; site_id: string; active: boolean }>(
      `SELECT id, site_id, active FROM equipment WHERE id = ANY($1::uuid[])`, [equipmentIds],
    );
    for (const id of equipmentIds) {
      const u = units.find((x) => x.id === id);
      if (!u) throw new InputRefused(`no equipment ${id} visible in this scope`, "unknown_equipment");
      if (u.site_id !== site.id) throw new InputRefused(`equipment ${id} is not at site ${site.id} — a job names the units at the site it is opened for`, "equipment_not_at_site");
    }
  }

  // Derived, never typed in. A resolution refusal (no value anywhere on the
  // path, an authoring-tier or ratchet violation) surfaces as its own 422 —
  // `resolvedTermsAt` never throws for one bad key, so it is read out of `refused`.
  // The day the job is opened is the day where the site is, not in UTC: an
  // evening job in Dallas the night before an amendment starts is under the
  // terms in force that evening.
  const tz = (await uow.tx.query<{ timezone: string | null }>(`SELECT timezone FROM regions WHERE id = $1`, [site.region_id]))[0]?.timezone ?? "UTC";
  const asOf = localDate(now, tz);
  const r = await resolvedTermsAt(uow, site.org_id, "site", site.id, asOf, ["sla_response"]);
  const refusedSla = r.refused.sla_response;
  if (refusedSla) {
    // A missing term is the dispatcher's to report, not to fix: say which
    // site and customer, so the surface can name them without parsing this.
    const named = refusedSla.code === "no_value"
      ? (await uow.tx.query<{ site_name: string; customer: string }>(
          `SELECT a.name AS site_name, o.name AS customer FROM accounts a JOIN organizations o ON o.id = a.org_id WHERE a.id = $1`, [site.id],
        ))[0]
      : undefined;
    throw new InputRefused(
      `cannot open a job at this site: ${refusedSla.message}`, refusedSla.code,
      named ? { termKey: "sla_response", siteId: site.id, siteName: named.site_name, customer: named.customer, asOf } : undefined,
    );
  }
  const resolution = r.resolved.sla_response!;
  const responseTerm = String(resolution.value);
  const dueAt = deriveDueAt(now, { response: responseTerm });

  const jobId = newId();
  const eventId = await uow.apply(
    {
      entity: "job", entityId: jobId, action: "job.create", topic: "job.created",
      before: null,
      after: { id: jobId, siteId: site.id, serviceCode, priority, workClass, state: "created", serviceWindowStart: windowStart.toISOString(), serviceWindowEnd: windowEnd.toISOString(), equipmentIds },
      orgId: site.org_id, regionId: site.region_id,
      payload: { siteId: site.id, serviceCode, priority, workClass },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO jobs (id, org_id, region_id, site_id, contract_id, project_id, service_code, priority, service_window, work_class)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, tstzrange($9::timestamptz, $10::timestamptz, '[)'), $11)`,
        [jobId, site.org_id, site.region_id, site.id, contractId, projectId, serviceCode, priority, windowStart.toISOString(), windowEnd.toISOString(), workClass],
      );
      for (const equipmentId of equipmentIds) {
        await tx.query(
          `INSERT INTO job_equipment (org_id, region_id, job_id, equipment_id) VALUES ($1, $2, $3, $4)`,
          [site.org_id, site.region_id, jobId, equipmentId],
        );
      }
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

/**
 * S3 → gateway: the office's hand on a job's state, and only for waiting on
 * the customer (OFFICE_JOB_TRANSITIONS). Assignment and release keep their
 * own doors; the field's moves arrive through sync.replay. The UPDATE names
 * the state it read, so a job the field moved in the meantime is refused as
 * a stale transition instead of being overwritten.
 */
export const transitionJob = async (uow: UnitOfWork, actorId: string, input: TransitionJobInput, at: Date): Promise<TransitionJobOutput> => {
  const jobId = requireUuid(input.jobId, "jobId");
  const job = (await uow.tx.query<{ state: JobStateWire; version: number; org_id: string; region_id: string }>(
    `SELECT state, version, org_id, region_id FROM jobs WHERE id = $1`, [jobId],
  ))[0];
  if (!job) throw new InputRefused(`job ${jobId} not found in scope`, "unknown_job");
  if (job.org_id !== input.orgId || job.region_id !== input.regionId) throw new InputRefused(`job ${jobId} tenancy does not match input`, "tenancy_mismatch");
  const legal = OFFICE_JOB_TRANSITIONS[job.state] ?? [];
  if (!legal.includes(input.to)) {
    throw new InputRefused(
      `job ${jobId} is "${job.state}" — the office may move it to ${legal.length ? legal.map((s) => `"${s}"`).join(" or ") : "nothing from here"}, not "${String(input.to)}"`,
      "illegal_transition",
    );
  }

  const version = job.version + 1;
  const eventId = await uow.apply(
    {
      entity: "job_state", entityId: jobId, action: "job.transition", topic: "job.transitioned",
      before: { state: job.state, version: job.version }, after: { state: input.to, version },
      orgId: job.org_id, regionId: job.region_id,
      payload: { jobId, from: job.state, to: input.to },
    },
    async (tx) => {
      const moved = await tx.query(`UPDATE jobs SET state = $2, version = $4 WHERE id = $1 AND state = $3 AND version = $5 RETURNING id`, [jobId, input.to, job.state, version, job.version]);
      if (moved.length === 0) throw new InputRefused(`job ${jobId} changed while this transition was in flight — read it again`, "illegal_transition");
      await tx.insert("job_state_events", {
        org_id: job.org_id, region_id: job.region_id, job_id: jobId, from_state: job.state, to_state: input.to,
        actor_id: actorId, surface_id: "S3", mutation_id: `office:v${version}`, occurred_at: at.toISOString(),
      });
    },
  );
  return { jobId, state: input.to, version, eventId };
};

/** The job a note or flag is about, in scope and matching the tenancy the caller named. */
export const jobInScope = async (uow: UnitOfWork, input: { jobId: string; orgId: string; regionId: string }) => {
  const jobId = requireUuid(input.jobId, "jobId");
  const job = (await uow.tx.query<{ org_id: string; region_id: string; return_trip: boolean }>(
    `SELECT org_id, region_id, return_trip FROM jobs WHERE id = $1`, [jobId],
  ))[0];
  if (!job) throw new InputRefused(`job ${jobId} not found in scope`, "unknown_job");
  if (job.org_id !== input.orgId || job.region_id !== input.regionId) throw new InputRefused(`job ${jobId} tenancy does not match input`, "tenancy_mismatch");
  return { jobId, ...job };
};

/** S3 → gateway: a note on a job. Append-only (0015's trigger), internal only (0015's policy). */
export const addJobNote = async (uow: UnitOfWork, actorId: string, input: AddJobNoteInput, newId: () => string): Promise<AddJobNoteOutput> => {
  const body = requireText(input.body, "body");
  if (body.length > 2000) throw new BadInput("body must be 2000 characters or fewer — a note, not a report");
  const kind = input.kind ?? "note";
  if (kind !== "note" && kind !== "standing") throw new BadInput("kind must be note or standing");
  const job = await jobInScope(uow, input);
  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "job_note", entityId: job.jobId, action: "job.note.add", topic: "job.annotated",
      before: null, after: { noteId: id, body, kind },
      orgId: job.org_id, regionId: job.region_id,
      payload: { jobId: job.jobId, noteId: id },
    },
    async (tx) => {
      await tx.insert("job_notes", { id, org_id: job.org_id, region_id: job.region_id, job_id: job.jobId, body, author_id: actorId, kind });
    },
  );
  return { id, jobId: job.jobId, eventId };
};

/** S3 → gateway: flag or clear a return trip. No version bump: a flag is not a state a device's offline log should lose to. */
export const setReturnTrip = async (uow: UnitOfWork, input: SetReturnTripInput): Promise<SetReturnTripOutput> => {
  if (typeof input.returnTrip !== "boolean") throw new BadInput("returnTrip must be true or false");
  const job = await jobInScope(uow, input);
  const eventId = await uow.apply(
    {
      entity: "job_flag", entityId: job.jobId, action: "job.return_trip.set", topic: "job.annotated",
      before: { returnTrip: job.return_trip }, after: { returnTrip: input.returnTrip },
      orgId: job.org_id, regionId: job.region_id,
      payload: { jobId: job.jobId, returnTrip: input.returnTrip },
    },
    async (tx) => {
      await tx.query(`UPDATE jobs SET return_trip = $2 WHERE id = $1`, [job.jobId, input.returnTrip]);
    },
  );
  return { jobId: job.jobId, returnTrip: input.returnTrip, eventId };
};
