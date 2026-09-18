/**
 * ITEM 7 OVER THE WIRE — S8 Subcontractor Portal: firm visibility (0007) as
 * two firms and the office see it, and D12's four writes through the real
 * gateway.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What the render tests cannot say: that the ROWS are right. Two firms, each
 * with a cleared crew, each sent to one job at one customer's site, each
 * with a rate card and an issued statement; a third job with nobody on it;
 * a draft statement. A firm's portal must show its own crew, its own job, the
 * site it was sent to, its own statement — and nothing of the other firm's,
 * nothing of the customer's beyond the site, nothing of ours. Then the four
 * writes: enroll and retire a crew, file a document, take a position on a
 * statement — and at the table, the rows a firm may not write however it
 * asks.
 *
 * Before 0007, the firm's binding read every South job, assignment, clearance,
 * timer and request of every customer, the customer's whole tree, every
 * firm's settlement lines, our float, every user row with its password hash,
 * and the audit log. The first table-level test states what it reads now.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — item 7 (S8) was not verified over the wire";
if (!URL_) test("item 7 over the wire", { skip }, () => {});

const PORT = 24080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `d8000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_DISP = U(2), USER_COORD_A = U(3), USER_COORD_B = U(4), USER_FM = U(5);
// Per run, so the audit and outbox rows the tests count are this run's alone on a reused database.
const STMT_A = randomUUID(), STMT_A_DRAFT = randomUUID(), STMT_B = randomUUID(), LINE_A = randomUUID(), LINE_B = randomUUID(), WCP = randomUUID();
const PASSWORD = "correct horse battery staple";
const RUN = `d8-${Date.now().toString(36)}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
/** A statement inside one scope-bound transaction, as the gateway role — the database's own view of a principal. */
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
const firmBinding = (firmId: string, actor: string, surface = "S8") => ({
  "ac.namespace": "subcontractor", "ac.org_id": firmId, "ac.region_id": REGION_SOUTH, "ac.scope_tier": "parent", "ac.scope_id": firmId,
  "ac.firm_id": firmId, "ac.device_id": "", "ac.actor_id": actor, "ac.surface_id": surface,
});
const count = async (b: Record<string, string>, table: string, where = "", params: unknown[] = []) =>
  (await asBinding(b, `SELECT count(*)::int AS n FROM ${table} ${where}`, params))[0]!.n as number;

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-item7-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d8@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.d8@ac.test','South Dispatcher','["dispatcher"]','region',$3,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_DISP]);

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

const owner = () => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.d8@ac.test", password: PASSWORD } });
const dispatcher = () => connectShell({ surfaceId: "S3", baseUrl: BASE, fetch, credentials: { email: "disp.d8@ac.test", password: PASSWORD } });
const firmShell = (email: string) => connectShell({ surfaceId: "S8", baseUrl: BASE, fetch, credentials: { email, password: PASSWORD } });
const refusal = (s: ConnectedShell, e: unknown) => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return r!; };
const code = (s: ConnectedShell, e: unknown): string | null => { const r = refusal(s, e); return "code" in r ? r.code : null; };
const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id).sort();

const tomorrow = new Date(Date.now() + 24 * 3600_000);
const WINDOW_START = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 9)).toISOString();
const WINDOW_END = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 13)).toISOString();

// Shared across the tests below, in order. node:test runs them serially.
let s2: ConnectedShell, s3: ConnectedShell, firmA: ConnectedShell, firmB: ConnectedShell;
let A = "", B = "", crewA = "", crewB = "", rateA = "", rateB = "";
let amped = "", southNode = "", austin = "", austinRoof = "", austinAhu = "", austinDock = "";
let jobA = "", jobB = "", jobNobody = "";

test("the office records two firms, their crews and prices, a customer, and sends each firm to one job — the fixture the portal is measured against", { skip }, async () => {
  s2 = await owner();
  A = (await s2.gateway.createFirm({ legalName: `Firm A ${RUN}`, regionId: REGION_SOUTH, settlementTermsDays: 30, diagnosticDataRightsReserved: true, msaSignedAt: "2026-01-10" })).id;
  B = (await s2.gateway.createFirm({ legalName: `Firm B ${RUN}`, regionId: REGION_SOUTH, settlementTermsDays: 45, diagnosticDataRightsReserved: true, msaSignedAt: "2026-01-12" })).id;
  await s2.gateway.updateFirm({ firmId: A, status: "active" });
  await s2.gateway.updateFirm({ firmId: B, status: "active" });
  crewA = (await s2.gateway.createCrew({ label: `Crew A1 ${RUN}`, employmentType: "subcontracted", firmId: A, homeRegionId: REGION_SOUTH })).id;
  crewB = (await s2.gateway.createCrew({ label: `Crew B1 ${RUN}`, employmentType: "subcontracted", firmId: B, homeRegionId: REGION_SOUTH })).id;
  for (const crew of [crewA, crewB]) {
    for (const kind of ["insurance", "license", "background_check"] as const) {
      const c = await s2.gateway.recordCredential({ crewId: crew, kind, identifier: `${kind} ${crew.slice(-4)} ${RUN}`, validFrom: "2026-01-01", validTo: "2027-12-31" });
      await s2.gateway.verifyCredential({ credentialId: c.id });
    }
  }
  rateA = (await s2.gateway.setRateCard({ firmId: A, serviceCode: "HVAC-REPAIR", rateMinor: "9500", currency: "USD", effectiveFrom: "2026-01-01" })).id;
  rateB = (await s2.gateway.setRateCard({ firmId: B, serviceCode: "HVAC-REPAIR", rateMinor: "8800", currency: "USD", effectiveFrom: "2026-01-01" })).id;

  const a = await s2.gateway.createOrganization({ name: `Amped S8 ${RUN}`, externalRef: RUN, firstRegionNode: { regionId: REGION_SOUTH, name: "Amped / South" } });
  amped = a.orgId; southNode = a.regionNodeId;
  austin = (await s2.gateway.createAccount({ orgId: amped, tier: "location", parentId: southNode, name: "Austin", customerGroup: "Southwest" })).id;
  austinRoof = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: austin, name: `Austin — Roof ${RUN}` })).id;
  austinAhu = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: austin, name: `Austin — Basement AHU ${RUN}` })).id;
  austinDock = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: austin, name: `Austin — Loading Dock ${RUN}` })).id;
  const msa = (await s2.gateway.createContract({ orgId: amped, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: amped, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true })).id;
  await s2.gateway.transitionContract({ contractId: msa, to: "active" });
  await s2.gateway.authorTermOverride({ contractId: msa, scopeTier: "parent", scopeId: amped, termKey: "sla_response", termValue: "4_hour", effectiveFrom: "2026-01-01", orgId: amped, regionId: REGION_SOUTH });

  jobA = (await s2.gateway.createJob({ siteId: austinRoof, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
  jobB = (await s2.gateway.createJob({ siteId: austinAhu, serviceCode: "HVAC-REPAIR", priority: "routine", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
  jobNobody = (await s2.gateway.createJob({ siteId: austinDock, serviceCode: "PM-VISIT", priority: "pm", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
  s3 = await dispatcher();
  assert.equal((await s3.gateway.assignCrew({ jobId: jobA, crewId: crewA, orgId: amped, regionId: REGION_SOUTH })).ok, true);
  assert.equal((await s3.gateway.assignCrew({ jobId: jobB, crewId: crewB, orgId: amped, regionId: REGION_SOUTH })).ok, true);

  // Statements are WS-E's to issue (D13); until then they are rows. A's issued and A's draft, B's issued, and our float.
  await admin(`INSERT INTO settlements (id, org_id, region_id, firm_id, period, total_minor, currency, state, issued_at) VALUES
      ($1, $4, $6, $4, daterange('2026-08-01','2026-09-01','[)'), 42750, 'USD', 'issued', now()),
      ($2, $4, $6, $4, daterange('2026-09-01','2026-10-01','[)'), 1, 'USD', 'draft', NULL),
      ($3, $5, $6, $5, daterange('2026-08-01','2026-09-01','[)'), 35200, 'USD', 'issued', now())
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, firm_id = EXCLUDED.firm_id, period = EXCLUDED.period, total_minor = EXCLUDED.total_minor,
      state = EXCLUDED.state, issued_at = EXCLUDED.issued_at, acknowledged_at = NULL, disputed_at = NULL, dispute_reason = NULL`, [STMT_A, STMT_A_DRAFT, STMT_B, A, B, REGION_SOUTH]);
  await admin(`INSERT INTO settlement_lines (id, org_id, region_id, settlement_id, job_id, rate_card_id, quantity_milli, amount_minor) VALUES
      ($1, $3, $7, $5, $8, $9, 4500, 42750), ($2, $4, $7, $6, $10, $11, 4000, 35200)
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, settlement_id = EXCLUDED.settlement_id, job_id = EXCLUDED.job_id, rate_card_id = EXCLUDED.rate_card_id`,
    [LINE_A, LINE_B, A, B, STMT_A, STMT_B, REGION_SOUTH, jobA, rateA, jobB, rateB]);
  await admin(`INSERT INTO working_capital_positions (id, org_id, region_id, as_of, receivable_minor, subcontractor_payable_minor, parts_payable_minor, currency)
    VALUES ($1, $2, $3, current_date, 1000000, 77950, 0, 'USD') ON CONFLICT (id) DO NOTHING`, [WCP, INTERNAL_ORG_ID, REGION_SOUTH]);

  // The firm coordinators and a customer contact. Provisioning is SQL — there is no operation for it yet (OPEN-S6-IDP).
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, firm_id, password_hash, active)
    VALUES ($1,$2,$3,'subcontractor',$4,'Firm A Coordinator','[]','parent',$2,$2,$5,true),
           ($6,$7,$3,'subcontractor',$8,'Firm B Coordinator','[]','parent',$7,$7,$5,true),
           ($9,$10,$3,'customer',$11,'Austin FM','[]','location',$12,NULL,$5,true)
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, scope_id = EXCLUDED.scope_id, firm_id = EXCLUDED.firm_id, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, active = true`,
    [USER_COORD_A, A, REGION_SOUTH, `coord.${RUN}@firma.test`, hash, USER_COORD_B, B, `coord.${RUN}@firmb.test`, USER_FM, amped, `fm.${RUN}@amped.test`, austin]);
});

test("a firm signs in to S8 and its context is its own root: the firm, and nothing above it", { skip }, async () => {
  firmA = await firmShell(`coord.${RUN}@firma.test`);
  firmB = await firmShell(`coord.${RUN}@firmb.test`);
  assert.equal(firmA.principal.namespace, "subcontractor");
  assert.equal(firmA.principal.firmId, A);
  assert.equal(firmA.context?.parent.id, A);
  assert.match(firmA.context?.parent.name ?? "", /^Firm A/);
});

test("FIRM VISIBILITY — work: a firm sees the job its crew was sent to, with its own crew on the row and the site's name; not the other firm's job, not the unassigned one", { skip }, async () => {
  const a = (await firmA.gateway.listJobs({})).jobs;
  assert.deepEqual(ids(a), [jobA]);
  assert.equal(a[0]!.currentCrewId, crewA, "the crew on the row is the firm's own");
  assert.match(a[0]!.currentCrewLabel ?? "", /^Crew A1/);
  assert.match(a[0]!.siteName ?? "", /^Austin — Roof/, "the site it was sent to, by name");
  assert.ok(a[0]!.slaDueAt, "the timer is visible with the job");
  const b = (await firmB.gateway.listJobs({})).jobs;
  assert.deepEqual(ids(b), [jobB]);
  // The office and the dispatcher are unchanged: all three.
  assert.deepEqual(ids((await s2.gateway.listJobs({})).jobs).filter((id) => [jobA, jobB, jobNobody].includes(id)), [jobA, jobB, jobNobody].sort());
});

test("AT THE TABLE: what a firm's binding reads after 0007 — its own work, the site it was sent to, its own issued statement; zero rows on the customer's intake and tree, the other firm's everything, our float, users, audit, outbox", { skip }, async () => {
  const b = firmBinding(A, USER_COORD_A);
  // Its own.
  assert.deepEqual((await asBinding(b, `SELECT id FROM jobs ORDER BY id`)).map((r) => r.id), [jobA]);
  assert.equal(await count(b, "assignments"), 1);
  assert.equal(await count(b, "assignments", "WHERE crew_id = $1", [crewA]), 1);
  assert.equal(await count(b, "compliance_clearances", "WHERE crew_id = $1", [crewA]), 1);
  assert.equal(await count(b, "sla_timers"), 1);
  assert.deepEqual((await asBinding(b, `SELECT id FROM accounts`)).map((r) => r.id), [austinRoof], "the site it was sent to — not the location, not the region node, not the sibling sites");
  assert.deepEqual((await asBinding(b, `SELECT id FROM settlements ORDER BY id`)).map((r) => r.id), [STMT_A], "its own ISSUED statement; the draft is ours until issued");
  assert.deepEqual((await asBinding(b, `SELECT id FROM settlement_lines`)).map((r) => r.id), [LINE_A]);
  assert.deepEqual((await asBinding(b, `SELECT id FROM organizations`)).map((r) => r.id), [A], "its own root and no customer's");
  assert.deepEqual((await asBinding(b, `SELECT id FROM users`)).map((r) => r.id), [USER_COORD_A], "its own row — nobody else's hash");
  // Nothing else.
  for (const t of ["service_requests", "contracts", "contract_term_overrides", "working_capital_positions", "audit_log", "outbox", "invoices"]) {
    assert.equal(await count(b, t), 0, `${t}: zero rows for a firm, not an error`);
  }
  assert.equal(await count(b, "jobs", "WHERE id IN ($1, $2)", [jobB, jobNobody]), 0, "the other firm's job and the unassigned job are not there");
  assert.equal(await count(b, "crews", "WHERE id = $1", [crewB]), 0);
  assert.equal(await count(b, "rate_cards", "WHERE firm_id = $1", [B]), 0);
  assert.equal(await count(b, "settlement_lines", "WHERE id = $1", [LINE_B]), 0, "the other firm's price is not derivable from a row the firm cannot read");
  // And the customer's binding is unchanged by 0007: its sites, its work, no crew.
  const c = { ...b, "ac.namespace": "customer", "ac.org_id": amped, "ac.scope_tier": "location", "ac.scope_id": austin, "ac.firm_id": "", "ac.actor_id": USER_FM, "ac.surface_id": "S6" };
  assert.equal(await count(c, "jobs"), 3);
  assert.equal(await count(c, "crews"), 0);
  assert.equal(await count(c, "settlements"), 0);
  assert.equal(await count(c, "users"), 1);
});

test("THE ROSTER — enroll: label in, a subcontracted crew under the firm in its region out; retire refused while assigned, then admitted; the trigger refuses a row that says otherwise from any path", { skip }, async () => {
  const before = (await firmA.gateway.listCrews({})).crews.length;
  const enrolled = await firmA.gateway.enrollCrew({ label: `Crew A2 ${RUN}` });
  assert.equal(enrolled.firmId, A);
  assert.equal(enrolled.regionId, REGION_SOUTH);
  const row = (await admin(`SELECT org_id, region_id, employment_type, firm_id, home_region_id, active FROM crews WHERE id = $1`, [enrolled.id]))[0]!;
  assert.deepEqual(row, { org_id: A, region_id: REGION_SOUTH, employment_type: "subcontracted", firm_id: A, home_region_id: REGION_SOUTH, active: true });
  assert.equal((await firmA.gateway.listCrews({})).crews.length, before + 1);
  const summary = (await firmA.gateway.listCrews({})).crews.find((c) => c.id === enrolled.id)!.documents;
  assert.deepEqual(summary.missing, ["insurance", "license", "background_check"], "the gate's requirement, stated on the row");
  const audit = await admin(`SELECT entity, surface_id, actor_id FROM audit_log WHERE entity_id = $1`, [enrolled.id]);
  assert.deepEqual(audit, [{ entity: "crew_roster", surface_id: "S8", actor_id: USER_COORD_A }]);

  // Retire: the crew holding the live assignment is refused by name; the new crew goes.
  await assert.rejects(firmA.gateway.retireCrew({ crewId: crewA, active: false }), (e: unknown) => code(firmA, e) === "crew_assigned");
  assert.equal((await admin(`SELECT active FROM crews WHERE id = $1`, [crewA]))[0]!.active, true);
  await firmA.gateway.retireCrew({ crewId: enrolled.id, active: false, label: `Crew A2 ${RUN} (left)` });
  assert.equal((await admin(`SELECT active FROM crews WHERE id = $1`, [enrolled.id]))[0]!.active, false);
  // The other firm's crew: unknown, not forbidden.
  await assert.rejects(firmA.gateway.retireCrew({ crewId: crewB, active: false }), (e: unknown) => code(firmA, e) === "unknown_crew");

  // At the table, as the firm: a crew under the other firm (RLS), an employed crew under itself (trigger), a change of employer (trigger).
  const b = firmBinding(A, USER_COORD_A);
  await assert.rejects(
    asBinding(b, `INSERT INTO crews (org_id, region_id, label, employment_type, firm_id, home_region_id, active) VALUES ($1, $2, 'forged', 'subcontracted', $1, $2, true)`, [B, REGION_SOUTH]),
    /row-level security|enrolls its own crews/i, "a crew under firm B, from firm A's binding — the trigger or the policy, whichever the planner reaches first");
  await assert.rejects(
    asBinding(b, `INSERT INTO crews (org_id, region_id, label, employment_type, firm_id, home_region_id, active) VALUES ($1, $2, 'forged', 'employed', $1, $2, true)`, [A, REGION_SOUTH]),
    /a firm enrolls its own crews, subcontracted/, "an employed crew from a firm");
  await assert.rejects(
    asBinding(b, `UPDATE crews SET employment_type = 'employed' WHERE id = $1`, [crewA]),
    /changes employer, type or region only as a new crew/);
  // While the office's own path is untouched.
  assert.equal(await count(b, "crews", "WHERE id = $1", [crewA]), 1);
  // And a suspended firm does not roster.
  await s2.gateway.updateFirm({ firmId: B, status: "suspended" });
  await assert.rejects(firmB.gateway.enrollCrew({ label: "x" }), (e: unknown) => code(firmB, e) === "firm_ended");
  await s2.gateway.updateFirm({ firmId: B, status: "active" });
});

test("THE DOCUMENT — a firm files one for its own crew and it lands UNVERIFIED; a verified one is refused at the table; the other firm's crew is unknown; S2 then verifies it and the firm reads it verified", { skip }, async () => {
  const filed = await firmA.gateway.submitCredential({ crewId: crewA, kind: "certification", identifier: `EPA-608 ${RUN}`, validFrom: "2026-01-01", validTo: "2028-01-01", documentKey: `docs/${RUN}/epa608.pdf` });
  const row = (await admin(`SELECT verified_at, verified_by, org_id, region_id FROM crew_credentials WHERE id = $1`, [filed.id]))[0]!;
  assert.equal(row.verified_at, null);
  assert.equal(row.verified_by, null);
  assert.equal(row.org_id, A);
  assert.deepEqual(await admin(`SELECT entity, surface_id FROM audit_log WHERE entity_id = $1`, [filed.id]), [{ entity: "compliance_doc", surface_id: "S8" }]);
  const listed = (await firmA.gateway.listCredentials({ crewId: crewA })).credentials.find((c) => c.id === filed.id)!;
  assert.equal(listed.verifiedAt, null, "on the list AS unverified");

  await assert.rejects(firmA.gateway.submitCredential({ crewId: crewB, kind: "license", identifier: "x", validFrom: "2026-01-01", validTo: "2027-01-01" }), (e: unknown) => code(firmA, e) === "unknown_crew");
  await assert.rejects(firmA.gateway.verifyCredential({ credentialId: filed.id }), (e: unknown) => refusal(firmA, e).kind === "scope", "verification is S2's door");
  await assert.rejects(firmA.gateway.recordCredential({ crewId: crewA, kind: "license", identifier: "x", validFrom: "2026-01-01", validTo: "2027-01-01" }), (e: unknown) => refusal(firmA, e).kind === "scope", "S2's intake is not served to S8");
  const b = firmBinding(A, USER_COORD_A);
  await assert.rejects(
    asBinding(b, `INSERT INTO crew_credentials (org_id, region_id, crew_id, kind, identifier, valid_from, valid_to, verified_at, verified_by) VALUES ($1, $2, $3, 'license', 'forged', '2026-01-01', '2027-01-01', now(), $4)`, [A, REGION_SOUTH, crewA, USER_COORD_A]),
    /recorded unverified/, "0005 from the firm's own binding");
  await assert.rejects(
    asBinding(b, `UPDATE crew_credentials SET verified_at = now(), verified_by = $2 WHERE id = $1`, [filed.id, USER_COORD_A]),
    /only the Service Manager \(S2\) verifies/);

  const v = await s2.gateway.verifyCredential({ credentialId: filed.id });
  assert.equal(v.verifiedBy, USER_OWNER);
  const after = (await firmA.gateway.listCredentials({ crewId: crewA })).credentials.find((c) => c.id === filed.id)!;
  assert.ok(after.verifiedAt, "read back verified");
  assert.ok((await firmA.gateway.listCrews({})).crews.find((c) => c.id === crewA)!.documents.satisfied.includes("license"));
});

test("THE STATEMENT — a firm reads its own issued statements and their lines; the draft and the other firm's are not there; acknowledge, then dispute with a reason; each refused by name the second time", { skip }, async () => {
  const mine = (await firmA.gateway.listSettlements({})).settlements;
  assert.deepEqual(ids(mine), [STMT_A]);
  assert.equal(mine[0]!.totalMinor, "42750");
  assert.equal(mine[0]!.periodTo, "2026-08-31");
  assert.equal(mine[0]!.lineCount, 1);
  assert.deepEqual(ids((await firmA.gateway.listSettlements({ firmId: B })).settlements), [], "asking for the other firm's by id returns zero rows, not a 403 that confirms they exist — the C4 rule for rate cards");
  assert.deepEqual(ids((await firmA.gateway.listSettlements({ firmId: A })).settlements), [STMT_A]);
  const lines = await firmA.gateway.listSettlementLines({ settlementId: STMT_A });
  assert.equal(lines.lines.length, 1);
  assert.equal(lines.lines[0]!.jobId, jobA);
  assert.equal(lines.lines[0]!.rateMinor, "9500", "its own rate, visible");
  assert.match(lines.lines[0]!.siteName ?? "", /^Austin — Roof/);
  await assert.rejects(firmA.gateway.listSettlementLines({ settlementId: STMT_B }), (e: unknown) => code(firmA, e) === "unknown_settlement");
  await assert.rejects(firmA.gateway.listSettlementLines({ settlementId: STMT_A_DRAFT }), (e: unknown) => code(firmA, e) === "unknown_settlement", "a draft is ours until issued");

  const ack = await firmA.gateway.acknowledgeSettlement({ settlementId: STMT_A });
  assert.equal(ack.state, "acknowledged");
  let row = (await admin(`SELECT state, acknowledged_at, total_minor::text AS total FROM settlements WHERE id = $1`, [STMT_A]))[0]!;
  assert.equal(row.state, "acknowledged");
  assert.ok(row.acknowledged_at);
  assert.equal(row.total, "42750", "the total is untouched");
  await assert.rejects(firmA.gateway.acknowledgeSettlement({ settlementId: STMT_A }), (e: unknown) => code(firmA, e) === "already_acknowledged");
  await assert.rejects(firmA.gateway.acknowledgeSettlement({ settlementId: STMT_B }), (e: unknown) => code(firmA, e) === "unknown_settlement");

  await assert.rejects(firmA.gateway.disputeSettlement({ settlementId: STMT_A, reason: "  " }), (e: unknown) => code(firmA, e) === "empty_reason");
  const dis = await firmA.gateway.disputeSettlement({ settlementId: STMT_A, reason: `Line 1 bills 4.5h at ${RUN}; the ticket shows 4h.` });
  assert.equal(dis.state, "disputed");
  row = (await admin(`SELECT state, dispute_reason FROM settlements WHERE id = $1`, [STMT_A]))[0]!;
  assert.equal(row.state, "disputed");
  assert.match(String(row.dispute_reason), /ticket shows 4h/);
  await assert.rejects(firmA.gateway.disputeSettlement({ settlementId: STMT_A, reason: "again" }), (e: unknown) => code(firmA, e) === "already_disputed");
  const audit = await admin(`SELECT entity, action FROM audit_log WHERE entity_id = $1 AND surface_id = 'S8' ORDER BY occurred_at`, [STMT_A]);
  assert.deepEqual(audit, [{ entity: "settlement_ack", action: "settlement.acknowledge" }, { entity: "dispute", action: "settlement.dispute" }]);
  const events = await admin(`SELECT topic FROM outbox WHERE entity_id = $1 ORDER BY occurred_at`, [STMT_A]);
  assert.deepEqual(events.map((e) => e.topic), ["settlement.acknowledged", "settlement.disputed"], "the office's block subscribes to both");

  // The office reads every firm's, the draft and the reason included; and may not take a position on the firm's behalf.
  const all = (await s2.gateway.listSettlements({})).settlements.filter((s) => [STMT_A, STMT_A_DRAFT, STMT_B].includes(s.id));
  assert.equal(all.length, 3);
  assert.match(all.find((s) => s.id === STMT_A)!.disputeReason ?? "", /ticket shows 4h/);
  await assert.rejects(s2.gateway.acknowledgeSettlement({ settlementId: STMT_B }), (e: unknown) => refusal(s2, e).kind === "scope");
  // Firm B reads its own and only its own.
  assert.deepEqual(ids((await firmB.gateway.listSettlements({})).settlements), [STMT_B]);
});

test("AT THE TABLE — the statement is ours: a firm's binding cannot change the total, the period, the firm, or take a step the ladder does not have", { skip }, async () => {
  const b = firmBinding(A, USER_COORD_A);
  await assert.rejects(asBinding(b, `UPDATE settlements SET total_minor = 1 WHERE id = $1`, [STMT_A]), /is ours; a firm states its position/);
  await assert.rejects(asBinding(b, `UPDATE settlements SET firm_id = $2 WHERE id = $1`, [STMT_A, B]), /is ours; a firm states its position|row-level security/);
  await assert.rejects(asBinding(b, `UPDATE settlements SET state = 'paid' WHERE id = $1`, [STMT_A]), /a firm may acknowledge an issued statement or dispute/);
  await assert.rejects(asBinding(b, `UPDATE settlements SET state = 'issued', disputed_at = NULL, dispute_reason = NULL WHERE id = $1`, [STMT_A]), /a firm may acknowledge an issued statement or dispute/, "a dispute is not withdrawn by the firm; the office answers it");
  await assert.rejects(asBinding(b, `INSERT INTO settlements (org_id, region_id, firm_id, period, total_minor, currency, state) VALUES ($1, $2, $1, daterange('2026-10-01','2026-11-01','[)'), 1, 'USD', 'issued')`, [A, REGION_SOUTH]), /row-level security/);
  await assert.rejects(asBinding(b, `INSERT INTO settlement_lines (org_id, region_id, settlement_id, job_id, rate_card_id, quantity_milli, amount_minor) VALUES ($1, $2, $3, $4, $5, 1, 1)`, [A, REGION_SOUTH, STMT_A, jobA, rateA]), /row-level security/);
  // The other firm's statement is not there to update: zero rows, no error, nothing changed.
  await asBinding(b, `UPDATE settlements SET state = 'acknowledged', acknowledged_at = now() WHERE id = $1`, [STMT_B]);
  assert.equal((await admin(`SELECT state FROM settlements WHERE id = $1`, [STMT_B]))[0]!.state, "issued");
  assert.equal(await count(b, "settlements", "WHERE id = $1 AND state = 'disputed'", [STMT_A]), 1, "nothing above took effect");
  // The acknowledged→disputed step IS the firm's, with the stamp and the reason — the trigger admits exactly that.
  await admin(`UPDATE settlements SET state = 'issued', acknowledged_at = NULL, disputed_at = NULL, dispute_reason = NULL WHERE id = $1`, [STMT_B]);
  const bB = firmBinding(B, USER_COORD_B);
  await assert.rejects(asBinding(bB, `UPDATE settlements SET state = 'disputed' WHERE id = $1`, [STMT_B]), /a dispute says why/);
  await asBinding(bB, `UPDATE settlements SET state = 'disputed', disputed_at = now(), dispute_reason = 'rate' WHERE id = $1`, [STMT_B]);
  assert.equal((await admin(`SELECT state FROM settlements WHERE id = $1`, [STMT_B]))[0]!.state, "disputed");
});

test("WHAT A FIRM CANNOT DO, and who cannot read the firm's: authoring, dispatch and the customer's reads refused by scope; the dispatcher reads no firm, the customer no statement", { skip }, async () => {
  for (const call of [
    () => firmA.gateway.createCrew({} as never), () => firmA.gateway.updateCrew({} as never), () => firmA.gateway.setRateCard({} as never),
    () => firmA.gateway.updateFirm({} as never), () => firmA.gateway.createJob({} as never), () => firmA.gateway.assignCrew({} as never),
    () => firmA.gateway.listAccounts({} as never), () => firmA.gateway.listContracts({} as never), () => firmA.gateway.listServiceRequests({} as never),
    () => firmA.gateway.resolvedTerms({} as never), () => firmA.gateway.candidateCrews({} as never),
  ]) await assert.rejects(call(), (e: unknown) => refusal(firmA, e).kind === "scope");
  await assert.rejects(s3.gateway.listSettlements({} as never), (e: unknown) => refusal(s3, e).kind === "scope");
  await assert.rejects(s3.gateway.listFirms({} as never), (e: unknown) => refusal(s3, e).kind === "scope");
  const fm = await connectShell({ surfaceId: "S6", baseUrl: BASE, fetch, credentials: { email: `fm.${RUN}@amped.test`, password: PASSWORD } });
  await assert.rejects(fm.gateway.listSettlements({} as never), (e: unknown) => refusal(fm, e).kind === "scope");
  await assert.rejects(fm.gateway.listCrews({} as never), (e: unknown) => refusal(fm, e).kind === "scope");
  await fm.logout();
});

test("sign out: the session is revoked and the copied token is dead", { skip }, async () => {
  const held = firmA.token()!;
  await firmA.logout();
  await assert.rejects(
    connectShell({ surfaceId: "S8", baseUrl: BASE, fetch, credentials: { token: held } }),
    (e: unknown) => { const r = (e as { refusal?: { kind: string; code?: string } }).refusal; return r?.kind === "token" && r.code === "revoked"; },
  );
  await Promise.all([firmB.logout(), s3.logout(), s2.logout()]);
});
