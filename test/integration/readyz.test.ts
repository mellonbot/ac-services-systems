/**
 * READINESS OVER THE WIRE — /readyz answers 200 only when the gateway's login
 * can reach Postgres AND take the ac_gateway role; /healthz stays liveness.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * The second gateway connects as a login that exists but holds no SET ROLE on
 * ac_gateway — production's failure when the Worker's DATABASE_URL is not the
 * migrating login (0012). /healthz said green through exactly that; /readyz
 * must not.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../services/gateway/src/db/pg-tx.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — /readyz was not verified against a database";
if (!URL_) test("readiness over the wire", { skip }, () => {});

const STRANGER = "ac_readyz_stranger";
const STRANGER_PASSWORD = "readyz-stranger-only";

let pool: Pool;
const gateways: ChildProcess[] = [];

const start = async (databaseUrl: string): Promise<string> => {
  const port = 29080 + Math.floor(Math.random() * 1000) + gateways.length;
  const gw = spawn(process.execPath, [fileURLToPath(new URL("../../services/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl, AC_SITE: "ac.test" }, stdio: ["ignore", "pipe", "pipe"],
  });
  gateways.push(gw);
  let log = "";
  gw.stdout!.on("data", (d) => { log += String(d); });
  gw.stderr!.on("data", (d) => { log += String(d); });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { if ((await fetch(`${base}/healthz`)).ok) return base; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`gateway did not come up on :${port}\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-readyz-test");
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${STRANGER}') THEN
      CREATE ROLE ${STRANGER} LOGIN PASSWORD '${STRANGER_PASSWORD}';
    END IF;
  END $$`);
});

after(async () => {
  for (const gw of gateways) gw.kill("SIGTERM");
  await pool?.end();
});

test("the migrating login is ready: it reaches Postgres and becomes ac_gateway", { skip }, async () => {
  const base = await start(URL_!);
  const r = await fetch(`${base}/readyz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, database: "reachable", storage: "not_configured" });
});

test("a login without the ac_gateway grant is live but not ready", { skip }, async () => {
  const wrong = new URL(URL_!);
  wrong.username = STRANGER;
  wrong.password = STRANGER_PASSWORD;
  const base = await start(wrong.toString());
  assert.equal((await fetch(`${base}/healthz`)).status, 200, "liveness does not touch the database");
  const r = await fetch(`${base}/readyz`);
  assert.equal(r.status, 503);
  const body = await r.text();
  assert.ok(!body.includes(STRANGER_PASSWORD), "the refusal never carries the connection string");
});
