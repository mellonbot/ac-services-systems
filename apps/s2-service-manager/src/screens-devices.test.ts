import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp } from "./app.ts";
import { instantOf } from "./screens/devices.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, HierarchyContext } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * D-2a in S2: the devices S5 signs in with, and the shift grant on one. What
 * the gateway admits is services/gateway/src/handlers/devices.test.ts and the
 * wire suite; this holds what the office is offered — only active devices,
 * only technicians' own units, and no key field for a browser.
 */
const U = (n: number) => `e3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(2), FIRM = U(10), UNIT = U(12), INSTALL = U(13), RETIRED = U(14), WEB = U(20), OLD = U(21);

const fakeGateway: FetchLike = (() => {
  const principal: Principal = {
    namespace: "internal", subjectId: "u-1", orgId: "org-internal", regionId: SOUTH, scopeTier: "parent", scopeId: "org-internal",
    roles: ["office_manager"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
  };
  const context: HierarchyContext = {
    principal, path: [{ tier: "parent", id: "org-internal", name: "AC Services" }],
    parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH,
  };
  const docs = { required: [], satisfied: [], unverified: [], expired: [], missing: [], earliestExpiry: null };
  const crew = (id: string, label: string, kind: "service" | "install", active: boolean) =>
    ({ id, label, employmentType: "employed", kind, firmId: null, homeRegionId: SOUTH, active, documents: docs });
  let session = false;
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  return async (url) => {
    const path = new URL(url).pathname;
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "x", expiresAt: "2026-10-22T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [{ id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 0, active: true }] });
    if (path === OPERATIONS["firms.list"].path) return reply(200, { firms: [{ id: FIRM, legalName: "Lone Star Mechanical LLC", status: "active", regionId: SOUTH, settlementTermsDays: 30, msaSignedAt: "2026-03-02", diagnosticDataRightsReserved: true, w9DocumentKey: null, crewCount: 1, activeCrewCount: 1 }] });
    if (path === OPERATIONS["crews.list"].path) return reply(200, { crews: [crew(UNIT, "Marcus Bell", "service", true), crew(INSTALL, "Install Crew 2", "install", true), crew(RETIRED, "Dana Cole", "service", false)] });
    if (path === OPERATIONS["devices.list"].path) return reply(200, { devices: [
      { id: WEB, hardwareId: "RK-WEB-0001", kind: "web_fallback", firmId: null, active: true, orgId: "org-internal", regionId: SOUTH },
      { id: OLD, hardwareId: "LS-TAB-0007", kind: "android_pilot", firmId: FIRM, active: false, orgId: FIRM, regionId: SOUTH },
    ] });
    return reply(200, {});
  };
})();

const settle = () => new Promise((r) => setTimeout(r, 0));
const screenAt = async (screen: "devices" | "devices.new" | "devices.grant", params: Record<string, string> = {}) => {
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: fakeGateway, now: () => 1_000 });
  await app.login("o@ac.test", "pw");
  app.router.navigate(screen, params);
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  return render(app.view());
};

test("the device list names each device's ID, kind and owner, and offers a grant only on an active one", async () => {
  const list = (await screenAt("devices")).split('id="devices"')[1]!;
  assert.match(list, /RK-WEB-0001/);
  assert.match(list, /Web fallback \(browser\)/);
  assert.match(list, /LS-TAB-0007<\/span> <small class="s2-muted">inactive/);
  assert.match(list, /Lone Star Mechanical LLC/);
  assert.match(list, /href="\/devices\/grant\/e3000000-0000-0000-0000-000000000020"/);
  assert.doesNotMatch(list, /devices\/grant\/e3000000-0000-0000-0000-000000000021/, "an inactive device takes no grant");
});

test("a web fallback is registered without a public key — the browser holds none", async () => {
  const form = await screenAt("devices.new");
  assert.match(form, /name="hardwareId"/);
  assert.match(form, /<option value="web_fallback" selected/);
  assert.doesNotMatch(form, /name="publicKey"/);
  assert.match(form, /<option value="e3000000-0000-0000-0000-000000000010">Lone Star Mechanical LLC/);
});

test("the grant form offers active devices and active technician units only, with the chosen device preselected", async () => {
  const form = await screenAt("devices.grant", { deviceId: WEB });
  assert.match(form, /<option value="e3000000-0000-0000-0000-000000000020" selected>RK-WEB-0001/);
  assert.doesNotMatch(form, /LS-TAB-0007/);
  assert.match(form, /Marcus Bell/);
  assert.doesNotMatch(form, /Install Crew 2/, "an install crew is not a technician's unit");
  assert.doesNotMatch(form, /Dana Cole/, "an inactive unit cannot be granted onto");
  assert.match(form, /name="windowStart"/);
  assert.match(form, /name="windowEnd"/);
});

test("instantOf reads the browser's wall clock as an instant", () => {
  assert.equal(instantOf("2026-10-27T06:00"), new Date(2026, 9, 27, 6, 0).toISOString());
});
