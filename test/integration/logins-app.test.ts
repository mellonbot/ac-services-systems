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
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { GatewayRefusal, type SurfaceId } from "../../packages/contracts/src/index.ts";
import { UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { openDb, attachIdleErrorHandler, LoginsDbError, type LoginsDb } from "../../tools/logins-app/src/db.ts";
import { kindsOf } from "../../tools/logins-app/src/kinds.ts";
import { LoginInputError } from "../../tools/logins-app/src/rows.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — the logins app's database access was not verified over the wire";
if (!URL_) test("logins app database access over the wire", { skip }, () => {});

const PORT = 25080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "correct horse battery staple";
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
  orgId = (await admin(`INSERT INTO organizations (name, kind) VALUES ($1,'customer') RETURNING id`, [`Customer ${RUN}`]))[0].id;
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
  assert.ok((await db.listCrews()).some((c) => c.id === crewId && c.label === `Crew ${RUN}` && c.homeRegionId === REGION_SOUTH));
  assert.ok((await db.listFirms()).some((f) => f.id === firmId && f.legalName === `Firm ${RUN} LLC`));
  const tree = await db.listAccountTree(orgId);
  assert.ok(tree.some((n) => n.id === regionNodeId && n.tier === "region" && n.parentId === null));
  assert.ok(tree.some((n) => n.id === locationId && n.tier === "location" && n.parentId === regionNodeId));
  assert.ok((await db.listCustomerOrgs()).some((o) => o.id === orgId));
  const regions = await db.listRegions();
  assert.ok(regions.some((r) => r.id === REGION_SOUTH));
  assert.ok(!regions.some((r) => r.id === UNASSIGNED_REGION_ID));
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
  await assert.rejects(db.resetPassword(subId, "short"), /at least 12/);
  const s = await as("sub", "S8");
  const next = "a different long password";
  const r = await db.resetPassword(subId, next);
  assert.ok(r.revokedSessions >= 1);
  await assert.rejects(live(s), revoked);
  await assert.rejects(as("sub", "S8"), (e: unknown) => refused(e));
  await (await as("sub", "S8", next)).logout();
});

test("remove ends a technician's device session", { skip }, async () => {
  const techId = (await db.addLogin({ kind: "technician", email: email("tech"), displayName: "Tia Tech", password: PASSWORD, crewId, crewHomeRegionId: REGION_SOUTH })).id;
  const device = (await admin(
    `INSERT INTO devices (org_id, region_id, hardware_id, kind, public_key) VALUES ('00000000-0000-0000-0000-000000000003',$1,$2,'android_pilot',$3) RETURNING id`,
    [REGION_SOUTH, `hw-${RUN}`, Buffer.from("k")]))[0].id;
  const grant = (await admin(
    `INSERT INTO device_grants (org_id, region_id, device_id, crew_id, technician_id, service_window, granted_by)
     VALUES ('00000000-0000-0000-0000-000000000003',$1,$2,$3,$4, tstzrange(now() - interval '1 hour', now() + interval '8 hours'), $4) RETURNING id`,
    [REGION_SOUTH, device, crewId, techId]))[0].id;
  const session = (await admin(
    `INSERT INTO sessions (org_id, region_id, principal_kind, principal_id, expires_at, surface_id)
     VALUES ('00000000-0000-0000-0000-000000000003',$1,'device_grant',$2, now() + interval '8 hours','S5') RETURNING id`,
    [REGION_SOUTH, grant]))[0].id;
  const r = await db.deactivate(techId);
  assert.ok(r.revokedSessions >= 1);
  assert.notEqual((await admin(`SELECT revoked_at FROM sessions WHERE id = $1`, [session]))[0].revoked_at, null);
});

test("a dropped idle connection is swallowed, and the next query still works", { skip }, async () => {
  const p = createPool(URL_!, "ac-logins-app-idle-test");
  try {
    assert.equal(p.listenerCount("error"), 0);
    attachIdleErrorHandler(p);
    assert.equal(p.listenerCount("error"), 1);
    assert.doesNotThrow(() => p.emit("error", new Error("idle drop")));
  } finally { await p.end(); }
  await db.ping();
});
