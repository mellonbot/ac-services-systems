import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../../../packages/ui/src/testing.ts";
import { createApp } from "../../app.ts";
import type { FetchLike } from "../../../../../packages/sdk/src/runtime.ts";
import type { Principal, HierarchyContext } from "../../../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../../../packages/contracts/src/index.ts";

/**
 * 0038 — Regions in S2. What the gateway admits is the regions integration
 * test; this holds what the office is offered: the tab for a principal only,
 * every region listed with Unassigned never offered a page, and no create form
 * offering Unassigned or a closed region.
 */
const U = (n: number) => `e5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(2), ME = U(1), UNASSIGNED = U(6), CLOSED = U(7);

const gateway = (roles: string[]): FetchLike => {
  const principal: Principal = {
    namespace: "internal", subjectId: ME, orgId: "org-internal", regionId: SOUTH, scopeTier: "parent", scopeId: "org-internal",
    roles, firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
  };
  const context: HierarchyContext = {
    principal, path: [{ tier: "parent", id: "org-internal", name: "AC Services" }],
    parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH,
  };
  let session = false;
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  return async (url) => {
    const path = new URL(url).pathname;
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "x", expiresAt: "2026-11-01T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [
      { id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 0, active: true, assignable: true },
      { id: UNASSIGNED, code: "UNASSIGNED", name: "Unassigned (pre-account)", timezone: "America/Chicago", minCrewDensity: 0, active: true, assignable: false },
      { id: CLOSED, code: "OKC", name: "Oklahoma City", timezone: "America/Chicago", minCrewDensity: 0, active: false, assignable: false },
    ] });
    if (path === OPERATIONS["firms.list"].path) return reply(200, { firms: [] });
    if (path === OPERATIONS["devices.list"].path) return reply(200, { devices: [] });
    if (path === OPERATIONS["devices.listGrants"].path) return reply(200, { grants: [] });
    return reply(200, {});
  };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
const appFor = async (roles: string[]) => {
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gateway(roles), now: () => 1_000 });
  await app.login("p@ac.test", "pw");
  return { app };
};
const at = async (app: Awaited<ReturnType<typeof appFor>>["app"], screen: Parameters<typeof app.router.navigate>[0], params: Record<string, string> = {}) => {
  app.router.navigate(screen, params);
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  return render(app.view());
};

test("the Regions tab is a principal's; another office role is not offered it", async () => {
  const principal = await appFor(["principal"]);
  assert.match(await at(principal.app, "devices"), /<a class="ac-seg__item"[^>]*href="\/regions">Regions<\/a>/);
  const finance = await appFor(["finance"]);
  assert.doesNotMatch(await at(finance.app, "devices"), /href="\/regions"/);
});

test("the Regions screen lists every region; Unassigned has no page to open, and a closed region says so", async () => {
  const { app } = await appFor(["principal"]);
  const panel = (await at(app, "regions")).split('id="regions"')[1]!;
  assert.match(panel, /South/);
  const unassignedRow = panel.split("Unassigned (pre-account)")[1]!.split("</tr>")[0]!;
  assert.match(unassignedRow, /never offered/);
  assert.doesNotMatch(unassignedRow, /<a /, "Unassigned has no page to open");
  assert.match(panel, /data-tone="ended">Closed/);
});

test("a create form that picks a region offers only regions we serve from", async () => {
  const { app } = await appFor(["principal"]);
  const form = await at(app, "devices.new");
  const options = form.split('name="regionId"')[1]!.split("</select>")[0]!;
  assert.match(options, /South \(SOUTH\)/);
  assert.doesNotMatch(options, /UNASSIGNED|OKC/);
});
