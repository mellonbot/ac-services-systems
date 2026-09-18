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
import { createPool, beginTx, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { sweepSlaCascade, sweepCredentialExpiry, workerScope, WORKER_ACTOR } from "../../apps/worker/src/sweeps.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — the worker was not run against RLS";
const RUN = `wk-${Date.now().toString(36)}`;
const U = (n: number) => `e7000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const ORG = U(10), SITE_NODE = U(11), SITE = U(12), JOB = U(13), TIMER = U(14), CREW = U(15), CRED = U(16), CRED_FAR = U(17);

let pool: Pool;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-worker-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  await admin(`INSERT INTO organizations (id, name, kind, external_ref) VALUES ($1, $2, 'customer', $2) ON CONFLICT (id) DO NOTHING`, [ORG, `Worker Org ${RUN}`]);
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
  // A crew with a licence that expires in ten days, and one that expires in a year.
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id, active)
    VALUES ($1, $2, $3, $4, 'employed', NULL, $3, true) ON CONFLICT (id) DO NOTHING`, [CREW, INTERNAL_ORG_ID, REGION_SOUTH, `Worker Crew ${RUN}`]);
  await admin(`INSERT INTO crew_credentials (id, org_id, region_id, crew_id, kind, identifier, valid_from, valid_to)
    VALUES ($1, $2, $3, $4, 'license', $5, current_date - 300, current_date + 10),
           ($6, $2, $3, $4, 'insurance', $7, current_date - 300, current_date + 365)
    ON CONFLICT (id) DO NOTHING`, [CRED, INTERNAL_ORG_ID, REGION_SOUTH, CREW, `LIC-${RUN}`, CRED_FAR, `INS-${RUN}`]);
  await admin(`DELETE FROM outbox WHERE entity_id IN ($1, $2) AND surface_id = 'worker'`, [TIMER, CRED]);
});

after(async () => { await pool?.end(); });

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

test("a worker pinned to a region (AC_REGION_ID) sweeps that region and not another", { skip }, async () => {
  const tx = await beginTx(pool, "ac_worker");
  await tx.setLocal(workerScope("a0000000-0000-0000-0000-00000000000f"));
  const rows = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM sla_timers WHERE id = $1`, [TIMER]);
  assert.equal(rows[0]!.n, "0", "a South timer is not a West worker's");
  await tx.rollback();
});
