import { test } from "node:test";
import assert from "node:assert/strict";
import { HQ_ROLLUP_SQL, rollupStatement, sweepHqRollup } from "./rollup.ts";
import { HQ_METRIC_KEYS } from "../../../packages/contracts/src/hq.ts";
import { REQUIRED } from "../../../packages/domain/src/compliance/gate.ts";
import type { RelayTx } from "./relay.ts";

/**
 * The rollup's shape, without a database. That the SQL reads the right rows
 * under RLS as the worker is test/integration/s4.test.ts; this holds that
 * the register and the SQL name the same figures, that each statement takes
 * only its four parameters, and that one refresh is one transaction.
 */
test("every figure in the register has its SQL here, and nothing else does", () => {
  assert.deepEqual(Object.keys(HQ_ROLLUP_SQL).sort(), [...HQ_METRIC_KEYS].sort());
});

test("each statement upserts one (day, region, metric) per region and takes only $1–$4", () => {
  for (const k of HQ_METRIC_KEYS) {
    const sql = rollupStatement(k);
    assert.match(sql, /INSERT INTO hq_metrics/);
    assert.match(sql, /FROM regions r/);
    assert.match(sql, /ON CONFLICT \(day, region_id, metric\) DO UPDATE/);
    const params = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    for (const p of params) assert.ok(p >= 1 && p <= 4, `${k} uses $${p}`);
  }
});

test("cleared-to-dispatch reads the gate's required kinds from domain/compliance, not a copy", () => {
  for (const kinds of Object.values(REQUIRED)) for (const k of kinds) assert.match(HQ_ROLLUP_SQL.crews_cleared_now, new RegExp(`'${k}'`));
});

test("one refresh: a statement per figure with the same moment and day, then one commit", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  let commits = 0;
  const tx = { query: async (sql: string, params: readonly unknown[] = []) => { calls.push({ sql, params }); return sql.includes("count(*) AS n") ? [{ n: "105" }] : []; }, commit: async () => { commits++; } } as unknown as RelayTx;
  const at = new Date("2026-09-27T15:00:00.000Z");
  const n = await sweepHqRollup(tx, at);
  const inserts = calls.filter((c) => c.sql.includes("INSERT INTO hq_metrics"));
  assert.equal(inserts.length, HQ_METRIC_KEYS.length);
  for (const c of inserts) { assert.equal(c.params[0], at.toISOString()); assert.equal(c.params[1], "2026-09-27"); }
  assert.equal(commits, 1);
  assert.equal(n, 105);
});
