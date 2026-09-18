import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { listDevices, registerDevice, grantDeviceShift, resolveDeviceLogin } from "./devices.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";

/**
 * D-2a's primitive, at the handler: which inputs are admissible, that
 * tenancy follows the crew for a grant and the firm for firm-owned hardware,
 * and the pre-authentication lookup `auth.deviceLogin` reads. Whether the
 * database's own constraints agree is test/integration/s3-s5.test.ts.
 */
const U = (n: number) => `d0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const REGION = U(1), FIRM = U(2), DEVICE = U(3), CREW = U(4), TECH = U(5);

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

const ops: Principal = {
  namespace: "internal", subjectId: U(9), orgId: INTERNAL_ORG_ID, regionId: REGION, scopeTier: "parent", scopeId: INTERNAL_ORG_ID,
  roles: ["office_manager"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
let seq = 0;
const uowFor = async (tx: Tx) => createUnitOfWork({ surfaceId: "S2", principal: ops, requestId: "r", now: () => new Date("2026-09-17T12:00:00Z"), newId: () => U(600 + ++seq) }, tx);
const newId = () => U(700 + ++seq);
const region = { id: REGION, code: "SOUTH", name: "South", active: true };

test("registerDevice: ours by default, the firm's own when firmId names an active firm, refused for a terminated one", async () => {
  const ours = await uowFor(scripted([["FROM regions", [region]]]).tx);
  const out = await registerDevice(ours, { hardwareId: "hw-001", kind: "web_fallback", publicKey: "AAA=", regionId: REGION }, newId);
  assert.equal(out.orgId, INTERNAL_ORG_ID);

  const s2 = scripted([["FROM regions", [region]], ["FROM subcontractor_firms", [{ id: FIRM, org_id: FIRM, status: "active", legal_name: "Firm A" }]]]);
  const firmOwned = await uowFor(s2.tx);
  const out2 = await registerDevice(firmOwned, { hardwareId: "hw-002", kind: "android_pilot", publicKey: "AAA=", regionId: REGION, firmId: FIRM }, newId);
  assert.equal(out2.orgId, FIRM, "firm-owned hardware carries the firm's own tenancy, same as a subcontracted crew");

  const s3 = scripted([["FROM regions", [region]], ["FROM subcontractor_firms", [{ id: FIRM, org_id: FIRM, status: "terminated", legal_name: "Firm A" }]]]);
  const terminated = await uowFor(s3.tx);
  await assert.rejects(
    registerDevice(terminated, { hardwareId: "hw-003", kind: "android_pilot", publicKey: "AAA=", regionId: REGION, firmId: FIRM }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "firm_ended",
  );
});

test("registerDevice is a BadInput on a missing hardwareId or an unknown kind", async () => {
  const uow = await uowFor(scripted([["FROM regions", [region]]]).tx);
  await assert.rejects(registerDevice(uow, { kind: "web_fallback", publicKey: "A", regionId: REGION } as never, newId), BadInput);
  await assert.rejects(registerDevice(uow, { hardwareId: "hw", kind: "toaster", publicKey: "A", regionId: REGION } as never, newId), BadInput);
});

const crewRow = { id: CREW, active: true, org_id: INTERNAL_ORG_ID, home_region_id: REGION };
const techRow = { id: TECH, crew_id: CREW };
const window = { windowStart: "2026-09-18T06:00:00Z", windowEnd: "2026-09-18T18:00:00Z" };

test("grantDeviceShift: this device, this crew, this technician, this window — tenancy follows the crew", async () => {
  const s = scripted([
    ["FROM devices WHERE id", [{ id: DEVICE, active: true }]],
    ["FROM crews WHERE id", [crewRow]],
    ["FROM users WHERE id", [techRow]],
    ["FROM device_grants WHERE device_id", []],
  ]);
  const uow = await uowFor(s.tx);
  const out = await grantDeviceShift(uow, U(9), { deviceId: DEVICE, crewId: CREW, technicianId: TECH, ...window }, newId);
  assert.equal(out.orgId, INTERNAL_ORG_ID);
  assert.equal(out.regionId, REGION);
  const write = s.queries.find((q) => q.sql.startsWith("INSERT"));
  assert.match(write!.sql, /INSERT INTO device_grants/);
});

test("grantDeviceShift refuses a technician who is not on the named crew, and an overlapping live grant", async () => {
  const notOnCrew = await uowFor(scripted([
    ["FROM devices WHERE id", [{ id: DEVICE, active: true }]],
    ["FROM crews WHERE id", [crewRow]],
    ["FROM users WHERE id", [{ id: TECH, crew_id: U(99) }]],
  ]).tx);
  await assert.rejects(
    grantDeviceShift(notOnCrew, U(9), { deviceId: DEVICE, crewId: CREW, technicianId: TECH, ...window }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "not_crew_member",
  );

  const overlap = await uowFor(scripted([
    ["FROM devices WHERE id", [{ id: DEVICE, active: true }]],
    ["FROM crews WHERE id", [crewRow]],
    ["FROM users WHERE id", [techRow]],
    ["FROM device_grants WHERE device_id", [{ id: U(50) }]],
  ]).tx);
  await assert.rejects(
    grantDeviceShift(overlap, U(9), { deviceId: DEVICE, crewId: CREW, technicianId: TECH, ...window }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "grant_overlap",
  );
});

test("listDevices maps rows and filters by firmId when given", async () => {
  const rows = [{ id: DEVICE, hardware_id: "hw-1", kind: "web_fallback", firm_id: null, active: true, org_id: INTERNAL_ORG_ID, region_id: REGION }];
  const uow = await uowFor(scripted([["FROM devices", rows]]).tx);
  const out = await listDevices(uow, {});
  assert.equal(out.devices.length, 1);
  assert.equal(out.devices[0]!.hardwareId, "hw-1");
});

// ---------------------------------------------------------------------------
// The pre-authentication lookup `auth.deviceLogin` uses. Pure against a fake
// Tx — there is no principal, so no UnitOfWork exists yet at this point.
// ---------------------------------------------------------------------------
const rawTx = (answers: readonly (readonly [string, unknown[]])[]): Tx => ({
  async setLocal() {},
  async query(sql) {
    for (const [needle, rows] of answers) if (sql.includes(needle)) return rows as never;
    return [] as never;
  },
  async insert() {},
  async commit() {},
  async rollback() {},
});

test("resolveDeviceLogin finds the one live grant for (device, technician) and carries the shift's own tenancy", async () => {
  const tx = rawTx([
    ["FROM devices WHERE hardware_id", [{ id: DEVICE, active: true }]],
    ["FROM device_grants", [{ id: U(60), crew_id: CREW, org_id: INTERNAL_ORG_ID, region_id: REGION, ends_at: "2026-09-18T18:00:00.000Z" }]],
    ["FROM crews WHERE id", [{ label: "Crew A1", active: true }]],
  ]);
  const out = await resolveDeviceLogin(tx, "hw-001", TECH, new Date("2026-09-18T10:00:00Z"));
  assert.ok(out);
  assert.equal(out!.crewLabel, "Crew A1");
  assert.equal(out!.orgId, INTERNAL_ORG_ID);
  assert.equal(out!.shiftEndsAt.toISOString(), "2026-09-18T18:00:00.000Z");
});

test("resolveDeviceLogin returns null for an unknown device, no live grant, or an inactive crew", async () => {
  assert.equal(await resolveDeviceLogin(rawTx([]), "hw-404", TECH, new Date()), null);
  assert.equal(await resolveDeviceLogin(rawTx([["FROM devices WHERE hardware_id", [{ id: DEVICE, active: true }]]]), "hw-001", TECH, new Date()), null);
  const noCrew = rawTx([
    ["FROM devices WHERE hardware_id", [{ id: DEVICE, active: true }]],
    ["FROM device_grants", [{ id: U(61), crew_id: CREW, org_id: INTERNAL_ORG_ID, region_id: REGION, ends_at: "2026-09-18T18:00:00.000Z" }]],
    ["FROM crews WHERE id", [{ label: "Crew A1", active: false }]],
  ]);
  assert.equal(await resolveDeviceLogin(noCrew, "hw-001", TECH, new Date("2026-09-18T10:00:00Z")), null, "a crew stood down mid-shift does not get a token");
});
