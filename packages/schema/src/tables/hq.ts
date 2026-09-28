import { operationalTable } from "../tenancy.ts";

/**
 * ITEM 10 — WHAT S4 READS, AND ALL IT READS.
 *
 * One row per (UTC day, region, metric). The worker's rollup overwrites
 * today's row on every refresh, so a day's row holds the last value computed
 * that day and yesterday's row is yesterday's closing figure — thirty rows of
 * one metric are its trend. `as_of` is the refresh that wrote the value, which
 * is what the registry's degraded line promises to show: "the age of its last
 * rollup and nothing more".
 *
 * org_id is always INTERNAL (a rollup is ours); region_id is the region the
 * figure is FOR — UNASSIGNED for leads, which have no region until worked.
 * The metric key is not CHECKed: the register is packages/contracts/src/hq.ts
 * and a unit test holds the worker's SQL to it.
 */
export const hq_metrics = operationalTable("hq_metrics", {
  columns: [
    { name: "day", type: "date" },
    { name: "metric", type: "text" },
    { name: "value", type: "bigint", comment: "A count, or integer minor units. Additive across regions by the register's rule." },
    { name: "as_of", type: "timestamptz", comment: "The refresh that wrote this value." },
  ],
  indexes: [["day"], ["metric", "day"]],
  uniques: [["day", "region_id", "metric"]],
});
