import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type {
  CreateServiceRequestInput, CreateServiceRequestOutput, ListServiceRequestsInput, ListServiceRequestsOutput,
  ServiceRequestPriority, ServiceRequestWire, JobStateWire,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * ITEM 6 — S6's FIRST WRITE. A customer asks for work at one of its sites.
 *
 * The division of labour is C1's: this handler decides INPUTS — a site that
 * is a site, a priority from the list, a description that says something —
 * and the database decides what the principal may see. "Which sites may this
 * customer ask about" is not a WHERE clause here; it is 0006's policy on
 * `accounts`, which is why an invisible site comes back `unknown_site` rather
 * than `forbidden`: from inside the customer's scope the row is not there.
 *
 * Tenancy — org and region — derives from the site, never from the input and
 * never from the token: a parent-tier customer's token names one of our
 * regions, and its Boulder request belongs to the region Boulder is served
 * from, not the one the executive happened to be bound to at login.
 *
 * It is a REQUEST, not a job. A job is opened in Office & Dispatch against a
 * resolved SLA term (jobs.create); a request is the customer's statement of
 * need, and `job_id` is set when the office acts on it. Emergency is a
 * priority the customer may declare and the office may re-grade; the register
 * of SLA terms, not this field, is what the timer is derived from.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const PRIORITIES: readonly ServiceRequestPriority[] = ["emergency", "urgent", "routine"];
/** Long enough for a paragraph, short enough that a pasted log file is refused rather than stored. */
export const DESCRIPTION_MAX = 2000;

export const createServiceRequest = async (
  uow: UnitOfWork, requestedBy: string, input: CreateServiceRequestInput, newId: () => string,
): Promise<CreateServiceRequestOutput> => {
  const siteId = requireUuid(input.siteId, "siteId");
  const priority = input.priority ?? "routine";
  if (!PRIORITIES.includes(priority)) throw new BadInput(`priority must be one of ${PRIORITIES.join(", ")}`);
  if (typeof input.description !== "string") throw new BadInput("description is required");
  const description = input.description.trim();
  if (description.length === 0) throw new InputRefused("a request says what is wrong — the description is empty", "empty_description");
  if (description.length > DESCRIPTION_MAX) throw new InputRefused(`the description is ${description.length} characters; ${DESCRIPTION_MAX} is the most a request carries`, "description_too_long");

  const site = (await uow.tx.query<{ id: string; tier: string; org_id: string; region_id: string; active: boolean }>(
    `SELECT id, tier, org_id, region_id, active FROM accounts WHERE id = $1`, [siteId],
  ))[0];
  if (!site) throw new InputRefused(`no node ${siteId} visible in this scope`, "unknown_site");
  if (site.tier !== "site") throw new InputRefused(`"${siteId}" is a ${site.tier}, not a site — service is requested at a site, the tier equipment lives at`, "not_a_site");
  if (!site.active) throw new InputRefused(`site ${siteId} is not active`, "site_inactive");

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "service_request", entityId: id, action: "service_request.create", topic: "service_request.created",
      before: null, after: { id, siteId: site.id, priority, description },
      orgId: site.org_id, regionId: site.region_id,
      payload: { siteId: site.id, priority },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO service_requests (id, org_id, region_id, site_id, requested_by, priority, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, site.org_id, site.region_id, site.id, requestedBy, priority, description],
      );
    },
  );
  return { id, orgId: site.org_id, regionId: site.region_id, eventId };
};

type Row = {
  id: string; site_id: string; site_name: string; priority: ServiceRequestPriority; description: string;
  requested_by: string; created_at: string; job_id: string | null; job_state: JobStateWire | null; org_id: string; region_id: string;
};

/** S6 (its own, by RLS), S2 (org-wide), S3 (by region) — one query, one shape. */
export const listServiceRequests = async (uow: UnitOfWork, input: ListServiceRequestsInput): Promise<ListServiceRequestsOutput> => {
  const siteId = input.siteId === undefined ? null : requireUuid(input.siteId, "siteId");
  const rows = await uow.tx.query<Row>(
    `SELECT r.id, r.site_id, a.name AS site_name, r.priority, r.description, r.requested_by,
            to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
            r.job_id, j.state AS job_state, r.org_id, r.region_id
       FROM service_requests r
       JOIN accounts a ON a.id = r.site_id
       LEFT JOIN jobs j ON j.id = r.job_id
      WHERE ($1::uuid IS NULL OR r.site_id = $1)
      ORDER BY r.created_at DESC`,
    [siteId],
  );
  const requests: ServiceRequestWire[] = rows.map((r) => ({
    id: r.id, siteId: r.site_id, siteName: r.site_name, priority: r.priority, description: r.description,
    requestedBy: r.requested_by, createdAt: r.created_at, jobId: r.job_id, jobState: r.job_state, orgId: r.org_id, regionId: r.region_id,
  }));
  return { requests };
};
