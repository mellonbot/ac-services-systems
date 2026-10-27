import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp } from "./app.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, HierarchyContext, ProjectWire } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * 0024 in S2: a crew is recorded as a technician's unit or an install crew,
 * a person as a technician or an installer, and the crew field offers only
 * the kind their role belongs on. Projects lists what was sold and who sold
 * it, and offers only agreements in force and only foremen. The refusals
 * themselves are the gateway's (handlers/technicians.test.ts, projects.test.ts).
 */
const U = (n: number) => `e3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(2), ORG = U(3), UNIT = U(10), INSTALL = U(11), ACTIVE = U(20), DRAFT = U(21), FOREMAN = U(30);
const docs = { required: [], satisfied: [], unverified: [], expired: [], missing: [], earliestExpiry: null };
const project: ProjectWire = {
  id: U(40), orgId: ORG, regionId: SOUTH, contractId: ACTIVE, customer: "Amped", name: "Austin roof — RTU changeout",
  foremanId: FOREMAN, foremanName: "Blake Keating", serviceWindowStart: "2026-11-02T13:00:00.000Z", serviceWindowEnd: "2026-11-07T05:00:00.000Z", state: "planned", installJobs: 2,
};
const contract = (id: string, state: string) => ({
  id, scopeTier: "parent", scopeId: ORG, kind: "msa", parentContractId: null, billingPath: "enterprise_sla", regionId: SOUTH,
  signedAt: "2026-01-01", effectiveFrom: id === ACTIVE ? "2026-01-01" : "2027-01-01", effectiveTo: null, diagnosticDataRightsReserved: true, documentKey: null, state,
});

const fakeGateway = (): FetchLike => {
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
  return async (url) => {
    const path = new URL(url).pathname;
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "x", expiresAt: "2026-10-24T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [{ id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 0, active: true }] });
    if (path === OPERATIONS["firms.list"].path) return reply(200, { firms: [] });
    if (path === OPERATIONS["crews.list"].path) return reply(200, { crews: [
      { id: UNIT, label: "Marcus's unit", employmentType: "employed", kind: "service", firmId: null, homeRegionId: SOUTH, active: true, documents: docs },
      { id: INSTALL, label: "South Install 1", employmentType: "employed", kind: "install", firmId: null, homeRegionId: SOUTH, active: true, documents: docs },
    ] });
    if (path === OPERATIONS["technicians.list"].path) return reply(200, { technicians: [] });
    if (path === OPERATIONS["organizations.list"].path) return reply(200, { organizations: [{ id: ORG, name: "Amped", kind: "customer", segment: "commercial" }] });
    if (path === OPERATIONS["contracts.list"].path) return reply(200, { contracts: [contract(ACTIVE, "active"), contract(DRAFT, "draft")] });
    if (path === OPERATIONS["projects.list"].path) return reply(200, { projects: [project], foremen: [{ id: FOREMAN, name: "Blake Keating" }] });
    return reply(200, {});
  };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
type TestNode = { readonly type?: unknown; readonly props?: Record<string, unknown> & { readonly children?: unknown } };
const nodesIn = (node: unknown): TestNode[] => {
  if (Array.isArray(node)) return node.flatMap(nodesIn);
  if (!node || typeof node !== "object") return [];
  const current = node as TestNode;
  return [current, ...nodesIn(current.props?.children)];
};
const screenAt = async (screen: "network" | "network.crew.new" | "network.technician.new" | "projects", params: Record<string, string>) => {
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: fakeGateway(), now: () => 1_000 });
  await app.login("o@ac.test", "pw");
  app.router.navigate(screen, params);
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  return render(app.view());
};

test("a crew is recorded as a technician's unit or an install crew, and the network lists which", async () => {
  const form = await screenAt("network.crew.new", {});
  assert.match(form, /<select name="kind"/);
  assert.match(form, /<option value="service">Technician's unit<\/option>/);
  assert.match(form, /<option value="install">Install crew<\/option>/);
  assert.match(form, /A technician is never on an install crew/);

  const network = await screenAt("network", {});
  assert.match(network, /Technician's unit/);
  assert.match(network, /Install crew/);
});

test("a new person is a technician until the office says otherwise, and is offered a unit — never an install crew", async () => {
  const form = await screenAt("network.technician.new", {});
  assert.match(form, /<select name="role"/);
  assert.match(form, /<option value="lead_installer">Lead installer<\/option>/);
  const crewField = form.split('name="crewId"')[1]!.split("</select>")[0]!;
  assert.match(crewField, /Marcus's unit/);
  assert.doesNotMatch(crewField, /South Install 1/, "a technician is never offered an install crew");
});

test("Projects lists what was sold and who sold it, and offers only agreements in force and only foremen", async () => {
  const out = await screenAt("projects", { orgId: ORG });
  const sold = out.split('id="projects"')[1]!.split('id="project-new"')[0]!;
  assert.match(sold, /Austin roof — RTU changeout/);
  assert.match(sold, /Blake Keating/);
  assert.match(sold, /<span class="s2-num">2026-11-02 → 2026-11-07<\/span>/);
  const sell = out.split('id="project-new"')[1]!;
  const agreements = sell.split('name="contractId"')[1]!.split("</select>")[0]!;
  assert.match(agreements, new RegExp(`value="${ACTIVE}"`));
  assert.doesNotMatch(agreements, new RegExp(DRAFT), "nothing is sold under a draft");
  assert.match(sell.split('name="foremanId"')[1]!.split("</select>")[0]!, /Blake Keating/);
});

test("Projects reads by foreman, searches the customers they sold to, and searches every customer account by name", async () => {
  const out = await screenAt("projects", {});
  const foremen = out.split('id="project-foremen"')[1]!.split('id="project-accounts"')[0]!;
  assert.match(foremen, /Blake Keating/);
  const accounts = out.split('id="project-accounts"')[1]!.split('id="projects"')[0]!;
  assert.match(accounts, /aria-label="Search every customer account by name"/);
  assert.match(accounts, /Amped/);
  const sold = out.split('id="projects"')[1]!;
  assert.match(sold, /aria-label="Search the customers sold to"/);
  assert.match(sold, /Sold by/);
  assert.match(sold, /Austin roof — RTU changeout/);
  assert.match(sold, /Find the customer under Customer accounts to record a sale/);
});

test("a project that is recorded says so — the form is reset from a reference held across the await, not from the event", async () => {
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: fakeGateway(), now: () => 1_000 });
  await app.login("o@ac.test", "pw");
  app.router.navigate("projects", { orgId: ORG });
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }

  const values: Record<string, string> = { contractId: ACTIVE, name: "Austin roof — phase 2", foremanId: FOREMAN, from: "2026-11-02", to: "2026-11-06" };
  const RealFormData = globalThis.FormData;
  globalThis.FormData = class { forEach(f: (v: string, k: string) => void) { for (const [k, v] of Object.entries(values)) f(v, k); } } as unknown as typeof FormData;
  let resets = 0;
  // A browser clears currentTarget once dispatch returns, which is the handler's first await.
  const e = { preventDefault() {}, currentTarget: { reset() { resets += 1; } } as unknown };
  try {
    (nodesIn(app.view()).find((n) => n.type === "form" && n.props?.id === "project-form")!.props!.onSubmit as (e: unknown) => void)(e);
    e.currentTarget = null;
    for (let i = 0; i < 4; i++) await settle();
  } finally { globalThis.FormData = RealFormData; }

  const out = render(app.view());
  assert.match(out, /Austin roof — phase 2 recorded/);
  assert.doesNotMatch(out, /ac-refusal/, "a saved project is not shown as refused");
  assert.equal(resets, 1);
});
