import type { UnitOfWork } from "../unit-of-work.ts";
import type { ManagerOverviewOutput, ManagerWaitStep, CredentialStanding } from "../../../../packages/contracts/src/operations.ts";
import { UNASSIGNED_REGION_ID } from "../../../../packages/schema/src/tenancy.ts";

/**
 * manager.overview — S3's Manager Dashboard, read live from the operational
 * tables and the QuickBooks mirror (0018). The caller is already leadership
 * at parent scope (main.ts refuses anyone else), so RLS shows every region
 * and every customer's work: jobs, their events and the ledger carry the
 * CUSTOMER's org, and the whole book is what a manager reads. Crews and internal users carry the company's own
 * org, and those two reads are bound to the caller's.
 *
 * Every clock is the database's `now()`: one transaction, one instant.
 * Weeks start Monday (date_trunc('week')), months on the 1st, both UTC.
 */
const MONTH = "date_trunc('month', now())";
const UNBILLED = ["complete", "needs_pricing", "awaiting_po", "awaiting_pictures", "invoice_trouble"] as const;
const OVERTIME_WATCH_HOURS = 36;

/** Span length in hours, an open span counted to now. */
const HOURS = "extract(epoch FROM (COALESCE(upper(t.span), now()) - lower(t.span))) / 3600";

export const managerOverview = async (uow: UnitOfWork, orgId: string, now: Date): Promise<ManagerOverviewOutput> => {
  const q = <T>(sql: string) => uow.tx.query<T>(sql);
  const ours = <T>(sql: string) => uow.tx.query<T>(sql, [orgId]);

  // Money is QuickBooks' (0018): billed by invoice date, collected by payment date, by the day — this month to
  // date against last month to the same day.
  const DAY = "current_date", MONTH_DAY = `${MONTH}::date`, LAST = `(${MONTH} - interval '1 month')::date`, LAST_DAY = "(now() - interval '1 month')::date";
  const money = (table: "ledger_invoices" | "ledger_payments", amount: string, on: string) => q<{ currency: string; minor: string; prior_minor: string }>(
    `SELECT currency,
            COALESCE(sum(${amount}) FILTER (WHERE ${on} BETWEEN ${MONTH_DAY} AND ${DAY}), 0)::text AS minor,
            COALESCE(sum(${amount}) FILTER (WHERE ${on} BETWEEN ${LAST} AND ${LAST_DAY}), 0)::text AS prior_minor
       FROM ${table}
      WHERE ${on} >= ${LAST}
      GROUP BY currency ORDER BY currency`);
  const billed = await money("ledger_invoices", "total_minor", "txn_date");
  const collected = await money("ledger_payments", "amount_minor", "received_on");

  // Invoiced → paid: an invoice QuickBooks shows settled, from its date to the payment that settled it.
  const [paid] = await q<{ avg: number | null; n: number }>(
    `WITH settled AS (
       SELECT i.txn_date, max(p.received_on) AS paid_on
         FROM ledger_invoices i JOIN ledger_payments p ON p.realm_id = i.realm_id AND p.invoice_qbo_id = i.qbo_id
        WHERE i.balance_minor = 0 AND i.total_minor > 0 AND p.amount_minor > 0
        GROUP BY i.id, i.txn_date)
     SELECT avg(paid_on - txn_date)::float8 AS avg, count(*)::int AS n FROM settled WHERE paid_on >= ${DAY} - 30`);
  const [sync] = await q<{ synced_at: string | null }>("SELECT max(synced_at) AS synced_at FROM ledger_sync_state");

  // A job counts once, at its first completion in the window.
  const [done] = await q<{ now: number; prior: number; fixed: number }>(
    `WITH done AS (
       SELECT DISTINCT ON (e.job_id) e.job_id, e.occurred_at FROM job_state_events e
        WHERE e.to_state = 'complete' AND e.occurred_at >= ${MONTH} - interval '1 month'
        ORDER BY e.job_id, e.occurred_at)
     SELECT count(*) FILTER (WHERE d.occurred_at >= ${MONTH})::int AS now,
            count(*) FILTER (WHERE d.occurred_at < now() - interval '1 month')::int AS prior,
            count(*) FILTER (WHERE d.occurred_at >= ${MONTH} AND NOT j.return_trip
                             AND (SELECT count(*) FROM assignments a WHERE a.job_id = d.job_id) = 1)::int AS fixed
       FROM done d JOIN jobs j ON j.id = d.job_id`);

  // Each step is measured on the jobs that finished it in the last 30 days, from first arrival at each state.
  const [w] = await q<Record<`${ManagerWaitStep}_${"avg" | "n"}`, number | null>>(
    `WITH f AS (
       SELECT j.opened_at AS requested,
              min(e.occurred_at) FILTER (WHERE e.to_state = 'assigned') AS scheduled,
              min(e.occurred_at) FILTER (WHERE e.to_state = 'on_site') AS on_site,
              min(e.occurred_at) FILTER (WHERE e.to_state = 'complete') AS finished,
              min(e.occurred_at) FILTER (WHERE e.to_state = 'invoiced') AS invoiced
         FROM jobs j LEFT JOIN job_state_events e ON e.job_id = j.id
        GROUP BY j.id, j.opened_at)
     SELECT ${([["request_to_scheduled", "requested", "scheduled"], ["scheduled_to_on_site", "scheduled", "on_site"],
                ["on_site_to_finished", "on_site", "finished"], ["finished_to_invoiced", "finished", "invoiced"]] as const)
       .map(([step, from, to]) => `
            avg(extract(epoch FROM ${to} - ${from}) / 86400) FILTER (WHERE ${to} >= now() - interval '30 days' AND ${from} IS NOT NULL)::float8 AS ${step}_avg,
            count(*) FILTER (WHERE ${to} >= now() - interval '30 days' AND ${from} IS NOT NULL)::int AS ${step}_n`).join(",")}
       FROM f`);

  const crews = await ours<{ id: string; region_id: string; employed: boolean; labor_7d: number; hours_week: number; credential: CredentialStanding | null }>(
    `SELECT c.id, c.region_id, c.employment_type = 'employed' AS employed,
            COALESCE((SELECT sum(${HOURS}) FROM time_entries t
                       WHERE t.crew_id = c.id AND t.kind = 'labor' AND lower(t.span) >= now() - interval '7 days'), 0)::float8 AS labor_7d,
            COALESCE((SELECT sum(${HOURS}) FROM time_entries t
                       WHERE t.crew_id = c.id AND lower(t.span) >= date_trunc('week', now())), 0)::float8 AS hours_week,
            (SELECT CASE WHEN min(latest) IS NULL THEN NULL
                         WHEN min(latest) < current_date THEN 'breached'
                         WHEN min(latest) < current_date + 30 THEN 'at_risk' ELSE 'ok' END
               FROM (SELECT max(k.valid_to) AS latest FROM crew_credentials k WHERE k.crew_id = c.id GROUP BY k.kind) per_kind) AS credential
       FROM crews c
      WHERE c.org_id = $1 AND c.active`);
  const employed = crews.filter((c) => c.employed);

  const open = await q<{ region_id: string; state: string; urgent: boolean; n: number }>(
    `SELECT region_id, state, priority IN ('emergency', 'urgent') AS urgent, count(*)::int AS n
       FROM jobs
      WHERE state IN (${[...UNBILLED, "created", "reassigned", "reopened"].map((s) => `'${s}'`).join(", ")})
      GROUP BY region_id, state, urgent`);
  const unbilledIn = (state: string) => open.filter((r) => r.state === state).reduce((n, r) => n + r.n, 0);
  const urgentByRegion = new Map<string, number>();
  for (const r of open) if (r.urgent && !(UNBILLED as readonly string[]).includes(r.state)) urgentByRegion.set(r.region_id, (urgentByRegion.get(r.region_id) ?? 0) + r.n);

  const weeks = await q<{ week_start: string; completed: number; invoiced: number }>(
    `SELECT to_char(w, 'YYYY-MM-DD') AS week_start,
            (SELECT count(DISTINCT e.job_id) FROM job_state_events e WHERE e.to_state = 'complete'
                AND e.occurred_at >= w AND e.occurred_at < w + interval '1 week')::int AS completed,
            (SELECT count(DISTINCT e.job_id) FROM job_state_events e WHERE e.to_state = 'invoiced'
                AND e.occurred_at >= w AND e.occurred_at < w + interval '1 week')::int AS invoiced
       FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') w
      ORDER BY w`);

  const regions = await uow.tx.query<{ id: string; name: string }>(
    "SELECT id, name FROM regions WHERE active AND id <> $1 ORDER BY name", [UNASSIGNED_REGION_ID]);

  const team = await ours<{ id: string; display_name: string; roles: string[]; crew_id: string | null; branch: string; on_job: boolean }>(
    `SELECT u.id, u.display_name, u.roles, u.crew_id, r.name AS branch,
            EXISTS (SELECT 1 FROM assignments a JOIN jobs j ON j.id = a.job_id
                     WHERE a.crew_id = u.crew_id AND a.released_at IS NULL AND j.state IN ('en_route', 'on_site', 'in_progress')) AS on_job
       FROM users u JOIN regions r ON r.id = u.region_id
      WHERE u.org_id = $1 AND u.namespace = 'internal' AND u.active
      ORDER BY u.display_name`);
  const crewById = new Map(crews.map((c) => [c.id, c]));

  const step = (s: ManagerWaitStep) => ({ step: s, avgDays: w?.[`${s}_avg`] ?? null, jobs: w?.[`${s}_n`] ?? 0 });
  return {
    asOf: now.toISOString(),
    ledgerSyncedAt: sync?.synced_at ? new Date(sync.synced_at).toISOString() : null,
    billed: billed.map((b) => ({ currency: b.currency, minor: b.minor, priorMinor: b.prior_minor })),
    collected: collected.map((c) => ({ currency: c.currency, minor: c.minor, priorMinor: c.prior_minor })),
    completed: { now: done?.now ?? 0, prior: done?.prior ?? 0 },
    fixedFirstVisit: done?.fixed ?? 0,
    waits: [step("request_to_scheduled"), step("scheduled_to_on_site"), step("on_site_to_finished"), step("finished_to_invoiced"),
      { step: "invoiced_to_paid", avgDays: paid?.avg ?? null, jobs: paid?.n ?? 0 }],
    labor: { hours: employed.reduce((h, c) => h + c.labor_7d, 0), techs: employed.length },
    unbilled: {
      complete: unbilledIn("complete"), needsPricing: unbilledIn("needs_pricing"), awaitingPo: unbilledIn("awaiting_po"),
      awaitingPictures: unbilledIn("awaiting_pictures"), invoiceTrouble: unbilledIn("invoice_trouble"),
    },
    urgentUnassigned: [...urgentByRegion].map(([regionId, count]) => ({ regionId, count })),
    credentials: { expired: crews.filter((c) => c.credential === "breached").length, expiring: crews.filter((c) => c.credential === "at_risk").length },
    nearOvertime: employed.filter((c) => c.hours_week >= OVERTIME_WATCH_HOURS).length,
    weeks: weeks.map((x) => ({ weekStart: x.week_start, completed: x.completed, invoiced: x.invoiced })),
    branches: regions.map((r) => {
      const here = employed.filter((c) => c.region_id === r.id);
      return {
        regionId: r.id, name: r.name, techs: here.length, laborHours: here.reduce((h, c) => h + c.labor_7d, 0),
        unbilled: open.filter((o) => o.region_id === r.id && (UNBILLED as readonly string[]).includes(o.state)).reduce((n, o) => n + o.n, 0),
      };
    }),
    team: team.map((u) => {
      const crew = u.crew_id ? crewById.get(u.crew_id) : undefined;
      return {
        userId: u.id, name: u.display_name, roles: u.roles, branch: u.branch, onJob: u.on_job,
        hoursThisWeek: crew ? crew.hours_week : null, credential: crew?.credential ?? null,
      };
    }),
  };
};
