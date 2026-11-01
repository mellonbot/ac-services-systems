/**
 * S1, THE FRONT DOOR, OVER THE WIRE — `auth.signIn` through the real gateway
 * against a real database.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * The sentence under test:
 *
 *   ONE FORM; THE GATEWAY SENDS EACH LOGIN TO THE SURFACE IT BELONGS TO, AND
 *   THE SESSION IT MINTS IS ONE THAT SURFACE THEN ACCEPTS.
 *
 * Each case is a login whose surfaces the registry decides: an office manager
 * (S2), a region dispatcher (S3), a principal (S2, S3 and S4 — a choice), a
 * customer (S6), and a technician (nowhere without a device; S5 with one).
 * The minted token is then used AS that surface, through the real client, so
 * "signed in" means a surface accepted it — not that a row was written.
 *
 * What the front door must never do: say more than "invalid credentials"
 * before the password is right, mint a session on a surface the login would
 * be refused at, or take a write of its own (S1's lead routes are gone).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../services/gateway/src/db/pg-tx.ts";
import { hashPassword } from "../../services/gateway/src/auth/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import type { SignInOutput, SurfaceId } from "../../packages/contracts/src/index.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — S1's front door was not verified over the wire";
if (!URL_) test("S1 front door over the wire", { skip }, () => {});

const PORT = 25080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `d1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_OFFICE = U(2), USER_DISPATCH = U(3), USER_PRINCIPAL = U(4), USER_TECH = U(5), USER_GONE = U(6), USER_CUSTOMER = U(7), USER_REGIONAL_OFFICE = U(8);
const PASSWORD = "correct horse battery staple";
const RUN = `d1-${Date.now().toString(36)}`;
const HARDWARE = `door-tablet-${RUN}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-s1-test");
  await admin(`INSERT INTO regions (id, code, name, active) VALUES ($1,'SOUTH','South',true) ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d1@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','office.d1@ac.test','Office Manager','["office_manager"]','parent',$2,$4,true),
           ($6,$2,$3,'internal','dispatch.d1@ac.test','South Dispatcher','["dispatcher"]','region',$3,$4,true),
           ($7,$2,$3,'internal','principal.d1@ac.test','Principal','["principal"]','parent',$2,$4,true),
           ($8,$2,$3,'internal','tech.d1@ac.test','Technician','["technician"]','region',$3,$4,true),
           ($9,$2,$3,'internal','gone.d1@ac.test','Left the company','["office_manager"]','parent',$2,$4,false),
           ($10,$2,$3,'internal','regional.office.d1@ac.test','Regional Office','["office_manager"]','region',$3,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = EXCLUDED.active, crew_id = NULL`,
    [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_OFFICE, USER_DISPATCH, USER_PRINCIPAL, USER_TECH, USER_GONE, USER_REGIONAL_OFFICE]);

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

  // A customer, under an organization the office records, and a technician on a crew with a device and a live shift.
  const owner = await connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.d1@ac.test", password: PASSWORD } });
  const org = await owner.gateway.createOrganization({ name: `Front Door Customer ${RUN}`, externalRef: RUN, firstRegionNode: { regionId: REGION_SOUTH, name: `Front Door / South ${RUN}` } });
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'customer','customer.d1@ac.test','Customer','["payer","requester"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, scope_id = EXCLUDED.scope_id, password_hash = EXCLUDED.password_hash, active = true`,
    [USER_CUSTOMER, org.orgId, REGION_SOUTH, hash]);
  const crew = (await owner.gateway.createCrew({ label: `Door Crew ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
  await admin(`UPDATE users SET crew_id = $2 WHERE id = $1`, [USER_TECH, crew]);
  const device = (await owner.gateway.registerDevice({ hardwareId: HARDWARE, kind: "web_fallback", publicKey: Buffer.from("not-yet-checked").toString("base64"), regionId: REGION_SOUTH })).id;
  await owner.gateway.grantDeviceShift({
    deviceId: device, crewId: crew, technicianId: USER_TECH,
    windowStart: new Date(Date.now() - 3600_000).toISOString(), windowEnd: new Date(Date.now() + 8 * 3600_000).toISOString(),
  });
  await owner.logout();
});

after(async () => {
  gateway?.kill("SIGTERM");
  await pool?.end();
});

const signIn = (body: Record<string, unknown>) => fetch(`${BASE}/auth/sign-in`, {
  method: "POST", headers: { "content-type": "application/json", "x-ac-surface": "S1" }, body: JSON.stringify(body),
});
const asLogin = (email: string, extra: Record<string, unknown> = {}) => signIn({ email, password: PASSWORD, ...extra });
const signedIn = async (r: Response): Promise<Extract<SignInOutput, { kind: "signed_in" }>> => {
  assert.equal(r.status, 200, await r.clone().text());
  const out = await r.json() as SignInOutput;
  assert.equal(out.kind, "signed_in");
  assert.match(r.headers.get("set-cookie") ?? "", /ac_session=/, "the browser is handed the destination's session as its cookie");
  return out as Extract<SignInOutput, { kind: "signed_in" }>;
};
/** The minted session, used AS the surface it was minted for — what the surface does when the browser lands. */
const landOn = (surface: SurfaceId, token: string): Promise<ConnectedShell> => connectShell({ surfaceId: surface, baseUrl: BASE, fetch, credentials: { token } });

test("a wrong password and an unknown address get the same words, and a disabled login is no better", { skip }, async () => {
  for (const r of [await signIn({ email: "office.d1@ac.test", password: "nope" }), await signIn({ email: `nobody-${RUN}@ac.test`, password: PASSWORD }), await asLogin("gone.d1@ac.test")]) {
    assert.equal(r.status, 401);
    assert.match((await r.json() as { message: string }).message, /invalid credentials/);
    assert.equal(r.headers.get("set-cookie"), null, "no session for a refusal");
  }
});

test("one surface: the office manager goes to the office, and the office accepts the session", { skip }, async () => {
  const out = await signedIn(await asLogin("office.d1@ac.test"));
  assert.deepEqual([out.surface, out.path], ["S2", "/service-manager/"]);
  const s2 = await landOn("S2", out.token);
  assert.equal(s2.principal.subjectId, USER_OFFICE);
  await s2.logout();
});

test("one surface: a region dispatcher goes to dispatch", { skip }, async () => {
  const out = await signedIn(await asLogin("dispatch.d1@ac.test"));
  assert.deepEqual([out.surface, out.path], ["S3", "/dispatch/"]);
  const s3 = await landOn("S3", out.token);
  assert.equal(s3.principal.regionId, REGION_SOUTH);
  await s3.logout();
});

test("several surfaces: the principal is asked, with no session yet — and the pick mints exactly that surface's", { skip }, async () => {
  const r = await asLogin("principal.d1@ac.test");
  assert.equal(r.status, 200);
  const out = await r.json() as SignInOutput;
  assert.equal(out.kind, "choose");
  if (out.kind !== "choose") return;
  assert.deepEqual(out.choices.map((c) => c.surface), ["S2", "S3", "S4"], "every enabled surface the principal's role opens, in registry order");
  assert.equal(r.headers.get("set-cookie"), null, "nothing minted until they choose");
  const before = (await admin(`SELECT count(*)::int AS n FROM sessions WHERE principal_id = $1`, [USER_PRINCIPAL]))[0]!.n as number;
  const picked = await signedIn(await asLogin("principal.d1@ac.test", { surface: "S3" }));
  assert.deepEqual([picked.surface, picked.path], ["S3", "/dispatch/"]);
  const rows = await admin(`SELECT surface_id FROM sessions WHERE principal_id = $1 ORDER BY expires_at DESC LIMIT 1`, [USER_PRINCIPAL]);
  assert.equal(rows[0]!.surface_id, "S3");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM sessions WHERE principal_id = $1`, [USER_PRINCIPAL]))[0]!.n, before + 1, "one session, for the pick");
  const s3 = await landOn("S3", picked.token);
  await s3.logout();
});

test("a pick the login may not open is refused by the same rule every other door uses", { skip }, async () => {
  const r = await asLogin("office.d1@ac.test", { surface: "S3" });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("set-cookie"), null);
  assert.equal((await asLogin("office.d1@ac.test", { surface: "S1" })).status, 400, "nobody signs in to the front door itself");
});

test("a login no surface will take is told so — and never that its portal is coming when only its scope stands in the way", { skip }, async () => {
  // An office manager scoped to one region: S2 is org-wide, so no surface opens, and that will not change by rollout.
  const r = await asLogin("regional.office.d1@ac.test");
  assert.equal(r.status, 403);
  assert.match((await r.json() as { message: string }).message, /No portal is set up for this login yet/);
  assert.equal(r.headers.get("set-cookie"), null);
});

test("a customer goes to the customer portal", { skip }, async () => {
  const out = await signedIn(await asLogin("customer.d1@ac.test"));
  assert.deepEqual([out.surface, out.path], ["S6", "/customer/"]);
  const s6 = await landOn("S6", out.token);
  assert.equal(s6.principal.namespace, "customer");
  await s6.logout();
});

test("a technician: without the device they are told to give it; with it, S5 — and the resumed session knows its crew", { skip }, async () => {
  const bare = await asLogin("tech.d1@ac.test");
  assert.equal(bare.status, 403);
  assert.match((await bare.json() as { message: string }).message, /field device/);

  assert.equal((await asLogin("tech.d1@ac.test", { hardwareId: `not-${HARDWARE}` })).status, 401, "a device that is not theirs is invalid credentials, as at S5's own door");
  const out = await signedIn(await asLogin("tech.d1@ac.test", { hardwareId: HARDWARE }));
  assert.deepEqual([out.surface, out.path], ["S5", "/technician/"]);
  const s5 = await landOn("S5", out.token);
  assert.equal(s5.principal.namespace, "device");
  assert.match(s5.deviceCrew?.label ?? "", new RegExp(`Door Crew ${RUN}`), "session.me answers the crew the shift grant names");
  await s5.logout();
});

test("the front door takes no write of its own — the lead and call routes are gone", { skip }, async () => {
  for (const path of ["/s1/leads", "/s1/call-records", "/auth/anonymous", "/coverage"]) {
    const r = await fetch(`${BASE}${path}`, { method: path === "/coverage" ? "GET" : "POST", headers: { "content-type": "application/json", "x-ac-surface": "S1" }, body: path === "/coverage" ? undefined : "{}" });
    assert.equal(r.status, 404, `${path} answers nothing`);
  }
});
