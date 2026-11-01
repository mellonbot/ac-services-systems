import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../db/unit-of-work.ts";
import { listTechnicians, recordTechnician, updateTechnician } from "./technicians.ts";
import { InputRefused, BadInput } from "../http/refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { TECHNICIAN_SPECIALTIES } from "../../../../packages/contracts/src/operations.ts";
import { admissionAxis } from "../../../../packages/contracts/src/refusals.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";
import { TECHNICIAN_SPECIALTIES as COLUMN_SPECIALTIES } from "../../../../packages/schema/src/tables/network.ts";

/**
 * What the HANDLER decides for the 0020 roster: who reads and writes a home
 * address, that a crew belongs to the technician's employer, and that the audit
 * row never carries the address. Internal-only visibility and the crew trigger
 * for every other path are the database's (0020).
 */
const U = (n: number) => `d0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const REGION = U(2), FIRM = U(10), FIRM_CREW = U(12), OUR_CREW = U(13), TECH = U(20);
const HOME = { line1: "4411 Elm St", city: "Garland", state: "TX", postal: "75040" };

const scripted = (answers: Record<string, unknown[]>) => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      for (const [needle, rows] of Object.entries(answers)) if (sql.includes(needle)) return rows as never;
      return [];
    },
    async insert() {},
    async commit() {},
    async rollback() {},
  };
  return { tx, queries };
};

const as = (roles: string[]): Principal => ({
  namespace: "internal", subjectId: U(1), orgId: INTERNAL_ORG_ID, regionId: REGION, scopeTier: "parent", scopeId: INTERNAL_ORG_ID,
  roles, firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
});
const owner = as(["account_owner"]), principalRole = as(["principal"]), office = as(["office_manager"]);
let seq = 0;
const uowFor = async (tx: Tx, p: Principal) =>
  createUnitOfWork({ surfaceId: "S2", principal: p, requestId: "r", now: () => new Date("2026-10-21T15:00:00Z"), newId: () => U(200 + ++seq) }, tx);
const newId = () => U(300 + ++seq);

const techRow = { id: TECH, org_id: FIRM, region_id: REGION, firm_id: FIRM, crew_id: FIRM_CREW, name: "Dee Alvarez", phone: "(214) 555-0101", home_address: HOME, role: "technician", specialties: ["commercial_rtu"], active: true };
const db = () => scripted({
  "FROM technicians": [techRow],
  "FROM regions": [{ id: REGION, active: true, name: "South" }],
  "FROM subcontractor_firms": [{ id: FIRM, org_id: FIRM, legal_name: "Cool Air Partners LLC", status: "active" }],
  "FROM crews WHERE id = $1": [{ id: FIRM_CREW, firm_id: FIRM, label: "Crew CA-1", kind: "service" }],
});

test("the specialty list the wire offers is the list the column's CHECK admits", () => {
  assert.deepEqual([...TECHNICIAN_SPECIALTIES], [...COLUMN_SPECIALTIES]);
});

test("an account owner reads the home address; every other office role reads it as restricted, never as absent", async () => {
  const seen = await listTechnicians(await uowFor(db().tx, owner), {}, owner);
  assert.deepEqual(seen.technicians[0]!.homeAddress, HOME);
  assert.equal(seen.technicians[0]!.addressRestricted, false);

  const hidden = await listTechnicians(await uowFor(db().tx, office), {}, office);
  assert.equal(hidden.technicians[0]!.homeAddress, null);
  assert.equal(hidden.technicians[0]!.addressRestricted, true, "the reader is told it is restricted, not that there is none");
  assert.equal(hidden.technicians[0]!.phone, "(214) 555-0101", "name, phone and specialty are every office role's");
});

test("a firm's technician is the firm's row; the audit says an address was recorded and never what it is", async () => {
  const s = db();
  const uow = await uowFor(s.tx, owner);
  await recordTechnician(uow, { name: "Dee Alvarez", firmId: FIRM, crewId: FIRM_CREW, phone: "(214) 555-0101", homeAddress: HOME, specialties: ["commercial_rtu", "commercial_rtu", "refrigeration"], homeRegionId: REGION }, owner, newId);
  const insert = s.queries.find((q) => q.sql.startsWith("INSERT INTO technicians"))!;
  assert.equal(insert.params[1], FIRM, "tenancy follows the employer");
  assert.equal(insert.params[3], FIRM);
  assert.equal(insert.params[8], JSON.stringify(["commercial_rtu", "refrigeration"]), "a specialty picked twice is held once");
  const { audits, events } = uow.pending();
  assert.equal(events[0]!.topic, "technician.recorded");
  assert.doesNotMatch(JSON.stringify(audits), /Elm St|Garland|75040/, "no address value in the audit row");
  assert.doesNotMatch(JSON.stringify(events), /Elm St|Garland|75040/, "no address value on the event");
});

test("a principal reads, records and changes the home address as an account owner does", async () => {
  const seen = await listTechnicians(await uowFor(db().tx, principalRole), {}, principalRole);
  assert.deepEqual(seen.technicians[0]!.homeAddress, HOME);
  assert.equal(seen.technicians[0]!.addressRestricted, false);
  const s = db();
  await recordTechnician(await uowFor(s.tx, principalRole), { name: "Ana Reyes", homeAddress: HOME, specialties: [], homeRegionId: REGION }, principalRole, newId);
  assert.ok(s.queries.some((q) => q.sql.startsWith("INSERT INTO technicians") && q.params[7] === JSON.stringify(HOME)));
  await updateTechnician(await uowFor(db().tx, principalRole), { technicianId: TECH, homeAddress: null }, principalRole);
});

test("only an account owner records or changes a home address — refused by name, not silently dropped", async () => {
  const uow = await uowFor(db().tx, office);
  await assert.rejects(
    recordTechnician(uow, { name: "Dee", homeAddress: HOME, specialties: [], homeRegionId: REGION }, office, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "address_restricted",
  );
  await assert.rejects(
    updateTechnician(await uowFor(db().tx, office), { technicianId: TECH, homeAddress: null }, office),
    (e: unknown) => e instanceof InputRefused && e.code === "address_restricted",
  );
  // The same role keeps everything else on the row.
  await updateTechnician(await uowFor(db().tx, office), { technicianId: TECH, phone: "(214) 555-0199" }, office);
  assert.equal(admissionAxis("address_restricted"), "structural");
});

test("a crew of another employer is refused: one of ours on a firm's crew, or a firm's tech on our crew", async () => {
  const ours = scripted({ "FROM regions": [{ id: REGION, active: true, name: "South" }], "FROM crews WHERE id = $1": [{ id: FIRM_CREW, firm_id: FIRM, label: "Crew CA-1", kind: "service" }] });
  await assert.rejects(
    recordTechnician(await uowFor(ours.tx, owner), { name: "Sam Ortiz", crewId: FIRM_CREW, specialties: [], homeRegionId: REGION }, owner, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "crew_employer_mismatch",
  );
  const firms = scripted({ "FROM technicians": [techRow], "FROM crews WHERE id = $1": [{ id: OUR_CREW, firm_id: null, label: "DFW-1", kind: "service" }] });
  await assert.rejects(
    updateTechnician(await uowFor(firms.tx, owner), { technicianId: TECH, crewId: OUR_CREW }, owner),
    (e: unknown) => e instanceof InputRefused && e.code === "crew_employer_mismatch",
  );
});

test("0024: a technician is never on an install crew, an installer never on a technician's unit — and a new role is held to the crew already held", async () => {
  const install = scripted({ "FROM regions": [{ id: REGION, active: true, name: "South" }], "FROM crews WHERE id = $1": [{ id: OUR_CREW, firm_id: null, label: "DFW Install 1", kind: "install" }] });
  await assert.rejects(
    recordTechnician(await uowFor(install.tx, owner), { name: "Sam Ortiz", crewId: OUR_CREW, specialties: [], homeRegionId: REGION }, owner, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "crew_role_mismatch" && /never on an install crew/.test(e.message),
  );
  // The same person as a lead installer is admitted, and the role is written.
  const ok = scripted({ "FROM regions": [{ id: REGION, active: true, name: "South" }], "FROM crews WHERE id = $1": [{ id: OUR_CREW, firm_id: null, label: "DFW Install 1", kind: "install" }] });
  await recordTechnician(await uowFor(ok.tx, owner), { name: "Sam Ortiz", crewId: OUR_CREW, role: "lead_installer", specialties: [], homeRegionId: REGION }, owner, newId);
  assert.equal(ok.queries.find((q) => q.sql.startsWith("INSERT INTO technicians"))!.params[9], "lead_installer");
  // Dee is a technician on a service unit; making her an installer there is refused without moving her.
  await assert.rejects(
    updateTechnician(await uowFor(db().tx, owner), { technicianId: TECH, role: "installer" }, owner),
    (e: unknown) => e instanceof InputRefused && e.code === "crew_role_mismatch",
  );
  await assert.rejects(
    updateTechnician(await uowFor(db().tx, owner), { technicianId: TECH, role: "foreman" as never }, owner),
    (e: unknown) => e instanceof BadInput,
  );
});

test("a terminated firm fields no technicians; a specialty off the list and an empty update are 400s", async () => {
  const ended = scripted({ "FROM regions": [{ id: REGION, active: true, name: "South" }], "FROM subcontractor_firms": [{ id: FIRM, org_id: FIRM, legal_name: "Gone Heating Co", status: "terminated" }] });
  await assert.rejects(
    recordTechnician(await uowFor(ended.tx, owner), { name: "X", firmId: FIRM, specialties: [], homeRegionId: REGION }, owner, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "firm_ended",
  );
  await assert.rejects(
    recordTechnician(await uowFor(db().tx, owner), { name: "X", specialties: ["plumbing" as never], homeRegionId: REGION }, owner, newId),
    BadInput,
  );
  await assert.rejects(updateTechnician(await uowFor(db().tx, owner), { technicianId: TECH }, owner), BadInput);
});
