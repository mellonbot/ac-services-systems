/**
 * 0030 IN THE DATABASE — a job has a number a person can read aloud.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What this suite holds: the table numbers every job at insert, whatever the
 * caller sent, in the region's own month; a month starts at a random four
 * digits and counts up by one; jobs opened at once never share or skip a
 * number; a number is never changed; the check digit refuses every single
 * wrong digit and every adjacent swap; and the office numbers a job through
 * its own binding while never reading the counter.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPool, type Pool } from "../../services/gateway/src/pg-tx.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — 0030's job numbers were not verified against PostgreSQL";
if (!URL_) test("0030 job numbers", { skip }, () => {});

// A region of this run's own, so its counters start empty.
const CODE = `T${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, "")}`;
const REGION = randomUUID(), ORG = randomUUID(), RNODE = randomUUID(), LOC = randomUUID(), SITE = randomUUID();
const SHAPE = new RegExp(`^${CODE}-(\\d{4})-(\\d{4})-(\\d)$`);

let pool: Pool;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
const open = async (openedAt: string, jobNo: string | null = null): Promise<string> => (await admin(
  `INSERT INTO jobs (org_id, region_id, site_id, service_code, service_window, opened_at, job_no)
   VALUES ($1,$2,$3,'DIAGNOSTIC', tstzrange(now(), now() + interval '1 day'), $4, $5) RETURNING job_no`,
  [ORG, REGION, SITE, openedAt, jobNo]))[0].job_no;
const seq = (jobNo: string) => Number(SHAPE.exec(jobNo)![2]);
const valid = async (jobNo: string): Promise<boolean> => (await admin(`SELECT ac_job_no_valid($1) AS ok`, [jobNo]))[0].ok;

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-job-numbers-test");
  await admin(`INSERT INTO regions (id, code, name, timezone) VALUES ($1,$2,$2,'America/Chicago')`, [REGION, CODE]);
  await admin(`INSERT INTO organizations (id, name, kind, segment) VALUES ($1,$2,'customer','commercial')`, [ORG, `Cust ${CODE}`]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, name) VALUES ($1,$2,$3,'region','R')`, [RNODE, ORG, REGION]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, name, parent_id) VALUES ($1,$2,$3,'location','L',$4)`, [LOC, ORG, REGION, RNODE]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, name, parent_id) VALUES ($1,$2,$3,'site','S',$4)`, [SITE, ORG, REGION, LOC]);
});

after(async () => { await pool?.end(); });

test("a job is numbered at insert, in the region's month, from a random four-digit start, whatever the caller sent", { skip }, async () => {
  // 04:30 UTC on 1 March is still February in Chicago.
  const first = await open("2031-03-01 04:30Z", "MINE-0000-0000-0");
  const m = SHAPE.exec(first);
  assert.ok(m, `${first} is not ${CODE}-YYMM-SEQ-CHECK`);
  assert.equal(m[1], "3102");
  assert.ok(seq(first) >= 1000 && seq(first) <= 4999, `${first} starts outside 1000–4999`);
  const second = await open("2031-02-10 12:00Z");
  assert.equal(seq(second), seq(first) + 1);
  const march = await open("2031-03-01 06:00Z");
  assert.match(march, new RegExp(`^${CODE}-3103-`), "a new month has a counter of its own");
});

test("jobs opened at once each take their own number, with none skipped", { skip }, async () => {
  const nos = await Promise.all(Array.from({ length: 20 }, () => open("2031-04-15 12:00Z")));
  const seqs = nos.map(seq).sort((a, b) => a - b);
  assert.equal(new Set(nos).size, 20);
  assert.equal(seqs.at(-1)! - seqs[0]!, 19);
});

test("a job number is never changed", { skip }, async () => {
  const no = await open("2031-05-01 12:00Z");
  await assert.rejects(admin(`UPDATE jobs SET job_no = 'X' WHERE job_no = $1`, [no]), (e: { code?: string; message?: string }) => {
    assert.equal(e.code, "AC422");
    assert.match(e.message ?? "", /never changed/);
    return true;
  });
  assert.equal((await admin(`UPDATE jobs SET priority = 'urgent' WHERE job_no = $1 RETURNING job_no`, [no]))[0].job_no, no);
});

test("the check digit refuses every single wrong digit and every swap of two adjacent digits", { skip }, async () => {
  const no = await open("2031-06-01 12:00Z");
  assert.ok(await valid(no));
  const [code, yymm, s, check] = no.split("-");
  const digits = yymm! + s! + check!;
  const as = (d: string) => `${code}-${d.slice(0, 4)}-${d.slice(4, -1)}-${d.at(-1)}`;
  for (let i = 0; i < digits.length; i++) {
    for (let v = 0; v <= 9; v++) {
      if (String(v) === digits[i]) continue;
      const wrong = digits.slice(0, i) + v + digits.slice(i + 1);
      assert.equal(await valid(as(wrong)), false, `${as(wrong)} passed`);
    }
    if (i + 1 < digits.length && digits[i] !== digits[i + 1]) {
      const swapped = digits.slice(0, i) + digits[i + 1] + digits[i] + digits.slice(i + 2);
      assert.equal(await valid(as(swapped)), false, `${as(swapped)} passed`);
    }
  }
  assert.equal(await valid("not a job number"), false);
});

test("the office numbers a job through its own binding, and never reads the counter", { skip }, async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE ac_gateway");
    const binding = { "ac.namespace": "internal", "ac.org_id": INTERNAL_ORG_ID, "ac.region_id": REGION, "ac.scope_tier": "region", "ac.scope_id": REGION, "ac.actor_id": randomUUID(), "ac.surface_id": "S3" };
    for (const [k, v] of Object.entries(binding)) await c.query("SELECT set_config($1, $2, true)", [k, v]);
    const r = await c.query(`INSERT INTO jobs (org_id, region_id, site_id, service_code, service_window)
      VALUES ($1,$2,$3,'DIAGNOSTIC', tstzrange(now(), now() + interval '1 day')) RETURNING job_no`, [ORG, REGION, SITE]);
    assert.match(r.rows[0].job_no, SHAPE);
    await c.query("SAVEPOINT counter");
    await assert.rejects(c.query(`SELECT * FROM job_number_counters`), /permission denied/);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
