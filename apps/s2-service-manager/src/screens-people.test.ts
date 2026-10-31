import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, loginView } from "./app.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, HierarchyContext } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS, PASSWORD_CHANGE_REQUIRED } from "../../../packages/contracts/src/index.ts";

/**
 * 0038 — People in S2. What the gateway admits is test/integration/s2-people.test.ts;
 * this holds what the office is offered: the tab for a principal only, a
 * temporary password shown on the person's page until "Done", a technician
 * whose role is not edited, a grant form whose dead end points here, and the
 * sign-in that asks for a new password when the gateway says so. The
 * temporary password on the person's page is driven in a real browser
 * (tools/ci/drive-s2-people.ts): it appears after a submitted form.
 */
const U = (n: number) => `e5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(2), ME = U(1), DANA = U(3), THEO = U(4), UNIT = U(5);

const gateway = (roles: string[], crews: unknown[] = []): FetchLike => {
  const principal: Principal = {
    namespace: "internal", subjectId: ME, orgId: "org-internal", regionId: SOUTH, scopeTier: "parent", scopeId: "org-internal",
    roles, firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
  };
  const context: HierarchyContext = {
    principal, path: [{ tier: "parent", id: "org-internal", name: "AC Services" }],
    parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH,
  };
  const person = (userId: string, displayName: string, extra: Record<string, unknown>) => ({
    userId, email: `${displayName.split(" ")[0]!.toLowerCase()}@ac.test`, displayName, kind: "staff", roles: ["dispatcher"], scope: "region",
    regionId: SOUTH, regionCode: "SOUTH", crewId: null, crewLabel: null, firmId: null, firmName: null, active: true, mustChangePassword: false, passwordChangedAt: null, ...extra,
  });
  let session = false;
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  return async (url) => {
    const path = new URL(url).pathname;
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "x", expiresAt: "2026-11-01T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [{ id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 0, active: true }] });
    if (path === OPERATIONS["firms.list"].path) return reply(200, { firms: [] });
    if (path === OPERATIONS["crews.list"].path) return reply(200, { crews });
    if (path === OPERATIONS["devices.list"].path) return reply(200, { devices: [{ id: U(20), hardwareId: "RK-WEB-0001", kind: "web_fallback", firmId: null, active: true, orgId: "org-internal", regionId: SOUTH }] });
    if (path === OPERATIONS["devices.listGrants"].path) return reply(200, { grants: [] });
    if (path === OPERATIONS["people.list"].path) return reply(200, { people: [
      person(ME, "Pat Principal", { roles: ["principal"], scope: "org" }),
      person(DANA, "Dana Dispatch", { mustChangePassword: true }),
      person(THEO, "Theo Tech", { kind: "technician", roles: ["technician"], crewId: UNIT, crewLabel: "Theo Tech" }),
    ] });
    return reply(200, {});
  };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
const appFor = async (roles: string[], crews: unknown[] = []) => {
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gateway(roles, crews), now: () => 1_000 });
  await app.login("p@ac.test", "pw");
  return { app };
};
const at = async (app: Awaited<ReturnType<typeof appFor>>["app"], screen: Parameters<typeof app.router.navigate>[0], params: Record<string, string> = {}) => {
  app.router.navigate(screen, params);
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  return render(app.view());
};

test("the People tab is a principal's; another office role is not offered it", async () => {
  const { app } = await appFor(["principal"]);
  assert.match(await at(app, "devices"), /ac-nav__domain-name">People</);
  const other = (await appFor(["office_manager"])).app;
  assert.doesNotMatch(await at(other, "devices"), /ac-nav__domain-name">People</);
});

test("the list says who holds a temporary password, and a technician's employer", async () => {
  const { app } = await appFor(["principal"]);
  const list = (await at(app, "people")).split('id="people"')[1]!;
  assert.match(list, /Dana Dispatch/);
  assert.match(list, /data-tone="pending">Temporary password/);
  assert.match(list, /Technician <small class="s2-muted">ours/);
  assert.match(list, /Company-wide/);
});

test("a technician's page does not offer roles or region; your own page does not offer a reset", async () => {
  const { app } = await appFor(["principal"]);
  const theo = await at(app, "people.person", { userId: THEO });
  assert.match(theo, /role and region follow their unit/);
  assert.doesNotMatch(theo, /name="roles"/);
  assert.match(theo, /id="reset-password"/);
  const me = await at(app, "people.person", { userId: ME });
  assert.doesNotMatch(me, /id="reset-password"/);
  assert.match(me, /Account button/);
});

test("the grant form's dead end points a principal to a new technician login", async () => {
  const { app } = await appFor(["principal"], []);
  assert.match(await at(app, "devices.grant"), /href="\/people\/new\/technician"[^>]*>Make a technician login/);
  const other = (await appFor(["office_manager"], [])).app;
  assert.match(await at(other, "devices.grant"), /A principal makes one in People/);
});

test("sign-in asks for a new password when the gateway refuses the temporary one, and keeps asking on a mismatch", () => {
  const plain = render(loginView({ refusal: null, busy: false }, () => {}));
  assert.doesNotMatch(plain, /name="newPassword"/);
  const asked = render(loginView({ refusal: { kind: "admission", code: PASSWORD_CHANGE_REQUIRED, axis: "structural", message: "Choose a new password." }, busy: false }, () => {}));
  assert.match(asked, /Temporary password/);
  assert.match(asked, /name="newPassword"/);
  assert.match(asked, /name="repeatPassword"/);
  assert.match(asked, /Set password and sign in/);
  const differ = render(loginView({ refusal: { kind: "admission", code: "passwords_differ", axis: "structural", message: "Not the same." }, busy: false }, () => {}));
  assert.match(differ, /name="newPassword"/);
});
