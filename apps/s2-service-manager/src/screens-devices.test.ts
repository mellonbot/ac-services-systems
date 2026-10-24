import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp } from "./app.ts";
import { shiftWindow } from "./screens/devices.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, HierarchyContext, DeviceGrantWire } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * Field devices in S2: the office registers a device and grants a technician
 * login a shift on it — the two rows `auth.deviceLogin` reads besides the
 * login itself. Whether the gateway accepts them is
 * apps/gateway/src/handlers/devices.test.ts and test/integration/logins-app.test.ts.
 */
const U = (n: number) => `e3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(2), FIRM = U(10), UNIT = U(12), TECH = U(20), DEVICE = U(30), RETIRED = U(31);

const fakeGateway = (grants: readonly DeviceGrantWire[]) => {
  const principal: Principal = {
    namespace: "internal", subjectId: "u-1", orgId: "org-internal", regionId: SOUTH, scopeTier: "parent", scopeId: "org-internal",
    roles: ["office_manager"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
  };
  const context: HierarchyContext = {
    principal, path: [{ tier: "parent", id: "org-internal", name: "AC Services" }],
    parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH,
  };
  let session = false;
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "x", expiresAt: "2026-10-22T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [{ id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 0, active: true }] });
    if (path === OPERATIONS["firms.list"].path) return reply(200, { firms: [{ id: FIRM, legalName: "Lone Star Mechanical LLC", status: "active", regionId: SOUTH, settlementTermsDays: 30, msaSignedAt: "2026-03-02", diagnosticDataRightsReserved: true, w9DocumentKey: null, crewCount: 1, activeCrewCount: 1 }] });
    if (path === OPERATIONS["devices.shifts"].path) return reply(200, { technicians: [{ id: TECH, name: "Dana Diaz", email: "dana@ac.test", crewId: UNIT, crewLabel: "Dana Diaz", regionId: SOUTH }], grants });
    if (path === OPERATIONS["devices.list"].path) return reply(200, { devices: [
      { id: DEVICE, hardwareId: "van-12-ipad", kind: "web_fallback", firmId: null, active: true, orgId: "org-internal", regionId: SOUTH },
      { id: RETIRED, hardwareId: "old-tab-3", kind: "yocto_tablet", firmId: FIRM, active: false, orgId: FIRM, regionId: SOUTH },
    ] });
    return reply(200, {});
  };
  return fetch;
};

const settle = () => new Promise((r) => setTimeout(r, 0));
const screen = async (grants: readonly DeviceGrantWire[]) => {
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: fakeGateway(grants), now: () => 1_000 });
  await app.login("o@ac.test", "pw");
  app.router.navigate("devices", {});
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  return render(app.view());
};

test("no shift granted says so: no technician can sign in to the field app until one is", async () => {
  const out = await screen([]);
  assert.match(out, /Field devices/);
  assert.match(out, /No shifts granted\. Until one is, no technician can sign in to the field app\./);
});

test("the grant form offers technician logins and only devices still in service", async () => {
  const out = await screen([]);
  const form = out.split('id="grant-form"')[1]!.split("</form>")[0]!;
  assert.match(form, new RegExp(`<option value="${TECH}">Dana Diaz · dana@ac.test</option>`));
  assert.match(form, new RegExp(`<option value="${DEVICE}">van-12-ipad</option>`));
  assert.doesNotMatch(form, /old-tab-3/, "a retired device opens no shift");
});

test("live and upcoming shifts are listed with their device; the device list names its owner and a retired one", async () => {
  const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const out = await screen([
    { id: U(40), deviceId: DEVICE, hardwareId: "van-12-ipad", technicianId: TECH, technicianName: "Dana Diaz", crewId: UNIT, crewLabel: "Dana Diaz", windowStart: at(-1), windowEnd: at(9) },
    { id: U(41), deviceId: DEVICE, hardwareId: "van-12-ipad", technicianId: TECH, technicianName: "Dana Diaz", crewId: UNIT, crewLabel: "Dana Diaz", windowStart: at(20), windowEnd: at(30) },
  ]);
  const shifts = out.split('id="shifts"')[1]!.split('id="grant-form"')[0]!;
  assert.match(shifts, /On shift now/);
  assert.match(shifts, /Upcoming/);
  const list = out.split('id="device-form"')[0]!.split("Every registered device")[1]!;
  assert.match(list, /Lone Star Mechanical LLC/);
  assert.match(list, /Retired/);
  assert.match(list, /Browser \(web fallback\)/);
});

test("shiftWindow: blank start is now; the window runs for the hours given", () => {
  const now = Date.parse("2026-10-24T13:00:00Z");
  assert.deepEqual(shiftWindow(undefined, "10", now), { windowStart: "2026-10-24T13:00:00.000Z", windowEnd: "2026-10-24T23:00:00.000Z" });
  assert.deepEqual(shiftWindow("", "", now), { windowStart: "2026-10-24T13:00:00.000Z", windowEnd: "2026-10-24T23:00:00.000Z" }, "ten hours when none is typed");
  assert.equal(shiftWindow("2026-10-25T06:00:00Z", "8", now).windowEnd, "2026-10-25T14:00:00.000Z");
});
