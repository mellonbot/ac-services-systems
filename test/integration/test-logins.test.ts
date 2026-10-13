/**
 * THE TEST LOGINS OVER THE WIRE — superadmin-test, dispatcher-test and
 * service_manager-test, seeded by the same tool an operator runs
 * (tools/ci/seed-test-logins.ts), against a spawned gateway and a live
 * PostgreSQL.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * Two claims. Each login is admitted to exactly its own surfaces and refused
 * at the door everywhere else — no session minted for a surface whose roles
 * it does not hold. And each reads at its own level: the org-wide logins see
 * every region's rows, the dispatcher only its region's, decided by RLS from
 * the scope binding and not by any handler.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, beginTx, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { scopeBinding } from "../../apps/gateway/src/context.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { GatewayRefusal, SURFACE_IDS, type SurfaceId } from "../../packages/contracts/src/index.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { seedTestLogins, resolveRegion, type SeededLogin } from "../../tools/ci/seed-test-logins.ts";
import { TEST_LOGINS, type TestLogin } from "../../tools/ci/test-logins.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — the test logins were not verified over the wire";
if (!URL_) test("test logins over the wire", { skip }, () => {});

const PORT = 24080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "correct horse battery staple";
const RUN = `tl-${Date.now().toString(36)}`;

let pool: Pool;
let gateway: ChildProcess;
let seeded: readonly SeededLogin[] = [];
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-test-logins-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  const region = await resolveRegion(pool, "south");
  assert.equal(region.id, REGION_SOUTH, "a region code resolves case-insensitively");
  seeded = await seedTestLogins(pool, { password: PASSWORD, regionId: region.id });
  // Twice: the seed is idempotent, and the second run is what an operator does to reset a password.
  const again = await seedTestLogins(pool, { password: PASSWORD, regionId: region.id });
  assert.deepEqual(again.map((s) => s.id), seeded.map((s) => s.id), "a re-seed updates the same rows");

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

const as = (t: TestLogin, surfaceId: SurfaceId) => connectShell({ surfaceId, baseUrl: BASE, fetch, credentials: { email: t.email, password: PASSWORD } });
const byLogin = (name: string) => TEST_LOGINS.find((t) => t.login === name)!;
const idOf = (t: TestLogin) => seeded.find((s) => s.email === t.email)!.id;
const sessionsOf = async (t: TestLogin) => (await admin(`SELECT count(*)::int AS n FROM sessions WHERE principal_id = $1`, [idOf(t)]))[0]!.n as number;

test("the seed refuses a short password and an unknown region, and writes nothing", { skip }, async () => {
  await assert.rejects(seedTestLogins(pool, { password: "short", regionId: REGION_SOUTH }), /at least 12/);
  await assert.rejects(resolveRegion(pool, `NOWHERE-${RUN}`), /no active region/);
});

test("each login opens exactly its own surfaces and is refused at the door on every other — no session is minted for a refusal", { skip }, async () => {
  for (const t of TEST_LOGINS) {
    for (const id of SURFACE_IDS) {
      if (t.surfaces.includes(id)) {
        const s = await as(t, id);
        assert.equal(s.principal.subjectId, idOf(t), `${t.login} on ${id}`);
        assert.deepEqual([...s.principal.roles], [...t.roles]);
        await s.logout();
        continue;
      }
      const before = await sessionsOf(t);
      await assert.rejects(as(t, id), (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "scope", `${t.login} must be refused ${id}`);
      assert.equal(await sessionsOf(t), before, `${t.login} on ${id}: a refused login leaves no session behind`);
    }
  }
});

test("the dispatcher's refusal names the roles, so 'why can't I open S2' has an answer", { skip }, async () => {
  await assert.rejects(as(byLogin("dispatcher-test"), "S2"), (e: unknown) => e instanceof GatewayRefusal && /S2 admits \[.*office_manager.*\]; this login holds \[dispatcher\]/.test(e.message));
});

test("the levels: org-wide logins resolve to the org, the dispatcher to one region", { skip }, async () => {
  const sa = await as(byLogin("superadmin-test"), "S2");
  const sm = await as(byLogin("service_manager-test"), "S2");
  const d = await as(byLogin("dispatcher-test"), "S3");
  for (const s of [sa, sm]) assert.equal(s.principal.scopeTier, "parent");
  assert.equal(d.principal.scopeTier, "region");
  assert.equal(d.principal.scopeId, REGION_SOUTH);
  assert.deepEqual(d.context?.regions.map((r) => r.id), [REGION_SOUTH], "a dispatcher's hierarchy is one region: its own");
  assert.equal(d.context?.activeRegionId, REGION_SOUTH);
  for (const s of [sa, sm, d]) await s.logout();
});

test("the levels in the database: rows in two regions — the org-wide logins read both, the dispatcher reads its own and the other is simply absent", { skip }, async () => {
  const sa = await as(byLogin("superadmin-test"), "S2");
  const sm = await as(byLogin("service_manager-test"), "S2");
  // Both org-wide logins can author on S2 — the service manager by office_manager, the superadmin by principal.
  const south = (await sa.gateway.createCrew({ label: `South ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
  const west = (await sm.gateway.createCrew({ label: `West ${RUN}`, employmentType: "employed", homeRegionId: REGION_WEST })).id;
  for (const s of [sa, sm]) {
    const seen = new Set((await s.gateway.listCrews({})).crews.map((c) => c.id));
    assert.ok(seen.has(south) && seen.has(west), "org-wide over the wire: both regions");
  }

  const visible = async (s: ConnectedShell, surfaceId: SurfaceId): Promise<string[]> => {
    const tx = await beginTx(pool, "ac_gateway");
    try {
      await tx.setLocal(scopeBinding(s.principal, surfaceId));
      return (await tx.query<{ id: string }>(`SELECT id FROM crews WHERE id = ANY($1::uuid[]) ORDER BY label`, [[south, west]])).map((r) => r.id);
    } finally { await tx.rollback(); }
  };
  const d = await as(byLogin("dispatcher-test"), "S3");
  const sa3 = await as(byLogin("superadmin-test"), "S3");
  assert.deepEqual(await visible(sa, "S2"), [south, west]);
  assert.deepEqual(await visible(sm, "S2"), [south, west]);
  assert.deepEqual(await visible(sa3, "S3"), [south, west], "the superadmin on the dispatch console is still org-wide");
  assert.deepEqual(await visible(d, "S3"), [south], "RLS: the West crew is not there for the South dispatcher");

  // And the catalogue holds the surface line: the superadmin on S3 is a dispatcher's door, not S2's.
  await assert.rejects(sa3.gateway.createCrew({ label: `Nope ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH }),
    (e: unknown) => sa3.refusalOf(e)?.kind === "scope");
  for (const s of [sa, sm, d, sa3]) await s.logout();
});
