/**
 * THE 2026-10-24 REVIEW, PROVEN — the gateway's doors, asserted against a live
 * PostgreSQL and spawned gateways:
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * One gateway runs as on a laptop (no edge in front of it); a second runs as
 * it does behind infra/cloudflare/worker.mjs, with AC_BEHIND_CLOUDFLARE=1.
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
const skip = URL_ ? false : "DATABASE_URL not set — the gateway's doors were not verified against a database";
if (!URL_) test("gateway hardening", { skip }, () => {});

const PORT = 26080 + Math.floor(Math.random() * 1000);
const LAPTOP = `http://127.0.0.1:${PORT}`;
const EDGE = `http://127.0.0.1:${PORT + 1}`;
const U = (n: number) => `e2400000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const PASSWORD = "correct horse battery staple";

let pool: Pool;
const gateways: ChildProcess[] = [];
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
const user = async (n: number, email: string, roles: string[], tier = "parent", scope = INTERNAL_ORG_ID) =>
  admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal',$4,'Hardening',$5::jsonb,$6,$7,$8,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true, roles = EXCLUDED.roles, scope_tier = EXCLUDED.scope_tier, scope_id = EXCLUDED.scope_id`,
  [U(n), INTERNAL_ORG_ID, REGION_SOUTH, email, JSON.stringify(roles), tier, scope, hashPassword(PASSWORD)]);

const spawnGateway = async (port: number, extra: Record<string, string>) => {
  const g = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: URL_, AC_SITE: "ac.test", ...extra }, stdio: ["ignore", "pipe", "pipe"],
  });
  gateways.push(g);
  let log = "";
  g.stdout!.on("data", (d) => { log += String(d); });
  g.stderr!.on("data", (d) => { log += String(d); });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) return; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`gateway did not come up on :${port}\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-hardening-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  await user(1, "lockout.h24@ac.test", ["finance"]);
  await spawnGateway(PORT, {});
  await spawnGateway(PORT + 1, { AC_BEHIND_CLOUDFLARE: "1" });
});

after(async () => {
  for (const g of gateways) g.kill("SIGTERM");
  await pool?.end();
});

const anonymous = (base: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/auth/anonymous`, { method: "POST", headers: { "x-ac-surface": "S1", ...headers } });

test("off Cloudflare, CF-Connecting-IP is the caller's own words: a new one per request does not buy a new allowance", { skip }, async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 22; i++) statuses.push((await anonymous(LAPTOP, { "cf-connecting-ip": `198.51.100.${i}` })).status);
  assert.ok(statuses.includes(429), `twenty-two mints from one socket address, each claiming another: ${statuses.join(",")}`);
});

test("behind Cloudflare, CF-Connecting-IP is the client: two clients are counted apart", { skip }, async () => {
  for (let i = 0; i < 20; i++) assert.equal((await anonymous(EDGE, { "cf-connecting-ip": "203.0.113.1" })).status, 200);
  assert.equal((await anonymous(EDGE, { "cf-connecting-ip": "203.0.113.1" })).status, 429);
  assert.equal((await anonymous(EDGE, { "cf-connecting-ip": "203.0.113.2" })).status, 200);
});
