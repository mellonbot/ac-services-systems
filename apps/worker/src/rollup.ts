import type { RelayTx } from "./relay.ts";
import { HQ_METRIC_KEYS, type HqMetricKey } from "../../../packages/contracts/src/hq.ts";
import { REQUIRED } from "../../../packages/domain/src/compliance/gate.ts";
import { INTERNAL_ORG_ID } from "../../../packages/schema/src/tenancy.ts";

/**
 * ITEM 10 — THE HQ ROLLUP. What S4 reads, computed here and nowhere else.
 *
 * One SQL expression per metric in the register (packages/contracts/src/hq.ts),
 * correlated on `r` — a row of `regions` — and evaluated for every region in
 * one statement per metric. Parameters: $1 the refresh moment, $2 its UTC day.
 * Each value is upserted into (day, region, metric), so the day's row is the
 * latest figure and yesterday's is yesterday's close.
 *
 * Run as the worker, bound (workerScope()): every table read here is behind
 * RLS and the internal namespace sees every region's rows. 0007's lesson —
 * an unbound sweep reads zero rows and reports green — is why the rollup
 * test runs against a live database as ac_worker.
 */
const WINDOW = (col: string) => `${col} > $1::timestamptz - interval '30 days' AND ${col} <= $1::timestamptz`;
const OPEN_JOB = `j.state NOT IN ('complete','invoiced','cancelled','aborted')`;
const OPEN_STATEMENT = `s.state IN ('issued','acknowledged','disputed')`;
const count = (from: string, where: string) => `SELECT count(*) FROM ${from} WHERE ${where}`;
const sum = (col: string, from: string, where: string) => `SELECT COALESCE(sum(${col}), 0) FROM ${from} WHERE ${where}`;
const latestPosition = (col: string) =>
  `SELECT COALESCE((SELECT w.${col} FROM working_capital_positions w WHERE w.region_id = r.id ORDER BY w.as_of DESC, w.created_at DESC LIMIT 1), 0)`;

/** The gate's required kinds per employment shape, as SQL — read from domain/compliance, not restated. */
const requiredKinds = `CASE c.employment_type ${Object.entries(REQUIRED).map(([t, kinds]) => `WHEN '${t}' THEN ARRAY[${kinds.map((k) => `'${k}'`).join(",")}]`).join(" ")} END`;

const SLA_CLOSED = `(t.satisfied_at IS NOT NULL OR t.due_at < $1::timestamptz)`;
const SLA_MET = `(t.satisfied_at IS NOT NULL AND t.satisfied_at <= t.due_at)`;

export const HQ_ROLLUP_SQL: Readonly<Record<HqMetricKey, string>> = {
  // ---- service & SLA ----
  jobs_opened_30d: count("jobs j", `j.region_id = r.id AND ${WINDOW("j.opened_at")}`),
  jobs_completed_30d: count("jobs j", `j.region_id = r.id AND ${WINDOW("j.opened_at")} AND j.state IN ('complete','invoiced')`),
  jobs_open_now: count("jobs j", `j.region_id = r.id AND ${OPEN_JOB}`),
  jobs_unassigned_now: count("jobs j", `j.region_id = r.id AND ${OPEN_JOB} AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.job_id = j.id AND a.released_at IS NULL)`),
  jobs_at_risk_now: count("sla_timers t JOIN jobs j ON j.id = t.job_id",
    `t.region_id = r.id AND ${OPEN_JOB} AND t.satisfied_at IS NULL AND (t.escalation_stage > 0 OR t.due_at <= $1::timestamptz + interval '1 hour')`),
  sla_closed_30d: count("sla_timers t", `t.region_id = r.id AND ${WINDOW("t.opened_at")} AND ${SLA_CLOSED}`),
  sla_met_30d: count("sla_timers t", `t.region_id = r.id AND ${WINDOW("t.opened_at")} AND ${SLA_MET}`),
  sla_breached_30d: count("sla_timers t", `t.region_id = r.id AND ${WINDOW("t.opened_at")} AND ${SLA_CLOSED} AND NOT ${SLA_MET}`),
  sla_escalated_30d: count("sla_timers t", `t.region_id = r.id AND ${WINDOW("t.opened_at")} AND t.escalation_stage > 0`),

  // ---- revenue & money ----
  invoiced_minor_30d: sum("i.total_minor", "invoices i", `i.region_id = r.id AND i.issued_at IS NOT NULL AND ${WINDOW("i.issued_at")}`),
  invoices_past_due_minor: sum("i.total_minor", "invoices i", `i.region_id = r.id AND i.issued_at IS NOT NULL AND i.due_at < $1::timestamptz`),
  receivable_minor: latestPosition("receivable_minor"),
  subcontractor_payable_minor: latestPosition("subcontractor_payable_minor"),
  settlements_open_minor: sum("s.total_minor", "settlements s", `s.region_id = r.id AND ${OPEN_STATEMENT}`),
  settlements_overdue: count("settlements s JOIN subcontractor_firms f ON f.id = s.firm_id",
    `s.region_id = r.id AND ${OPEN_STATEMENT} AND s.issued_at + make_interval(days => f.settlement_terms_days) < $1::timestamptz`),
  settlements_disputed: count("settlements s", `s.region_id = r.id AND s.state = 'disputed'`),

  // ---- network & compliance ----
  crews_active: count("crews c", `c.region_id = r.id AND c.active`),
  crews_subcontracted_active: count("crews c", `c.region_id = r.id AND c.active AND c.employment_type = 'subcontracted'`),
  crews_cleared_now: count("crews c", `c.region_id = r.id AND c.active AND NOT EXISTS (
      SELECT 1 FROM unnest(${requiredKinds}) AS k(kind)
       WHERE NOT EXISTS (SELECT 1 FROM crew_credentials cc
                          WHERE cc.crew_id = c.id AND cc.kind = k.kind AND cc.verified_at IS NOT NULL
                            AND cc.valid_from <= $2::date AND cc.valid_to >= $2::date))`),
  min_crew_density: `SELECT COALESCE(r.min_crew_density, 0)`,
  locations_active: count("accounts a", `a.region_id = r.id AND a.tier = 'location' AND a.active`),
  firms_active: count("subcontractor_firms f", `f.region_id = r.id AND f.status = 'active'`),
  firms_onboarding: count("subcontractor_firms f", `f.region_id = r.id AND f.status = 'onboarding'`),
  credentials_unverified: count("crew_credentials cc JOIN crews c ON c.id = cc.crew_id", `cc.region_id = r.id AND c.active AND cc.verified_at IS NULL`),
  credentials_expiring_30d: count("crew_credentials cc JOIN crews c ON c.id = cc.crew_id",
    `cc.region_id = r.id AND c.active AND cc.verified_at IS NOT NULL AND cc.valid_to BETWEEN $2::date AND $2::date + 30`),

  // ---- growth & web ----
  leads_30d: count("leads l", `l.region_id = r.id AND ${WINDOW("l.created_at")}`),
  leads_web_form_30d: count("leads l", `l.region_id = r.id AND ${WINDOW("l.created_at")} AND l.source = 'web_form'`),
  leads_call_button_30d: count("leads l", `l.region_id = r.id AND ${WINDOW("l.created_at")} AND l.source = 'call_button'`),
  leads_referral_30d: count("leads l", `l.region_id = r.id AND ${WINDOW("l.created_at")} AND l.source = 'referral'`),
  calls_inbound_30d: count("call_records cr", `cr.region_id = r.id AND cr.direction = 'inbound' AND ${WINDOW("cr.occurred_at")}`),
  service_requests_30d: count("service_requests sr", `sr.region_id = r.id AND ${WINDOW("sr.created_at")}`),
  customers_active: `SELECT count(DISTINCT a.org_id) FROM accounts a JOIN organizations o ON o.id = a.org_id
                      WHERE a.region_id = r.id AND a.active AND o.kind = 'customer' AND o.active`,
  customers_new_30d: `SELECT count(DISTINCT a.org_id) FROM accounts a JOIN organizations o ON o.id = a.org_id
                       WHERE a.region_id = r.id AND o.kind = 'customer' AND ${WINDOW("o.created_at")}`,
  sites_active: count("accounts a", `a.region_id = r.id AND a.tier = 'site' AND a.active`),
};

export const rollupStatement = (metric: HqMetricKey): string =>
  `INSERT INTO hq_metrics (org_id, region_id, day, metric, value, as_of)
   SELECT $3::uuid, r.id, $2::date, $4::text, (${HQ_ROLLUP_SQL[metric]})::bigint, $1::timestamptz FROM regions r
   ON CONFLICT (day, region_id, metric) DO UPDATE SET value = EXCLUDED.value, as_of = EXCLUDED.as_of`;

/** One refresh: every metric, every region, one transaction. Returns the rows written. */
export const sweepHqRollup = async (tx: RelayTx, now: Date): Promise<number> => {
  const day = now.toISOString().slice(0, 10);
  for (const metric of HQ_METRIC_KEYS) {
    await tx.query(rollupStatement(metric), [now.toISOString(), day, INTERNAL_ORG_ID, metric]);
  }
  const n = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM hq_metrics WHERE day = $1::date AND as_of = $2::timestamptz`, [day, now.toISOString()]);
  await tx.commit();
  return Number(n[0]?.n ?? 0);
};
