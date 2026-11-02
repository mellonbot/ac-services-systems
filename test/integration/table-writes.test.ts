/**
 * 0028 AT THE TABLE — every write the whole-repo review of 2026-10-24 made
 * against a live cluster as `ac_gateway` under a principal's own bindings,
 * made again, and refused. The gateway's write allowlist stops these over
 * HTTP; this suite is the claim that the table stops them too.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPool, type Pool } from "../../services/gateway/src/db/pg-tx.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — 0028's write policies were not verified against PostgreSQL";
if (!URL_) test("0028 at the table", { skip }, () => {});

let pool: Pool;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
/** A clearance is earned by verified credentials (0002); these fixtures are about who may write, not what earns one. */
const unearned = async (sql: string, params: unknown[]) => {
  const c = await pool.connect();
  try {
    await c.query("SET session_replication_role = replica");
    return (await c.query(sql, params)).rows;
  } finally { await c.query("SET session_replication_role = DEFAULT"); c.release(); }
};

const RUN = randomUUID().slice(0, 8);
const id = () => randomUUID();
const custA = id(), custB = id(), firmOrg = id(), firm = id(), firmCrew = id(), ourCrew = id(), otherCrew = id();
const regionA = id(), locA = id(), siteA = id(), regionB = id(), locB = id(), siteB = id();
const firmCred = id(), jobA = id(), jobB = id(), jobOurs = id(), timerA = id(), tech = id(), device = id(), grant = id(), office = id();
const WINDOW = "[2030-03-01 09:00Z,2030-03-01 13:00Z)";

/** One transaction as ac_gateway under the given bindings; rolled back whatever happens. */
const as = async <T>(binding: Record<string, string>, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: Record<string, unknown>[] }>) => Promise<T>): Promise<T> => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE ac_gateway");
    const full = { "ac.namespace": "", "ac.org_id": "", "ac.region_id": "", "ac.scope_tier": "", "ac.scope_id": "", "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": "", "ac.surface_id": "", ...binding };
    for (const [k, v] of Object.entries(full)) await c.query("SELECT set_config($1, $2, true)", [k, v]);
    return await fn(async (sql, params = []) => { const r = await c.query(sql, params); return { rowCount: r.rowCount ?? 0, rows: r.rows }; });
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
};

const customer = { "ac.namespace": "customer", "ac.org_id": custA, "ac.region_id": REGION_SOUTH, "ac.scope_tier": "site", "ac.scope_id": siteA, "ac.actor_id": id(), "ac.surface_id": "S6" };
const subcontractor = { "ac.namespace": "subcontractor", "ac.org_id": firmOrg, "ac.region_id": REGION_SOUTH, "ac.scope_tier": "parent", "ac.scope_id": firmOrg, "ac.firm_id": firm, "ac.actor_id": id(), "ac.surface_id": "S8" };
const deviceP = { "ac.namespace": "device", "ac.org_id": INTERNAL_ORG_ID, "ac.region_id": REGION_SOUTH, "ac.scope_tier": "region", "ac.scope_id": REGION_SOUTH, "ac.device_id": device, "ac.actor_id": tech, "ac.surface_id": "S5" };
const anonymous = { "ac.namespace": "anonymous", "ac.org_id": INTERNAL_ORG_ID, "ac.region_id": REGION_SOUTH, "ac.scope_tier": "parent", "ac.scope_id": INTERNAL_ORG_ID, "ac.actor_id": id(), "ac.surface_id": "S1" };
const westOffice = { "ac.namespace": "internal", "ac.org_id": INTERNAL_ORG_ID, "ac.region_id": REGION_WEST, "ac.scope_tier": "region", "ac.scope_id": REGION_WEST, "ac.actor_id": office, "ac.surface_id": "S3" };
const refused = /row-level security|AC422|cannot see/;

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-table-writes-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  await admin(`INSERT INTO organizations (id, name, kind, segment) VALUES ($1,$3,'customer','commercial'), ($2,$4,'customer','commercial')`, [custA, custB, `A ${RUN}`, `B ${RUN}`]);
  await admin(`INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'subcontractor')`, [firmOrg, `Firm ${RUN}`]);
  for (const [org, r, l, s] of [[custA, regionA, locA, siteA], [custB, regionB, locB, siteB]] as const) {
    await admin(`INSERT INTO accounts (id, org_id, region_id, tier, name) VALUES ($1,$2,$3,'region',$4)`, [r, org, REGION_SOUTH, `R ${RUN} ${org}`]);
    await admin(`INSERT INTO accounts (id, org_id, region_id, tier, name, parent_id) VALUES ($1,$2,$3,'location',$4,$5)`, [l, org, REGION_SOUTH, `L ${RUN} ${org}`, r]);
    await admin(`INSERT INTO accounts (id, org_id, region_id, tier, name, parent_id) VALUES ($1,$2,$3,'site',$4,$5)`, [s, org, REGION_SOUTH, `S ${RUN} ${org}`, l]);
  }
  await admin(`INSERT INTO subcontractor_firms (id, org_id, region_id, legal_name, status, settlement_terms_days, diagnostic_data_rights_reserved) VALUES ($1,$2,$3,$4,'onboarding',30,false)`, [firm, firmOrg, REGION_SOUTH, `Firm ${RUN} LLC`]);
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id) VALUES ($1,$2,$3,$4,'subcontracted',$5,$3)`, [firmCrew, firmOrg, REGION_SOUTH, `Firm crew ${RUN}`, firm]);
  for (const [c, label] of [[ourCrew, "Ours"], [otherCrew, "Other"]] as const) {
    await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, home_region_id) VALUES ($1,$2,$3,$4,'employed',$3)`, [c, INTERNAL_ORG_ID, REGION_SOUTH, `${label} ${RUN}`]);
  }
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, crew_id) VALUES ($1,$2,$3,'internal',$4,'Tech','["technician"]','region',$3,$5), ($6,$2,$3,'internal',$7,'Office','["dispatcher"]','parent',$2,NULL)`,
    [tech, INTERNAL_ORG_ID, REGION_SOUTH, `tech.${RUN}@ac.test`, ourCrew, office, `office.${RUN}@ac.test`]);
  // Verified and in date: the firm's clearance below is refused for who writes it, not for what it cites.
  await unearned(`INSERT INTO crew_credentials (id, org_id, region_id, crew_id, kind, identifier, valid_from, valid_to, verified_at, verified_by) VALUES ($1,$2,$3,$4,'insurance','X','2030-01-01','2030-12-31',now(),$5)`, [firmCred, firmOrg, REGION_SOUTH, firmCrew, office]);
  for (const [j, org, site] of [[jobA, custA, siteA], [jobB, custB, siteB], [jobOurs, custB, siteB]] as const) {
    await admin(`INSERT INTO jobs (id, org_id, region_id, site_id, service_code, service_window) VALUES ($1,$2,$3,$4,'DIAGNOSTIC',$5::tstzrange)`, [j, org, REGION_SOUTH, site, WINDOW]);
  }
  await admin(`INSERT INTO sla_timers (id, org_id, region_id, job_id, response_term, opened_at, due_at, resolution_trace) VALUES ($1,$2,$3,$4,'4_hour',now(),now() + interval '4 hours','{}'::jsonb)`, [timerA, custA, REGION_SOUTH, jobA]);
  // Our crew is sent to jobOurs; the other crew to jobB.
  for (const [crew, job] of [[ourCrew, jobOurs], [otherCrew, jobB]] as const) {
    const clearance = (await unearned(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by) VALUES ($1,$2,$3,$4::tstzrange,'[]'::jsonb,now(),$5) RETURNING id`, [custB, REGION_SOUTH, crew, WINDOW, office]))[0].id;
    await admin(`INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by) VALUES ($1,$2,$3,$4,$5,$6)`, [custB, REGION_SOUTH, job, crew, clearance, office]);
  }
  await admin(`INSERT INTO devices (id, org_id, region_id, hardware_id, kind, public_key) VALUES ($1,$2,$3,$4,'android_pilot',$5)`, [device, INTERNAL_ORG_ID, REGION_SOUTH, `hw-${RUN}`, Buffer.from("k")]);
  await admin(`INSERT INTO device_grants (id, org_id, region_id, device_id, crew_id, technician_id, service_window, granted_by) VALUES ($1,$2,$3,$4,$5,$6,tstzrange(now() - interval '1 hour', now() + interval '1 day'),$7)`,
    [grant, INTERNAL_ORG_ID, REGION_SOUTH, device, ourCrew, tech, office]);
});

after(async () => { await pool?.end(); });

test("a customer reads its tree and writes none of it: no node, no job history, no SLA timer", { skip }, async () => {
  await as(customer, async (q) => {
    assert.ok((await q(`SELECT 1 FROM accounts WHERE id = $1`, [regionA])).rowCount === 1, "the breadcrumb is still visible");
    assert.equal((await q(`UPDATE accounts SET name = 'pwned', active = false WHERE org_id = $1`, [custA])).rowCount, 0);
  });
  await as(customer, async (q) => {
    await assert.rejects(q(`INSERT INTO job_state_events (org_id, region_id, job_id, from_state, to_state, actor_id, surface_id, mutation_id, occurred_at) VALUES ($1,$2,$3,'created','complete',$4,'S6','forged',now())`,
      [custA, REGION_SOUTH, jobA, customer["ac.actor_id"]]), refused);
  });
  await as(customer, async (q) => {
    assert.equal((await q(`UPDATE sla_timers SET satisfied_at = now(), due_at = now() + interval '10 years' WHERE id = $1`, [timerA])).rowCount, 0);
  });
});

test("a firm cannot activate itself, price its own work, release its assignment or assign itself a job", { skip }, async () => {
  await as(subcontractor, async (q) => {
    assert.equal((await q(`UPDATE subcontractor_firms SET status = 'active', settlement_terms_days = 1, msa_signed_at = now() WHERE id = $1`, [firm])).rowCount, 0);
  });
  await as(subcontractor, async (q) => {
    await assert.rejects(q(`INSERT INTO rate_cards (org_id, region_id, firm_id, service_code, rate_minor, currency, effective) VALUES ($1,$2,$3,'DIAGNOSTIC',99999999,'USD',daterange('2030-01-01',NULL))`, [firmOrg, REGION_SOUTH, firm]), refused);
  });
  await as(subcontractor, async (q) => {
    await assert.rejects(q(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by) VALUES ($1,$2,$3,$4::tstzrange,$5::jsonb,now(),$6)`,
      [custA, REGION_SOUTH, firmCrew, WINDOW, JSON.stringify([firmCred]), subcontractor["ac.actor_id"]]), refused);
  });
});

test("the clearance gate refuses a job its caller cannot see — hidden is not a pass", { skip }, async () => {
  const clearance = (await unearned(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by) VALUES ($1,$2,$3,$4::tstzrange,'[]'::jsonb,now(),$5) RETURNING id`,
    [custA, REGION_WEST, otherCrew, WINDOW, office]))[0].id;
  await as(westOffice, async (q) => {
    assert.equal((await q(`SELECT 1 FROM jobs WHERE id = $1`, [jobA])).rowCount, 0, "the South job is out of a West dispatcher's sight");
    await assert.rejects(q(`INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by) VALUES ($1,$2,$3,$4,$5,$6)`, [custA, REGION_WEST, jobA, otherCrew, clearance, office]), /cannot see|is <NULL> work/,
      "refused by whichever trigger reads the hidden job first — 0024's crew check, then the gate; neither reads NULL as a pass");
  });
  await assert.rejects(admin(`INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by) VALUES ($1,$2,$3,$4,$5,$6)`, [INTERNAL_ORG_ID, REGION_SOUTH, jobA, otherCrew, clearance, office]),
    /does not match job org|does not match job region|covers/, "and an assignment under some other org than its job's is refused even unbound");
});

test("a device sees and moves its crew's work, not its region's", { skip }, async () => {
  await as(deviceP, async (q) => {
    const seen = (await q(`SELECT id FROM jobs WHERE id = ANY($1::uuid[])`, [[jobA, jobB, jobOurs]])).rows.map((r) => r.id);
    assert.deepEqual(seen, [jobOurs]);
    assert.equal((await q(`SELECT 1 FROM crews WHERE id = $1`, [otherCrew])).rowCount, 0, "another crew is not the tablet's to read");
    assert.equal((await q(`SELECT 1 FROM assignments WHERE crew_id = $1`, [otherCrew])).rowCount, 0);
    assert.equal((await q(`UPDATE jobs SET state = 'complete' WHERE region_id = $1`, [REGION_SOUTH])).rowCount, 1, "one job: its own");
  });
});

test("an audit or outbox row names the actor its transaction is bound as", { skip }, async () => {
  await as(anonymous, async (q) => {
    await assert.rejects(q(`INSERT INTO outbox (event_id, topic, entity, entity_id, payload, actor_id, surface_id, region_id, org_id) VALUES ($1,'invoice.paid','invoice',$2,'{}'::jsonb,$3,'S1',$4,$5)`,
      [id(), id(), office, REGION_SOUTH, custB]), refused);
  });
  await as(anonymous, async (q) => {
    await assert.rejects(q(`INSERT INTO audit_log (event_id, actor_id, surface_id, action, entity, entity_id, region_id, org_id) VALUES ($1,$2,'S1','forged','invoice',$3,$4,$5)`,
      [id(), office, id(), REGION_SOUTH, custB]), refused);
  });
});
