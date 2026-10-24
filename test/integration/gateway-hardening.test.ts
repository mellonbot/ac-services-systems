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
import { request } from "node:http";
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
  await user(2, "csrf.h24@ac.test", ["finance"]);
  await admin(`INSERT INTO brand_themes (org_id, region_id, host, accent, overrides, accent_admission, authored_by)
    VALUES ($1,$2,'portal.h24.example','#0e6a46','{}','{}',$3) ON CONFLICT (host) DO NOTHING`, [INTERNAL_ORG_ID, REGION_SOUTH, U(1)]);
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

test("ten wrong passwords shut the email from that address only: its owner, signing in from elsewhere, is not locked out", { skip }, async () => {
  const attempt = (password: string, ip: string) => fetch(`${EDGE}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email: "lockout.h24@ac.test", password, surface: "S2" }),
  });
  for (let i = 0; i < 10; i++) assert.equal((await attempt("wrong", "203.0.113.50")).status, 401);
  assert.equal((await attempt(PASSWORD, "203.0.113.50")).status, 429, "the guesser's address is shut, right password or not");
  assert.equal((await attempt(PASSWORD, "203.0.113.51")).status, 200, "the owner, elsewhere, signs in");
});

/** A POST that declares `declared` bytes and sends only a little: what is answered, and is the connection closed under it. */
const declare = (base: string, path: string, declared: number, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; closed: boolean }>((resolve, reject) => {
    const u = new URL(path, base);
    const r = request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "content-type": "application/json", "content-length": String(declared), ...headers } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode!, closed: res.headers.connection === "close" }));
    });
    r.on("error", reject);
    r.write("{");
  });

test("a door anyone can knock on takes 64 KB, not fourteen megabytes; an oversized body is refused before it is read and the connection closed", { skip }, async () => {
  const big = await declare(LAPTOP, "/auth/login", 14 * 1024 * 1024);
  assert.deepEqual(big, { status: 413, closed: true });
  assert.equal((await declare(LAPTOP, "/auth/login", 100 * 1024)).status, 413);
  // Sent, not just declared: the reader stops at the limit.
  const sent = await fetch(`${LAPTOP}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x".repeat(70 * 1024) }) }).catch(() => null);
  assert.ok(sent === null || sent.status === 413);
});

test("the throttle is taken before the body is read: a spent address is a 429, however large the body it declares", { skip }, async () => {
  const ip = "203.0.113.77";
  for (let i = 0; i < 20; i++) await anonymous(EDGE, { "cf-connecting-ip": ip });
  assert.equal((await declare(EDGE, "/s1/leads", 14 * 1024 * 1024, { "cf-connecting-ip": ip })).status, 429);
});

const cookieOf = (setCookie: string | null) => (setCookie ?? "").split(";")[0]!;

test("login CSRF: a body that is not said to be JSON is refused — a cross-site text/plain form cannot sign this browser into anyone's session", { skip }, async () => {
  const body = JSON.stringify({ email: "csrf.h24@ac.test", password: PASSWORD, surface: "S2" });
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
    const r = await fetch(`${LAPTOP}/auth/login`, { method: "POST", headers: type ? { "content-type": type } : {}, body });
    assert.equal(r.status, 415, type || "(none)");
    assert.equal(r.headers.get("set-cookie"), null);
  }
  assert.equal((await fetch(`${LAPTOP}/auth/login`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body })).status, 200);
});

test("the anonymous mint does not replace a signed-in browser's live session; an anonymous or dead cookie is replaced as before", { skip }, async () => {
  const at = (ip: string) => ({ "cf-connecting-ip": ip });
  const login = await fetch(`${EDGE}/auth/login`, { method: "POST", headers: { "content-type": "application/json", ...at("203.0.113.89") }, body: JSON.stringify({ email: "csrf.h24@ac.test", password: PASSWORD, surface: "S2" }) });
  const signedIn = cookieOf(login.headers.get("set-cookie"));
  const over = await anonymous(EDGE, { ...at("203.0.113.89"), cookie: signedIn });
  assert.equal(over.status, 403);
  assert.equal(over.headers.get("set-cookie"), null);
  assert.equal((await fetch(`${EDGE}/me`, { headers: { cookie: signedIn, "x-ac-surface": "S2" } })).status, 200, "still signed in");
  const visitor = await anonymous(EDGE, at("203.0.113.90"));
  assert.equal((await anonymous(EDGE, { ...at("203.0.113.90"), cookie: cookieOf(visitor.headers.get("set-cookie")) })).status, 200);
  await fetch(`${EDGE}/auth/logout`, { method: "POST", headers: { cookie: signedIn, "x-ac-surface": "S2" } });
  assert.equal((await anonymous(EDGE, { ...at("203.0.113.91"), cookie: signedIn })).status, 200, "a session that has ended is no session to keep");
});

test("behind Cloudflare a portal's theme is found by the host the Worker forwards; off it, that header is nobody's word", { skip }, async () => {
  const theme = async (base: string, headers: Record<string, string>) => ((await (await fetch(`${base}/brand/theme`, { headers })).json()) as { tenant: boolean }).tenant;
  assert.equal(await theme(EDGE, { "x-ac-forwarded-host": "portal.h24.example" }), true);
  assert.equal(await theme(LAPTOP, { "x-ac-forwarded-host": "portal.h24.example" }), false);
});
