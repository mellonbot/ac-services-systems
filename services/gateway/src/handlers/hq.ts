import type { UnitOfWork } from "../unit-of-work.ts";
import { BadInput } from "../refusals.ts";
import { HQ_REFRESH_MINUTES, isHqMetricKey } from "../../../../packages/contracts/src/hq.ts";
import type { HqMetricsInput, HqMetricsOutput, HqHistoryInput, HqHistoryOutput, HqRegionWire } from "../../../../packages/contracts/src/operations.ts";
import { UNASSIGNED_REGION_ID } from "../../../../packages/schema/src/tenancy.ts";

/**
 * ITEM 10 — S4's two reads. `hq_metrics` (0010) and the names of the regions
 * the figures are for; no operational table is touched here, which is what
 * keeps leadership's queries off the rows dispatch is writing. Visibility is
 * 0010's: an internal principal reads every row, anyone else reads none.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const regions = async (uow: UnitOfWork): Promise<HqRegionWire[]> => {
  const rows = await uow.tx.query<{ id: string; code: string; name: string; active: boolean }>(
    "SELECT id, code, name, active FROM regions ORDER BY (id = $1), name", [UNASSIGNED_REGION_ID],
  );
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, active: r.active, placed: r.id !== UNASSIGNED_REGION_ID }));
};

export const hqMetrics = async (uow: UnitOfWork, input: HqMetricsInput): Promise<HqMetricsOutput> => {
  if (input.day !== undefined && !ISO_DAY.test(input.day)) throw new BadInput("day must be an ISO date, YYYY-MM-DD");
  // The latest day that has figures, or the one asked for — never a day with none.
  const head = (await uow.tx.query<{ day: string | null; as_of: string | null }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, max(as_of) AS as_of FROM hq_metrics
      WHERE ($1::date IS NULL OR day = $1::date)
      GROUP BY day ORDER BY day DESC LIMIT 1`,
    [input.day ?? null],
  ))[0];
  const all = await regions(uow);
  if (!head?.day) return { day: null, asOf: null, refreshMinutes: HQ_REFRESH_MINUTES, regions: all, values: [] };
  const rows = await uow.tx.query<{ region_id: string; metric: string; value: string }>(
    "SELECT region_id, metric, value::text AS value FROM hq_metrics WHERE day = $1::date ORDER BY metric, region_id", [head.day],
  );
  return {
    day: head.day, asOf: new Date(head.as_of!).toISOString(), refreshMinutes: HQ_REFRESH_MINUTES, regions: all,
    // A key the register no longer names is history, not a figure to draw.
    values: rows.filter((r) => isHqMetricKey(r.metric)).map((r) => ({ regionId: r.region_id, metric: r.metric, value: r.value })),
  };
};

export const hqHistory = async (uow: UnitOfWork, input: HqHistoryInput): Promise<HqHistoryOutput> => {
  if (!input.metric || !isHqMetricKey(input.metric)) throw new BadInput(`metric must be a key in the HQ register (packages/contracts/src/hq.ts)`);
  const days = input.days === undefined ? 30 : Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new BadInput("days must be a whole number from 1 to 90");
  const rows = await uow.tx.query<{ day: string; region_id: string; value: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, region_id, value::text AS value FROM hq_metrics
      WHERE metric = $1 AND day > (SELECT max(day) FROM hq_metrics) - $2::int
      ORDER BY day, region_id`,
    [input.metric, days],
  );
  return { metric: input.metric, days, points: rows.map((r) => ({ day: r.day, regionId: r.region_id, value: r.value })) };
};
