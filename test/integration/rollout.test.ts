/**
 * THE PRODUCTION ROLLOUT OVER THE WIRE — a gateway started as production
 * starts it (AC_ROLLOUT=1) serves the surfaces in ROLLOUT and nothing else.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * One login admitted to both S2 and S4 (account_owner) is the sharpest case:
 * same namespace, same password, same token — S2 is live and S4 is not. The
 * door (login) and every request after it (x-ac-surface) must both refuse S4.
 * S1, the front door, is live — and sends a login only to a surface that is.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../services/gateway/src/db/pg-tx.ts";
import { hashPassword } from "../../services/gateway/src/auth/auth.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — the production rollout was not verified over the wire";
if (!URL_) test("rollout over the wire", { skip }, () => {});

const PORT = 28080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const USER_OWNER = "f1000000-0000-0000-0000-000000000001";
const USER_CUSTOMER = "f1000000-0000-0000-0000-000000000002";
const CUSTOMER_ORG = "f1000000-0000-0000-0000-000000000003";
const EMAIL = "owner.rollout@ac.test";
const PASSWORD = "correct horse battery staple";

let pool: Pool;
let gateway: ChildProcess;

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-rollout-test");
  await pool.query(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  await pool.query(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal',$4,'Account Owner','["account_owner"]','parent',$2,$5,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, EMAIL, hashPassword(PASSWORD)]);
  // A customer, whose one surface (S6) is enabled but not in ROLLOUT.
  await pool.query(`INSERT INTO organizations (id, name, kind, segment) VALUES ($1,'Rollout Customer','customer','commercial') ON CONFLICT (id) DO NOTHING`, [CUSTOMER_ORG]);
  await pool.query(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'customer','customer.rollout@ac.test','Customer','["payer","requester"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_CUSTOMER, CUSTOMER_ORG, REGION_SOUTH, hashPassword(PASSWORD)]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../services/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test", AC_ROLLOUT: "1" }, stdio: ["ignore", "pipe", "pipe"],
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

const login = (surface: string) => fetch(`${BASE}/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, surface }),
});

test("a live surface signs in; a surface outside the rollout is refused at the door", { skip }, async () => {
  assert.equal((await login("S2")).status, 200);
  const s4 = await login("S4");
  assert.equal(s4.status, 404);
  assert.equal((await s4.json() as { error: string }).error, "SurfaceNotLive");
});

test("a live session cannot reach a surface outside the rollout by naming it", { skip }, async () => {
  const { token } = await (await login("S2")).json() as { token: string };
  const r = await fetch(`${BASE}/s4/metrics`, { headers: { authorization: `Bearer ${token}`, "x-ac-surface": "S4" } });
  assert.equal(r.status, 404);
  assert.equal((await r.json() as { error: string }).error, "SurfaceNotLive");
});

test("S1 is live, and its front door sends the login only where a surface is live: S2, never S4", { skip }, async () => {
  const r = await fetch(`${BASE}/auth/sign-in`, {
    method: "POST", headers: { "content-type": "application/json", "x-ac-surface": "S1" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(r.status, 200);
  const out = await r.json() as { kind: string; surface?: string };
  assert.deepEqual([out.kind, out.surface], ["signed_in", "S2"], "S2 and S4 both admit an account owner; only S2 is in ROLLOUT, so there is nothing to choose");
  const s4 = await fetch(`${BASE}/auth/sign-in`, {
    method: "POST", headers: { "content-type": "application/json", "x-ac-surface": "S1" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, surface: "S4" }),
  });
  assert.equal(s4.status, 404);
  assert.equal((await s4.json() as { error: string }).error, "SurfaceNotLive");
});

test("a customer, whose portal is built but not in the rollout, is told it is not open yet — and given no session", { skip }, async () => {
  const r = await fetch(`${BASE}/auth/sign-in`, {
    method: "POST", headers: { "content-type": "application/json", "x-ac-surface": "S1" }, body: JSON.stringify({ email: "customer.rollout@ac.test", password: PASSWORD }),
  });
  assert.equal(r.status, 403);
  assert.match((await r.json() as { message: string }).message, /Your portal is not open yet/);
  assert.equal(r.headers.get("set-cookie"), null);
});
