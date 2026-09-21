import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { listEquipment, registerEquipment, listContacts, setContact, listInvoices } from "./site-record.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";

/**
 * Item 9 at the handler: which inputs are admissible, that tenancy follows
 * the node, and that the derived facts are derived. What a customer may SEE
 * is 0009's and is test/integration/s6-site-card.test.ts.
 */
const U = (n: number) => `90000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), SOUTH = U(2), WEST = U(3), SITE = U(4), LOCATION = U(5), REGION_NODE = U(6), OWNER = U(7), INVOICE = U(8), JOB = U(9);

const scripted = (answers: readonly (readonly [string, unknown[]])[]) => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      for (const [needle, rows] of answers) if (sql.includes(needle)) return rows as never;
      return [];
    },
    async insert() {},
    async commit() {},
    async rollback() {},
  };
  return { tx, queries };
};
const office: Principal = {
  namespace: "internal", subjectId: OWNER, orgId: U(100), regionId: SOUTH, scopeTier: "parent", scopeId: U(100),
  roles: ["account_owner"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "s",
};
/** A facility manager whose token is bound to WEST; the site is served from SOUTH. */
const executive: Principal = { ...office, namespace: "customer", orgId: ORG, regionId: WEST, scopeTier: "parent", scopeId: ORG, roles: [] };
let seq = 0;
const uowFor = async (tx: Tx, surface: "S2" | "S6" = "S2", principal: Principal = office) =>
  createUnitOfWork({ surfaceId: surface, principal, requestId: "r", now: () => new Date("2026-09-21T12:00:00Z"), newId: () => U(600 + ++seq) }, tx);
const newId = () => U(700 + ++seq);
const site = { id: SITE, tier: "site", org_id: ORG, region_id: SOUTH, active: true, path: [REGION_NODE, LOCATION, SITE] };
const location = { ...site, id: LOCATION, tier: "location", path: [REGION_NODE, LOCATION] };

test("registerEquipment: tenancy is the site's, the manufacturer grows the global dictionary by name, and the kind is from the list", async () => {
  const s = scripted([["FROM accounts WHERE id", [site]], ["INSERT INTO part_manufacturers", [{ id: U(50) }]]]);
  const out = await registerEquipment(await uowFor(s.tx), { siteId: SITE, kind: "rtu", label: " RTU-3 ", manufacturer: "Carrier", model: "48TC", serial: "SN-1", tonnageMilli: "7500" }, newId);
  assert.ok(out.id && out.eventId);
  const ins = s.queries.find((q) => q.sql.includes("INSERT INTO equipment"))!;
  assert.equal(ins.params[1], ORG); assert.equal(ins.params[2], SOUTH, "derived from the site");
  assert.equal(ins.params[4], U(50), "the manufacturer row's id, not its name");
  assert.equal(ins.params[5], "rtu"); assert.equal(ins.params[6], "RTU-3", "trimmed"); assert.equal(ins.params[10], "7500");
  await assert.rejects(registerEquipment(await uowFor(scripted([]).tx), { siteId: SITE, kind: "furnace" as never, model: "x" }, newId), BadInput);
  await assert.rejects(registerEquipment(await uowFor(scripted([]).tx), { siteId: SITE, kind: "rtu", model: "x", tonnageMilli: "2.5" }, newId), BadInput);
});

test("registerEquipment refuses an invisible node as unknown_site, a location as not_a_site, and is not S6's to write", async () => {
  await assert.rejects(registerEquipment(await uowFor(scripted([]).tx), { siteId: SITE, kind: "rtu", model: "x" }, newId), (e: InputRefused) => e.code === "unknown_site");
  await assert.rejects(registerEquipment(await uowFor(scripted([["FROM accounts WHERE id", [location]]]).tx), { siteId: LOCATION, kind: "rtu", model: "x" }, newId), (e: InputRefused) => e.code === "not_a_site");
  const s = scripted([["FROM accounts WHERE id", [site]]]);
  await assert.rejects(registerEquipment(await uowFor(s.tx, "S6", executive), { siteId: SITE, kind: "rtu", model: "x" }, newId), /may not write "equipment"/);
  assert.ok(!s.queries.some((q) => q.sql.includes("INSERT INTO equipment")), "nothing written");
});

test("listEquipment: last serviced is READ off the completed jobs that named the unit, never off a column", async () => {
  const s = scripted([
    ["FROM accounts WHERE id", [site]],
    ["FROM equipment e", [{
      id: U(20), site_id: SITE, kind: "rtu", label: "RTU-1", manufacturer: "Carrier", model: "48TC", serial: "A", installed_on: "2021-04-01", tonnage_milli: "7500", active: true,
      last_serviced_at: "2026-08-30T17:00:00.000Z", last_serviced_job_id: JOB, last_serviced_service_code: "PM-Q3", job_count: "4",
    }]],
  ]);
  const out = await listEquipment(await uowFor(s.tx, "S6", executive), { siteId: SITE });
  assert.equal(out.equipment.length, 1);
  assert.equal(out.equipment[0]!.lastServicedAt, "2026-08-30T17:00:00.000Z");
  assert.equal(out.equipment[0]!.jobCount, 4);
  const q = s.queries.find((q) => q.sql.includes("FROM equipment e"))!;
  assert.match(q.sql, /job_equipment je JOIN jobs j/, "the LATERAL reads the jobs that named the unit");
  assert.match(q.sql, /j\.state IN \('complete', 'invoiced'\)/, "only a finished job is a service");
  assert.match(q.sql, /array_position\(\$2::text\[\], e\.kind\)/, "ordered as the closed list orders kinds, not alphabetically");
  assert.ok(!/last_serviced/.test(q.sql.split("FROM equipment e")[0]!.replace(/AS last_serviced\w*/g, "")), "no stored last_serviced column is read");
});

test("listContacts asks for the node and its ancestors — nearest first — and nothing beside", async () => {
  const s = scripted([
    ["FROM accounts WHERE id", [site]],
    ["FROM account_contacts c", [
      { id: U(30), account_id: LOCATION, account_name: "Austin", account_tier: "location", role: "site_manager", name: "Dana Ortiz", phone: "512-555-0100", email: null, note: null, is_primary: true, active: true, depth: 2 },
    ]],
  ]);
  const out = await listContacts(await uowFor(s.tx, "S6", executive), { accountId: SITE });
  assert.equal(out.contacts[0]!.accountTier, "location", "inherited from the location, and it says so");
  const q = s.queries.find((q) => q.sql.includes("FROM account_contacts c"))!;
  assert.deepEqual(q.params[0], [SITE, LOCATION, REGION_NODE], "this node first, the region node last — the path reversed");
  assert.match(q.sql, /c\.active/, "a retired contact is not offered to a crew");
});

test("setContact: reachable or refused, one primary per role, tenancy from the node; a replace names the row", async () => {
  await assert.rejects(setContact(await uowFor(scripted([["FROM accounts WHERE id", [site]]]).tx), { accountId: SITE, name: "Nobody" }, newId), (e: InputRefused) => e.code === "unreachable_contact");
  const s = scripted([["FROM accounts WHERE id", [site]]]);
  const out = await setContact(await uowFor(s.tx), { accountId: SITE, name: "Dana Ortiz", phone: "512-555-0100", isPrimary: true }, newId);
  const demote = s.queries.find((q) => q.sql.includes("SET is_primary = false"))!;
  assert.ok(demote, "the previous primary for the role is demoted in the same unit of work");
  assert.equal(demote.params[2], out.id);
  const ins = s.queries.find((q) => q.sql.includes("INSERT INTO account_contacts"))!;
  assert.equal(ins.params[1], ORG); assert.equal(ins.params[2], SOUTH); assert.equal(ins.params[4], "site_manager", "the default role");
  // replace
  const r = scripted([["FROM accounts WHERE id", [site]], ["FROM account_contacts c WHERE c.id", [{ id: U(31), account_id: SITE, role: "site_manager", name: "Old", phone: "1", email: null, note: null, is_primary: false, active: true }]]]);
  await setContact(await uowFor(r.tx), { accountId: SITE, contactId: U(31), name: "New Name", phone: "2" }, newId);
  assert.ok(r.queries.some((q) => q.sql.includes("UPDATE account_contacts SET role")), "an UPDATE, not a second row");
  await assert.rejects(setContact(await uowFor(scripted([["FROM accounts WHERE id", [site]]]).tx), { accountId: SITE, contactId: U(32), name: "X", phone: "1" }, newId), (e: InputRefused) => e.code === "unknown_contact");
});

test("listInvoices: the subtotal is the sum of the lines RLS returned, as a bigint string; the header total rides beside it", async () => {
  const s = scripted([
    ["FROM accounts WHERE id", [site]],
    ["FROM invoice_lines l", [
      { id: U(40), invoice_id: INVOICE, location_id: LOCATION, job_id: JOB, description: "PM visit", quantity_milli: "1000", unit_price_minor: "42500", amount_minor: "42500" },
      { id: U(41), invoice_id: INVOICE, location_id: LOCATION, job_id: JOB, description: "Filters", quantity_milli: "4000", unit_price_minor: "1899", amount_minor: "7596" },
    ]],
    ["FROM invoices WHERE id", [{ id: INVOICE, bill_to_tier: "parent", bill_to_id: ORG, contract_id: U(60), billing_path: "enterprise_sla", period_start: "2026-08-01", period_end: "2026-08-31", total_minor: "1250000", currency: "USD", issued_at: "2026-09-02T00:00:00.000Z", due_at: "2026-10-02T00:00:00.000Z" }]],
  ]);
  const out = await listInvoices(await uowFor(s.tx, "S6", executive), { siteId: SITE });
  assert.equal(out.invoices.length, 1);
  assert.equal(out.invoices[0]!.subtotalMinor, "50096");
  assert.equal(out.invoices[0]!.totalMinor, "1250000", "the consolidated header, untouched");
  assert.equal(out.invoices[0]!.lines.length, 2);
  await assert.rejects(listInvoices(await uowFor(scripted([]).tx), { siteId: SITE, locationId: LOCATION }), BadInput);
  const none = await listInvoices(await uowFor(scripted([["FROM accounts WHERE id", [site]]]).tx), { siteId: SITE });
  assert.deepEqual(none.invoices, [], "no lines, no invoices — the header is not shown for a node it does not bill");
});
