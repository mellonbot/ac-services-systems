/**
 * 0024 IN THE DATABASE — an install crew is not a technician, on the path
 * that skips every handler.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What this suite holds, each by a raw write the gateway would have refused
 * by name first: a technician is never on an install crew, an installer never
 * on a technician's service unit, and a service unit is one technician; a
 * crew does not change kind under its people; an install job names a project
 * whose foreman sold it, is never an emergency, and its foreman cannot be
 * cleared, and its seller is an active foreman of ours; and an assignment of
 * the wrong kind of crew is refused ahead of the clearance check.
 *
 * And over the wire, through the shell and a spawned gateway: the office
 * records what was sold (projects.create), opens install work under it, and
 * dispatch is offered install crews only — a technician is refused by name.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — 0024's rules were not verified against PostgreSQL";
const RUN = `inst-${Date.now().toString(36)}`;
const ORG = randomUUID(), RNODE = randomUUID(), LOC = randomUUID(), SITE = randomUUID(), CONTRACT = randomUUID();
const SELLER = randomUUID(), SOLD = randomUUID(), UNSOLD = randomUUID();
const UNIT = randomUUID(), INSTALL = randomUUID();
const OWNER = randomUUID(), DISPATCHER = randomUUID(), CLERK = randomUUID();
const PASSWORD = "correct horse battery staple";
const PORT = 24080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let gateway: ChildProcess;

let pool: Pool;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
/** A refusal from the database: AC422 from a trigger, or the named CHECK. */
const refused = (pattern: RegExp, code = "AC422") => (e: unknown) => {
  const err = e as { code?: string; message?: string };
  assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
  assert.match(err.message ?? "", pattern);
  return true;
};
const job = (work: string, project: string | null, priority = "routine") => admin(
  `INSERT INTO jobs (org_id, region_id, site_id, project_id, service_code, priority, work_class, service_window)
   VALUES ($1,$2,$3,$4,'CONDENSER-INSTALL',$5,$6, tstzrange(now() + interval '1 day', now() + interval '2 days', '[)')) RETURNING id`,
  [ORG, REGION_SOUTH, SITE, project, priority, work]);
const tech = (crew: string | null, role: string, name: string) => admin(
  `INSERT INTO technicians (org_id, region_id, crew_id, name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
  [INTERNAL_ORG_ID, REGION_SOUTH, crew, name, role]);

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-install-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  await admin(`INSERT INTO organizations (id, name, kind, segment) VALUES ($1,$2,'customer','residential')`, [ORG, `Install Customer ${RUN}`]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'region',NULL,'I / region')`, [RNODE, ORG, REGION_SOUTH]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'location',$4,'I location')`, [LOC, ORG, REGION_SOUTH, RNODE]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'site',$4,'I site')`, [SITE, ORG, REGION_SOUTH, LOC]);
  await admin(`INSERT INTO contracts (id, org_id, region_id, scope_tier, scope_id, kind, billing_path, signed_at, effective, diagnostic_data_rights_reserved, state)
    VALUES ($1,$2,$3,'parent',$2,'msa','enterprise_sla', now() - interval '30 days', daterange(current_date - 30, NULL), false, 'active')`, [CONTRACT, ORG, REGION_SOUTH]);
  await admin(`INSERT INTO contract_term_overrides (org_id, region_id, contract_id, scope_tier, scope_id, term_key, term_value, effective, authored_by)
    VALUES ($1,$2,$3,'parent',$1,'sla_response','"next_day"', daterange(current_date - 30, NULL), $4)`, [ORG, REGION_SOUTH, CONTRACT, INTERNAL_ORG_ID]);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal',$4,'The Seller','["foreman"]','parent',$2,$5,true)`, [SELLER, INTERNAL_ORG_ID, REGION_SOUTH, `seller.${RUN}@ac.test`, hashPassword("unused")]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$4,$5,'internal',$6,'Account Owner','["account_owner"]','parent',$4,$9,true),
           ($2,$4,$5,'internal',$7,'South Dispatcher','["dispatcher"]','region',$5,$9,true),
           ($3,$4,$5,'internal',$8,'Not A Seller','["office_manager"]','parent',$4,$9,true)`,
    [OWNER, DISPATCHER, CLERK, INTERNAL_ORG_ID, REGION_SOUTH, `owner.${RUN}@ac.test`, `disp.${RUN}@ac.test`, `clerk.${RUN}@ac.test`, hash]);
  await admin(`INSERT INTO projects (id, org_id, region_id, contract_id, name, foreman_id, service_window)
    VALUES ($1,$2,$3,$4,'Sold changeout',$5, tstzrange(now(), now() + interval '30 days')),
           ($6,$2,$3,$4,'Nobody sold this',NULL, tstzrange(now(), now() + interval '30 days'))`, [SOLD, ORG, REGION_SOUTH, CONTRACT, SELLER, UNSOLD]);
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, home_region_id, kind)
    VALUES ($1,$3,$4,$5,'employed',$4,'service'), ($2,$3,$4,$6,'employed',$4,'install')`,
    [UNIT, INSTALL, INTERNAL_ORG_ID, REGION_SOUTH, `Unit ${RUN}`, `Install ${RUN}`]);

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
});

const shellAs = (surfaceId: "S2" | "S3", who: string) => connectShell({ surfaceId, baseUrl: BASE, fetch, credentials: { email: `${who}.${RUN}@ac.test`, password: PASSWORD } });
const refusal = (s: ConnectedShell, e: unknown) => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return r!; };

test("a technician is never on an install crew; an installer never on a technician's unit", { skip }, async () => {
  await assert.rejects(tech(INSTALL, "technician", "Sam Ortiz"), refused(/never on an install crew/));
  await assert.rejects(tech(UNIT, "installer", "Rae Cole"), refused(/installer goes on an install crew/));
  // The crew they belong on admits each of them.
  await tech(UNIT, "technician", "Sam Ortiz");
  await tech(INSTALL, "lead_installer", "Rae Cole");
  await tech(INSTALL, "helper", "Jo Park");
});

test("a service unit is one technician — a second is refused; one taken off the roster makes room", { skip }, async () => {
  const unit = randomUUID();
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, home_region_id) VALUES ($1,$2,$3,$4,'employed',$3)`,
    [unit, INTERNAL_ORG_ID, REGION_SOUTH, `Unit B ${RUN}`]);
  const [first] = await tech(unit, "technician", "Ana Reyes") as { id: string }[];
  await assert.rejects(tech(unit, "technician", "Jordan Pike"), refused(/a service unit is one technician/));
  await admin(`UPDATE technicians SET active = false WHERE id = $1`, [first!.id]);
  await tech(unit, "technician", "Jordan Pike");
  // And a crew does not become an install crew under a technician.
  await assert.rejects(admin(`UPDATE crews SET kind = 'install' WHERE id = $1`, [unit]), refused(/cannot become install/));
});

test("an install job names a project, the project names who sold it, and an install is never an emergency", { skip }, async () => {
  // The trigger speaks before the CHECK (BEFORE row triggers run first), in plain words.
  await assert.rejects(job("install", null), refused(/names no project/));
  await assert.rejects(job("install", UNSOLD), refused(/names no foreman/));
  await assert.rejects(job("install", SOLD, "emergency"), refused(/jobs_install_is_never_an_emergency/, "23514"));
  await job("install", SOLD);
  // Service and commissioning need no project.
  await job("service", null, "emergency");
  await job("commissioning", null);
  // Turning an unsold job into an install is the same refusal as opening one.
  const [plain] = await job("service", UNSOLD) as { id: string }[];
  await assert.rejects(admin(`UPDATE jobs SET work_class = 'install' WHERE id = $1`, [plain!.id]), refused(/names no foreman/));
});

test("the person who sold a project is an active foreman of ours — on every path", { skip }, async () => {
  const sell = (foreman: string) => admin(`INSERT INTO projects (org_id, region_id, contract_id, name, foreman_id, service_window)
    VALUES ($1,$2,$3,'Raw',$4, tstzrange(now(), now() + interval '1 day'))`, [ORG, REGION_SOUTH, CONTRACT, foreman]);
  await assert.rejects(sell(CLERK), refused(/active foreman on our staff/));
  await assert.rejects(admin(`UPDATE projects SET foreman_id = $2 WHERE id = $1`, [SOLD, CLERK]), refused(/active foreman on our staff/));
});

test("the foreman of a project with install work under it is never cleared", { skip }, async () => {
  await assert.rejects(admin(`UPDATE projects SET foreman_id = NULL WHERE id = $1`, [SOLD]), refused(/cannot be cleared/));
  // Naming another seller is not clearing one.
  await admin(`UPDATE projects SET foreman_id = $2 WHERE id = $1`, [SOLD, SELLER]);
});

test("an assignment of the wrong kind of crew is refused ahead of the clearance — the right kind falls through to it", { skip }, async () => {
  const [installJob] = await job("install", SOLD) as { id: string }[];
  const [serviceJob] = await job("service", null) as { id: string }[];
  const [commissioning] = await job("commissioning", null) as { id: string }[];
  const assign = (jobId: string, crew: string) => admin(
    `INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [ORG, REGION_SOUTH, jobId, crew, randomUUID(), SELLER]);
  await assert.rejects(assign(installJob!.id, UNIT), refused(/install work goes to an install crew/));
  await assert.rejects(assign(serviceJob!.id, INSTALL), refused(/service and commissioning go to a technician/));
  await assert.rejects(assign(commissioning!.id, INSTALL), refused(/service and commissioning go to a technician/));
  // The right kind is not refused by 0024 — what stops it now is the gate's
  // own trigger, because this clearance was never earned.
  await assert.rejects(assign(installJob!.id, INSTALL), (e: unknown) => !/goes to an install crew|go to a technician/.test((e as Error).message));
});

test("over the wire: the office records what was sold, opens install work under it, and dispatch is offered install crews only", { skip }, async () => {
  const office = await shellAs("S2", "owner");
  const window = { serviceWindowStart: new Date(Date.now() + 86_400_000).toISOString(), serviceWindowEnd: new Date(Date.now() + 2 * 86_400_000).toISOString() };

  // Sold by someone who is not a foreman: refused by name, nothing written.
  const before = (await office.gateway.listProjects({ orgId: ORG })).projects.length;
  await assert.rejects(office.gateway.createProject({ contractId: CONTRACT, name: "Wire changeout", foremanId: CLERK, ...window }),
    (e: unknown) => refusal(office, e).code === "not_a_foreman");
  const listed = await office.gateway.listProjects({ orgId: ORG });
  assert.equal(listed.projects.length, before);
  assert.ok(listed.foremen.some((f) => f.id === SELLER), "the seller is offered as a foreman");

  const project = await office.gateway.createProject({ contractId: CONTRACT, name: "Wire changeout", foremanId: SELLER, ...window });
  assert.equal(project.regionId, REGION_SOUTH);
  const row = (await office.gateway.listProjects({ orgId: ORG })).projects.find((p) => p.id === project.id)!;
  assert.equal(row.foremanName, "The Seller");

  // An install without a project is refused by name; under the project it opens.
  await assert.rejects(office.gateway.createJob({ siteId: SITE, serviceCode: "CONDENSER-INSTALL", workClass: "install", ...window }),
    (e: unknown) => refusal(office, e).code === "install_needs_project");
  const job = await office.gateway.createJob({ siteId: SITE, serviceCode: "CONDENSER-INSTALL", workClass: "install", projectId: project.id, ...window });
  const listedJob = (await office.gateway.listJobs({})).jobs.find((j) => j.id === job.id)!;
  assert.equal(listedJob.workClass, "install");
  assert.equal((await office.gateway.listProjects({ orgId: ORG })).projects.find((p) => p.id === project.id)!.installJobs, 1);

  // Dispatch: the candidates are install crews; a technician's unit is refused by name.
  const dispatch = await shellAs("S3", "disp");
  const offered = await dispatch.gateway.candidateCrews({ jobId: job.id, orgId: ORG, regionId: REGION_SOUTH });
  assert.ok(offered.candidates.some((c) => c.crewId === INSTALL));
  assert.ok(!offered.candidates.some((c) => c.crewId === UNIT), "a technician's unit is not offered for install work");
  await assert.rejects(dispatch.gateway.assignCrew({ jobId: job.id, crewId: UNIT, orgId: ORG, regionId: REGION_SOUTH }),
    (e: unknown) => refusal(dispatch, e).code === "crew_kind_mismatch");
});
