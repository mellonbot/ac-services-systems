/**
 * MANAGER.OVERVIEW OVER THE WIRE — S3's Manager Dashboard against a spawned
 * gateway and a live PostgreSQL.
 *
 * The read is company-wide (it counts every job, invoice and crew it can
 * see), so this suite runs on a scratch database (create, migrate, seed,
 * drop), the way s4.test.ts does, and every figure it asserts is exactly the
 * rows seeded here.
 *
 * What it holds:
 *   - leadership at parent scope reads the figures: billed and completed this
 *     month against the same point last month, first-visit fixes, days per
 *     step, labour, unbilled work by state, urgent work with no crew by
 *     region, credential standing, eight weeks of completed vs. invoiced,
 *     branches and the team;
 *   - an ops_leadership login at REGION scope is refused (its jobs would be
 *     one region's and its invoices every region's), and so is a dispatcher.
 *
 * Times are placed so the suite holds on any day of the month: "this month"
 * is halfway between the 1st and now, "last month" is that minus one month.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../services/gateway/src/db/pg-tx.ts";
import { hashPassword } from "../../services/gateway/src/auth/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH, REGION_WEST } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const GIVEN = process.env.DATABASE_URL;
const skip = GIVEN ? false : "DATABASE_URL not set — manager.overview was not verified against PostgreSQL or over the wire";
const RUN = `mgr-${Date.now().toString(36)}`;
const SCRATCH = `ac_${RUN.replace(/-/g, "_")}`;
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const URL_ = GIVEN ? withDb(GIVEN, SCRATCH) : undefined;
const PORT = 26080 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "correct horse battery staple";
const U = (n: number) => `d6000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), RNODE_S = U(2), LOC_S = U(3), SITE_S = U(4), RNODE_W = U(5), LOC_W = U(6), SITE_W = U(7), CONTRACT = U(8);
const CREW_A = U(10), CREW_B = U(11);
const EXEC = U(20), LEAD = U(21), DISP = U(22), TECH = U(23);
const J = { oneVisit: U(30), twoVisits: U(31), lastMonth: U(32), urgentWest: U(33), routine: U(34), kickedBack: U(35), onSite: U(36) };

/** Halfway between the 1st of this month and now — inside this month on any day. */
const THIS = "(date_trunc('month', now()) + (now() - date_trunc('month', now())) / 2)";
const PRIOR = `(${THIS} - interval '1 month')`;

let maintenance: Pool;
let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!GIVEN || !URL_) return;
  const given = new URL(GIVEN).pathname.replace(/^\//, "");
  maintenance = createPool(withDb(GIVEN, given === "postgres" ? "template1" : "postgres"), "ac-mgr-test-admin");
  { const c = await maintenance.connect(); try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); } }
  const mig = spawn(process.execPath, [fileURLToPath(new URL("../../tools/ci/migrate.ts", import.meta.url))], { env: { ...process.env, DATABASE_URL: URL_ }, stdio: ["ignore", "pipe", "pipe"] });
  let mlog = "";
  mig.stdout!.on("data", (d) => { mlog += String(d); });
  mig.stderr!.on("data", (d) => { mlog += String(d); });
  if (await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1))) !== 0) throw new Error(`migrate failed on ${SCRATCH}:\n${mlog}`);
  pool = createPool(URL_, "ac-mgr-test");
  pool.on("error", () => {}); // the DROP ... WITH (FORCE) in after() may end a backend still closing — s4.test.ts

  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South'), ($2,'WEST','West') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH, REGION_WEST]);
  await admin(`INSERT INTO organizations (id, name, kind, segment) VALUES ($1,'Manager Customer','customer','commercial')`, [ORG]);
  for (const [node, loc, site, region] of [[RNODE_S, LOC_S, SITE_S, REGION_SOUTH], [RNODE_W, LOC_W, SITE_W, REGION_WEST]] as const) {
    await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'region',NULL,'M / region')`, [node, ORG, region]);
    await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'location',$4,'M location')`, [loc, ORG, region, node]);
    await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'site',$4,'M site')`, [site, ORG, region, loc]);
  }
  const job = (id: string, site: string, region: string, state: string, priority = "routine") => admin(
    `INSERT INTO jobs (id, org_id, region_id, site_id, service_code, priority, service_window, state, opened_at)
     VALUES ($1,$2,$3,$4,'HVAC-REPAIR',$5, tstzrange(now() - interval '2 hours', now() + interval '2 hours', '[)'), $6, ${THIS} - interval '3 days')`,
    [id, ORG, region, site, priority, state]);
  await job(J.oneVisit, SITE_S, REGION_SOUTH, "invoiced");
  await job(J.twoVisits, SITE_S, REGION_SOUTH, "complete");
  await job(J.lastMonth, SITE_S, REGION_SOUTH, "needs_pricing");
  await job(J.urgentWest, SITE_W, REGION_WEST, "created", "urgent");
  await job(J.routine, SITE_S, REGION_SOUTH, "created");
  await job(J.kickedBack, SITE_S, REGION_SOUTH, "invoice_trouble");
  await job(J.onSite, SITE_S, REGION_SOUTH, "in_progress");
  let seq = 0;
  const event = (jobId: string, to: string, at: string) => admin(
    `INSERT INTO job_state_events (org_id, region_id, job_id, to_state, actor_id, surface_id, mutation_id, occurred_at)
     SELECT org_id, region_id, id, $2, $3, 'S3', $4, ${at} FROM jobs WHERE id = $1`, [jobId, to, EXEC, `m-${++seq}`]);
  // One visit, end to end: scheduled ½ day after the request, on site 1½ days later, finished a day after that, invoiced since.
  await event(J.oneVisit, "assigned", `${THIS} - interval '2.5 days'`);
  await event(J.oneVisit, "on_site", `${THIS} - interval '1 day'`);
  await event(J.oneVisit, "complete", THIS);
  await event(J.oneVisit, "invoiced", `${THIS} + (now() - ${THIS}) / 2`);
  // Two visits: scheduled 2 days after the request, finished this month, not billed.
  await event(J.twoVisits, "assigned", `${THIS} - interval '1 day'`);
  await event(J.twoVisits, "complete", THIS);
  // Finished at the same point last month; still waiting on pricing.
  await event(J.lastMonth, "complete", PRIOR);

  // Crews: South's technician with a licence lapsing in 20 days; West's with one already lapsed.
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id, active)
    VALUES ($1,$2,$3,'South crew','employed',NULL,$3,true), ($4,$2,$5,'West crew','employed',NULL,$5,true)`, [CREW_A, INTERNAL_ORG_ID, REGION_SOUTH, CREW_B, REGION_WEST]);
  const [licence] = await admin(`INSERT INTO crew_credentials (org_id, region_id, crew_id, kind, identifier, valid_from, valid_to)
    VALUES ($1,$2,$3,'license','L-A', current_date - 100, current_date + 20) RETURNING id`, [INTERNAL_ORG_ID, REGION_SOUTH, CREW_A]);
  await admin(`INSERT INTO crew_credentials (org_id, region_id, crew_id, kind, identifier, valid_from, valid_to)
    VALUES ($1,$2,$3,'license','L-B', current_date - 400, current_date - 1)`, [INTERNAL_ORG_ID, REGION_WEST, CREW_B]);
  // A clearance needs a verified credential, and only S2 may verify one (0005).
  { const c = await pool.connect();
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL ROLE ac_gateway");
      for (const [k, v] of Object.entries({ "ac.namespace": "internal", "ac.org_id": INTERNAL_ORG_ID, "ac.region_id": REGION_SOUTH, "ac.scope_tier": "parent",
        "ac.scope_id": INTERNAL_ORG_ID, "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": EXEC, "ac.surface_id": "S2" })) await c.query("SELECT set_config($1, $2, true)", [k, v]);
      await c.query("UPDATE crew_credentials SET verified_at = now(), verified_by = $2 WHERE id = $1", [licence.id, EXEC]);
      await c.query("COMMIT");
    } finally { c.release(); } }
  const [clearance] = await admin(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by)
    VALUES ($1,$2,$3, tstzrange(now() - interval '60 days', now() + interval '15 days'), $4::jsonb, now(), $5) RETURNING id`,
    [INTERNAL_ORG_ID, REGION_SOUTH, CREW_A, JSON.stringify([licence.id]), EXEC]);
  const assign = (jobId: string, released: boolean) => admin(
    `INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by, released_at, release_reason)
     VALUES ($1,$2,$3,$4,$5,$6, ${released ? "now()" : "NULL"}, ${released ? "'done'" : "NULL"})`, [ORG, REGION_SOUTH, jobId, CREW_A, clearance.id, EXEC]);
  await assign(J.oneVisit, true);
  await assign(J.twoVisits, true);
  await assign(J.twoVisits, true);
  await assign(J.onSite, false);
  // Half an hour of labour on the job the crew is on now.
  await admin(`INSERT INTO time_entries (org_id, region_id, job_id, crew_id, span, kind, mutation_id)
    VALUES ($1,$2,$3,$4, tstzrange(now() - interval '30 minutes', now(), '[)'), 'labor', 'te-1')`, [ORG, REGION_SOUTH, J.onSite, CREW_A]);

  // Money: this month's invoice for the one-visit job, and last month's at the same point.
  await admin(`INSERT INTO contracts (id, org_id, region_id, scope_tier, scope_id, kind, billing_path, signed_at, effective, diagnostic_data_rights_reserved, state)
    VALUES ($1,$2,$3,'parent',$2,'msa','enterprise_sla', now() - interval '200 days', daterange(current_date - 200, NULL), false, 'active')`, [CONTRACT, ORG, REGION_SOUTH]);
  for (const [minor, at] of [[250000, THIS], [200000, PRIOR]] as const) {
    await admin(`INSERT INTO invoices (org_id, region_id, bill_to_tier, bill_to_id, contract_id, billing_path, total_minor, currency, issued_at, due_at)
      VALUES ($1,$2,'parent',$1,$3,'enterprise_sla', $4, 'USD', ${at}, ${at} + interval '30 days')`, [ORG, REGION_SOUTH, CONTRACT, minor]);
  }

  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active, crew_id)
    VALUES ($1,$2,$3,'internal','exec.mgr@ac.test','A Principal','["principal"]','parent',$2,$4,true,NULL),
           ($5,$2,$3,'internal','lead.mgr@ac.test','B Regional Lead','["ops_leadership"]','region',$3,$4,true,NULL),
           ($6,$2,$3,'internal','disp.mgr@ac.test','C Dispatcher','["dispatcher"]','parent',$2,$4,true,NULL),
           ($7,$2,$3,'internal','tech.mgr@ac.test','D Technician','["technician"]','region',$3,$4,true,$8)`,
    [EXEC, INTERNAL_ORG_ID, REGION_SOUTH, hash, LEAD, DISP, TECH, CREW_A]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../services/gateway/src/main.ts", import.meta.url))], {
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
  if (gateway && gateway.exitCode === null) await new Promise((r) => { gateway.once("exit", r); gateway.kill("SIGTERM"); });
  await pool?.end();
  if (maintenance) {
    const c = await maintenance.connect().catch(() => null);
    if (c) { try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } finally { c.release(); } }
    await maintenance.end().catch(() => {});
  }
});

const s3 = (email: string) => connectShell({ surfaceId: "S3", baseUrl: BASE, fetch, credentials: { email, password: PASSWORD } });
const near = (actual: number | null, expected: number, what: string) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `${what}: ${actual} ≠ ${expected}`);

test("leadership at parent scope reads the company: every figure is the seeded rows", { skip }, async () => {
  const out = await (await s3("exec.mgr@ac.test")).gateway.managerOverview();
  assert.deepEqual(out.billed, [{ currency: "USD", minor: "250000", priorMinor: "200000" }]);
  assert.deepEqual(out.completed, { now: 2, prior: 1 });
  assert.equal(out.fixedFirstVisit, 1, "one visit and no return trip owed; the two-visit job is not a first-visit fix");

  const wait = Object.fromEntries(out.waits.map((w) => [w.step, w]));
  near(wait.request_to_scheduled!.avgDays, (0.5 + 2) / 2, "request → scheduled");
  assert.equal(wait.request_to_scheduled!.jobs, 2);
  near(wait.scheduled_to_on_site!.avgDays, 1.5, "scheduled → on site");
  near(wait.on_site_to_finished!.avgDays, 1, "on site → finished");
  assert.equal(wait.finished_to_invoiced!.jobs, 1);
  assert.ok(wait.finished_to_invoiced!.avgDays! > 0);

  assert.equal(out.labor.techs, 2);
  near(out.labor.hours, 0.5, "labour, last 7 days");
  assert.deepEqual(out.unbilled, { complete: 1, needsPricing: 1, awaitingPo: 0, awaitingPictures: 0, invoiceTrouble: 1 });
  assert.deepEqual(out.urgentUnassigned, [{ regionId: REGION_WEST, count: 1 }], "the routine unassigned job is not urgent");
  assert.deepEqual(out.credentials, { expired: 1, expiring: 1 });

  assert.equal(out.weeks.length, 8);
  assert.equal(out.weeks.reduce((n, w) => n + w.completed, 0), 3);
  assert.equal(out.weeks.reduce((n, w) => n + w.invoiced, 0), 1);

  const branch = (id: string) => out.branches.find((b) => b.regionId === id)!;
  assert.equal(branch(REGION_SOUTH).techs, 1);
  near(branch(REGION_SOUTH).laborHours, 0.5, "South labour");
  assert.equal(branch(REGION_SOUTH).unbilled, 3);
  assert.deepEqual({ ...branch(REGION_WEST), regionId: undefined, name: undefined }, { regionId: undefined, name: undefined, techs: 1, laborHours: 0, unbilled: 0 });

  const person = (name: string) => out.team.find((p) => p.name === name)!;
  assert.deepEqual(out.team.map((p) => p.name), ["A Principal", "B Regional Lead", "C Dispatcher", "D Technician"]);
  assert.equal(person("D Technician").onJob, true);
  near(person("D Technician").hoursThisWeek, 0.5, "the technician's hours");
  assert.equal(person("D Technician").credential, "at_risk");
  assert.deepEqual([person("A Principal").onJob, person("A Principal").hoursThisWeek, person("A Principal").credential], [false, null, null]);
});

test("refused: ops_leadership at region scope, and a dispatcher — 403, not a partial dashboard", { skip }, async () => {
  for (const email of ["lead.mgr@ac.test", "disp.mgr@ac.test"]) {
    const shell: ConnectedShell = await s3(email);
    await assert.rejects(shell.gateway.managerOverview(), (e: unknown) => shell.refusalOf(e)?.kind === "scope", email);
  }
});
