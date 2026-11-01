import { test } from "node:test";
import assert from "node:assert/strict";
import { iso } from "./sql.ts";

test("iso formats a timestamptz in UTC and marks it Z", () => {
  const sql = iso("j.opened_at");
  assert.equal(sql, `to_char(j.opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
  assert.match(sql, /AT TIME ZONE 'UTC'/);
  assert.match(sql, /YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"/);
});

test("iso converts a nested timestamp expression before it formats it", () => {
  const sql = iso("COALESCE((SELECT max(e.occurred_at) FROM job_state_events e WHERE e.job_id = j.id), j.opened_at)");
  assert.match(sql, /^to_char\(COALESCE\(\(SELECT max\(e\.occurred_at\)/);
  assert.match(sql, /j\.opened_at\) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\)$/);
});
