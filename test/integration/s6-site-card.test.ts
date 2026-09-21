/**
 * ITEM 9 OVER THE WIRE — the S6 SITE CARD, through the shell, against a
 * spawned gateway and a live PostgreSQL. The card composes seven reads; this
 * file holds that each of them returns the customer's own rows and nothing
 * beside, as migration 0009 makes true — and that the two facts the card
 * derives (a unit's last service, a node's billed subtotal) are derived from
 * the rows and not from a column.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * Read as a facility manager at Austin before 0009: every unit of every
 * customer with its serial (equipment had no policy); the parent's every
 * invoice nationwide (0002's org rule); every invoice line of every customer
 * (no policy); every photo key, part and warranty claim (no policy). Each of
 * those is a test below, asserted the way it now holds.
 *
 * The imagery provider is a stub HTTP server this file runs: the gateway is
 * pointed at it by AC_IMAGERY_URL, so the whole pipe — coordinates off the
 * address, the template, the fetch, the cache, the data: URL — executes.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — item 9 (the S6 site card) was not verified over the wire";
if (!URL_) test("item 9 over the wire", { skip }, () => {});

const PORT = 24080 + Math.floor(Math.random() * 1000);
const TILE_PORT = PORT + 1000;
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `d9000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_FM_AUSTIN = U(3), USER_FM_RENO = U(4), USER_EXEC = U(5), USER_OTHER = U(6);
const PASSWORD = "correct horse battery staple";
const RUN = `d9-${Date.now().toString(36)}`;
const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000" + "01f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

let pool: Pool;
let gateway: ChildProcess;
let tiles: Server;
let tileHits: string[] = [];
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
const customerBinding = (orgId: string, regionId: string, scopeTier: string, scopeId: string, actor: string) => ({
  "ac.namespace": "customer", "ac.org_id": orgId, "ac.region_id": regionId, "ac.scope_tier": scopeTier, "ac.scope_id": scopeId,
  "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": actor, "ac.surface_id": "S6",
});

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-item9-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d9@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash]);

  tiles = createServer((req, res) => {
    tileHits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "image/png" });
    res.end(PNG);
  });
  await new Promise<void>((r) => tiles.listen(TILE_PORT, "127.0.0.1", r));

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    env: {
      ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test",
      AC_IMAGERY_URL: `http://127.0.0.1:${TILE_PORT}/static?c={lat},{lng}&z={zoom}&s={w}x{h}`, AC_IMAGERY_ATTRIBUTION: "© Stub Tiles",
    },
    stdio: ["ignore", "pipe", "pipe"],
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
  await new Promise<void>((r) => tiles?.close(() => r()));
  await pool?.end();
});

const owner = () => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.d9@ac.test", password: PASSWORD } });
const customer = (email: string) => connectShell({ surfaceId: "S6", baseUrl: BASE, fetch, credentials: { email, password: PASSWORD } });
const code = (s: ConnectedShell, e: unknown): string | null => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return "code" in r! ? r!.code : null; };
const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id).sort();

const day = (offset: number, hour: number) => { const d = new Date(Date.now() + offset * 24 * 3600_000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour)).toISOString(); };

let s2: ConnectedShell;
let amped = "", southNode = "", westNode = "", austin = "", austinRoof = "", austinAhu = "", reno = "", renoRoof = "", msa = "";
let other = "", otherNode = "", otherLoc = "", otherSite = "";
let rtu1 = "", rtu2 = "", ef1 = "", renoUnit = "", otherUnit = "";
let pmAustin = "", repairAustin = "", jobReno = "", invoice = "", lineAustin = "", lineReno = "";

test("the office records a site's record — units, contacts, the jobs that named the units — and the fixture the card will be measured against", { skip }, async () => {
  s2 = await owner();
  const a = await s2.gateway.createOrganization({ name: `Amped S9 ${RUN}`, externalRef: RUN, firstRegionNode: { regionId: REGION_SOUTH, name: "Amped / South" } });
  amped = a.orgId; southNode = a.regionNodeId;
  westNode = (await s2.gateway.createAccount({ orgId: amped, tier: "region", regionId: REGION_WEST, name: "Amped / West" })).id;
  austin = (await s2.gateway.createAccount({ orgId: amped, tier: "location", parentId: southNode, name: "Austin", customerGroup: "Southwest" })).id;
  austinRoof = (await s2.gateway.createAccount({
    orgId: amped, tier: "site", parentId: austin, name: "Austin — Roof", externalRef: "ATX-01", timezone: "America/Chicago",
    address: { line1: "4500 Burnet Rd", city: "Austin", state: "TX", postal: "78756", lat: 30.3145, lng: -97.7392 },
  })).id;
  austinAhu = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: austin, name: "Austin — Basement AHU", address: { line1: "4500 Burnet Rd", city: "Austin", state: "TX" } })).id;
  reno = (await s2.gateway.createAccount({ orgId: amped, tier: "location", parentId: westNode, name: "Reno" })).id;
  renoRoof = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: reno, name: "Reno — Roof", address: { line1: "1 Casino Way", city: "Reno", state: "NV", lat: 39.5296, lng: -119.8138 } })).id;
  msa = (await s2.gateway.createContract({ orgId: amped, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: amped, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true })).id;
  await s2.gateway.transitionContract({ contractId: msa, to: "active" });
  await s2.gateway.authorTermOverride({ contractId: msa, scopeTier: "parent", scopeId: amped, termKey: "sla_response", termValue: "4_hour", effectiveFrom: "2026-01-01", orgId: amped, regionId: REGION_SOUTH });

  const o = await s2.gateway.createOrganization({ name: `Other Co ${RUN}`, externalRef: `${RUN}-other`, firstRegionNode: { regionId: REGION_SOUTH, name: "Other / South" } });
  other = o.orgId; otherNode = o.regionNodeId;
  otherLoc = (await s2.gateway.createAccount({ orgId: other, tier: "location", parentId: otherNode, name: "Other — Dallas" })).id;
  otherSite = (await s2.gateway.createAccount({ orgId: other, tier: "site", parentId: otherLoc, name: "Other — Dallas Roof" })).id;
  const otherMsa = (await s2.gateway.createContract({ orgId: other, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: other, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-02-01", effectiveFrom: "2026-02-01", diagnosticDataRightsReserved: false })).id;
  await s2.gateway.transitionContract({ contractId: otherMsa, to: "active" });
  await s2.gateway.authorTermOverride({ contractId: otherMsa, scopeTier: "parent", scopeId: other, termKey: "sla_response", termValue: "48_hour", effectiveFrom: "2026-02-01", orgId: other, regionId: REGION_SOUTH });

  // Units. Two Carriers share a manufacturer row; the exhaust fan names none.
  rtu1 = (await s2.gateway.registerEquipment({ siteId: austinRoof, kind: "rtu", label: "RTU-1", manufacturer: "Carrier", model: "48TC-D08", serial: `4819U-${RUN}-1`, installedOn: "2019-05-14", tonnageMilli: "7500" })).id;
  rtu2 = (await s2.gateway.registerEquipment({ siteId: austinRoof, kind: "rtu", label: "RTU-2", manufacturer: "Carrier", model: "48TC-D08", serial: `4819U-${RUN}-2`, installedOn: "2019-05-14", tonnageMilli: "7500" })).id;
  ef1 = (await s2.gateway.registerEquipment({ siteId: austinRoof, kind: "exhaust", label: "EF-1", model: "Greenheck G-120" })).id;
  renoUnit = (await s2.gateway.registerEquipment({ siteId: renoRoof, kind: "package", label: "PU-1", manufacturer: "Trane", model: "Precedent", serial: `T-${RUN}` })).id;
  otherUnit = (await s2.gateway.registerEquipment({ siteId: otherSite, kind: "rtu", label: "RTU-A", manufacturer: "Carrier", model: "50TC", serial: `OTHER-${RUN}` })).id;
  assert.equal(Number((await admin(`SELECT count(*)::int AS n FROM part_manufacturers WHERE name = 'Carrier'`))[0]!.n), 1, "the dictionary grew by name, once");
  // Refused inputs: a location is not a site; a kind off the list is a 400.
  assert.equal(code(s2, await s2.gateway.registerEquipment({ siteId: austin, kind: "rtu", model: "x" }).catch((e) => e)), "not_a_site");

  // Contacts: the site's own manager, the location's security desk, and others' that must stay theirs.
  await s2.gateway.setContact({ accountId: austinRoof, role: "site_manager", name: "Dana Ortiz", phone: "(512) 555-0100", email: `dana.${RUN}@amped.test`, note: "On site 6a–3p", isPrimary: true });
  await s2.gateway.setContact({ accountId: austin, role: "security", name: "Front desk", phone: "(512) 555-0199" });
  await s2.gateway.setContact({ accountId: reno, role: "site_manager", name: "Reno Manager", phone: "(775) 555-0100", isPrimary: true });
  await s2.gateway.setContact({ accountId: otherSite, role: "site_manager", name: "Other Manager", phone: "(214) 555-0100", isPrimary: true });
  assert.equal(code(s2, await s2.gateway.setContact({ accountId: austinRoof, name: "Nobody" }).catch((e) => e)), "unreachable_contact");

  // Jobs that name units. The PM visit touched both RTUs; the repair touched RTU-2 alone and is still open.
  pmAustin = (await s2.gateway.createJob({ siteId: austinRoof, serviceCode: "PM-Q2", priority: "pm", serviceWindowStart: day(-100, 9), serviceWindowEnd: day(-100, 13), equipmentIds: [rtu1, rtu2] })).id;
  repairAustin = (await s2.gateway.createJob({ siteId: austinRoof, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: day(1, 9), serviceWindowEnd: day(1, 13), equipmentIds: [rtu2] })).id;
  jobReno = (await s2.gateway.createJob({ siteId: renoRoof, serviceCode: "PM-Q2", priority: "pm", serviceWindowStart: day(-30, 9), serviceWindowEnd: day(-30, 13), equipmentIds: [renoUnit] })).id;
  // A unit at another site is refused BEFORE anything is written — and the trigger would have said the same.
  assert.equal(code(s2, await s2.gateway.createJob({ siteId: austinRoof, serviceCode: "X", serviceWindowStart: day(1, 9), serviceWindowEnd: day(1, 13), equipmentIds: [renoUnit] }).catch((e) => e)), "equipment_not_at_site");
  assert.equal(Number((await admin(`SELECT count(*)::int AS n FROM jobs WHERE site_id = $1`, [austinRoof]))[0]!.n), 2);
  await assert.rejects(admin(`INSERT INTO job_equipment (org_id, region_id, job_id, equipment_id) SELECT org_id, region_id, id, $2 FROM jobs WHERE id = $1`, [pmAustin, renoUnit]), /not at the job's site/);

  // The PM visit and Reno's are done. The state ladder is item 4's and is proven in s3-s5.test.ts; here the fact is set directly.
  await admin(`UPDATE jobs SET state = 'complete' WHERE id = ANY($1::uuid[])`, [[pmAustin, jobReno]]);

  // An invoice. Issuance is WS-E's (D13) and has no operation; the read is item 9's, so the row is seeded as the header 0001 defines it —
  // billed to the PARENT, itemised per LOCATION, one line for Austin's PM and one for Reno's.
  invoice = (await admin(
    `INSERT INTO invoices (org_id, region_id, bill_to_tier, bill_to_id, contract_id, billing_path, period_start, period_end, total_minor, currency, issued_at, due_at)
     VALUES ($1, $2, 'parent', $1, $3, 'enterprise_sla', '2026-06-01', '2026-06-30', 128450, 'USD', '2026-07-03T15:00:00Z', '2026-08-17T00:00:00Z') RETURNING id`,
    [amped, REGION_SOUTH, msa]))[0]!.id;
  lineAustin = (await admin(`INSERT INTO invoice_lines (org_id, region_id, invoice_id, location_id, customer_group, job_id, description, quantity_milli, unit_price_minor, amount_minor)
     VALUES ($1, $2, $3, $4, 'Southwest', $5, 'Quarterly PM — RTU-1, RTU-2', 1000, 42500, 42500) RETURNING id`, [amped, REGION_SOUTH, invoice, austin, pmAustin]))[0]!.id;
  lineReno = (await admin(`INSERT INTO invoice_lines (org_id, region_id, invoice_id, location_id, job_id, description, quantity_milli, unit_price_minor, amount_minor)
     VALUES ($1, $2, $3, $4, $5, 'Quarterly PM — PU-1', 1000, 85950, 85950) RETURNING id`, [amped, REGION_WEST, invoice, reno, jobReno]))[0]!.id;

  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'customer',$4,'Austin FM','[]','location',$5,$6,true),
           ($7,$2,$8,'customer',$9,'Reno FM','[]','location',$10,$6,true),
           ($11,$2,$3,'customer',$12,'Amped Exec','[]','parent',$2,$6,true),
           ($13,$14,$3,'customer',$15,'Other FM','[]','location',$16,$6,true)
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, region_id = EXCLUDED.region_id, scope_id = EXCLUDED.scope_id, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, active = true`,
    [USER_FM_AUSTIN, amped, REGION_SOUTH, `fm.austin.${RUN}@amped.test`, austin, hash,
     USER_FM_RENO, REGION_WEST, `fm.reno.${RUN}@amped.test`, reno,
     USER_EXEC, `exec.${RUN}@amped.test`,
     USER_OTHER, other, `fm.${RUN}@other.test`, otherLoc]);
});

let fmAustin: ConnectedShell, fmReno: ConnectedShell, exec: ConnectedShell, otherFm: ConnectedShell;

test("EQUIPMENT: the Austin manager reads Austin's three units with last-serviced DERIVED from the completed PM; Reno's unit is unknown to them; the executive reads both sites", { skip }, async () => {
  fmAustin = await customer(`fm.austin.${RUN}@amped.test`);
  fmReno = await customer(`fm.reno.${RUN}@amped.test`);
  exec = await customer(`exec.${RUN}@amped.test`);
  otherFm = await customer(`fm.${RUN}@other.test`);

  const units = (await fmAustin.gateway.listEquipment({ siteId: austinRoof })).equipment;
  assert.deepEqual(ids(units), [rtu1, rtu2, ef1].sort());
  const byId = new Map(units.map((u) => [u.id, u]));
  assert.equal(byId.get(rtu1)!.manufacturer, "Carrier", "the dictionary's name, joined");
  assert.equal(byId.get(rtu1)!.lastServicedJobId, pmAustin, "the completed PM that named it");
  assert.equal(byId.get(rtu1)!.lastServicedAt, day(-100, 13), "the PM window's end");
  assert.equal(byId.get(rtu1)!.jobCount, 1);
  assert.equal(byId.get(rtu2)!.lastServicedJobId, pmAustin, "the OPEN repair is not a service yet — last serviced is still the PM");
  assert.equal(byId.get(rtu2)!.jobCount, 2);
  assert.equal(byId.get(ef1)!.lastServicedAt, null);
  assert.equal(byId.get(ef1)!.jobCount, 0);
  assert.equal(byId.get(ef1)!.manufacturer, null);

  assert.equal(code(fmAustin, await fmAustin.gateway.listEquipment({ siteId: renoRoof }).catch((e) => e)), "unknown_site", "Reno's site is not a row in this scope — not 'forbidden'");
  assert.equal(code(fmAustin, await fmAustin.gateway.listEquipment({ siteId: otherSite }).catch((e) => e)), "unknown_site");
  assert.equal(code(fmAustin, await fmAustin.gateway.listEquipment({ siteId: austin }).catch((e) => e)), "not_a_site");
  assert.deepEqual(ids((await fmReno.gateway.listEquipment({ siteId: renoRoof })).equipment), [renoUnit]);
  assert.deepEqual(ids((await exec.gateway.listEquipment({ siteId: renoRoof })).equipment), [renoUnit]);
  assert.deepEqual(ids((await exec.gateway.listEquipment({ siteId: austinRoof })).equipment), [rtu1, rtu2, ef1].sort());
  assert.deepEqual(ids((await otherFm.gateway.listEquipment({ siteId: otherSite })).equipment), [otherUnit]);
});

test("CONTACTS: the site's own manager first, then the location's desk marked as the location's — never a sibling's, never another customer's", { skip }, async () => {
  const c = (await fmAustin.gateway.listContacts({ accountId: austinRoof })).contacts;
  assert.deepEqual(c.map((x) => [x.role, x.accountTier, x.name]), [["site_manager", "site", "Dana Ortiz"], ["security", "location", "Front desk"]]);
  assert.equal(c[0]!.accountId, austinRoof); assert.equal(c[1]!.accountId, austin);
  assert.equal(c[0]!.phone, "(512) 555-0100");
  // The AHU site has no contact of its own; it inherits the location's desk and nothing else.
  assert.deepEqual((await fmAustin.gateway.listContacts({ accountId: austinAhu })).contacts.map((x) => x.name), ["Front desk"]);
  assert.equal(code(fmAustin, await fmAustin.gateway.listContacts({ accountId: renoRoof }).catch((e) => e)), "unknown_scope");
  assert.deepEqual((await fmReno.gateway.listContacts({ accountId: renoRoof })).contacts.map((x) => x.name), ["Reno Manager"]);
  assert.deepEqual((await exec.gateway.listContacts({ accountId: austinRoof })).contacts.map((x) => x.name), ["Dana Ortiz", "Front desk"]);
  assert.deepEqual((await otherFm.gateway.listContacts({ accountId: otherSite })).contacts.map((x) => x.name), ["Other Manager"]);
  // The office replaces a contact rather than adding a second; the customer reads the new name.
  const id = c[0]!.id;
  await s2.gateway.setContact({ accountId: austinRoof, contactId: id, role: "site_manager", name: "Dana Ortiz-Reyes", phone: "(512) 555-0100", isPrimary: true });
  const again = (await fmAustin.gateway.listContacts({ accountId: austinRoof })).contacts;
  assert.equal(again.length, 2); assert.equal(again[0]!.name, "Dana Ortiz-Reyes");
});

test("INVOICES: one consolidated parent invoice, read from Austin, shows Austin's line and Austin's subtotal beside the header total; from Reno, Reno's; the executive, both; the other customer, nothing", { skip }, async () => {
  const a = (await fmAustin.gateway.listInvoices({ siteId: austinRoof })).invoices;
  assert.equal(a.length, 1);
  assert.equal(a[0]!.id, invoice);
  assert.equal(a[0]!.billToTier, "parent", "the header is the parent's");
  assert.equal(a[0]!.totalMinor, "128450", "the whole invoice — the consolidation is visible");
  assert.deepEqual(a[0]!.lines.map((l) => l.id), [lineAustin], "but only this location's line is on it");
  assert.equal(a[0]!.subtotalMinor, "42500");
  assert.equal(a[0]!.lines[0]!.amountMinor, "42500", "money is a string of minor units on the wire");
  // Asked without a node: still only the lines this scope may see.
  assert.deepEqual((await fmAustin.gateway.listInvoices({})).invoices[0]!.lines.map((l) => l.id), [lineAustin]);
  const r = (await fmReno.gateway.listInvoices({ siteId: renoRoof })).invoices;
  assert.deepEqual(r[0]!.lines.map((l) => l.id), [lineReno]); assert.equal(r[0]!.subtotalMinor, "85950");
  const e = (await exec.gateway.listInvoices({})).invoices;
  assert.deepEqual(ids(e[0]!.lines), [lineAustin, lineReno].sort()); assert.equal(e[0]!.subtotalMinor, "128450", "the parent's subtotal is the total");
  assert.deepEqual((await exec.gateway.listInvoices({ locationId: reno })).invoices[0]!.lines.map((l) => l.id), [lineReno]);
  assert.deepEqual((await otherFm.gateway.listInvoices({})).invoices, []);
  assert.deepEqual((await fmAustin.gateway.listInvoices({ siteId: austinAhu })).invoices, [], "the AHU site billed nothing — no header is shown for it");
});

test("IMAGERY: the GATEWAY fetches the roof from the configured provider and answers inline — once per site; no coordinates and an invisible site are answers, not errors", { skip }, async () => {
  tileHits = [];
  const a = await fmAustin.gateway.siteImagery({ siteId: austinRoof });
  assert.equal(a.unavailable, null);
  assert.equal(a.lat, 30.3145); assert.equal(a.lng, -97.7392);
  assert.match(a.image!, /^data:image\/png;base64,/);
  assert.equal(a.attribution, "© Stub Tiles");
  assert.deepEqual(tileHits, ["/static?c=30.3145,-97.7392&z=18&s=640x360"], "the template, rendered by the gateway, reached the provider once");
  await exec.gateway.siteImagery({ siteId: austinRoof });
  assert.equal(tileHits.length, 1, "the second principal's read is served from the gateway's cache");
  const b = await fmAustin.gateway.siteImagery({ siteId: austinAhu });
  assert.equal(b.unavailable, "no_coordinates"); assert.equal(b.image, null);
  assert.equal(code(fmAustin, await fmAustin.gateway.siteImagery({ siteId: renoRoof }).catch((e) => e)), "unknown_site");
  assert.equal(tileHits.length, 1, "nothing was fetched for a site that has no coordinates or is not in scope");
});

test("AT THE TABLE: a customer binding reads its own units and lines and zero rows on every job-hung table — and cannot write a unit or a contact", { skip }, async () => {
  const b = customerBinding(amped, REGION_SOUTH, "location", austin, USER_FM_AUSTIN);
  assert.deepEqual((await asBinding(b, `SELECT id FROM equipment ORDER BY id`)).map((r) => r.id), [rtu1, rtu2, ef1].sort(), "Austin's units, not Reno's, not Other Co's — the table was open to all before 0009");
  assert.deepEqual((await asBinding(b, `SELECT id FROM invoice_lines`)).map((r) => r.id), [lineAustin], "one line of a two-line invoice");
  assert.deepEqual((await asBinding(b, `SELECT id FROM invoices`)).map((r) => r.id), [invoice]);
  assert.deepEqual((await asBinding(b, `SELECT name FROM account_contacts ORDER BY name`)).map((r) => r.name), ["Dana Ortiz-Reyes", "Front desk"]);
  assert.equal(Number((await asBinding(b, `SELECT count(*)::int AS n FROM job_equipment`))[0]!.n), 3, "the PM's two and the repair's one — Reno's is not there");
  for (const t of ["job_media", "parts_used", "warranty_cases"]) assert.equal(Number((await asBinding(b, `SELECT count(*)::int AS n FROM ${t}`))[0]!.n), 0, `${t}: zero rows, not an error`);
  // Reno's manager, bound to WEST, sees the invoice header (it has Reno's line) and only Reno's line.
  const rb = customerBinding(amped, REGION_WEST, "location", reno, USER_FM_RENO);
  assert.deepEqual((await asBinding(rb, `SELECT id FROM invoice_lines`)).map((r) => r.id), [lineReno]);
  assert.deepEqual((await asBinding(rb, `SELECT id FROM equipment`)).map((r) => r.id), [renoUnit]);
  // Writing is ours: a raw INSERT under the customer's binding is refused AT THE TABLE, allowlist or no allowlist.
  await assert.rejects(asBinding(b, `INSERT INTO equipment (org_id, region_id, site_id, kind, model) VALUES ($1, $2, $3, 'rtu', 'forged')`, [amped, REGION_SOUTH, austinRoof]), /row-level security/);
  await assert.rejects(asBinding(b, `INSERT INTO account_contacts (org_id, region_id, account_id, name, phone) VALUES ($1, $2, $3, 'forged', '1')`, [amped, REGION_SOUTH, austinRoof]), /row-level security/);
  await assert.rejects(asBinding(b, `UPDATE invoice_lines SET amount_minor = 1 WHERE id = $1`, [lineAustin]).then((r) => { if (r.length === 0) throw new Error("row-level security: zero rows updated"); }), /row-level security/);
  // And through the gateway the surface is refused before any handler runs.
  await assert.rejects(fmAustin.gateway.registerEquipment({ siteId: austinRoof, kind: "rtu", model: "x" }), /S6|surface|not admitted|403/i);
  await assert.rejects(fmAustin.gateway.setContact({ accountId: austinRoof, name: "x", phone: "1" }), /S6|surface|not admitted|403/i);
});

test("THE LEDGER'S ROWS: the customer's jobs at the site carry the units' service in their own words; sign out kills the token", { skip }, async () => {
  const jobs = (await fmAustin.gateway.listJobs({})).jobs;
  assert.deepEqual(ids(jobs), [pmAustin, repairAustin].sort());
  assert.equal(jobs.find((j) => j.id === pmAustin)!.state, "complete");
  // The instants on the wire are UTC and say so — on THIS cluster's clock, whatever it is set to. Before item 9 `to_char` formatted the
  // session's wall time with a "Z" glued on, so a Chicago cluster reported every SLA due time five hours early. The window end is the
  // one instant the fixture typed in ISO; it must come back byte-identical.
  assert.equal(jobs.find((j) => j.id === pmAustin)!.serviceWindowEnd, day(-100, 13));
  const tz = (await admin(`SHOW timezone`))[0]!.TimeZone as string;
  const opened = jobs.find((j) => j.id === repairAustin)!.openedAt;
  const openedRow = (await admin(`SELECT to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc FROM jobs WHERE id = $1`, [repairAustin]))[0]!.utc as string;
  assert.equal(opened, openedRow, `openedAt is the UTC instant (cluster timezone: ${tz})`);
  assert.match(jobs.find((j) => j.id === repairAustin)!.slaDueAt!, /Z$/);
  assert.equal(jobs.find((j) => j.id === repairAustin)!.currentCrewId, null, "still no crew on a customer's row");
  const token = fmAustin.token;
  await fmAustin.logout();
  const r = await fetch(`${BASE}/equipment?siteId=${austinRoof}`, { headers: { authorization: `Bearer ${token}`, "x-ac-surface": "S6" } });
  assert.equal(r.status, 401);
});
