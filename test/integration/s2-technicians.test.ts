/**
 * 0020 OVER THE WIRE — the technician roster, through the shell, against a
 * spawned gateway and a live PostgreSQL.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What this suite holds: an account owner records a firm's technician with a
 * home address and reads it back; an office manager reads the same row with
 * the address restricted, and is refused (by name) when they try to write one;
 * the audit row and the outbox never carry the address; a crew of another
 * employer is refused by the handler AND by 0020's trigger on a path that
 * skips the handler; and the table is internal-only by RLS — a firm's own
 * principal reads zero rows, its own technicians included.
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
const skip = URL_ ? false : "DATABASE_URL not set — the technician roster was not verified over the wire";
if (!URL_) test("technician roster over the wire", { skip }, () => {});

const PORT = 23080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `7e000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_OFFICE = U(2), USER_PRINCIPAL = U(3);
const PASSWORD = "correct horse battery staple";
const RUN = `tech-${Date.now().toString(36)}`;
const HOME = { line1: "905 Hemphill St", city: "Fort Worth", state: "TX", postal: "76104" };

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
const asBinding = async (binding: Record<string, string>, sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE ac_gateway");
    for (const [k, v] of Object.entries(binding)) await c.query("SELECT set_config($1, $2, true)", [k, v]);
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-tech-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.tech@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','office.tech@ac.test','Office Manager','["office_manager"]','parent',$2,$4,true),
           ($6,$2,$3,'internal','principal.tech@ac.test','Principal','["principal"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_OFFICE, USER_PRINCIPAL]);

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

const shellAs = (email: string) => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email, password: PASSWORD } });
const refusal = (s: ConnectedShell, e: unknown) => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return r!; };

let owner: ConnectedShell, office: ConnectedShell;
let firm = "", firmCrew = "", ourCrew = "", tech = "";

test("an account owner records a firm's technician with a home address; the audit and the outbox never carry it", { skip }, async () => {
  owner = await shellAs("owner.tech@ac.test");
  office = await shellAs("office.tech@ac.test");
  firm = (await owner.gateway.createFirm({ legalName: `Lone Star ${RUN}`, regionId: REGION_SOUTH, settlementTermsDays: 30, diagnosticDataRightsReserved: true })).id;
  firmCrew = (await owner.gateway.createCrew({ label: `LS-A ${RUN}`, employmentType: "subcontracted", firmId: firm, homeRegionId: REGION_SOUTH })).id;
  ourCrew = (await owner.gateway.createCrew({ label: `DFW-1 ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;

  const out = await owner.gateway.recordTechnician({ name: `Luis Ortega ${RUN}`, firmId: firm, crewId: firmCrew, phone: "(817) 555-0120", homeAddress: HOME, specialties: ["commercial_rtu", "ductwork"], homeRegionId: REGION_SOUTH });
  tech = out.id;
  const row = (await admin(`SELECT org_id, firm_id, home_address, specialties FROM technicians WHERE id = $1`, [tech]))[0]!;
  assert.equal(row.org_id, firm, "a firm's technician is in the firm's tenancy");
  assert.deepEqual(row.home_address, HOME);
  assert.deepEqual(row.specialties, ["commercial_rtu", "ductwork"]);

  const audit = await admin(`SELECT before, after FROM audit_log WHERE event_id = $1`, [out.eventId]);
  assert.equal(audit.length, 1);
  assert.doesNotMatch(JSON.stringify(audit), /Hemphill|76104/, "the audit records that an address was recorded, not where");
  const outbox = await admin(`SELECT topic, payload FROM outbox WHERE event_id = $1`, [out.eventId]);
  assert.equal(outbox[0]!.topic, "technician.recorded");
  assert.doesNotMatch(JSON.stringify(outbox), /Hemphill|76104/);

  const mine = (await owner.gateway.listTechnicians({ firmId: firm })).technicians;
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0]!.homeAddress, HOME);
  assert.equal(mine[0]!.addressRestricted, false);
});

test("an office manager reads the row with the address restricted, and is refused by name when writing one", { skip }, async () => {
  const seen = (await office.gateway.listTechnicians({ firmId: firm })).technicians[0]!;
  assert.equal(seen.homeAddress, null);
  assert.equal(seen.addressRestricted, true);
  assert.equal(seen.phone, "(817) 555-0120");

  await assert.rejects(
    office.gateway.updateTechnician({ technicianId: tech, homeAddress: { line1: "1 Elsewhere" } }),
    (e: unknown) => { const r = refusal(office, e); return r.kind === "admission" && r.code === "address_restricted"; },
  );
  await office.gateway.updateTechnician({ technicianId: tech, specialties: ["refrigeration"] });
  const after = (await admin(`SELECT home_address, specialties FROM technicians WHERE id = $1`, [tech]))[0]!;
  assert.deepEqual(after.home_address, HOME, "an office manager's edit leaves the address where it was");
  assert.deepEqual(after.specialties, ["refrigeration"]);
});

test("a principal reads the address as an account owner does, and may change it", { skip }, async () => {
  const principal = await shellAs("principal.tech@ac.test");
  const seen = (await principal.gateway.listTechnicians({ firmId: firm })).technicians[0]!;
  assert.deepEqual(seen.homeAddress, HOME);
  assert.equal(seen.addressRestricted, false);
  await principal.gateway.updateTechnician({ technicianId: tech, homeAddress: { ...HOME, line2: "Unit B" } });
  assert.deepEqual((await admin(`SELECT home_address FROM technicians WHERE id = $1`, [tech]))[0]!.home_address, { ...HOME, line2: "Unit B" });
  await principal.gateway.updateTechnician({ technicianId: tech, homeAddress: HOME });
});

test("a crew of another employer is refused by the handler, and by 0020's trigger on a path that skips it", { skip }, async () => {
  await assert.rejects(
    owner.gateway.updateTechnician({ technicianId: tech, crewId: ourCrew }),
    (e: unknown) => refusal(owner, e).kind === "admission" && refusal(owner, e).code === "crew_employer_mismatch",
  );
  await assert.rejects(
    admin(`UPDATE technicians SET crew_id = $2 WHERE id = $1`, [tech, ourCrew]),
    (e: unknown) => (e as { code?: string }).code === "AC422",
  );
  await assert.rejects(
    admin(`UPDATE technicians SET specialties = '["plumbing"]'::jsonb WHERE id = $1`, [tech]),
    (e: unknown) => (e as { code?: string }).code === "23514",
    "a specialty off the list is refused by the column's CHECK",
  );
});

test("the roster is internal-only: a firm's own principal reads zero rows, its own technicians included", { skip }, async () => {
  const internal = await asBinding({ "ac.namespace": "internal", "ac.scope_tier": "parent", "ac.region_id": REGION_SOUTH }, `SELECT id FROM technicians WHERE id = $1`, [tech]);
  assert.equal(internal.length, 1);
  const theFirm = await asBinding({ "ac.namespace": "subcontractor", "ac.firm_id": firm, "ac.region_id": REGION_SOUTH }, `SELECT id FROM technicians WHERE firm_id = $1`, [firm]);
  assert.equal(theFirm.length, 0, "S8 is not given the roster");
  const customer = await asBinding({ "ac.namespace": "customer", "ac.org_id": firm }, `SELECT id FROM technicians`);
  assert.equal(customer.length, 0);
});
