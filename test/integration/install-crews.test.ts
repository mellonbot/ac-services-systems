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
 * cleared; and an assignment of the wrong kind of crew is refused ahead of
 * the clearance check.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal',$4,'The Seller','["office_manager"]','parent',$2,$5,true)`, [SELLER, INTERNAL_ORG_ID, REGION_SOUTH, `seller.${RUN}@ac.test`, hashPassword("unused")]);
  await admin(`INSERT INTO projects (id, org_id, region_id, contract_id, name, foreman_id, service_window)
    VALUES ($1,$2,$3,$4,'Sold changeout',$5, tstzrange(now(), now() + interval '30 days')),
           ($6,$2,$3,$4,'Nobody sold this',NULL, tstzrange(now(), now() + interval '30 days'))`, [SOLD, ORG, REGION_SOUTH, CONTRACT, SELLER, UNSOLD]);
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, home_region_id, kind)
    VALUES ($1,$3,$4,$5,'employed',$4,'service'), ($2,$3,$4,$6,'employed',$4,'install')`,
    [UNIT, INSTALL, INTERNAL_ORG_ID, REGION_SOUTH, `Unit ${RUN}`, `Install ${RUN}`]);
});

after(async () => { await pool?.end(); });

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
