/**
 * THE PRODUCTION ROLLOUT OVER THE WIRE — a gateway started as production
 * starts it (AC_ROLLOUT=1) serves the surfaces in ROLLOUT and nothing else.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * One login admitted to both S2 and S4 (account_owner) is the sharpest case:
 * same namespace, same password, same token — S2 is live and S4 is not. The
 * door (login) and every request after it (x-ac-surface) must both refuse S4.
 * S1 is live, so its anonymous door stays open for the lead form.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — the production rollout was not verified over the wire";
if (!URL_) test("rollout over the wire", { skip }, () => {});

const PORT = 28080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const USER_OWNER = "d9000000-0000-0000-0000-000000000001";
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

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
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

test("S1 is live: a visitor session is minted for the lead form", { skip }, async () => {
  const r = await fetch(`${BASE}/auth/anonymous`, { method: "POST" });
  assert.equal(r.status, 200);
});
