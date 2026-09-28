/**
 * ITEM 10 — S4 OVER THE WIRE, AND THE ROLLUP UNDER RLS.
 *
 * The rollup is the worker's and it is GLOBAL — it counts every row in the
 * database — so this suite runs on a scratch database (create, migrate, seed,
 * roll up, drop), the way worker.test.ts does, and the figures it asserts are
 * exactly the rows seeded here.
 *
 * What it holds:
 *   - bound as the worker, one refresh writes every figure in the register for
 *     every region, and the counts are the seeded rows' — the SLA split, the
 *     open and unassigned work, the density rule, the cleared crews, the money,
 *     the leads waiting in UNASSIGNED;
 *   - a second refresh the same day overwrites the day's rows, it does not add;
 *   - 0010: an internal principal reads every row, a customer and a firm read
 *     none, and the gateway role cannot write a figure whatever it is bound as;
 *   - over the wire: S4's principal reads hq.metrics and hq.history; a
 *     dispatcher is refused S4 at the door; S4 is served no write.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, beginTx, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { sweepHqRollup } from "../../apps/worker/src/rollup.ts";
import { workerScope } from "../../apps/worker/src/sweeps.ts";
import { connectShell } from "../../packages/shell/src/index.ts";
import { HQ_METRIC_KEYS, OPERATIONS } from "../../packages/contracts/src/index.ts";
import { INTERNAL_ORG_ID, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH, REGION_WEST } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const GIVEN = process.env.DATABASE_URL;
const skip = GIVEN ? false : "DATABASE_URL not set — item 10 (S4) was not verified against RLS or over the wire";
const RUN = `s4-${Date.now().toString(36)}`;
const SCRATCH = `ac_s4_${RUN.replace(/-/g, "_")}`;
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const URL_ = GIVEN ? withDb(GIVEN, SCRATCH) : undefined;
const PORT = 25080 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "correct horse battery staple";
const U = (n: number) => `d4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), RNODE = U(2), LOC = U(3), SITE = U(4), FIRM = U(5), CREW_OK = U(6), CREW_SUB = U(7), EXEC = U(8), DISP = U(9);
const J = { met: U(20), late: U(21), open: U(22), assigned: U(23) };

let maintenance: Pool;
let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
const asBinding = async (binding: Record<string, string>, sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE ac_gateway");
    for (const [k, v] of Object.entries(binding)) await c.query("SELECT set_config($1, $2, true)", [k, v]);
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
};
const binding = (namespace: string, org: string, surface: string, firm = "") => ({
  "ac.namespace": namespace, "ac.org_id": org, "ac.region_id": REGION_SOUTH, "ac.scope_tier": "parent", "ac.scope_id": org,
  "ac.firm_id": firm, "ac.device_id": "", "ac.actor_id": EXEC, "ac.surface_id": surface,
});
const refresh = async (at = new Date()) => {
  const tx = await beginTx(pool, "ac_worker");
  await tx.setLocal(workerScope());
  try { return await sweepHqRollup(tx, at); } catch (e) { await tx.rollback().catch(() => {}); throw e; }
};
const figure = async (metric: string, region: string) =>
  Number((await admin(`SELECT value FROM hq_metrics WHERE metric = $1 AND region_id = $2 ORDER BY day DESC LIMIT 1`, [metric, region]))[0]?.value ?? -1);

before(async () => {
  if (!GIVEN || !URL_) return;
  const given = new URL(GIVEN).pathname.replace(/^\//, "");
  maintenance = createPool(withDb(GIVEN, given === "postgres" ? "template1" : "postgres"), "ac-s4-test-admin");
  { const c = await maintenance.connect(); try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); } }
  const mig = spawn(process.execPath, [fileURLToPath(new URL("../../tools/ci/migrate.ts", import.meta.url))], { env: { ...process.env, DATABASE_URL: URL_ }, stdio: ["ignore", "pipe", "pipe"] });
  let mlog = "";
  mig.stdout!.on("data", (d) => { mlog += String(d); });
  mig.stderr!.on("data", (d) => { mlog += String(d); });
  if (await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1))) !== 0) throw new Error(`migrate failed on ${SCRATCH}:\n${mlog}`);
  pool = createPool(URL_, "ac-s4-test");

  await admin(`INSERT INTO regions (id, code, name, min_crew_density) VALUES ($1,'SOUTH','South',2), ($2,'WEST','West',1) ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH, REGION_WEST]);
  await admin(`INSERT INTO organizations (id, name, kind) VALUES ($1,'S4 Customer','customer'), ($2,'S4 Firm LLC','subcontractor')`, [ORG, FIRM]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'region',NULL,'C / South')`, [RNODE, ORG, REGION_SOUTH]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'location',$4,'C Austin')`, [LOC, ORG, REGION_SOUTH, RNODE]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'site',$4,'C Austin Roof')`, [SITE, ORG, REGION_SOUTH, LOC]);
  // Four jobs: one answered in time, one answered late, one open with its clock nearly due, one on its way (no
  // assignment row — the assignment gate is item 4's to test; here it is only an open job with no crew holding it).
  for (const [id, state] of [[J.met, "complete"], [J.late, "complete"], [J.open, "created"], [J.assigned, "assigned"]] as const) {
    await admin(`INSERT INTO jobs (id, org_id, region_id, site_id, service_code, priority, service_window, state, opened_at)
      VALUES ($1,$2,$3,$4,'HVAC-REPAIR','urgent', tstzrange(now() - interval '2 hours', now() + interval '2 hours', '[)'), $5, now() - interval '5 hours')`, [id, ORG, REGION_SOUTH, SITE, state]);
  }
  const timer = (job: string, satisfied: string | null, due: string) => admin(
    `INSERT INTO sla_timers (org_id, region_id, job_id, response_term, opened_at, due_at, satisfied_at, resolution_trace, shadow_mode)
     VALUES ($1,$2,$3,'4_hour', now() - interval '5 hours', ${due}, ${satisfied ?? "NULL"}, '[]'::jsonb, false)`, [ORG, REGION_SOUTH, job]);
  await timer(J.met, "now() - interval '4 hours'", "now() - interval '1 hour'");
  await timer(J.late, "now() - interval '30 minutes'", "now() - interval '1 hour'");
  await timer(J.open, null, "now() + interval '20 minutes'");
  // Crews: an employed crew with every document, a firm's crew with its insurance unverified.
  await admin(`INSERT INTO subcontractor_firms (id, org_id, region_id, legal_name, status, settlement_terms_days, msa_signed_at, diagnostic_data_rights_reserved)
    VALUES ($1,$1,$2,'S4 Firm LLC','active',30, now() - interval '100 days', true)`, [FIRM, REGION_SOUTH]);
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id, active)
    VALUES ($1,$2,$3,'S4 Employed','employed',NULL,$3,true), ($4,$5,$3,'S4 Sub','subcontracted',$5,$3,true)`, [CREW_OK, INTERNAL_ORG_ID, REGION_SOUTH, CREW_SUB, FIRM]);
  // Documents go on file unverified — 0005 refuses verified_at on any path but S2's — and S2 verifies them.
  const docs = await admin(`INSERT INTO crew_credentials (org_id, region_id, crew_id, kind, identifier, valid_from, valid_to) VALUES
    ($1,$2,$3,'license','L-OK', current_date - 100, current_date + 20),
    ($1,$2,$3,'background_check','B-OK', current_date - 100, current_date + 200) RETURNING id`, [INTERNAL_ORG_ID, REGION_SOUTH, CREW_OK]);
  for (const d of docs) {
    await asBinding({ ...binding("internal", INTERNAL_ORG_ID, "S2"), "ac.actor_id": EXEC }, `UPDATE crew_credentials SET verified_at = now(), verified_by = $2 WHERE id = $1`, [d.id, EXEC]);
  }
  await admin(`INSERT INTO crew_credentials (org_id, region_id, crew_id, kind, identifier, valid_from, valid_to) VALUES
    ($1,$2,$3,'insurance','I-SUB', current_date - 5, current_date + 360)`, [FIRM, REGION_SOUTH, CREW_SUB]);
  // Money: an invoice issued ten days ago and already past due; a disputed statement past the firm's terms.
  await admin(`INSERT INTO contracts (id, org_id, region_id, scope_tier, scope_id, kind, billing_path, signed_at, effective, diagnostic_data_rights_reserved, state)
    VALUES ($1,$2,$3,'parent',$2,'msa','enterprise_sla', now() - interval '200 days', daterange(current_date - 200, NULL), false, 'active')`, [U(30), ORG, REGION_SOUTH]);
  await admin(`INSERT INTO invoices (org_id, region_id, bill_to_tier, bill_to_id, contract_id, billing_path, total_minor, currency, issued_at, due_at)
    VALUES ($1,$2,'parent',$1,$3,'enterprise_sla', 250000, 'USD', now() - interval '10 days', now() - interval '1 day')`, [ORG, REGION_SOUTH, U(30)]);
  await admin(`INSERT INTO settlements (org_id, region_id, firm_id, period, total_minor, currency, state, issued_at, disputed_at, dispute_reason)
    VALUES ($1,$2,$1, daterange(current_date - 70, current_date - 40), 120000, 'USD', 'disputed', now() - interval '40 days', now() - interval '35 days', 'quantity')`, [FIRM, REGION_SOUTH]);
  // Growth: two leads from the web, one from the call button — they wait in UNASSIGNED.
  for (const source of ["web_form", "web_form", "call_button"]) {
    await admin(`INSERT INTO leads (org_id, region_id, source, submission_id, contact) VALUES ($1,$2,$3, gen_random_uuid(), '{"name":"S4 lead","phone":"512-555-0100"}'::jsonb)`, [PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, source]);
  }

  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','exec.s4@ac.test','Principal','["principal"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.s4@ac.test','South Dispatcher','["dispatcher"]','region',$3,$4,true)`, [EXEC, INTERNAL_ORG_ID, REGION_SOUTH, hash, DISP]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  gateway.stdout!.on("data", (d) => { log += String(d); });
  gateway.stderr!.on("data", (d) => { log += String(d); });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`gateway did not come up on :${PORT}\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
});

after(async () => {
  gateway?.kill("SIGTERM");
  await pool?.end();
  if (maintenance) {
    const c = await maintenance.connect().catch(() => null);
    if (c) { try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } finally { c.release(); } }
    await maintenance.end().catch(() => {});
  }
});

test("before the first refresh the gateway answers with no day and no values — not an error", { skip }, async () => {
  const s4 = await connectShell({ surfaceId: "S4", baseUrl: BASE, fetch, credentials: { email: "exec.s4@ac.test", password: PASSWORD } });
  const out = await s4.gateway.hqMetrics({});
  assert.equal(out.day, null);
  assert.deepEqual(out.values, []);
  assert.ok(out.regions.some((r) => r.id === UNASSIGNED_REGION_ID && !r.placed));
});

test("bound as the worker, one refresh writes every figure for every region, and the counts are the seeded rows", { skip }, async () => {
  const regions = Number((await admin("SELECT count(*)::int AS n FROM regions"))[0]!.n);
  assert.equal(await refresh(), HQ_METRIC_KEYS.length * regions);
  assert.equal(await figure("sla_closed_30d", REGION_SOUTH), 2, "met and late are closed; the open clock is not due yet");
  assert.equal(await figure("sla_met_30d", REGION_SOUTH), 1);
  assert.equal(await figure("sla_breached_30d", REGION_SOUTH), 1, "answered late is a breach");
  assert.equal(await figure("jobs_open_now", REGION_SOUTH), 2);
  assert.equal(await figure("jobs_unassigned_now", REGION_SOUTH), 2);
  assert.equal(await figure("jobs_at_risk_now", REGION_SOUTH), 1, "due within the hour");
  assert.equal(await figure("crews_active", REGION_SOUTH), 2);
  assert.equal(await figure("crews_cleared_now", REGION_SOUTH), 1, "the firm's crew has unverified insurance and no licence");
  assert.equal(await figure("credentials_unverified", REGION_SOUTH), 1);
  assert.equal(await figure("credentials_expiring_30d", REGION_SOUTH), 1, "the licence runs out in twenty days");
  assert.equal(await figure("min_crew_density", REGION_SOUTH), 2);
  assert.equal(await figure("locations_active", REGION_SOUTH), 1);
  assert.equal(await figure("customers_active", REGION_SOUTH), 1);
  assert.equal(await figure("firms_active", REGION_SOUTH), 1);
  assert.equal(await figure("invoiced_minor_30d", REGION_SOUTH), 250000);
  assert.equal(await figure("invoices_past_due_minor", REGION_SOUTH), 250000);
  assert.equal(await figure("settlements_disputed", REGION_SOUTH), 1);
  assert.equal(await figure("settlements_overdue", REGION_SOUTH), 1, "issued forty days ago on thirty-day terms");
  assert.equal(await figure("leads_30d", UNASSIGNED_REGION_ID), 3);
  assert.equal(await figure("leads_web_form_30d", UNASSIGNED_REGION_ID), 2);
  assert.equal(await figure("jobs_open_now", REGION_WEST), 0, "a region with no work has zeros, not no rows");
});

test("a second refresh the same day overwrites the day's rows; it does not add", { skip }, async () => {
  const before_ = Number((await admin("SELECT count(*)::int AS n FROM hq_metrics"))[0]!.n);
  await refresh(new Date(Date.now() + 1000));
  assert.equal(Number((await admin("SELECT count(*)::int AS n FROM hq_metrics"))[0]!.n), before_);
});

test("0010: internal reads every figure; a customer and a firm read none; the gateway cannot write one bound as anything", { skip }, async () => {
  const n = async (b: Record<string, string>) => Number((await asBinding(b, "SELECT count(*)::int AS n FROM hq_metrics"))[0]!.n);
  assert.ok(await n(binding("internal", INTERNAL_ORG_ID, "S4")) > 0);
  assert.equal(await n(binding("customer", ORG, "S6")), 0);
  assert.equal(await n(binding("subcontractor", FIRM, "S8", FIRM)), 0);
  for (const b of [binding("internal", INTERNAL_ORG_ID, "S4"), binding("internal", INTERNAL_ORG_ID, "worker")]) {
    await assert.rejects(
      asBinding(b, `INSERT INTO hq_metrics (org_id, region_id, day, metric, value, as_of) VALUES ($1,$2,current_date,'jobs_open_now',999,now())`, [INTERNAL_ORG_ID, REGION_SOUTH]),
      (e: { code?: string }) => e.code === "42501", "permission denied — the gateway role holds no write on the rollup",
    );
  }
});

test("over the wire: S4's principal reads the figures and their age, and the trend behind one", { skip }, async () => {
  const s4 = await connectShell({ surfaceId: "S4", baseUrl: BASE, fetch, credentials: { email: "exec.s4@ac.test", password: PASSWORD } });
  const out = await s4.gateway.hqMetrics({});
  assert.ok(out.day && out.asOf);
  assert.ok(Date.now() - Date.parse(out.asOf!) < 60_000);
  assert.equal(out.values.find((v) => v.metric === "sla_met_30d" && v.regionId === REGION_SOUTH)?.value, "1");
  const h = await s4.gateway.hqHistory({ metric: "jobs_open_now", days: 7 });
  assert.ok(h.points.some((p) => p.regionId === REGION_SOUTH && p.value === "2"));
});

test("over the wire: a dispatcher is refused S4 at the door, and S4 is served no write", { skip }, async () => {
  await assert.rejects(connectShell({ surfaceId: "S4", baseUrl: BASE, fetch, credentials: { email: "disp.s4@ac.test", password: PASSWORD } }));
  for (const op of Object.values(OPERATIONS)) {
    if ((op.surfaces as readonly string[]).includes("S4")) assert.ok(op.kind !== "mutation" || op.id === "auth.logout", op.id);
  }
});
