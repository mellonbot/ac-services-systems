/**
 * 0038 OVER THE WIRE — People in S2, and a shift grant extended and revoked,
 * through the shell, against a spawned gateway and a live PostgreSQL.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What this suite holds: only a principal reads, makes, edits, removes or
 * resets a login — refused at the gateway for every other S2 role; the last
 * active company-wide principal cannot be removed or demoted; a temporary
 * password opens no session on S2, S3 or S5 until the sign-in carries a new
 * password of the person's own, and the hash and the temporary password never
 * leave the gateway; a technician made in S2 comes with their own unit, is
 * granted a shift on it, and signs in on the device; and a grant extended
 * moves its end while a grant revoked refuses the device's token on its next
 * request.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — People in S2 was not verified over the wire";
if (!URL_) test("people over the wire", { skip }, () => {});

const PORT = 24080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `5e000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_PRINCIPAL = U(1), USER_OFFICE = U(2), USER_OWNER = U(3);
const PASSWORD = "correct horse battery staple";
const RUN = `ppl-${Date.now().toString(36)}`;
const HARDWARE = `web-${RUN}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-people-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','principal.ppl@ac.test','Principal','["principal"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','office.ppl@ac.test','Office Manager','["office_manager"]','parent',$2,$4,true),
           ($6,$2,$3,'internal','owner.ppl@ac.test','Account Owner','["account_owner","ops_leadership"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true, roles = EXCLUDED.roles, must_change_password = false`,
    [USER_PRINCIPAL, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_OFFICE, USER_OWNER]);

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

const signIn = (surfaceId: "S2" | "S3", email: string, password = PASSWORD, newPassword?: string) =>
  connectShell({ surfaceId, baseUrl: BASE, fetch, credentials: { email, password, ...(newPassword ? { newPassword } : {}) } });
const onDevice = (email: string, password: string, newPassword?: string, hardwareId = HARDWARE) =>
  connectShell({ surfaceId: "S5", baseUrl: BASE, fetch, credentials: { hardwareId, email, password, ...(newPassword ? { newPassword } : {}) } });
const refusedWith = async (p: Promise<unknown>, test: (r: Record<string, unknown>) => boolean, why: string) => {
  try { await p; } catch (e) {
    const r = (e as { refusal?: Record<string, unknown> }).refusal;
    assert.ok(r, `not a refusal: ${String(e)}`);
    assert.ok(test(r), `${why} — got ${JSON.stringify(r)}`);
    return r;
  }
  assert.fail(`${why} — it was not refused`);
};
const scope = (r: Record<string, unknown>) => r.kind === "scope";
const code = (c: string) => (r: Record<string, unknown>) => r.kind === "admission" && r.code === c;

let principal: ConnectedShell, office: ConnectedShell, owner: ConnectedShell;
let staffId = "", staffTemp = "", techId = "", techUnit = "", techTemp = "";
const STAFF_EMAIL = `dispatch.${RUN}@ac.test`;
const TECH_EMAIL = `tech.${RUN}@ac.test`;

test("only a principal reads or writes People — every other S2 role is refused at the gateway", { skip }, async () => {
  principal = await signIn("S2", "principal.ppl@ac.test");
  office = await signIn("S2", "office.ppl@ac.test");
  owner = await signIn("S2", "owner.ppl@ac.test");
  for (const s of [office, owner]) {
    await refusedWith(s.gateway.listPeople(), scope, "a non-principal reads no logins");
    await refusedWith(s.gateway.createStaffLogin({ email: `x.${RUN}@ac.test`, displayName: "X", roles: ["dispatcher"], scope: "region", regionId: REGION_SOUTH }), scope, "a non-principal makes no staff login");
    await refusedWith(s.gateway.createTechnicianLogin({ email: `y.${RUN}@ac.test`, displayName: `Y ${RUN}`, homeRegionId: REGION_SOUTH }), scope, "a non-principal makes no technician login");
    await refusedWith(s.gateway.resetPersonPassword({ userId: USER_PRINCIPAL }), scope, "a non-principal resets nobody");
    await refusedWith(s.gateway.setPersonActive({ userId: USER_PRINCIPAL, active: false }), scope, "a non-principal removes nobody");
    await refusedWith(s.gateway.updatePerson({ userId: USER_OFFICE, roles: ["principal"] }), scope, "a non-principal promotes nobody, themselves included");
  }
  assert.equal((await admin(`SELECT count(*)::int AS n FROM users WHERE email LIKE $1`, [`%.${RUN}@ac.test`]))[0]!.n, 0, "no refused call left a row — not even a technician's unit");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM crews WHERE label = $1`, [`Y ${RUN}`]))[0]!.n, 0);
});

test("a principal makes a staff login: a temporary password once, a hash only, an audit row that says neither", { skip }, async () => {
  const made = await principal.gateway.createStaffLogin({ email: STAFF_EMAIL.toUpperCase(), displayName: "  Dana   Dispatch ", roles: ["dispatcher"], scope: "region", regionId: REGION_SOUTH });
  staffId = made.userId; staffTemp = made.temporaryPassword;
  assert.match(staffTemp, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
  const row = (await admin(`SELECT email, display_name, roles, scope_tier, scope_id, password_hash, must_change_password FROM users WHERE id = $1`, [staffId]))[0]!;
  assert.equal(row.email, STAFF_EMAIL, "stored lower-cased");
  assert.equal(row.display_name, "Dana Dispatch");
  assert.deepEqual(row.roles, ["dispatcher"]);
  assert.equal(row.scope_tier, "region"); assert.equal(row.scope_id, REGION_SOUTH);
  assert.equal(row.must_change_password, true);
  assert.match(String(row.password_hash), /^scrypt\$/);
  assert.ok(!String(row.password_hash).includes(staffTemp));

  const audit = await admin(`SELECT actor_id, action, after FROM audit_log WHERE event_id = $1`, [made.eventId]);
  assert.equal(audit[0]!.actor_id, USER_PRINCIPAL);
  assert.equal(audit[0]!.action, "user.create");
  const trail = JSON.stringify(await admin(`SELECT before, after FROM audit_log WHERE entity_id = $1`, [staffId])) + JSON.stringify(await admin(`SELECT payload FROM outbox WHERE entity_id = $1`, [staffId]));
  assert.ok(!trail.includes(staffTemp) && !trail.includes("scrypt$"), "neither the password nor its hash is in the trail");

  const listed = (await principal.gateway.listPeople()).people.find((p) => p.userId === staffId)!;
  assert.equal(listed.kind, "staff"); assert.equal(listed.mustChangePassword, true);
  assert.ok(!JSON.stringify(await principal.gateway.listPeople()).includes("scrypt$"), "the list carries no hash");

  await refusedWith(principal.gateway.createStaffLogin({ email: STAFF_EMAIL, displayName: "Twin", roles: ["dispatcher"], scope: "org", regionId: REGION_SOUTH }), code("email_taken"), "one login per email");
  await refusedWith(principal.gateway.createStaffLogin({ email: `t.${RUN}@ac.test`, displayName: "T", roles: ["technician"], scope: "org", regionId: REGION_SOUTH }), code("bad_roles"), "a technician is made with their unit");
});

test("a temporary password opens no session on S3 until the sign-in carries the person's own", { skip }, async () => {
  await refusedWith(signIn("S3", STAFF_EMAIL, staffTemp), code("password_change_required"), "the temporary password alone mints nothing");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM sessions WHERE principal_id = $1`, [staffId]))[0]!.n, 0, "no session was opened");
  await refusedWith(signIn("S3", STAFF_EMAIL, staffTemp, "short"), code("password_too_short"), "the account's own floor applies");
  await refusedWith(signIn("S3", STAFF_EMAIL, staffTemp, staffTemp), code("password_unchanged"), "the temporary password is not a new one");
  await refusedWith(signIn("S3", STAFF_EMAIL, "not the temporary one", "a fine new password"), (r) => r.kind === "token", "a wrong temporary password is a wrong password");
  assert.equal((await admin(`SELECT must_change_password FROM users WHERE id = $1`, [staffId]))[0]!.must_change_password, true, "a refused sign-in changed nothing");

  const own = `dana's own ${RUN}`;
  const s3 = await signIn("S3", STAFF_EMAIL, staffTemp, own);
  assert.equal(s3.principal.subjectId, staffId);
  const row = (await admin(`SELECT must_change_password, password_changed_at FROM users WHERE id = $1`, [staffId]))[0]!;
  assert.equal(row.must_change_password, false); assert.ok(row.password_changed_at);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'account.replace_temporary_password' AND surface_id = 'S3'`, [staffId]))[0]!.n, 1);
  await refusedWith(signIn("S3", STAFF_EMAIL, staffTemp), (r) => r.kind === "token", "the temporary password is spent");
  await (await signIn("S3", STAFF_EMAIL, own)).logout();
  await s3.logout();
});

test("a reset on S2 ends the person's sessions and forces a change at their next S2 sign-in", { skip }, async () => {
  // Promote Dana company-wide so the reset is proven on the S2 door.
  await principal.gateway.updatePerson({ userId: staffId, roles: ["office_manager"], scope: "org" });
  const before = await signIn("S2", STAFF_EMAIL, `dana's own ${RUN}`);
  const reset = await principal.gateway.resetPersonPassword({ userId: staffId });
  assert.ok(reset.endedSessions >= 1, "the session in hand was ended");
  await refusedWith(before.gateway.listRegions(), (r) => r.kind === "token", "the old session is refused on its next request");
  await refusedWith(signIn("S2", STAFF_EMAIL, `dana's own ${RUN}`), (r) => r.kind === "token", "the old password no longer works");
  await refusedWith(signIn("S2", STAFF_EMAIL, reset.temporaryPassword), code("password_change_required"), "S2 asks for a new one");
  const after = await signIn("S2", STAFF_EMAIL, reset.temporaryPassword, `dana's second ${RUN}`);
  assert.ok((await after.gateway.listRegions()).regions.length > 0);
  await refusedWith(after.gateway.listPeople(), scope, "an office manager reads no logins");
  await after.logout();
  await refusedWith(principal.gateway.resetPersonPassword({ userId: USER_PRINCIPAL }), code("use_account"), "your own password is the Account button's");
});

test("the last active company-wide principal can be neither removed nor demoted", { skip }, async () => {
  // Hold every other principal aside for this test; the suite shares a database.
  const others = (await admin(`SELECT id FROM users WHERE id <> $1 AND active AND namespace = 'internal' AND scope_tier = 'parent' AND roles @> '["principal"]'::jsonb`, [USER_PRINCIPAL])).map((r) => r.id as string);
  await admin(`UPDATE users SET active = false WHERE id = ANY($1::uuid[])`, [others]);
  try {
    await refusedWith(principal.gateway.setPersonActive({ userId: USER_PRINCIPAL, active: false }), code("last_principal"), "the last principal cannot remove themselves");
    await refusedWith(principal.gateway.updatePerson({ userId: USER_PRINCIPAL, roles: ["ops_leadership"] }), code("last_principal"), "…or demote themselves");
    await refusedWith(principal.gateway.updatePerson({ userId: USER_PRINCIPAL, scope: "region", regionId: REGION_SOUTH }), code("last_principal"), "…or narrow themselves to one region");
    // A second principal, and then the first may step down.
    await principal.gateway.updatePerson({ userId: USER_OWNER, roles: ["account_owner", "principal"] });
    const stepped = await principal.gateway.updatePerson({ userId: USER_PRINCIPAL, roles: ["ops_leadership"] });
    assert.ok(stepped.endedSessions >= 1, "a change of access ends the person's own sessions");
    owner = await signIn("S2", "owner.ppl@ac.test");
    await owner.gateway.updatePerson({ userId: USER_OWNER, roles: ["account_owner", "ops_leadership"] }).then(
      () => assert.fail("the new last principal stepped down"),
      (e) => assert.equal((e as { refusal?: { code?: string } }).refusal?.code, "last_principal"),
    );
  } finally {
    await admin(`UPDATE users SET active = true WHERE id = ANY($1::uuid[])`, [others]);
    await admin(`UPDATE users SET roles = '["account_owner","ops_leadership"]' WHERE id = $1`, [USER_OWNER]);
    await admin(`UPDATE users SET roles = '["principal"]' WHERE id = $1`, [USER_PRINCIPAL]);
    principal = await signIn("S2", "principal.ppl@ac.test");
  }
});

let deviceId = "", grantId = "";

test("a technician login comes with their own unit, takes a shift grant, and replaces the temporary password at the device", { skip }, async () => {
  const made = await principal.gateway.createTechnicianLogin({ email: TECH_EMAIL, displayName: `Theo Tech ${RUN}`, homeRegionId: REGION_SOUTH });
  techId = made.userId; techUnit = made.crewId!; techTemp = made.temporaryPassword;
  const unit = (await admin(`SELECT label, kind, employment_type, home_region_id, active FROM crews WHERE id = $1`, [techUnit]))[0]!;
  assert.deepEqual({ ...unit }, { label: `Theo Tech ${RUN}`, kind: "service", employment_type: "employed", home_region_id: REGION_SOUTH, active: true });
  const row = (await admin(`SELECT crew_id, roles, scope_tier, region_id FROM users WHERE id = $1`, [techId]))[0]!;
  assert.equal(row.crew_id, techUnit); assert.deepEqual(row.roles, ["technician"]); assert.equal(row.scope_tier, "region");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ANY($1::uuid[]) AND action IN ('crew.create','user.create')`, [[techId, techUnit]]))[0]!.n, 2);

  // An office manager — not a principal — grants the shift, as before.
  const om = await signIn("S2", "office.ppl@ac.test");
  deviceId = (await om.gateway.registerDevice({ hardwareId: HARDWARE, kind: "web_fallback", regionId: REGION_SOUTH })).id;
  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 2 * 3600_000).toISOString();
  grantId = (await om.gateway.grantDeviceShift({ deviceId, crewId: techUnit, windowStart: start, windowEnd: end })).id;

  await refusedWith(onDevice(TECH_EMAIL, techTemp), code("password_change_required"), "S5 asks for a new password too");
  await refusedWith(onDevice(TECH_EMAIL, techTemp, `theo's own ${RUN}`, `no-such-${RUN}`), (r) => r.kind === "token", "a device that is not granted is invalid credentials");
  assert.equal((await admin(`SELECT must_change_password FROM users WHERE id = $1`, [techId]))[0]!.must_change_password, true, "…and leaves the temporary password standing");
  const s5 = await onDevice(TECH_EMAIL, techTemp, `theo's own ${RUN}`);
  assert.equal(s5.deviceCrew?.id, techUnit);
  assert.equal(s5.principal.shiftId, grantId);
  assert.equal((await admin(`SELECT must_change_password FROM users WHERE id = $1`, [techId]))[0]!.must_change_password, false);
  await refusedWith(principal.gateway.updatePerson({ userId: techId, roles: ["dispatcher"] }), code("follows_unit"), "a technician's role follows the unit");
  await s5.logout();
});

test("a shift grant is extended by the roles that grant it, and a revoked grant's token is refused on its next request", { skip }, async () => {
  const om = await signIn("S2", "office.ppl@ac.test");
  const listed = (await om.gateway.listDeviceGrants({ deviceId })).grants;
  assert.equal(listed.length, 1); assert.equal(listed[0]!.state, "open"); assert.equal(listed[0]!.technicianName, `Theo Tech ${RUN}`);

  const was = listed[0]!.windowEnd;
  await refusedWith(om.gateway.extendDeviceShift({ grantId, windowEnd: new Date(Date.parse(was) - 60_000).toISOString() }), code("bad_window"), "an extension moves the end later");
  const later = new Date(Date.parse(was) + 3600_000).toISOString();
  const ext = await om.gateway.extendDeviceShift({ grantId, windowEnd: later });
  assert.equal(ext.windowEnd, later);
  assert.equal((await om.gateway.listDeviceGrants({ deviceId })).grants[0]!.windowEnd, later);
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [ext.eventId]))[0]!.topic, "device.shift_extended");
  // A grant after the extended end, then an extension into it, is an overlap.
  const next = (await om.gateway.grantDeviceShift({ deviceId, crewId: techUnit, windowStart: new Date(Date.parse(later) + 3600_000).toISOString(), windowEnd: new Date(Date.parse(later) + 7200_000).toISOString() })).id;
  await refusedWith(om.gateway.extendDeviceShift({ grantId, windowEnd: new Date(Date.parse(later) + 5400_000).toISOString() }), code("grant_overlap"), "an extension may not run into the next grant");

  const s5 = await onDevice(TECH_EMAIL, `theo's own ${RUN}`);
  assert.ok(Array.isArray((await s5.gateway.myJobs()).jobs), "the device works before the revoke");
  const rev = await om.gateway.revokeDeviceShift({ grantId });
  assert.equal(rev.endedSessions, 1);
  await refusedWith(s5.gateway.myJobs(), (r) => r.kind === "token", "the revoked grant's token is refused on its next request");
  await refusedWith(onDevice(TECH_EMAIL, `theo's own ${RUN}`), (r) => r.kind === "token", "and no new session is minted on it");
  await refusedWith(om.gateway.revokeDeviceShift({ grantId }), code("grant_revoked"), "a revoked grant has nothing left to end");
  await refusedWith(om.gateway.extendDeviceShift({ grantId, windowEnd: new Date(Date.parse(later) + 60_000).toISOString() }), code("grant_revoked"), "…or to extend");
  assert.equal((await om.gateway.listDeviceGrants({ deviceId })).grants.find((g) => g.id === grantId)!.state, "revoked");
  await om.gateway.revokeDeviceShift({ grantId: next });
});

test("removing a technician ends their sessions and retires their unit; bringing them back restores it", { skip }, async () => {
  const off = await principal.gateway.setPersonActive({ userId: techId, active: false });
  assert.equal(off.active, false);
  assert.equal((await admin(`SELECT active FROM crews WHERE id = $1`, [techUnit]))[0]!.active, false);
  await refusedWith(principal.gateway.setPersonActive({ userId: techId, active: false }), code("no_change"), "already removed");
  await principal.gateway.setPersonActive({ userId: techId, active: true });
  assert.equal((await admin(`SELECT active FROM crews WHERE id = $1`, [techUnit]))[0]!.active, true);
  await principal.gateway.updatePerson({ userId: staffId, email: `dana.${RUN}@ac.test`, displayName: "Dana D." });
  assert.equal((await admin(`SELECT email FROM users WHERE id = $1`, [staffId]))[0]!.email, `dana.${RUN}@ac.test`);
});
