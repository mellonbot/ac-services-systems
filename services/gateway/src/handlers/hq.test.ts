import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { hqMetrics, hqHistory } from "./hq.ts";
import { BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../../../packages/schema/src/tenancy.ts";

/**
 * S4's two reads against a scripted Tx. What this holds: the handler reads
 * hq_metrics and the region names and no operational table; inputs are
 * checked before any query; a figure the register no longer names is not
 * drawn; no rollup is an answer (nulls), not an error. That an internal
 * principal reads every row and nobody else reads any is 0010's, held in
 * test/integration/s4.test.ts.
 */
const U = (n: number) => `a4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(1);
const exec: Principal = {
  namespace: "internal", subjectId: U(9), orgId: INTERNAL_ORG_ID, regionId: SOUTH, scopeTier: "parent", scopeId: INTERNAL_ORG_ID,
  roles: ["principal"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-4",
};
const scripted = (answers: Record<string, unknown[]>) => {
  const queries: string[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql) { queries.push(sql); for (const [needle, rows] of Object.entries(answers)) if (sql.includes(needle)) return rows as never; return []; },
    async insert() {}, async commit() {}, async rollback() {},
  };
  return { tx, queries };
};
const uowOf = (tx: Tx) => createUnitOfWork({ surfaceId: "S4", principal: exec, requestId: "r", now: () => new Date(), newId: () => U(99) }, tx);
const REGIONS = [
  { id: SOUTH, code: "SOUTH", name: "South", active: true },
  { id: UNASSIGNED_REGION_ID, code: "UNASSIGNED", name: "Unassigned (pre-account)", active: true },
];

test("hq.metrics: the latest day's figures, the moment they were computed, and the regions — UNASSIGNED marked unplaced", async () => {
  const s = scripted({
    "GROUP BY day": [{ day: "2026-09-27", as_of: "2026-09-27T15:00:00.000Z" }],
    "FROM regions": REGIONS,
    "WHERE day = $1::date ORDER BY": [
      { region_id: SOUTH, metric: "jobs_open_now", value: "12" },
      { region_id: SOUTH, metric: "retired_metric", value: "3" },
    ],
  });
  const out = await hqMetrics(await uowOf(s.tx), {});
  assert.equal(out.day, "2026-09-27");
  assert.equal(out.asOf, "2026-09-27T15:00:00.000Z");
  assert.deepEqual(out.values, [{ regionId: SOUTH, metric: "jobs_open_now", value: "12" }], "a key the register no longer names is not drawn");
  assert.deepEqual(out.regions.map((r) => r.placed), [true, false]);
  for (const q of s.queries) assert.match(q, /hq_metrics|FROM regions|set_config|ac_/, `S4 reads the rollup, not the operational tables: ${q.slice(0, 60)}`);
});

test("hq.metrics before any rollup: nulls and no values, not an error", async () => {
  const out = await hqMetrics(await uowOf(scripted({ "FROM regions": REGIONS }).tx), {});
  assert.equal(out.day, null);
  assert.equal(out.asOf, null);
  assert.deepEqual(out.values, []);
  assert.equal(out.regions.length, 2);
});

test("inputs are refused before any query: a day that is not a date, a metric outside the register, days out of 1–90", async () => {
  const s = scripted({});
  const uow = await uowOf(s.tx);
  const before = s.queries.length;
  await assert.rejects(hqMetrics(uow, { day: "yesterday" }), BadInput);
  await assert.rejects(hqHistory(uow, { metric: "drop table" }), BadInput);
  await assert.rejects(hqHistory(uow, { metric: "jobs_open_now", days: 0 }), BadInput);
  await assert.rejects(hqHistory(uow, { metric: "jobs_open_now", days: 91 }), BadInput);
  assert.equal(s.queries.length, before);
});

test("hq.history: daily points for one registered figure, 30 days unless asked", async () => {
  const s = scripted({ "WHERE metric = $1": [{ day: "2026-09-26", region_id: SOUTH, value: "11" }, { day: "2026-09-27", region_id: SOUTH, value: "12" }] });
  const out = await hqHistory(await uowOf(s.tx), { metric: "jobs_open_now" });
  assert.equal(out.days, 30);
  assert.deepEqual(out.points.map((p) => p.value), ["11", "12"]);
  const q = await hqHistory(await uowOf(s.tx), { metric: "jobs_open_now", days: "7" as unknown as number });
  assert.equal(q.days, 7, "the query string carries days as text");
});
