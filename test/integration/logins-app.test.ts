/**
 * AC LOGINS' DATABASE ACCESS OVER THE WIRE — tools/logins-app/src/db.ts against
 * a spawned gateway and a live PostgreSQL.
 *
 *   DATABASE_URL=postgres://... node --test --test-concurrency=1 test/integration/logins-app.test.ts
 *
 * Claims: the pickers read what an unbound role cannot; each kind of login
 * added through the app signs in where kindsOf says; a change of access, a
 * reset and a removal each end the open sessions — the human's and, for a
 * technician, the device's — and a cosmetic edit ends none.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { GatewayRefusal, type SurfaceId } from "../../packages/contracts/src/index.ts";
import { UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { openDb, attachIdleErrorHandler, failure, LoginsDbError, LOGINS_APP_ACTOR, type LoginsDb } from "../../tools/logins-app/src/db.ts";
import { kindsOf } from "../../tools/logins-app/src/kinds.ts";
import { LoginInputError, type Employer } from "../../tools/logins-app/src/rows.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — the logins app's database access was not verified over the wire";
if (!URL_) test("logins app database access over the wire", { skip }, () => {});

// No database needed — kept here because db.ts imports pg, which the zero-install guard cannot load.

test("failure: a refused connect's empty AggregateError names its inner errors", () => {
  const e = Object.assign(new AggregateError([new Error("connect ECONNREFUSED ::1:5433"), new Error("connect ECONNREFUSED 127.0.0.1:5433")], ""), { code: "ECONNREFUSED" });
  const f = failure(e);
  assert.ok(f instanceof LoginsDbError);
  assert.equal(f.message, "connect ECONNREFUSED ::1:5433; connect ECONNREFUSED 127.0.0.1:5433");
});

test("failure: never an empty message", () => {
  assert.equal(failure(Object.assign(new AggregateError([], ""), { code: "ECONNRESET" })).message, "ECONNRESET");
  assert.equal(failure(new Error("")).message, "Lost the connection to the database.");
});

const PORT = 25080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "correct horse battery staple!";
const RUN = `la-${Date.now().toString(36)}`;
const email = (who: string) => `${who}-${RUN}@logins-app.test`;

let pool: Pool;
let db: LoginsDb;
let gateway: ChildProcess;
let crewId = "", orgId = "", regionNodeId = "", locationId = "", firmId = "";
let dispatcherId = "", customerId = "", subId = "";
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
const as = (who: string, surfaceId: SurfaceId, password = PASSWORD) =>
  connectShell({ surfaceId, baseUrl: BASE, fetch, credentials: { email: email(who), password } });
const refused = (e: unknown) => e instanceof GatewayRefusal;
const revoked = (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "token";
const live = (s: ConnectedShell) => s.gateway.me();

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-logins-app-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  crewId = (await admin(
    `INSERT INTO crews (org_id, region_id, label, employment_type, home_region_id) VALUES ('00000000-0000-0000-0000-000000000003',$1,$2,'employed',$1) RETURNING id`,
    [REGION_SOUTH, `Crew ${RUN}`]))[0].id;
  orgId = (await admin(`INSERT INTO organizations (name, kind, segment) VALUES ($1,'customer','commercial') RETURNING id`, [`Customer ${RUN}`]))[0].id;
  regionNodeId = (await admin(`INSERT INTO accounts (org_id, region_id, tier, name) VALUES ($1,$2,'region',$3) RETURNING id`, [orgId, REGION_SOUTH, `Customer ${RUN} / South`]))[0].id;
  locationId = (await admin(`INSERT INTO accounts (org_id, region_id, parent_id, tier, name) VALUES ($1,$2,$3,'location',$4) RETURNING id`, [orgId, REGION_SOUTH, regionNodeId, `Customer ${RUN} / Store 1`]))[0].id;
  firmId = (await admin(`INSERT INTO organizations (name, kind) VALUES ($1,'subcontractor') RETURNING id`, [`Firm ${RUN}`]))[0].id;
  await admin(
    `INSERT INTO subcontractor_firms (id, org_id, region_id, legal_name, status, settlement_terms_days, diagnostic_data_rights_reserved) VALUES ($1,$1,$2,$3,'active',30,true)`,
    [firmId, REGION_SOUTH, `Firm ${RUN} LLC`]);

  db = await openDb(URL_);

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
  await db?.close();
  await pool?.end();
});

test("openDb surfaces a bad connection as LoginsDbError", { skip }, async () => {
  await assert.rejects(openDb("postgres://nobody:x@127.0.0.1:1/none"), (e: unknown) => e instanceof LoginsDbError);
});

test("the pickers see what the unbound role cannot", { skip }, async () => {
  assert.ok((await db.listCompanies({ includeInactive: false })).some((c) => c.id === crewId && c.label === `Crew ${RUN}` && c.homeRegionId === REGION_SOUTH));
  assert.ok((await db.listFirms()).some((f) => f.id === firmId && f.legalName === `Firm ${RUN} LLC`));
  const tree = await db.listAccountTree(orgId);
  assert.ok(tree.some((n) => n.id === regionNodeId && n.tier === "region" && n.parentId === null));
  assert.ok(tree.some((n) => n.id === locationId && n.tier === "location" && n.parentId === regionNodeId));
  assert.ok((await db.listCustomerOrgs()).some((o) => o.id === orgId && o.segment === "commercial"), "each customer carries its segment, for the Customer type choice");
  const regions = await db.listRegions();
  assert.ok(regions.some((r) => r.id === REGION_SOUTH));
  assert.ok(!regions.some((r) => r.id === UNASSIGNED_REGION_ID));
});

test("0027: the role reads no password hash, session row, price or audit trail — from a laptop", { skip }, async () => {
  for (const sql of [
    "SELECT password_hash FROM users LIMIT 1",
    "SELECT expires_at FROM sessions LIMIT 1",
    "SELECT 1 FROM rate_cards LIMIT 1",
    "SELECT 1 FROM settlements LIMIT 1",
    "SELECT 1 FROM audit_log LIMIT 1",
  ]) {
    await assert.rejects(admin(`SET ROLE ac_logins; ${sql}`), /permission denied/, sql);
    await admin("RESET ROLE");
  }
});

test("add one of each kind, and each signs in where kindsOf says", { skip }, async () => {
  dispatcherId = (await db.addLogin({ kind: "internal", email: email("dispatcher"), displayName: "Dee Dispatcher", password: PASSWORD, roles: ["dispatcher"], scope: "region", regionId: REGION_SOUTH })).id;
  customerId = (await db.addLogin({ kind: "customer", email: email("customer"), displayName: "Cass Customer", password: PASSWORD, orgId, tier: "location", nodeId: locationId, regionId: REGION_SOUTH })).id;
  subId = (await db.addLogin({ kind: "subcontractor", email: email("sub"), displayName: "Sam Sub", password: PASSWORD, firmId, regionId: REGION_SOUTH })).id;
  for (const [who, surface] of [["dispatcher", "S3"], ["customer", "S6"], ["sub", "S8"]] as const) {
    await (await as(who, surface)).logout();
  }
  const users = await db.listUsers({ includeInactive: false });
  const get = (id: string) => users.find((u) => u.id === id)!;
  assert.deepEqual(kindsOf(get(dispatcherId)), ["S3"]);
  assert.deepEqual(kindsOf(get(customerId)), ["S6"]);
  assert.deepEqual(kindsOf(get(subId)), ["S8"]);
  assert.equal(get(dispatcherId).scopeName, null, "a region-scoped internal login names no account node");
  assert.equal(get(customerId).scopeName, `Customer ${RUN} / Store 1`);
  assert.equal(get(customerId).orgName, `Customer ${RUN}`);
  assert.equal(get(subId).firmName, `Firm ${RUN} LLC`);
  assert.equal(get(dispatcherId).regionCode, "SOUTH");
});

test("addLogin refuses an existing email", { skip }, async () => {
  await assert.rejects(
    db.addLogin({ kind: "internal", email: email("dispatcher"), displayName: "Again", password: PASSWORD, roles: ["dispatcher"], scope: "region", regionId: REGION_SOUTH }),
    (e: unknown) => e instanceof LoginInputError && e.message === "A login with that email already exists",
  );
  assert.equal((await admin(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email("dispatcher")]))[0].n, 1);
});

test("editLogin revokes only on an access change", { skip }, async () => {
  const s = await as("dispatcher", "S3");
  assert.deepEqual(await db.editLogin(dispatcherId, { displayName: "New" }), { revokedSessions: 0 });
  await live(s);
  assert.equal((await admin(`SELECT display_name FROM users WHERE id = $1`, [dispatcherId]))[0].display_name, "New");
  const r = await db.editLogin(dispatcherId, { displayName: "New", roles: ["dispatcher", "foreman"] });
  assert.ok(r.revokedSessions >= 1);
  await assert.rejects(live(s), revoked);
});

test("editLogin makes addLogin's checks: roles of the login's own kind, a scope it can hold — and writes nothing when refused", { skip }, async () => {
  const input = (msg: RegExp) => (e: unknown) => e instanceof LoginInputError && msg.test(e.message);
  const roles = async (id: string) => (await admin(`SELECT roles FROM users WHERE id = $1`, [id]))[0].roles;
  const before = { d: await roles(dispatcherId), c: await roles(customerId), s: await roles(subId) };
  await assert.rejects(db.editLogin(dispatcherId, { displayName: "New", roles: [] }), input(/at least one role/));
  await assert.rejects(db.editLogin(dispatcherId, { displayName: "New", roles: ["payer"] }), input(/not a staff role/));
  await assert.rejects(db.editLogin(customerId, { displayName: "C", roles: ["principal"] }), input(/only pay or request/));
  await assert.rejects(db.editLogin(customerId, { displayName: "C", roles: [] }), input(/tick at least one/));
  await assert.rejects(db.editLogin(subId, { displayName: "S", roles: ["dispatcher"] }), input(/no roles/));
  // A staff scope whose node is not the org or its own region; a region that is not one; a firm login's scope at all.
  await assert.rejects(db.editLogin(dispatcherId, { displayName: "New", scope: { tier: "region", scopeId: REGION_WEST, regionId: REGION_SOUTH } }), input(/whole company or one region/));
  await assert.rejects(db.editLogin(dispatcherId, { displayName: "New", scope: { tier: "parent", scopeId: orgId, regionId: REGION_SOUTH } }), input(/whole company or one region/));
  await assert.rejects(db.editLogin(dispatcherId, { displayName: "New", scope: { tier: "region", scopeId: UNASSIGNED_REGION_ID, regionId: UNASSIGNED_REGION_ID } }), input(/not available/));
  await assert.rejects(db.editLogin(subId, { displayName: "S", scope: { tier: "parent", scopeId: REGION_SOUTH, regionId: REGION_SOUTH } }), input(/follows its company/));
  await assert.rejects(db.editLogin(dispatcherId, { displayName: "New", ownUnit: true }), input(/Only a technician has a service unit/));
  assert.deepEqual({ d: await roles(dispatcherId), c: await roles(customerId), s: await roles(subId) }, before);
});

test("remove ends an open session over the wire", { skip }, async () => {
  const s = await as("customer", "S6");
  assert.deepEqual(await db.deactivate(customerId), { revokedSessions: 1 });
  await assert.rejects(live(s), revoked);
  await assert.rejects(as("customer", "S6"), (e: unknown) => refused(e));
  assert.ok(!(await db.listUsers({ includeInactive: false })).some((u) => u.id === customerId));
  assert.equal((await db.listUsers({ includeInactive: true })).find((u) => u.id === customerId)?.active, false);
  await db.reactivate(customerId);
  await (await as("customer", "S6")).logout();
});

test("reset password", { skip }, async () => {
  await assert.rejects(db.resetPassword(subId, "sh!rt"), /at least 6/);
  await assert.rejects(db.resetPassword(subId, "longenough"), /special character/);
  const s = await as("sub", "S8");
  const next = "ab-cd1"; // the shortest the rule allows, and the gateway signs it in
  const r = await db.resetPassword(subId, next);
  assert.ok(r.revokedSessions >= 1);
  await assert.rejects(live(s), revoked);
  await assert.rejects(as("sub", "S8"), (e: unknown) => refused(e));
  await (await as("sub", "S8", next)).logout();
});

test("remove ends a technician's device session", { skip }, async () => {
  const techId = (await db.addLogin({ kind: "technician", email: email("tech"), displayName: "Tia Tech", password: PASSWORD, employer: { type: "ours", regionId: REGION_SOUTH } })).id;
  const unit = await unitOf(techId);
  const device = (await admin(
    `INSERT INTO devices (org_id, region_id, hardware_id, kind, public_key) VALUES ('00000000-0000-0000-0000-000000000003',$1,$2,'android_pilot',$3) RETURNING id`,
    [REGION_SOUTH, `hw-${RUN}`, Buffer.from("k")]))[0].id;
  const grant = (await admin(
    `INSERT INTO device_grants (org_id, region_id, device_id, crew_id, technician_id, service_window, granted_by)
     VALUES ('00000000-0000-0000-0000-000000000003',$1,$2,$3,$4, tstzrange(now() - interval '1 hour', now() + interval '8 hours'), $4) RETURNING id`,
    [REGION_SOUTH, device, unit, techId]))[0].id;
  const session = (await admin(
    `INSERT INTO sessions (org_id, region_id, principal_kind, principal_id, expires_at, surface_id)
     VALUES ('00000000-0000-0000-0000-000000000003',$1,'device_grant',$2, now() + interval '8 hours','S5') RETURNING id`,
    [REGION_SOUTH, grant]))[0].id;
  const r = await db.deactivate(techId);
  assert.ok(r.revokedSessions >= 1);
  assert.notEqual((await admin(`SELECT revoked_at FROM sessions WHERE id = $1`, [session]))[0].revoked_at, null);
  assert.equal((await crewRows(unit))[0].active, false, "their unit leaves with them");
});

test("addLogin refuses a customer scoped to another customer's node", { skip }, async () => {
  const otherOrg = (await admin(`INSERT INTO organizations (name, kind, segment) VALUES ($1,'customer','commercial') RETURNING id`, [`Other ${RUN}`]))[0].id;
  await assert.rejects(
    db.addLogin({ kind: "customer", email: email("cross"), displayName: "Cross", password: PASSWORD, orgId: otherOrg, tier: "location", nodeId: locationId, regionId: REGION_SOUTH }),
    (e: unknown) => e instanceof LoginInputError && e.message === "That site or location doesn't belong to the chosen customer",
  );
  assert.equal((await admin(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email("cross")]))[0].n, 0);
});

test("a write to a login that does not exist says so", { skip }, async () => {
  await assert.rejects(db.deactivate(crypto.randomUUID()), (e: unknown) => e instanceof LoginInputError && e.message === "That login no longer exists");
});

const INTERNAL = "00000000-0000-0000-0000-000000000003";
const crewRows = (id: string) => admin(`SELECT org_id, region_id, home_region_id, label, employment_type, firm_id, active, kind FROM crews WHERE id = $1`, [id]);
const tech = (who: string, employer: Employer = { type: "ours", regionId: REGION_SOUTH }) =>
  db.addLogin({ kind: "technician", email: email(who), displayName: `${who} ${RUN}`, password: PASSWORD, employer });
const unitOf = async (userId: string): Promise<string> => (await admin(`SELECT crew_id FROM users WHERE id = $1`, [userId]))[0].crew_id;
/** A technician placed on a shared or install crew before 0024, written the way the app wrote them then. */
const legacy = async (who: string, crew: string): Promise<{ id: string }> => (await admin(
  `INSERT INTO users (org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, crew_id, password_hash)
   VALUES ($1,$2,'internal',$3,$4,'["technician"]'::jsonb,'region',$2,$5,$6) RETURNING id`,
  [INTERNAL, REGION_SOUTH, email(who), who, crew, hashPassword(PASSWORD)]))[0];
const refusedWith = (re: RegExp) => (e: unknown) => e instanceof LoginInputError && re.test(e.message);
const newFirm = (name: string) => ({ legalName: name, regionId: REGION_SOUTH, paymentTermsDays: 30, dataRightsReserved: false, msaSignedAt: null });

test("addCompany makes an install crew; a technician login makes their own service unit (0024)", { skip }, async () => {
  const made = await db.addCompany({ type: "ours", name: `Ours ${RUN}`, regionId: REGION_SOUTH });
  assert.equal(made.firmId, null);
  assert.deepEqual((await crewRows(made.id))[0], { org_id: INTERNAL, region_id: REGION_SOUTH, home_region_id: REGION_SOUTH, label: `Ours ${RUN}`, employment_type: "employed", firm_id: null, active: true, kind: "install" });
  const t = await tech("ours-tech");
  const unit = await unitOf(t.id);
  assert.deepEqual((await crewRows(unit))[0], { org_id: INTERNAL, region_id: REGION_SOUTH, home_region_id: REGION_SOUTH, label: `ours-tech ${RUN}`, employment_type: "employed", firm_id: null, active: true, kind: "service" });
  const listed = (await db.listUsers({ includeInactive: false })).find((u) => u.id === t.id)!;
  assert.deepEqual([listed.crewKind, listed.crewEmployment, listed.ownUnit], ["service", "employed", true]);
  assert.deepEqual(kindsOf(listed), ["S5"]);
  assert.equal((await db.listCompanies({ includeInactive: false })).find((c) => c.id === unit)?.technicians, 1);
  // Two people can share a name; each still gets a unit of their own.
  const twin = await db.addLogin({ kind: "technician", email: email("ours-tech-twin"), displayName: `ours-tech ${RUN}`, password: PASSWORD, employer: { type: "ours", regionId: REGION_SOUTH } });
  assert.notEqual(await unitOf(twin.id), unit);
});

test("a contractor's technician gets a unit under the firm; a bad employer, region or email writes nothing", { skip }, async () => {
  const t = await tech("firm-tech", { type: "contractor", firmId });
  assert.deepEqual((await crewRows(await unitOf(t.id)))[0], { org_id: firmId, region_id: REGION_SOUTH, home_region_id: REGION_SOUTH, label: `firm-tech ${RUN}`, employment_type: "subcontracted", firm_id: firmId, active: true, kind: "service" });
  assert.equal((await db.listUsers({ includeInactive: false })).find((u) => u.id === t.id)?.crewFirmName, `Firm ${RUN} LLC`);
  const units = async (who: string) => (await admin(`SELECT count(*)::int AS n FROM crews WHERE label = $1`, [`${who} ${RUN}`]))[0].n;
  await assert.rejects(tech("no-region", { type: "ours", regionId: UNASSIGNED_REGION_ID }), refusedWith(/That region is not available/));
  await assert.rejects(tech("no-firm", { type: "contractor", firmId: randomUUID() }), refusedWith(/That firm no longer exists/));
  for (const employer of [undefined, null, { type: "ours-ish" }]) {
    await assert.rejects(db.addLogin({ kind: "technician", email: email("no-employer"), displayName: `no-employer ${RUN}`, password: PASSWORD, employer: employer as never }), refusedWith(/Choose who employs the technician/));
  }
  await assert.rejects(tech("firm-tech"), refusedWith(/already exists/)); // the same email again: its new unit rolls back with it
  assert.deepEqual([await units("no-region"), await units("no-firm"), await units("no-employer"), await units("firm-tech")], [0, 0, 0, 1]);
  await admin(`UPDATE subcontractor_firms SET status = 'terminated' WHERE id = $1`, [firmId]);
  try {
    await assert.rejects(tech("late-firm-tech", { type: "contractor", firmId }), refusedWith(/terminated/));
  } finally {
    await admin(`UPDATE subcontractor_firms SET status = 'active' WHERE id = $1`, [firmId]);
  }
});

test("addCompany refuses a region that is not available", { skip }, async () => {
  await assert.rejects(db.addCompany({ type: "ours", name: `Nowhere ${RUN}`, regionId: UNASSIGNED_REGION_ID }), refusedWith(/That region is not available/));
  await assert.rejects(db.addCompany({ type: "contractor", name: `Nowhere ${RUN}`, firm: { ...newFirm(`Nowhere Firm ${RUN}`), regionId: UNASSIGNED_REGION_ID } }), refusedWith(/That region is not available/));
  assert.equal((await admin(`SELECT count(*)::int AS n FROM organizations WHERE name = $1`, [`Nowhere Firm ${RUN}`]))[0].n, 0);
});

let contractorId = "", contractorFirmId = "";
test("addCompany contractor with a new firm", { skip }, async () => {
  const made = await db.addCompany({ type: "contractor", name: `Contractor ${RUN}`, firm: { ...newFirm(`Contractor Firm ${RUN} LLC`), msaSignedAt: "2026-03-01" } });
  contractorId = made.id; contractorFirmId = made.firmId!;
  assert.ok(contractorFirmId);
  assert.deepEqual((await admin(`SELECT name, kind FROM organizations WHERE id = $1`, [contractorFirmId]))[0], { name: `Contractor Firm ${RUN} LLC`, kind: "subcontractor" });
  const f = (await admin(`SELECT org_id, region_id, legal_name, status, settlement_terms_days, to_char(msa_signed_at,'YYYY-MM-DD') AS msa, diagnostic_data_rights_reserved FROM subcontractor_firms WHERE id = $1`, [contractorFirmId]))[0];
  assert.deepEqual(f, { org_id: contractorFirmId, region_id: REGION_SOUTH, legal_name: `Contractor Firm ${RUN} LLC`, status: "onboarding", settlement_terms_days: 30, msa: "2026-03-01", diagnostic_data_rights_reserved: false });
  assert.deepEqual((await crewRows(contractorId))[0], { org_id: contractorFirmId, region_id: REGION_SOUTH, home_region_id: REGION_SOUTH, label: `Contractor ${RUN}`, employment_type: "subcontracted", firm_id: contractorFirmId, active: true, kind: "install" });
  const row = (await db.listCompanies({ includeInactive: false })).find((c) => c.id === contractorId)!;
  assert.equal(row.firmName, `Contractor Firm ${RUN} LLC`);
  assert.equal(row.firmStatus, "onboarding");
  assert.equal(row.technicians, 0);
  assert.equal(row.regionCode, "SOUTH");
  assert.match(row.documents, /^Missing:/);
  assert.ok((await db.listFirms()).some((x) => x.id === contractorFirmId && x.status === "onboarding"));
});

test("addCompany under an existing firm; refused once the firm is terminated", { skip }, async () => {
  const second = await db.addCompany({ type: "contractor", name: `Contractor Two ${RUN}`, firm: { existing: contractorFirmId } });
  assert.equal(second.firmId, contractorFirmId);
  assert.equal((await crewRows(second.id))[0].org_id, contractorFirmId);
  await admin(`UPDATE subcontractor_firms SET status = 'terminated' WHERE id = $1`, [contractorFirmId]);
  try {
    await assert.rejects(db.addCompany({ type: "contractor", name: `Contractor Three ${RUN}`, firm: { existing: contractorFirmId } }), refusedWith(/terminated/));
    assert.ok(!(await db.listFirms()).some((x) => x.id === contractorFirmId), "a terminated firm is not offered");
    await db.removeCompany(second.id);
    await assert.rejects(db.reactivateCompany(second.id), refusedWith(/terminated/));
  } finally {
    await admin(`UPDATE subcontractor_firms SET status = 'active' WHERE id = $1`, [contractorFirmId]);
  }
  await db.reactivateCompany(second.id);
  assert.equal((await crewRows(second.id))[0].active, true);
});

test("addCompany refuses a duplicate name, and writes nothing", { skip }, async () => {
  await db.addCompany({ type: "ours", name: `AC Services DFW ${RUN}`, regionId: REGION_SOUTH });
  await assert.rejects(db.addCompany({ type: "ours", name: ` ac  services dfw ${RUN} `, regionId: REGION_SOUTH }), refusedWith(/An install crew named .* already exists/));
  await assert.rejects(db.addCompany({ type: "contractor", name: `Dup Firm Co ${RUN}`, firm: newFirm(`  contractor FIRM ${RUN}  llc `) }), refusedWith(/A firm named .* already exists/));
  assert.equal((await admin(`SELECT count(*)::int AS n FROM crews WHERE lower(label) LIKE $1`, [`%ac%services%dfw ${RUN}%`]))[0].n, 1);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM crews WHERE label = $1`, [`Dup Firm Co ${RUN}`]))[0].n, 0);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM subcontractor_firms WHERE lower(legal_name) LIKE $1`, [`%contractor firm ${RUN}%`]))[0].n, 1);
});

test("removeCompany: a unit goes with its technician's login; a shared crew waits for its technicians to move", { skip }, async () => {
  const t = await tech("unit-owner");
  const unit = await unitOf(t.id);
  await assert.rejects(db.removeCompany(unit), refusedWith(/own service unit — remove their login and the unit goes with it/));
  await db.deactivate(t.id);
  assert.equal((await db.listCompanies({ includeInactive: true })).find((x) => x.id === unit)?.active, false);
  const c = await db.addCompany({ type: "ours", name: `Removable ${RUN}`, regionId: REGION_SOUTH });
  const old = await legacy("removable-tech", c.id);
  await assert.rejects(db.removeCompany(c.id), refusedWith(/Give its 1 technician their own service units first/));
  await db.deactivate(old.id);
  assert.equal((await crewRows(c.id))[0].active, true, "an install crew does not leave with one of its people");
  await db.removeCompany(c.id);
  assert.ok(!(await db.listCompanies({ includeInactive: false })).some((x) => x.id === c.id));
  await assert.rejects(db.removeCompany(randomUUID()), refusedWith(/That company no longer exists/));
});

test("removeCompany refuses live assignments", { skip }, async () => {
  const c = await db.addCompany({ type: "ours", name: `Busy ${RUN}`, regionId: REGION_SOUTH });
  const client = await pool.connect();
  try {
    await client.query(`SET session_replication_role = replica`); // the assignment gate trigger wants a real clearance; this test is about the count. Triggers off, so the job's number (0030) is written by hand
    const job = (await client.query(`INSERT INTO jobs (org_id, region_id, site_id, service_code, service_window, job_no) VALUES ($1,$2,$3,'HVAC-REPAIR','[2030-01-01 09:00Z,2030-01-01 13:00Z)',$4) RETURNING id`, [orgId, REGION_SOUTH, locationId, `FIXTURE-${RUN}`])).rows[0].id;
    const clearance = (await client.query(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by) VALUES ($1,$2,$3,'[2030-01-01 09:00Z,2030-01-01 13:00Z)','[]'::jsonb,now(),$4) RETURNING id`, [orgId, REGION_SOUTH, c.id, dispatcherId])).rows[0].id;
    // The job's org, as dispatch.assign writes it: 0028's gate refuses an assignment whose org is not its job's.
    await client.query(`INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by) VALUES ($1,$2,$3,$4,$5,$6)`, [orgId, REGION_SOUTH, job, c.id, clearance, dispatcherId]);
    // A technician's own unit holding work: their login can go, but the unit stays on the board until Dispatch releases it.
    const t = await tech("busy-tech");
    const unit = await unitOf(t.id);
    const job2 = (await client.query(`INSERT INTO jobs (org_id, region_id, site_id, service_code, service_window, job_no) VALUES ($1,$2,$3,'HVAC-REPAIR','[2030-01-02 09:00Z,2030-01-02 13:00Z)',$4) RETURNING id`, [orgId, REGION_SOUTH, locationId, `FIXTURE-2-${RUN}`])).rows[0].id;
    const clearance2 = (await client.query(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by) VALUES ($1,$2,$3,'[2030-01-02 09:00Z,2030-01-02 13:00Z)','[]'::jsonb,now(),$4) RETURNING id`, [orgId, REGION_SOUTH, unit, dispatcherId])).rows[0].id;
    await client.query(`INSERT INTO assignments (org_id, region_id, job_id, crew_id, clearance_id, assigned_by) VALUES ($1,$2,$3,$4,$5,$6)`, [orgId, REGION_SOUTH, job2, unit, clearance2, dispatcherId]);
    await db.deactivate(t.id);
    assert.equal((await crewRows(unit))[0].active, true);
  } finally { await client.query(`SET session_replication_role = DEFAULT`); client.release(); }
  await assert.rejects(db.removeCompany(c.id), refusedWith(/It has 1 job assigned — release them in Dispatch first/));
  await admin(`UPDATE assignments SET released_at = now() WHERE crew_id = $1`, [c.id]);
  await db.removeCompany(c.id);
});

test("reactivating a technician brings their unit back — not under a terminated firm, nor onto a removed crew", { skip }, async () => {
  const t = await tech("sleeper");
  const unit = await unitOf(t.id);
  await db.deactivate(t.id);
  assert.equal((await crewRows(unit))[0].active, false);
  await db.reactivate(t.id);
  assert.equal((await crewRows(unit))[0].active, true);
  assert.equal((await admin(`SELECT active FROM users WHERE id = $1`, [t.id]))[0].active, true);

  const ft = await tech("firm-sleeper", { type: "contractor", firmId });
  await db.deactivate(ft.id);
  await admin(`UPDATE subcontractor_firms SET status = 'terminated' WHERE id = $1`, [firmId]);
  try {
    await assert.rejects(db.reactivate(ft.id), refusedWith(/terminated/));
    assert.equal((await admin(`SELECT active FROM users WHERE id = $1`, [ft.id]))[0].active, false);
  } finally {
    await admin(`UPDATE subcontractor_firms SET status = 'active' WHERE id = $1`, [firmId]);
  }

  const gone = await db.addCompany({ type: "ours", name: `Gone ${RUN}`, regionId: REGION_SOUTH });
  const old = await legacy("old-sleeper", gone.id);
  const resident = await legacy("resident", gone.id);
  await db.deactivate(old.id);
  await db.deactivate(resident.id);
  await db.removeCompany(gone.id);
  await assert.rejects(db.reactivate(old.id), refusedWith(new RegExp(`Gone ${RUN} has been removed`)));
  // A cosmetic edit on a technician still pointing at the removed crew is not a placement.
  await admin(`UPDATE users SET active = true WHERE id = $1`, [resident.id]);
  assert.deepEqual(await db.editLogin(resident.id, { displayName: "Renamed" }), { revokedSessions: 0 });
});

test("reactivateCompany works", { skip }, async () => {
  const c = await db.addCompany({ type: "ours", name: `Back ${RUN}`, regionId: REGION_SOUTH });
  await db.removeCompany(c.id);
  await db.reactivateCompany(c.id);
  assert.ok((await db.listCompanies({ includeInactive: false })).some((x) => x.id === c.id));
  await assert.rejects(db.reactivateCompany(randomUUID()), refusedWith(/That company no longer exists/));
  const t = await tech("unit-back");
  const unit = await unitOf(t.id);
  await db.deactivate(t.id);
  await assert.rejects(db.reactivateCompany(unit), refusedWith(/comes back with its technician — reactivate their login/));
});

test("reactivateCompany refuses a label an active company now holds", { skip }, async () => {
  const a = await db.addCompany({ type: "ours", name: `Twin ${RUN}`, regionId: REGION_SOUTH });
  await db.removeCompany(a.id);
  await db.addCompany({ type: "ours", name: ` twin  ${RUN}`, regionId: REGION_SOUTH });
  await assert.rejects(db.reactivateCompany(a.id), refusedWith(/An install crew named .* already exists/));
  assert.equal((await crewRows(a.id))[0].active, false);
});

test("every write emits its event in the same transaction, so open pages refetch", { skip }, async () => {
  const events = async (entityId: string) => (await admin(
    `SELECT o.topic, o.entity, o.org_id, o.region_id, o.actor_id, o.surface_id, a.action
       FROM outbox o JOIN audit_log a ON a.event_id = o.event_id
      WHERE o.entity_id = $1 ORDER BY o.occurred_at, o.created_at`, [entityId]));
  const ACTOR = LOGINS_APP_ACTOR;

  const c = await db.addCompany({ type: "contractor", name: `Evented ${RUN}`, firm: newFirm(`Evented Firm ${RUN} LLC`) });
  assert.deepEqual(await events(c.firmId!), [{ topic: "firm.created", entity: "firm", org_id: c.firmId, region_id: REGION_SOUTH, actor_id: ACTOR, surface_id: "logins-app", action: "firm.create" }]);
  await db.removeCompany(c.id);
  await db.reactivateCompany(c.id);
  assert.deepEqual((await events(c.id)).map((e) => [e.topic, e.action, e.org_id]),
    [["crew.created", "crew.create", c.firmId], ["crew.updated", "crew.retire", c.firmId], ["crew.updated", "crew.reactivate", c.firmId]]);

  const u = await db.addLogin({ kind: "internal", email: email("evented"), displayName: "Evented", password: PASSWORD, roles: ["dispatcher"], scope: "region", regionId: REGION_SOUTH });
  await db.editLogin(u.id, { displayName: "Evented Again" });
  await db.deactivate(u.id);
  await db.reactivate(u.id);
  await db.resetPassword(u.id, `${PASSWORD} two`);
  assert.deepEqual((await events(u.id)).map((e) => [e.topic, e.action, e.region_id]),
    [["user.created", "user.create", REGION_SOUTH], ["user.updated", "user.edit", REGION_SOUTH], ["user.updated", "user.deactivate", REGION_SOUTH], ["user.updated", "user.reactivate", REGION_SOUTH]]);

  // A refused write rolls its event back with it.
  const before = (await admin(`SELECT count(*)::int AS n FROM outbox WHERE actor_id = $1`, [ACTOR]))[0].n;
  await assert.rejects(db.addCompany({ type: "ours", name: `Evented ${RUN}`, regionId: REGION_SOUTH }), refusedWith(/already exists/));
  assert.equal((await admin(`SELECT count(*)::int AS n FROM outbox WHERE actor_id = $1`, [ACTOR]))[0].n, before);
});

test("addCompany rejects (not throws) on an empty name", { skip }, async () => {
  await assert.rejects(db.addCompany({ type: "ours", name: "", regionId: REGION_SOUTH }), refusedWith(/name/));
});

test("Move to their own service unit: off a shared or install crew, same employer, sessions ended", { skip }, async () => {
  const from = await db.addCompany({ type: "ours", name: `Move From ${RUN}`, regionId: REGION_SOUTH });
  const t = await legacy("move-tech", from.id);
  assert.equal((await db.listUsers({ includeInactive: false })).find((u) => u.id === t.id)?.ownUnit, false);
  const device = (await admin(
    `INSERT INTO devices (org_id, region_id, hardware_id, kind, public_key) VALUES ($1,$2,$3,'android_pilot',$4) RETURNING id`,
    [INTERNAL, REGION_SOUTH, `hw-move-${RUN}`, Buffer.from("k")]))[0].id;
  const grant = (await admin(
    `INSERT INTO device_grants (org_id, region_id, device_id, crew_id, technician_id, service_window, granted_by)
     VALUES ($1,$2,$3,$4,$5, tstzrange(now() - interval '1 hour', now() + interval '8 hours'), $5) RETURNING id`,
    [INTERNAL, REGION_SOUTH, device, from.id, t.id]))[0].id;
  const session = (await admin(
    `INSERT INTO sessions (org_id, region_id, principal_kind, principal_id, expires_at, surface_id) VALUES ($1,$2,'device_grant',$3, now() + interval '8 hours','S5') RETURNING id`,
    [INTERNAL, REGION_SOUTH, grant]))[0].id;
  const r = await db.editLogin(t.id, { displayName: "Mo Mover", ownUnit: true });
  assert.ok(r.revokedSessions >= 1);
  assert.notEqual((await admin(`SELECT revoked_at FROM sessions WHERE id = $1`, [session]))[0].revoked_at, null);
  const unit = await unitOf(t.id);
  assert.notEqual(unit, from.id);
  assert.deepEqual((await crewRows(unit))[0], { org_id: INTERNAL, region_id: REGION_SOUTH, home_region_id: REGION_SOUTH, label: "Mo Mover", employment_type: "employed", firm_id: null, active: true, kind: "service" });
  assert.equal((await db.listUsers({ includeInactive: false })).find((u) => u.id === t.id)?.ownUnit, true);
  await assert.rejects(db.editLogin(t.id, { displayName: "Mo Mover", ownUnit: true }), refusedWith(/already has their own service unit/));

  // A contractor's crew: the new unit stays under the same firm.
  const shared = await db.addCompany({ type: "contractor", name: `Shared Firm Crew ${RUN}`, firm: { existing: firmId } });
  const a = await legacy("shared-a", shared.id);
  await legacy("shared-b", shared.id);
  await db.editLogin(a.id, { displayName: "shared-a", ownUnit: true });
  const row = (await crewRows(await unitOf(a.id)))[0];
  assert.deepEqual([row.employment_type, row.firm_id, row.org_id, row.kind], ["subcontracted", firmId, firmId, "service"]);
});

test("a contractor technician signs in on S5", { skip }, async () => {
  const t = await tech("contractor-tech", { type: "contractor", firmId });
  const unit = await unitOf(t.id);
  const ownerId = await db.addLogin({ kind: "internal", email: email("owner"), displayName: "Olly Owner", password: PASSWORD, roles: ["account_owner"], scope: "org", regionId: REGION_SOUTH });
  assert.ok(ownerId.id);
  const s2 = await as("owner", "S2");
  const hardwareId = `hw-contractor-${RUN}`;
  const deviceId = (await s2.gateway.registerDevice({ hardwareId, kind: "android_pilot", publicKey: Buffer.from("not-yet-checked").toString("base64"), regionId: REGION_SOUTH })).id;
  await s2.gateway.grantDeviceShift({ deviceId, crewId: unit, technicianId: t.id, windowStart: new Date(Date.now() - 3600_000).toISOString(), windowEnd: new Date(Date.now() + 8 * 3600_000).toISOString() });
  const s5 = await connectShell({ surfaceId: "S5", baseUrl: BASE, fetch, credentials: { hardwareId, email: email("contractor-tech"), password: PASSWORD } });
  assert.deepEqual(s5.deviceCrew, { id: unit, label: `contractor-tech ${RUN}` });
  await s5.logout();
  await s2.logout();
});

test("S2 grants a shift by the technician's unit alone, on a web fallback registered with no key", { skip }, async () => {
  const t = await tech("unit-only-tech", { type: "ours", regionId: REGION_SOUTH });
  const unit = await unitOf(t.id);
  const s2 = await as("owner", "S2");
  const hardwareId = `web-unit-${RUN}`;
  const deviceId = (await s2.gateway.registerDevice({ hardwareId, kind: "web_fallback", regionId: REGION_SOUTH })).id;
  await s2.gateway.grantDeviceShift({ deviceId, crewId: unit, windowStart: new Date(Date.now() - 60_000).toISOString(), windowEnd: new Date(Date.now() + 3600_000).toISOString() });
  const [g] = await admin(`SELECT technician_id FROM device_grants WHERE device_id = $1`, [deviceId]);
  assert.equal(g.technician_id, t.id, "the unit's one active login is the one granted");
  const s5 = await connectShell({ surfaceId: "S5", baseUrl: BASE, fetch, credentials: { hardwareId, email: email("unit-only-tech"), password: PASSWORD } });
  assert.equal(s5.deviceCrew?.id, unit);
  await s5.logout();
  await s2.logout();
});

test("grantShift: the logins app registers a web fallback and grants the shift in one write, and the technician signs in on S5", { skip }, async () => {
  const t = await tech("granted-tech", { type: "ours", regionId: REGION_SOUTH });
  const hardwareId = `web-la-${RUN}`;
  const window = { windowStart: new Date(Date.now() - 60_000).toISOString(), windowEnd: new Date(Date.now() + 3600_000).toISOString() };
  const out = await db.grantShift({ userId: t.id, device: { hardwareId, kind: "web_fallback" }, ...window });
  assert.ok((await db.listDevices()).some((d) => d.id === out.deviceId && d.hardwareId === hardwareId && d.kind === "web_fallback" && d.active));
  const audits = await admin(`SELECT action FROM audit_log WHERE entity_id IN ($1,$2) AND actor_id = $3 ORDER BY action`, [out.deviceId, out.grantId, LOGINS_APP_ACTOR]);
  assert.deepEqual(audits.map((a) => a.action), ["device.grant_shift", "device.register"]);

  const s5 = await connectShell({ surfaceId: "S5", baseUrl: BASE, fetch, credentials: { hardwareId, email: email("granted-tech"), password: PASSWORD } });
  assert.equal(s5.deviceCrew?.id, await unitOf(t.id));
  await s5.logout();

  // The gateway's own checks hold here too: an overlapping window is refused, and a taken device ID writes nothing.
  await assert.rejects(db.grantShift({ userId: t.id, device: { id: out.deviceId }, ...window }), /overlapping this window/);
  await assert.rejects(db.grantShift({ userId: t.id, device: { hardwareId, kind: "web_fallback" }, ...window }), /already registered/);
  await assert.rejects(db.grantShift({ userId: dispatcherId, device: { id: out.deviceId }, ...window }), /Only a technician/);
});

test("a dropped idle connection is swallowed, and the next query still works", { skip }, async () => {
  const p = createPool(URL_!, "ac-logins-app-idle-test");
  try {
    // createPool already listens (pg-tx.ts); the app's own handler is a second, harmless one.
    assert.equal(p.listenerCount("error"), 1);
    attachIdleErrorHandler(p);
    assert.equal(p.listenerCount("error"), 2);
    assert.doesNotThrow(() => p.emit("error", new Error("idle drop")));
  } finally { await p.end(); }
  await db.ping();
});
