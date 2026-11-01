/**
 * THE WORKER AGAINST ROW-LEVEL SECURITY.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * The sweeps had thirteen scripted tests and had never read a row from a
 * live database: every table they sweep is behind RLS, the worker bound no
 * scope, and an unbound transaction is a principal from nowhere — zero rows,
 * no error. The SLA cascade (C6) therefore escalated nothing and the
 * credential-expiry sweep (B5) warned of nothing, and both reported success.
 *
 * Found 2026-09-18 by reading the schema as a firm (item 7). The fix is one
 * line — the worker binds its own scope — and this file is what makes it a
 * fix rather than a hope: the same two sweeps, as the ac_worker role, against
 * rows that RLS protects.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, beginTx, type Pool } from "../../services/gateway/src/pg-tx.ts";
import { sweepSlaCascade, sweepCredentialExpiry, workerScope, WORKER_ACTOR } from "../../services/worker/src/sweeps.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const GIVEN = process.env.DATABASE_URL;
const skip = GIVEN ? false : "DATABASE_URL not set — the worker was not run against RLS";
const RUN = `wk-${Date.now().toString(36)}`;
// A SWEEP IS GLOBAL. Run on a scratch database (create, migrate, sweep, drop), the way the
// drives do, so a sweep here never emits for another suite's rows on a shared database —
// the backbone suite's own credential test reads "the latest expiring row" and would find ours.
const SCRATCH = `ac_worker_${RUN.replace(/-/g, "_")}`;
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const URL_ = GIVEN ? withDb(GIVEN, SCRATCH) : undefined;
let maintenance: Pool;
const U = (n: number) => `e7000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const ORG = U(10), SITE_NODE = U(11), SITE = U(12), JOB = U(13), TIMER = U(14), CREW = U(15), CRED = U(16), CRED_FAR = U(17);
/** Its own credential, so the timezone test counts its own rows and not the idempotency test's. */
const CRED_TZ = U(19);
/** A job waiting on the customer's answer to a quote, its timer as far past due as JOB's. */
const JOB_QUOTE = U(20), TIMER_QUOTE = U(21);
/** Expiry fixtures, each on its own crew so no credential renews another by accident. */
const CREW_B = U(22), CREW_C = U(23), CREW_D = U(24);
const CRED_LAST = U(25), CRED_THRESH = U(26), CRED_OLD = U(27), CRED_NEW = U(28), CRED_IDLE = U(29);
const JOB_PM = U(30), JOB_NEXT = U(31);
const DAY_MS = 86_400_000;

let pool: Pool;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!GIVEN || !URL_) return;
  const given = new URL(GIVEN).pathname.replace(/^\//, "");
  maintenance = createPool(withDb(GIVEN, given === "postgres" ? "template1" : "postgres"), "ac-worker-test-admin");
  { const c = await maintenance.connect(); try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); } }
  const mig = spawn(process.execPath, [fileURLToPath(new URL("../../tools/ci/migrate.ts", import.meta.url))], { env: { ...process.env, DATABASE_URL: URL_ }, stdio: ["ignore", "pipe", "pipe"] });
  let mlog = "";
  mig.stdout!.on("data", (d) => { mlog += String(d); });
  mig.stderr!.on("data", (d) => { mlog += String(d); });
  const mcode = await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1)));
  if (mcode !== 0) throw new Error(`migrate failed on ${SCRATCH}:\n${mlog}`);
  pool = createPool(URL_, "ac-worker-test");
  // Same race as s4.test.ts: after()'s DROP ... WITH (FORCE) can terminate a socket pool.end() has not finished closing.
  pool.on("error", () => {});
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  await admin(`INSERT INTO organizations (id, name, kind, segment, external_ref) VALUES ($1, $2, 'customer', 'commercial', $2) ON CONFLICT (id) DO NOTHING`, [ORG, `Worker Org ${RUN}`]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1, $2, $3, 'region', NULL, 'W / South') ON CONFLICT (id) DO NOTHING`, [SITE_NODE, ORG, REGION_SOUTH]);
  const loc = U(18);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1, $2, $3, 'location', $4, 'W Loc') ON CONFLICT (id) DO NOTHING`, [loc, ORG, REGION_SOUTH, SITE_NODE]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1, $2, $3, 'site', $4, 'W Site') ON CONFLICT (id) DO NOTHING`, [SITE, ORG, REGION_SOUTH, loc]);
  // A job whose SLA timer came due two hours ago and has never been escalated.
  await admin(`INSERT INTO jobs (id, org_id, region_id, site_id, service_code, priority, service_window, state)
    VALUES ($1, $2, $3, $4, 'HVAC-REPAIR', 'urgent', tstzrange(now() - interval '3 hours', now() + interval '1 hour', '[)'), 'assigned') ON CONFLICT (id) DO NOTHING`, [JOB, ORG, REGION_SOUTH, SITE]);
  await admin(`INSERT INTO sla_timers (id, org_id, region_id, job_id, response_term, opened_at, due_at, resolution_trace, escalation_stage, shadow_mode)
    VALUES ($1, $2, $3, $4, '4_hour', now() - interval '6 hours', now() - interval '2 hours', '[]'::jsonb, 0, false)
    ON CONFLICT (id) DO UPDATE SET escalation_stage = 0, breached_at = NULL, satisfied_at = NULL`, [TIMER, ORG, REGION_SOUTH, JOB]);
  await admin(`INSERT INTO jobs (id, org_id, region_id, site_id, service_code, priority, service_window, state)
    VALUES ($1, $2, $3, $4, 'HVAC-REPAIR', 'urgent', tstzrange(now() - interval '3 hours', now() + interval '1 hour', '[)'), 'quote_submitted') ON CONFLICT (id) DO NOTHING`, [JOB_QUOTE, ORG, REGION_SOUTH, SITE]);
  await admin(`INSERT INTO sla_timers (id, org_id, region_id, job_id, response_term, opened_at, due_at, resolution_trace, escalation_stage, shadow_mode)
    VALUES ($1, $2, $3, $4, '4_hour', now() - interval '6 hours', now() - interval '2 hours', '[]'::jsonb, 0, false)
    ON CONFLICT (id) DO NOTHING`, [TIMER_QUOTE, ORG, REGION_SOUTH, JOB_QUOTE]);
  // A crew with a licence that expires in ten days, and one that expires in a year.
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id, active)
    VALUES ($1, $2, $3, $4, 'employed', NULL, $3, true) ON CONFLICT (id) DO NOTHING`, [CREW, INTERNAL_ORG_ID, REGION_SOUTH, `Worker Crew ${RUN}`]);
  await admin(`INSERT INTO crew_credentials (id, org_id, region_id, crew_id, kind, identifier, valid_from, valid_to)
    VALUES ($1, $2, $3, $4, 'license', $5, current_date - 300, current_date + 10),
           ($6, $2, $3, $4, 'insurance', $7, current_date - 300, current_date + 365)
    ON CONFLICT (id) DO NOTHING`, [CRED, INTERNAL_ORG_ID, REGION_SOUTH, CREW, `LIC-${RUN}`, CRED_FAR, `INS-${RUN}`]);
  // Twelve days out FROM THE UTC DAY, because the sweep's day is UTC and the
  // timezone test below is about exactly that disagreement.
  await admin(`INSERT INTO crew_credentials (id, org_id, region_id, crew_id, kind, identifier, valid_from, valid_to)
    VALUES ($1, $2, $3, $4, 'background_check', $5, (now() AT TIME ZONE 'UTC')::date - 300, (now() AT TIME ZONE 'UTC')::date + 12)
    ON CONFLICT (id) DO NOTHING`, [CRED_TZ, INTERNAL_ORG_ID, REGION_SOUTH, CREW, `BGC-${RUN}`]);
  // D is the UTC day the sweeps below run on.
  const D = `(now() AT TIME ZONE 'UTC')::date`;
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id, active)
    VALUES ($1, $4, $5, 'Crew B', 'employed', NULL, $5, true), ($2, $4, $5, 'Crew C', 'employed', NULL, $5, true), ($3, $4, $5, 'Crew D', 'employed', NULL, $5, false)
    ON CONFLICT (id) DO NOTHING`, [CREW_B, CREW_C, CREW_D, INTERNAL_ORG_ID, REGION_SOUTH]);
  // Crew B: a licence whose last valid day is today, and a background check ten days out.
  // Crew C: insurance five days out, already renewed by a verified one. Crew D (inactive): a licence five days out.
  await admin(`INSERT INTO crew_credentials (id, org_id, region_id, crew_id, kind, identifier, valid_from, valid_to) VALUES
    ($1, $6, $7, $8, 'license', 'LIC-B', ${D} - 300, ${D}),
    ($2, $6, $7, $8, 'background_check', 'BGC-B', ${D} - 300, ${D} + 10),
    ($3, $6, $7, $9, 'insurance', 'INS-C-OLD', ${D} - 300, ${D} + 5),
    ($4, $6, $7, $9, 'insurance', 'INS-C-NEW', ${D} - 1, ${D} + 365),
    ($5, $6, $7, $10, 'license', 'LIC-D', ${D} - 300, ${D} + 5)
    ON CONFLICT (id) DO NOTHING`, [CRED_LAST, CRED_THRESH, CRED_OLD, CRED_NEW, CRED_IDLE, INTERNAL_ORG_ID, REGION_SOUTH, CREW_B, CREW_C, CREW_D]);
  // Fixtures the gate and S2 would refuse to write this way (an S2 verification, an assignment without the gate's
  // clearance): written with triggers off, in one transaction, because the sweep is what is under test here.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(`UPDATE crew_credentials SET verified_at = now(), verified_by = $2 WHERE id = $1`, [CRED_NEW, WORKER_ACTOR]);
    // Crew B holds two jobs: one ends this afternoon (inside the licence's last day), one ends at 01:00 tomorrow.
    // Triggers off, so each job's number (0030) is written by hand.
    await c.query(`INSERT INTO jobs (id, org_id, region_id, site_id, service_code, priority, service_window, state, job_no) VALUES
      ($1, $3, $4, $5, 'HVAC-REPAIR', 'routine', tstzrange((${D}::timestamp + interval '13 hours') AT TIME ZONE 'UTC', (${D}::timestamp + interval '15 hours') AT TIME ZONE 'UTC', '[)'), 'assigned', $6),
      ($2, $3, $4, $5, 'HVAC-REPAIR', 'routine', tstzrange((${D}::timestamp + interval '23 hours') AT TIME ZONE 'UTC', (${D}::timestamp + interval '25 hours') AT TIME ZONE 'UTC', '[)'), 'assigned', $7)
      ON CONFLICT (id) DO NOTHING`, [JOB_PM, JOB_NEXT, ORG, REGION_SOUTH, SITE, `FIXTURE-${JOB_PM}`, `FIXTURE-${JOB_NEXT}`]);
    for (const job of [JOB_PM, JOB_NEXT]) {
      await c.query(`INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by) VALUES ($1, $2, $3, $4, gen_random_uuid(), $5)`, [ORG, REGION_SOUTH, job, CREW_B, WORKER_ACTOR]);
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  await admin(`DELETE FROM outbox WHERE entity_id IN ($1, $2) AND surface_id = 'worker'`, [TIMER, CRED]);
});

after(async () => {
  await pool?.end();
  if (maintenance) {
    const c = await maintenance.connect().catch(() => null);
    if (c) { try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } finally { c.release(); } }
    await maintenance.end().catch(() => {});
  }
});

test("an UNBOUND worker transaction sees zero timers and zero credentials — the defect, stated", { skip }, async () => {
  const tx = await beginTx(pool, "ac_worker");
  try {
    const timers = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM sla_timers WHERE id = $1`, [TIMER]);
    const creds = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM crew_credentials WHERE id = $1`, [CRED]);
    assert.equal(timers[0]!.n, "0", "RLS with no scope bound answers nothing");
    assert.equal(creds[0]!.n, "0");
  } finally { await tx.rollback(); }
});

test("bound as the worker, the SLA cascade escalates the timer that is two hours past due and writes audit + outbox as the worker", { skip }, async () => {
  const tx = await beginTx(pool, "ac_worker");
  await tx.setLocal(workerScope());
  const actions = await sweepSlaCascade(tx, new Date());
  assert.ok(actions >= 1, `expected at least one escalation, got ${actions}`);
  const t = (await admin(`SELECT escalation_stage, breached_at FROM sla_timers WHERE id = $1`, [TIMER]))[0]!;
  assert.ok(Number(t.escalation_stage) >= 1, `stage advanced: ${t.escalation_stage}`);
  const out = await admin(`SELECT topic, actor_id, surface_id FROM outbox WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [TIMER]);
  assert.equal(out.length, 1);
  assert.match(String(out[0]!.topic), /^sla\.(escalated|breached)$/);
  assert.equal(out[0]!.actor_id, WORKER_ACTOR);
  assert.equal(out[0]!.surface_id, "worker");
  const audit = await admin(`SELECT action FROM audit_log WHERE entity_id = $1 AND surface_id = 'worker'`, [TIMER]);
  assert.ok(audit.length >= 1, "the audit row landed in the same transaction");
});

test("a job waiting on the customer's answer to a quote is not escalated, however far past due its timer is", { skip }, async () => {
  const tx = await beginTx(pool, "ac_worker");
  await tx.setLocal(workerScope());
  await sweepSlaCascade(tx, new Date());
  const t = (await admin(`SELECT escalation_stage, breached_at FROM sla_timers WHERE id = $1`, [TIMER_QUOTE]))[0]!;
  assert.equal(Number(t.escalation_stage), 0);
  assert.equal(t.breached_at, null);
  assert.equal((await admin(`SELECT count(*)::text AS n FROM outbox WHERE entity_id = $1`, [TIMER_QUOTE]))[0]!.n, "0");
});

test("bound as the worker, the credential-expiry sweep warns of the licence ten days out and not of the insurance a year out", { skip }, async () => {
  const tx = await beginTx(pool, "ac_worker");
  await tx.setLocal(workerScope());
  const n = await sweepCredentialExpiry(tx, new Date());
  assert.ok(n >= 1, `expected at least one warning, got ${n}`);
  const warned = await admin(`SELECT topic FROM outbox WHERE entity = 'crew_credential' AND entity_id = $1 AND surface_id = 'worker'`, [CRED]);
  assert.equal(warned.length, 1, "one warning for the licence");
  assert.equal(warned[0]!.topic, "credential.expiring");
  const far = await admin(`SELECT count(*)::text AS n FROM outbox WHERE entity = 'crew_credential' AND entity_id = $1`, [CRED_FAR]);
  assert.equal(far[0]!.n, "0", "nothing for a document a year out");
  // Idempotent: the same day, the same sweep, no second warning.
  const tx2 = await beginTx(pool, "ac_worker");
  await tx2.setLocal(workerScope());
  await sweepCredentialExpiry(tx2, new Date());
  assert.equal((await admin(`SELECT count(*)::text AS n FROM outbox WHERE entity = 'crew_credential' AND entity_id = $1`, [CRED]))[0]!.n, "1");
});

/**
 * THE TIMEZONE THE SWEEP RUNS IN (found while proving item 8, 2026-09-18).
 *
 * `sweepCredentialExpiry` keys its own idempotency on
 * `today.toISOString().slice(0, 10)` — a UTC date — against
 * `occurred_at::date`, which Postgres casts in the SESSION's timezone. On a
 * cluster set to anything west of UTC the two disagree from local evening
 * until midnight: the NOT EXISTS never matches, and the sweep warns again
 * every hour, all night, about the same credential.
 *
 * It was invisible because CI runs UTC. So this test PINS the session
 * timezone rather than trusting the machine's, which makes it fail on the old
 * SQL everywhere — including in CI — and pass on the new SQL everywhere.
 */
test("THE SWEEP'S DAY IS UTC WHEREVER THE SERVER THINKS IT IS: two runs in one UTC day warn once, on a cluster set to America/Chicago", { skip }, async () => {
  // 03:00Z is the evening of the PREVIOUS day in Chicago — the window where
  // the two calendars disagree, and the window the bug lived in. Derived from
  // today rather than written down, so the test does not rot.
  const utc = new Date();
  const at = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 3, 0, 0));
  const chicago = async () => {
    const tx = await beginTx(pool, "ac_worker");
    await tx.setLocal(workerScope());
    await tx.query("SET LOCAL TIME ZONE 'America/Chicago'");
    return tx;
  };
  await sweepCredentialExpiry(await chicago(), at);
  const after1 = await admin(`SELECT count(*)::text AS n FROM outbox WHERE entity = 'crew_credential' AND entity_id = $1`, [CRED_TZ]);
  await sweepCredentialExpiry(await chicago(), at);
  const after2 = await admin(`SELECT count(*)::text AS n FROM outbox WHERE entity = 'crew_credential' AND entity_id = $1`, [CRED_TZ]);
  assert.equal(after2[0]!.n, after1[0]!.n, "the second sweep of the same UTC day warns about nothing");
});

test("a worker pinned to a region (AC_REGION_ID) sweeps that region and not another", { skip }, async () => {
  const tx = await beginTx(pool, "ac_worker");
  await tx.setLocal(workerScope("a0000000-0000-0000-0000-00000000000f"));
  const rows = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM sla_timers WHERE id = $1`, [TIMER]);
  assert.equal(rows[0]!.n, "0", "a South timer is not a West worker's");
  await tx.rollback();
});

const sweepAt = async (at: Date) => {
  const tx = await beginTx(pool, "ac_worker");
  await tx.setLocal(workerScope());
  return sweepCredentialExpiry(tx, at);
};
const events = (id: string) => admin(`SELECT topic, payload FROM outbox WHERE entity = 'crew_credential' AND entity_id = $1 ORDER BY occurred_at, created_at`, [id]);

test("valid_to is the last valid day: on it the sweep warns, and counts only the job that ends after it; the day after, it is expired", { skip }, async () => {
  const now = new Date();
  await sweepAt(now);
  const on = await events(CRED_LAST);
  assert.deepEqual(on.map((e) => e.topic), ["credential.expiring"], "the last valid day is a warning, not an expiry");
  assert.equal(on[0]!.payload.daysLeft, 0);
  assert.equal(on[0]!.payload.assignedJobsAtRisk, 1, "the job ending this afternoon is covered; the one ending at 01:00 tomorrow is not");
  await sweepAt(new Date(now.getTime() + DAY_MS));
  assert.deepEqual((await events(CRED_LAST)).map((e) => e.topic), ["credential.expiring", "credential.expired"]);
});

test("a credential warns once at each of 30, 7 and 1 days — not every day for thirty days", { skip }, async () => {
  const now = new Date();
  const at = (days: number) => new Date(now.getTime() + days * DAY_MS);
  for (const d of [0, 1, 2]) await sweepAt(at(d));
  assert.deepEqual((await events(CRED_THRESH)).map((e) => e.payload.threshold), [30], "ten, nine and eight days out are all the thirty-day warning");
  for (const d of [3, 4, 8]) await sweepAt(at(d));
  assert.deepEqual((await events(CRED_THRESH)).map((e) => e.payload.threshold), [30, 7], "seven days out is the second, and the only one until the last day");
  await sweepAt(at(9));
  assert.deepEqual((await events(CRED_THRESH)).map((e) => e.payload.threshold), [30, 7, 1]);
});

test("a credential already renewed by a verified one, and a credential of an inactive crew, are not swept", { skip }, async () => {
  await sweepAt(new Date());
  assert.equal((await events(CRED_OLD)).length, 0, "the renewal carries on where it ends");
  assert.equal((await events(CRED_IDLE)).length, 0, "an inactive crew is sent no work");
});
