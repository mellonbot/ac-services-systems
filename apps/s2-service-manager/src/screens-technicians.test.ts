import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp } from "./app.ts";
import { addressLine } from "./screens/network-technicians.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, HierarchyContext, TechnicianWire } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * 0020 in S2: each Technician Network tab lists that employer's technicians —
 * name, home address, phone, specialty — and the address column is what the
 * gateway decided for this principal. The redaction itself is the gateway's
 * (services/gateway/src/handlers/technicians.test.ts); this holds that S2 shows
 * "Restricted" rather than an empty cell, and offers the address fields to an
 * account owner only.
 */
const U = (n: number) => `e2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(2), FIRM = U(10), CREW = U(12), TECH = U(20), OURS = U(21);
const HOME = { line1: "905 Hemphill St", city: "Fort Worth", state: "TX", postal: "76104" };

const fakeGateway = (roles: string[]) => {
  const owner = roles.includes("account_owner") || roles.includes("principal");
  const principal: Principal = {
    namespace: "internal", subjectId: "u-1", orgId: "org-internal", regionId: SOUTH, scopeTier: "parent", scopeId: "org-internal",
    roles, firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
  };
  const context: HierarchyContext = {
    principal, path: [{ tier: "parent", id: "org-internal", name: "AC Services" }],
    parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH,
  };
  const tech = (id: string, firmId: string | null, name: string): TechnicianWire => ({
    id, firmId, crewId: firmId ? CREW : null, name, phone: "(817) 555-0120", homeAddress: owner ? HOME : null, addressRestricted: !owner, role: "technician",
    specialties: ["commercial_rtu", "refrigeration"], homeRegionId: SOUTH, active: true,
  });
  let session = false;
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "x", expiresAt: "2026-10-22T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [{ id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 0, active: true }] });
    if (path === OPERATIONS["firms.list"].path) return reply(200, { firms: [{ id: FIRM, legalName: "Lone Star Mechanical LLC", status: "active", regionId: SOUTH, settlementTermsDays: 30, msaSignedAt: "2026-03-02", diagnosticDataRightsReserved: true, w9DocumentKey: null, crewCount: 1, activeCrewCount: 1 }] });
    if (path === OPERATIONS["crews.list"].path) return reply(200, { crews: [{ id: CREW, label: "Lone Star — Crew A", employmentType: "subcontracted", firmId: FIRM, homeRegionId: SOUTH, active: true, documents: { required: [], satisfied: [], unverified: [], expired: [], missing: [], earliestExpiry: null } }] });
    if (path === OPERATIONS["technicians.list"].path) return reply(200, { technicians: [tech(TECH, FIRM, "Luis Ortega"), tech(OURS, null, "Marcus Bell")] });
    return reply(200, {});
  };
  return fetch;
};

const settle = () => new Promise((r) => setTimeout(r, 0));
const screenAt = async (roles: string[], screen: "network" | "network.technician.new", params: Record<string, string>) => {
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: fakeGateway(roles), now: () => 1_000 });
  await app.login("o@ac.test", "pw");
  app.router.navigate(screen, params);
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  return render(app.view());
};

test("a firm's tab lists that firm's technicians — name, home address, phone, specialty, crew — and not ours", async () => {
  const out = await screenAt(["account_owner"], "network", { firmId: FIRM });
  const roster = out.split('id="technicians"')[1]!;
  assert.match(roster, /Luis Ortega/);
  assert.match(roster, /905 Hemphill St, Fort Worth, TX 76104/);
  assert.match(roster, /href="tel:8175550120"><span class="s2-num">\(817\) 555-0120</);
  assert.match(roster, /Commercial RTU, Refrigeration/);
  assert.match(roster, /Lone Star — Crew A/);
  assert.doesNotMatch(roster, /Marcus Bell/, "our own technicians are under AC Services DFW, not under a firm");
});

test("AC Services DFW lists our own technicians", async () => {
  const roster = (await screenAt(["account_owner"], "network", {})).split('id="technicians"')[1]!;
  assert.match(roster, /Marcus Bell/);
  assert.doesNotMatch(roster, /Luis Ortega/);
});

test("any other office role reads the address as Restricted, and the form offers no address fields", async () => {
  const roster = (await screenAt(["office_manager"], "network", { firmId: FIRM })).split('id="technicians"')[1]!;
  assert.match(roster, /Restricted/);
  assert.doesNotMatch(roster, /Hemphill/);
  assert.match(roster, /\(817\) 555-0120/, "phone and specialty stay every office role's");

  const form = await screenAt(["office_manager"], "network.technician.new", { firmId: FIRM });
  assert.doesNotMatch(form, /name="line1"/);
  assert.match(form, /recorded by an account owner/);
  const principalForm = await screenAt(["principal"], "network.technician.new", { firmId: FIRM });
  assert.match(principalForm, /name="line1"/, "a principal records the address as an account owner does");
  const ownerForm = await screenAt(["account_owner"], "network.technician.new", { firmId: FIRM });
  assert.match(ownerForm, /name="line1"/);
  assert.match(ownerForm, /name="specialties" value="commercial_rtu"/);
});

test("addressLine reads an address the way an envelope does", () => {
  assert.equal(addressLine(HOME), "905 Hemphill St, Fort Worth, TX 76104");
  assert.equal(addressLine({ line1: "1 Main", line2: "Apt 4" }), "1 Main, Apt 4");
  assert.equal(addressLine(null), "");
});
