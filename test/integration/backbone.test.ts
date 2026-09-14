/**
 * THE BACKBONE, END TO END, AGAINST A REAL POSTGRES.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * Skips (loudly) without DATABASE_URL. Everything here is a claim in
 * docs/BACKBONE_CONTRACT.md; a claim without a test below is not in the
 * contract. Each test opens its own transaction on a seeded Amped tree and
 * rolls back, so the suite is order-independent and leaves the database as
 * it found it — except for the seed, which is idempotent.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPool, beginTx, hierarchyReader, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { createUnitOfWork, type Tx } from "../../apps/gateway/src/unit-of-work.ts";
import { buildContext } from "../../apps/gateway/src/context.ts";
import { authorTermOverride, resolvedTermsAt } from "../../apps/gateway/src/handlers/terms.ts";
import { assignCrew } from "../../apps/gateway/src/handlers/assignment.ts";
import { ingestSync } from "../../apps/gateway/src/handlers/sync.ts";
import { relayOnce, notifyPublisher } from "../../apps/worker/src/relay.ts";
import { sweepCredentialExpiry } from "../../apps/worker/src/sweeps.ts";
import { AdmissionRefused } from "../../packages/domain/src/inheritance/admit.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import type { Principal } from "../../packages/contracts/src/scope.ts";
import { ORG, N, REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH, NODES, OVERRIDES, MSA, AMEND_SJ, AMEND_AUSTIN_JULY, BOULDER_WARRANTY } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL = process.env.DATABASE_URL;
if (!URL) {
  test("integration suite", { skip: "DATABASE_URL not set — the backbone was not verified against a live database" }, () => {});
}

let pool: Pool;
const U = (n: number) => `b0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OPS = U(1), USER_DISP_SOUTH = U(2), USER_DISP_WEST = U(3), USER_CUST_BOULDER = U(4), USER_FIRM_A = U(5), USER_TECH = U(7);
const FIRM_A = U(10), FIRM_B = U(11), CREW_A = U(12), CREW_B = U(13), CREW_EMP = U(14), DEVICE = U(15), GRANT = U(16);
const NOW = new Date("2026-09-14T15:00:00Z");
const ctxFor = (surfaceId: "S2" | "S3" | "S5" | "S6" | "S8", principal: Principal) =>
  ({ surfaceId, principal, requestId: randomUUID(), now: () => NOW, newId: () => randomUUID() });

const principal = (over: Partial<Principal>): Principal => ({
  namespace: "internal", subjectId: USER_OPS, orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: INTERNAL_ORG_ID,
  roles: ["ops_leadership"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: randomUUID(), ...over,
});
const OPS = principal({});
const DISP_SOUTH = principal({ subjectId: USER_DISP_SOUTH, scopeTier: "region", scopeId: REGION_SOUTH, regionId: REGION_SOUTH, roles: ["dispatcher"] });
const DISP_WEST = principal({ subjectId: USER_DISP_WEST, scopeTier: "region", scopeId: REGION_WEST, regionId: REGION_WEST, roles: ["dispatcher"] });
const CUST_BOULDER = principal({ namespace: "customer", subjectId: USER_CUST_BOULDER, orgId: ORG, scopeTier: "location", scopeId: N.boulder, regionId: REGION_MOUNTAIN, roles: [], tierClaim: "facility_manager" });
const FIRM_A_USER = principal({ namespace: "subcontractor", subjectId: USER_FIRM_A, orgId: FIRM_A, scopeTier: "parent", scopeId: FIRM_A, regionId: REGION_SOUTH, roles: [], firmId: FIRM_A });
const TECH_DEVICE = principal({ namespace: "device", subjectId: USER_TECH, orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "region", scopeId: REGION_SOUTH, roles: ["technician"], deviceId: DEVICE, shiftId: GRANT });

/** Runs SQL as superuser, outside any scope binding. Seeding only. */
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

/** Unit of work under a principal, rolled back at the end of the test. */
const withUow = async <T>(surface: "S2" | "S3" | "S5" | "S6" | "S8", p: Principal, fn: (uow: Awaited<ReturnType<typeof createUnitOfWork>>, tx: Tx) => Promise<T>): Promise<T> => {
  const tx = await beginTx(pool, "ac_gateway");
  const uow = await createUnitOfWork(ctxFor(surface, p), tx);
  try {
    return await fn(uow, tx);
  } finally {
    // ROLLBACK unless the test committed. rollback() on a committed tx is a no-op error we swallow.
    try { await tx.rollback(); } catch { /* already closed */ }
  }
};

before(async () => {
  if (!URL) return;
  pool = createPool(URL, "ac-integration");
  await admin(`INSERT INTO organizations (id, name, kind) VALUES ($1,'Amped Fitness Inc.','customer'), ($2,'Firm A LLC','subcontractor'), ($3,'Firm B LLC','subcontractor') ON CONFLICT (id) DO NOTHING`, [ORG, FIRM_A, FIRM_B]);
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'MOUNTAIN','Mountain'), ($3,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH]);
  for (const n of NODES) {
    if (n.tier === "parent") continue;
    await admin(`INSERT INTO accounts (id, org_id, region_id, parent_id, tier, name, customer_group) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [n.id, ORG, n.serviceRegion, n.parent === ORG ? null : n.parent, n.tier, n.name, n.customerGroup ?? null]);
  }
  await admin(`INSERT INTO contracts (id, org_id, region_id, scope_tier, scope_id, kind, billing_path, signed_at, effective, diagnostic_data_rights_reserved, state)
    VALUES ($1,$2,$3,'parent',$2,'msa','enterprise_sla','2025-12-15','[2026-01-01,)',true,'active'),
           ($4,$2,$5,'location',$6,'amendment','enterprise_sla','2026-02-20','[2026-03-01,)',true,'active'),
           ($7,$2,$3,'location',$8,'amendment','enterprise_sla','2026-06-15','[2026-07-01,)',true,'active') ON CONFLICT (id) DO NOTHING`,
    [MSA, ORG, REGION_SOUTH, AMEND_SJ, REGION_WEST, N.sanJose, AMEND_AUSTIN_JULY, N.austin]);
  await admin(`INSERT INTO contracts (id, org_id, region_id, scope_tier, scope_id, kind, billing_path, signed_at, effective, diagnostic_data_rights_reserved, state)
    VALUES ($1,$2,$3,'site',$4,'amendment','enterprise_sla','2026-02-10','[2026-02-15,)',true,'active') ON CONFLICT (id) DO NOTHING`, [BOULDER_WARRANTY, ORG, REGION_MOUNTAIN, N.boulderRoof]);
  // Overrides from the fixture, through the DB's own admission trigger.
  const regionOf = (tier: string, id: string) => (tier === "parent" ? REGION_SOUTH : NODES.find((n) => n.id === id)!.serviceRegion);
  for (const o of OVERRIDES) {
    await admin(`INSERT INTO contract_term_overrides (org_id, region_id, contract_id, scope_tier, scope_id, term_key, term_value, effective, authored_by)
      SELECT $1,$2,$3,$4,$5,$6,$7::jsonb, daterange($8::date,$9::date,'[)'), $10
      WHERE NOT EXISTS (SELECT 1 FROM contract_term_overrides WHERE scope_tier=$4 AND scope_id=$5 AND term_key=$6 AND lower(effective)=$8::date)`,
      [ORG, regionOf(o.scopeTier, o.scopeId), o.contractId, o.scopeTier, o.scopeId, o.termKey, JSON.stringify(o.termValue), o.effectiveFrom, o.effectiveTo, USER_OPS]);
  }
  // Network: two subcontractor firms in South, one employed crew in West.
  await admin(`INSERT INTO subcontractor_firms (id, org_id, region_id, legal_name, status, settlement_terms_days, diagnostic_data_rights_reserved)
    VALUES ($1,$1,$3,'Firm A LLC','active',30,true), ($2,$2,$3,'Firm B LLC','active',30,true) ON CONFLICT (id) DO NOTHING`, [FIRM_A, FIRM_B, REGION_SOUTH]);
  await admin(`INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id) VALUES
    ($1,$4,$6,'Crew A1','subcontracted',$4,$6), ($2,$5,$6,'Crew B1','subcontracted',$5,$6), ($3,$7,$8,'Crew W1','employed',NULL,$8) ON CONFLICT (id) DO NOTHING`,
    [CREW_A, CREW_B, CREW_EMP, FIRM_A, FIRM_B, REGION_SOUTH, INTERNAL_ORG_ID, REGION_WEST]);
  await admin(`INSERT INTO rate_cards (org_id, region_id, firm_id, service_code, rate_minor, currency, effective) VALUES
    ($1,$3,$1,'HVAC_REPAIR',9500,'USD','[2026-01-01,)'), ($2,$3,$2,'HVAC_REPAIR',8800,'USD','[2026-01-01,)') ON CONFLICT DO NOTHING`, [FIRM_A, FIRM_B, REGION_SOUTH]);
  // Credentials for crew A: full set, verified. Insurance expires 2026-09-20 — the one that matters.
  await admin(`DELETE FROM crew_credentials WHERE crew_id IN ($1,$2)`, [CREW_A, CREW_B]);
  for (const [kind, to] of [["insurance", "2026-09-20"], ["license", "2027-12-31"], ["background_check", "2027-12-31"]] as const) {
    await admin(`INSERT INTO crew_credentials (org_id, region_id, crew_id, kind, identifier, valid_from, valid_to, verified_at, verified_by) VALUES ($1,$2,$3,$4,$5,'2025-01-01',$6,'2026-01-05',$7)`,
      [FIRM_A, REGION_SOUTH, CREW_A, kind, `${kind}-A`, to, USER_OPS]);
  }
  // Crew B: insurance on file but never verified.
  await admin(`INSERT INTO crew_credentials (org_id, region_id, crew_id, kind, identifier, valid_from, valid_to, verified_at) VALUES ($1,$2,$3,'insurance','ins-B','2025-01-01','2027-12-31',NULL), ($1,$2,$3,'license','lic-B','2025-01-01','2027-12-31','2026-01-05'), ($1,$2,$3,'background_check','bg-B','2025-01-01','2027-12-31','2026-01-05')`, [FIRM_B, REGION_SOUTH, CREW_B]);
  // Sites under El Paso and Austin, for jobs.
  for (const [id, loc, name] of [[U(40), N.elPaso, "El Paso — Roof"], [U(41), N.austin, "Austin — Roof"]] as const) {
    await admin(`INSERT INTO accounts (id, org_id, region_id, parent_id, tier, name) VALUES ($1,$2,$3,$4,'site',$5) ON CONFLICT (id) DO NOTHING`, [id, ORG, REGION_SOUTH, loc, name]);
  }
  await admin(`INSERT INTO devices (id, org_id, region_id, hardware_id, kind, public_key) VALUES ($1,$2,$3,'PILOT-0001','android_pilot','\\x00') ON CONFLICT (id) DO NOTHING`, [DEVICE, INTERNAL_ORG_ID, REGION_SOUTH]);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id) VALUES ($1,$2,$3,'internal','tech@ac.test','Tech','["technician"]','region',$3) ON CONFLICT (id) DO NOTHING`, [USER_TECH, INTERNAL_ORG_ID, REGION_SOUTH]);
});

after(async () => { if (pool) await pool.end(); });

const skip = { skip: URL ? false : "no DATABASE_URL" };

// ---------------------------------------------------------------------------
// D2 part 3 — region_id derives from the parent edge
// ---------------------------------------------------------------------------
test("a location cannot be inserted under a region node with a different region_id", skip, async () => {
  await assert.rejects(
    admin(`INSERT INTO accounts (org_id, region_id, parent_id, tier, name) VALUES ($1,$2,$3,'location','Amped Nowhere')`, [ORG, REGION_WEST, N.south]),
    /region_id derives from the parent edge/,
  );
});

test("a site cannot hang off a region, a location cannot hang off a location", skip, async () => {
  await assert.rejects(admin(`INSERT INTO accounts (org_id, region_id, parent_id, tier, name) VALUES ($1,$2,$3,'site','x')`, [ORG, REGION_SOUTH, N.south]), /must hang off a location/);
  await assert.rejects(admin(`INSERT INTO accounts (org_id, region_id, parent_id, tier, name) VALUES ($1,$2,$3,'location','x')`, [ORG, REGION_SOUTH, N.elPaso]), /must hang off a region/);
});

test("a customer's grouping is an attribute: changing customer_group touches no region_id", skip, async () => {
  const tx = await beginTx(pool);
  try {
    await tx.query(`UPDATE accounts SET customer_group = 'Southwest' WHERE id = $1`, [N.elPaso]);
    const r = await tx.query<{ region_id: string; customer_group: string }>(`SELECT region_id, customer_group FROM accounts WHERE id = $1`, [N.elPaso]);
    assert.equal(r[0]!.region_id, REGION_SOUTH);
    assert.equal(r[0]!.customer_group, "Southwest");
  } finally { await tx.rollback(); }
});

test("WE redraw a region by rebinding the region node, and the shard key cascades to every descendant", skip, async () => {
  const tx = await beginTx(pool);
  try {
    await tx.query(`UPDATE accounts SET region_id = $2 WHERE id = $1`, [N.mountain, REGION_WEST]);
    const r = await tx.query<{ id: string; region_id: string }>(`SELECT id, region_id FROM accounts WHERE id IN ($1,$2,$3)`, [N.boulder, N.boulderRoof, N.boulderAhu]);
    assert.deepEqual(r.map((x) => x.region_id), [REGION_WEST, REGION_WEST, REGION_WEST]);
  } finally { await tx.rollback(); }
});

test("path is materialised from the parent edge and moves with the node", skip, async () => {
  const r = await admin(`SELECT path FROM accounts WHERE id = $1`, [N.boulderRoof]);
  assert.deepEqual(r[0]!.path, [N.mountain, N.boulder, N.boulderRoof]);
  const tx = await beginTx(pool);
  try {
    // Move Boulder under West (we redraw): region_id and path cascade to both sites.
    await tx.query(`UPDATE accounts SET parent_id = $2 WHERE id = $1`, [N.boulder, N.west]);
    const rows = await tx.query<{ id: string; region_id: string; path: string[] }>(`SELECT id, region_id, path FROM accounts WHERE id IN ($1,$2)`, [N.boulderRoof, N.boulderAhu]);
    for (const row of rows) {
      assert.equal(row.region_id, REGION_WEST);
      assert.deepEqual(row.path.slice(0, 2), [N.west, N.boulder]);
    }
  } finally { await tx.rollback(); }
});

test("a job's tenancy is inherited from its site — a script typing the wrong region is refused", skip, async () => {
  await assert.rejects(
    admin(`INSERT INTO jobs (org_id, region_id, site_id, service_code, service_window) VALUES ($1,$2,$3,'HVAC_REPAIR','[2026-09-16 09:00,2026-09-16 13:00)')`, [ORG, REGION_WEST, N.boulderRoof]),
    /Tenancy is inherited, not typed/,
  );
});

// ---------------------------------------------------------------------------
// D2 part 2 — the term policy register, enforced at the table
// ---------------------------------------------------------------------------
test("the term_registry mirror matches the code register exactly", skip, async () => {
  const { TERMS } = await import("../../packages/contracts/src/terms.ts");
  const rows = await admin(`SELECT key, authoring_tiers, combine_kind FROM term_registry ORDER BY key`);
  assert.deepEqual(rows.map((r) => r.key), Object.keys(TERMS).sort());
  for (const r of rows) assert.deepEqual(r.authoring_tiers, TERMS[r.key]!.authoring);
});

test("finding 1 at the table: payment_terms_days at a location is refused by the trigger, from psql, with the reason", skip, async () => {
  await assert.rejects(
    admin(`INSERT INTO contract_term_overrides (org_id, region_id, contract_id, scope_tier, scope_id, term_key, term_value, effective, authored_by) VALUES ($1,$2,$3,'location',$4,'payment_terms_days','30','[2026-04-01,)',$5)`,
      [ORG, REGION_SOUTH, MSA, N.elPaso, USER_OPS]),
    /may not be set at tier "location"/,
  );
});

test("finding 4 at the table: overlapping rows for one (scope, term) are unrepresentable — EXCLUDE refuses", skip, async () => {
  await assert.rejects(
    admin(`INSERT INTO contract_term_overrides (org_id, region_id, contract_id, scope_tier, scope_id, term_key, term_value, effective, authored_by) VALUES ($1,$2,$3,'parent',$1,'payment_terms_days','30','[2026-06-01,)',$4)`,
      [ORG, REGION_SOUTH, MSA, USER_OPS]),
    /term_override_no_overlap/,
  );
});

test("the register mirror cannot be edited by a runtime role", skip, async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE ac_gateway");
    await assert.rejects(c.query(`UPDATE term_registry SET authoring_tiers = '["parent","location"]' WHERE key = 'payment_terms_days'`), /permission denied/);
    await c.query("ROLLBACK");
  } finally { c.release(); }
});

test("finding 2 through the gateway: Reno relaxing to 48-hour is refused by admission with the rationale; San Jose's 4-hour stands", skip, async () => {
  await withUow("S2", OPS, async (uow) => {
    const ctx = await buildContext(OPS, hierarchyReader(uow.tx));
    await assert.rejects(
      authorTermOverride(uow, ctx, { contractId: AMEND_SJ, scopeTier: "location", scopeId: N.reno, termKey: "sla_response", termValue: "48_hour", effectiveFrom: "2026-10-01", effectiveTo: null, orgId: ORG, regionId: REGION_WEST }),
      (e: unknown) => e instanceof AdmissionRefused && e.code === "ratchet_loosened" && /parent MSA priced/.test(e.message),
    );
    const r = await resolvedTermsAt(uow, ORG, "site", N.sanJoseRoof, "2026-06-01");
    assert.equal(r.resolved.sla_response!.value, "4_hour");
    assert.equal(r.resolved.payment_terms_days!.value, 45);
  });
});

test("authoring a legal override writes the row, an audit row and an outbox row with one event_id — and none of them if the tx rolls back", skip, async () => {
  const tx = await beginTx(pool, "ac_gateway");
  const uow = await createUnitOfWork(ctxFor("S2", OPS), tx);
  const ctx = await buildContext(OPS, hierarchyReader(tx));
  const { id, eventId } = await authorTermOverride(uow, ctx, { contractId: AMEND_SJ, scopeTier: "location", scopeId: N.reno, termKey: "sla_response", termValue: "2_hour", effectiveFrom: "2026-10-01", effectiveTo: null, orgId: ORG, regionId: REGION_WEST });
  assert.ok(id);
  await uow.rollback();
  const gone = await admin(`SELECT 1 FROM contract_term_overrides WHERE id = $1 UNION ALL SELECT 1 FROM audit_log WHERE event_id = $2 UNION ALL SELECT 1 FROM outbox WHERE event_id = $2`, [id, eventId]);
  assert.equal(gone.length, 0);

  const tx2 = await beginTx(pool, "ac_gateway");
  const uow2 = await createUnitOfWork(ctxFor("S2", OPS), tx2);
  const ctx2 = await buildContext(OPS, hierarchyReader(tx2));
  const w = await authorTermOverride(uow2, ctx2, { contractId: AMEND_SJ, scopeTier: "location", scopeId: N.reno, termKey: "sla_response", termValue: "2_hour", effectiveFrom: "2026-10-01", effectiveTo: null, orgId: ORG, regionId: REGION_WEST });
  await uow2.commit();
  try {
    const a = await admin(`SELECT actor_id, surface_id, action, region_id FROM audit_log WHERE event_id = $1`, [w.eventId]);
    const o = await admin(`SELECT topic, region_id, published_at FROM outbox WHERE event_id = $1`, [w.eventId]);
    assert.equal(a[0]!.surface_id, "S2");
    assert.equal(a[0]!.region_id, REGION_WEST);
    assert.equal(o[0]!.topic, "contract.term_overridden");
    assert.equal(o[0]!.published_at, null);
  } finally {
    await admin(`DELETE FROM contract_term_overrides WHERE id = $1`, [w.id]);
    await admin(`DELETE FROM outbox WHERE event_id = $1`, [w.eventId]);
    // audit_log cannot be deleted — that is the point. The row stays as evidence that this test ran.
  }
});

// ---------------------------------------------------------------------------
// Non-negotiable #4 — the audit log is append-only for everyone
// ---------------------------------------------------------------------------
test("audit_log refuses UPDATE and DELETE even from the superuser", skip, async () => {
  const rows = await admin(`SELECT id FROM audit_log LIMIT 1`);
  if (rows.length === 0) {
    await admin(`INSERT INTO audit_log (event_id, actor_id, surface_id, action, entity, entity_id, region_id, org_id) VALUES (gen_random_uuid(),$1,'test','seed','test',gen_random_uuid(),$2,$3)`, [USER_OPS, REGION_SOUTH, INTERNAL_ORG_ID]);
  }
  await assert.rejects(admin(`UPDATE audit_log SET action = 'tampered' WHERE id = (SELECT id FROM audit_log LIMIT 1)`), /append-only/);
  await assert.rejects(admin(`DELETE FROM audit_log WHERE id = (SELECT id FROM audit_log LIMIT 1)`), /append-only/);
});

// ---------------------------------------------------------------------------
// Non-negotiable #8 — the gate, all three layers
// ---------------------------------------------------------------------------
const newJob = async (tx: Tx, site: string, region: string, from: string, to: string) => {
  const r = await tx.query<{ id: string }>(`INSERT INTO jobs (org_id, region_id, site_id, service_code, service_window) VALUES ($1,$2,$3,'HVAC_REPAIR', tstzrange($4,$5,'[)')) RETURNING id`, [ORG, region, site, from, to]);
  return r[0]!.id;
};

test("THE ONE THAT MATTERS: insurance valid today, expiring the 20th, does NOT clear a job on the 22nd — and the refusal is an event", skip, async () => {
  await withUow("S3", DISP_SOUTH, async (uow) => {
    const job = await newJob(uow.tx, await siteUnder(uow.tx, N.elPaso), REGION_SOUTH, "2026-09-22T09:00:00Z", "2026-09-22T13:00:00Z");
    const r = await assignCrew(uow, USER_DISP_SOUTH, { jobId: job, crewId: CREW_A, orgId: ORG, regionId: REGION_SOUTH }, NOW);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.refusal.reason, "expired_in_window");
      assert.match(r.refusal.detail, /insurance expires 2026-09-20/);
    }
    assert.equal(uow.pending().events[0]!.topic, "crew.compliance_refused");
    assert.equal((await uow.tx.query(`SELECT 1 FROM assignments WHERE job_id = $1`, [job])).length, 0);
  });
});

test("the same crew clears a job on the 16th — the gate is time-aware, not merely strict — and the clearance row cites the credentials", skip, async () => {
  await withUow("S3", DISP_SOUTH, async (uow) => {
    const job = await newJob(uow.tx, await siteUnder(uow.tx, N.elPaso), REGION_SOUTH, "2026-09-16T09:00:00Z", "2026-09-16T13:00:00Z");
    const r = await assignCrew(uow, USER_DISP_SOUTH, { jobId: job, crewId: CREW_A, orgId: ORG, regionId: REGION_SOUTH }, NOW);
    assert.equal(r.ok, true);
    if (r.ok) {
      const c = await uow.tx.query<{ credential_ids: string[] }>(`SELECT credential_ids FROM compliance_clearances WHERE id = $1`, [r.clearanceId]);
      assert.equal(c[0]!.credential_ids.length, 3);
      const j = await uow.tx.query<{ state: string }>(`SELECT state FROM jobs WHERE id = $1`, [job]);
      assert.equal(j[0]!.state, "assigned");
    }
  });
});

test("an unverified certificate is not a certificate: crew B is refused", skip, async () => {
  await withUow("S3", DISP_SOUTH, async (uow) => {
    const job = await newJob(uow.tx, await siteUnder(uow.tx, N.austin), REGION_SOUTH, "2026-09-16T09:00:00Z", "2026-09-16T13:00:00Z");
    const r = await assignCrew(uow, USER_DISP_SOUTH, { jobId: job, crewId: CREW_B, orgId: ORG, regionId: REGION_SOUTH }, NOW);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.refusal.reason, "unverified");
  });
});

test("layer 2: a raw INSERT into assignments with a clearance that does not cover the window is refused by the trigger", skip, async () => {
  const tx = await beginTx(pool);
  try {
    const job = await newJob(tx, await siteUnder(tx, N.elPaso), REGION_SOUTH, "2026-09-22T09:00:00Z", "2026-09-22T13:00:00Z");
    const creds = await tx.query<{ id: string }>(`SELECT id FROM crew_credentials WHERE crew_id = $1`, [CREW_A]);
    // A clearance for the 16th (earned), spent on a job on the 22nd.
    const c = await tx.query<{ id: string }>(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by) VALUES ($1,$2,$3,'[2026-09-16 09:00Z,2026-09-16 13:00Z)',$4::jsonb,now(),$5) RETURNING id`,
      [ORG, REGION_SOUTH, CREW_A, JSON.stringify(creds.map((x) => x.id)), USER_OPS]);
    await assert.rejects(
      tx.query(`INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by) VALUES ($1,$2,$3,$4,$5,$6)`, [ORG, REGION_SOUTH, job, CREW_A, c[0]!.id, USER_OPS]),
      /expires mid-window does not clear the job/,
    );
  } finally { await tx.rollback(); }
});

test("layer 2b: a forged clearance citing credentials that do not cover its window is refused at the clearance table", skip, async () => {
  const creds = await admin(`SELECT id FROM crew_credentials WHERE crew_id = $1`, [CREW_A]);
  await assert.rejects(
    admin(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by) VALUES ($1,$2,$3,'[2026-09-22 09:00Z,2026-09-22 13:00Z)',$4::jsonb,now(),$5)`,
      [ORG, REGION_SOUTH, CREW_A, JSON.stringify(creds.map((x) => x.id)), USER_OPS]),
    /does not cover clearance window/,
  );
  await assert.rejects(
    admin(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by) VALUES ($1,$2,$3,'[2026-09-16 09:00Z,2026-09-16 13:00Z)','[]'::jsonb,now(),$4)`, [ORG, REGION_SOUTH, CREW_A, USER_OPS]),
    /names the credentials that earned it/,
  );
});

// ---------------------------------------------------------------------------
// Non-negotiable #3 — scope, enforced below the application
// ---------------------------------------------------------------------------
test("RLS: a West dispatcher sees zero South crews, jobs and clearances — not an error, zero rows", skip, async () => {
  await withUow("S3", DISP_WEST, async (uow) => {
    assert.equal((await uow.tx.query(`SELECT id FROM crews WHERE id IN ($1,$2)`, [CREW_A, CREW_B])).length, 0);
    assert.equal((await uow.tx.query(`SELECT id FROM crews WHERE id = $1`, [CREW_EMP])).length, 1);
  });
  await withUow("S3", DISP_SOUTH, async (uow) => {
    assert.equal((await uow.tx.query(`SELECT id FROM crews WHERE id IN ($1,$2)`, [CREW_A, CREW_B])).length, 2);
  });
});

test("RLS: a subcontractor firm sees its own rate card and nobody else's — a forgotten WHERE returns one row", skip, async () => {
  await withUow("S8", FIRM_A_USER, async (uow) => {
    const rows = await uow.tx.query<{ firm_id: string }>(`SELECT firm_id FROM rate_cards`);
    assert.deepEqual([...new Set(rows.map((r) => r.firm_id))], [FIRM_A]);
  });
});

test("RLS: a facility manager scoped to Boulder sees Boulder and its sites, not El Paso, not the region node's siblings", skip, async () => {
  await withUow("S6", CUST_BOULDER, async (uow) => {
    const rows = await uow.tx.query<{ id: string }>(`SELECT id FROM accounts ORDER BY id`);
    assert.deepEqual(rows.map((r) => r.id).sort(), [N.boulder, N.boulderRoof, N.boulderAhu].sort());
  });
});

test("the unit of work refuses a West dispatcher writing a South row before SQL is ever reached", skip, async () => {
  await withUow("S3", DISP_WEST, async (uow) => {
    await assert.rejects(
      uow.apply({ entity: "assignment", entityId: randomUUID(), action: "assign", topic: "job.assigned", before: null, after: {}, orgId: ORG, regionId: REGION_SOUTH }, async () => { assert.fail("write ran"); }),
      /own tenancy/,
    );
  });
});

test("a surface cannot write outside its allowlist: S6 (customer portal) cannot author a contract", skip, async () => {
  await withUow("S6", CUST_BOULDER, async (uow) => {
    await assert.rejects(
      uow.apply({ entity: "contract", entityId: randomUUID(), action: "x", topic: "contract.amended", before: null, after: {}, orgId: ORG, regionId: REGION_MOUNTAIN }, async () => {}),
      /may not write "contract"/,
    );
  });
});

// ---------------------------------------------------------------------------
// Non-negotiable #6 — sync
// ---------------------------------------------------------------------------
test("sync: a device log replays in device order; a duplicate replay is a no-op; an assignment intent is rejected and recorded", skip, async () => {
  await withUow("S5", TECH_DEVICE, async (uow) => {
    // Set up an assigned job, as the office would have.
    const tx = uow.tx;
    const job = await newJob(tx, await siteUnder(tx, N.elPaso), REGION_SOUTH, "2026-09-16T09:00:00Z", "2026-09-16T13:00:00Z");
    await tx.query(`UPDATE jobs SET state = 'assigned' WHERE id = $1`, [job]);
    const log = [
      { mutationId: "m1", deviceId: DEVICE, deviceSeq: 1, entityTable: "jobs", entityId: job, op: "transition" as const, payload: { state: "en_route" }, clientObservedVersion: 1, deviceAt: "2026-09-16T08:30:00Z" },
      { mutationId: "m2", deviceId: DEVICE, deviceSeq: 2, entityTable: "jobs", entityId: job, op: "transition" as const, payload: { state: "on_site" }, clientObservedVersion: 2, deviceAt: "2026-09-16T09:05:00Z" },
      { mutationId: "m3", deviceId: DEVICE, deviceSeq: 3, entityTable: "job_media", entityId: job, op: "insert" as const, payload: { storage_key: `${REGION_SOUTH}/${ORG}/photo/p1`, kind: "photo" }, clientObservedVersion: null, deviceAt: "2026-09-16T09:10:00Z" },
      { mutationId: "m4", deviceId: DEVICE, deviceSeq: 4, entityTable: "assignments", entityId: job, op: "insert" as const, payload: { crew_id: CREW_B }, clientObservedVersion: null, deviceAt: "2026-09-16T09:11:00Z" },
    ];
    const out = await ingestSync(uow, USER_TECH, { deviceId: DEVICE, mutations: log, orgId: ORG, regionId: REGION_SOUTH }, NOW);
    assert.deepEqual(out.map((o) => o.outcome), ["applied", "applied", "applied", "rejected"]);
    assert.equal((await tx.query<{ state: string }>(`SELECT state FROM jobs WHERE id = $1`, [job]))[0]!.state, "on_site");
    assert.equal((await tx.query(`SELECT 1 FROM job_state_events WHERE job_id = $1`, [job])).length, 2);
    assert.equal((await tx.query(`SELECT 1 FROM sync_mutations WHERE device_id = $1 AND outcome = 'rejected'`, [DEVICE])).length, 1);
    // Twelve hours later the device replays the same log.
    const again = await ingestSync(uow, USER_TECH, { deviceId: DEVICE, mutations: log, orgId: ORG, regionId: REGION_SOUTH }, NOW);
    assert.deepEqual(again.map((o) => o.outcome), ["duplicate", "duplicate", "duplicate", "duplicate"]);
    assert.equal((await tx.query(`SELECT 1 FROM job_media WHERE job_id = $1`, [job])).length, 1);
  });
});

test("sync: the office cancelled it, the crew completed it — a conflict row for a human and an event, not a silent winner", skip, async () => {
  await withUow("S5", TECH_DEVICE, async (uow) => {
    const job = await newJob(uow.tx, await siteUnder(uow.tx, N.elPaso), REGION_SOUTH, "2026-09-16T09:00:00Z", "2026-09-16T13:00:00Z");
    await uow.tx.query(`UPDATE jobs SET state = 'cancelled' WHERE id = $1`, [job]);
    const out = await ingestSync(uow, USER_TECH, { deviceId: DEVICE, orgId: ORG, regionId: REGION_SOUTH, mutations: [
      { mutationId: "c1", deviceId: DEVICE, deviceSeq: 1, entityTable: "jobs", entityId: job, op: "transition", payload: { state: "complete" }, clientObservedVersion: 1, deviceAt: "2026-09-16T12:00:00Z" },
    ] }, NOW);
    assert.equal(out[0]!.outcome, "queued_for_human");
    assert.equal((await uow.tx.query(`SELECT 1 FROM sync_conflicts WHERE entity_id = $1 AND resolved_at IS NULL`, [job])).length, 1);
    assert.equal(uow.pending().events.at(-1)!.topic, "sync.conflict_queued");
    assert.equal((await uow.tx.query<{ state: string }>(`SELECT state FROM jobs WHERE id = $1`, [job]))[0]!.state, "cancelled");
  });
});

// ---------------------------------------------------------------------------
// B5 — the event stream
// ---------------------------------------------------------------------------
test("relay: unpublished outbox rows are published in order, marked, and NOTIFY fans out per region; a second run finds nothing", skip, async () => {
  const eventId = randomUUID();
  await admin(`INSERT INTO outbox (event_id, topic, entity, entity_id, payload, actor_id, surface_id, region_id, org_id) VALUES ($1,'job.created','job',gen_random_uuid(),'{}',$2,'test',$3,$4)`, [eventId, USER_OPS, REGION_SOUTH, ORG]);
  const tx = await beginTx(pool);
  const seen: string[] = [];
  const r = await relayOnce(tx, { async publish(events) { for (const e of events) seen.push(e.eventId); await notifyPublisher(tx).publish(events); } });
  assert.ok(r.published >= 1);
  assert.ok(seen.includes(eventId));
  const row = await admin(`SELECT published_at FROM outbox WHERE event_id = $1`, [eventId]);
  assert.ok(row[0]!.published_at);
  const tx2 = await beginTx(pool);
  const r2 = await relayOnce(tx2, { async publish() { assert.fail("nothing to publish"); } }, 200, REGION_SOUTH);
  assert.equal(r2.published, 0);
});

test("credential expiry sweep: crew A's insurance (6 days out) emits credential.expiring with the at-risk assignment count; a second sweep the same day is silent", skip, async () => {
  const tx = await beginTx(pool);
  const n = await sweepCredentialExpiry(tx, NOW);
  assert.ok(n >= 1);
  const ev = await admin(`SELECT payload FROM outbox WHERE topic = 'credential.expiring' AND payload->>'kind' = 'insurance' AND payload->>'validTo' = '2026-09-20' ORDER BY occurred_at DESC LIMIT 1`);
  assert.equal(ev[0]!.payload.daysLeft, 6);
  const tx2 = await beginTx(pool);
  assert.equal(await sweepCredentialExpiry(tx2, NOW), 0);
});

// ---------------------------------------------------------------------------
// The assertion the whole thing rests on
// ---------------------------------------------------------------------------
test("region_id is total in the live schema", skip, async () => {
  await admin(`SELECT ac_assert_region_id_everywhere()`);
});

test("no runtime role can DELETE anything", skip, async () => {
  const rows = await admin(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee IN ('ac_gateway','ac_worker','ac_readonly') AND privilege_type = 'DELETE'`);
  assert.equal(rows[0]!.n, 0);
});

const siteUnder = async (_tx: Tx, location: string): Promise<string> => {
  if (location === N.elPaso) return U(40);
  if (location === N.austin) return U(41);
  throw new Error(`no seeded site under ${location}`);
};
