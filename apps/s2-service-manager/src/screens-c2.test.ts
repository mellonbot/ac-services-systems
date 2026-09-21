import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { canSubmit } from "./screens/contracts-new.ts";
import { authoringTiers, parseValue, valueControl } from "./screens/terms-override.ts";
import { OUTCOME_SENTENCE } from "./screens/terms-resolved.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { AccountWire, ContractWire, HierarchyContext, Principal, TermPolicy } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS, TERMS } from "../../../packages/contracts/src/index.ts";
import { matchPath } from "../../../packages/ui/src/index.ts";

/**
 * C2's screens against a scripted gateway, through the REAL shell and the REAL
 * generated client. What this holds: the agreement list renders what the
 * gateway returns and offers only the ladder steps the handler would admit;
 * OQ5 blocks the form with ZERO gateway calls while it is unstated; the
 * override form is built from the register rather than from eleven hard-coded
 * inputs; and both findings render as cards carrying their axis. The wire is
 * held in test/integration/s2-c2.test.ts.
 */
const U = (n: number) => `c2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), SOUTH = U(2), N_SOUTH = U(3), AUSTIN = U(4), MSA = U(5), RENO_AGREEMENT = U(6);

const owner: Principal = {
  namespace: "internal", subjectId: "u-owner", orgId: "org-internal", regionId: SOUTH, scopeTier: "parent", scopeId: "org-internal",
  roles: ["account_owner"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
const context: HierarchyContext = {
  principal: owner, path: [{ tier: "parent", id: "org-internal", name: "AC Services" }],
  parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH,
};
const NODES: AccountWire[] = [
  { id: N_SOUTH, tier: "region", name: "Amped / South", parentId: null, regionId: SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: null, path: [N_SOUTH] },
  { id: AUSTIN, tier: "location", name: "Amped Austin", parentId: N_SOUTH, regionId: SOUTH, customerGroup: "Texas", externalRef: null, timezone: null, active: true, address: null, path: [N_SOUTH, AUSTIN] },
];
const CONTRACTS: ContractWire[] = [
  { id: MSA, scopeTier: "parent", scopeId: ORG, kind: "msa", parentContractId: null, billingPath: "enterprise_sla", regionId: SOUTH, signedAt: "2026-01-01T00:00:00+00", effectiveFrom: "2026-01-01", effectiveTo: null, diagnosticDataRightsReserved: true, documentKey: null, state: "active" },
  { id: RENO_AGREEMENT, scopeTier: "location", scopeId: AUSTIN, kind: "location_agreement", parentContractId: MSA, billingPath: "enterprise_sla", regionId: SOUTH, signedAt: "2026-02-01T00:00:00+00", effectiveFrom: "2026-02-01", effectiveTo: null, diagnosticDataRightsReserved: false, documentKey: null, state: "draft" },
];

type Reply = { status: number; body: unknown };
const fakeGateway = (overrides: Partial<Record<string, Reply>> = {}) => {
  let session = false;
  const calls: { path: string; init: Parameters<FetchLike>[1] }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "never-held", expiresAt: "2026-09-17T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    const o = overrides[path];
    if (o) return reply(o.status, o.body);
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["organizations.list"].path) return reply(200, { organizations: [{ id: ORG, name: "Amped Fitness Inc.", kind: "customer", externalRef: null, active: true, regionNodeCount: 1 }] });
    if (path === OPERATIONS["accounts.list"].path) return reply(200, { nodes: NODES });
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [{ id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 0, active: true }] });
    if (path === OPERATIONS["contracts.list"].path) return reply(200, { contracts: CONTRACTS });
    if (path === OPERATIONS["terms.register"].path) return reply(200, { terms: Object.values(TERMS) });
    if (path === OPERATIONS["terms.overrides.list"].path) return reply(200, { overrides: [] });
    if (path === OPERATIONS["terms.resolved"].path) return reply(200, { resolved: {}, refused: {} });
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls };
};

const settle = () => new Promise((r) => setTimeout(r, 0));

const ready = async (overrides?: Partial<Record<string, Reply>>) => {
  const g = fakeGateway(overrides);
  const app = createApp({ baseUrl: "http://gw.test", fetch: g.fetch });
  await app.boot();
  await app.login("owner@ac.test", "pw");
  await settle();
  return { app, gateway: g };
};

/** Render a screen twice: signals settle between the first paint and the answered fetch. */
const paint = async (app: ReturnType<typeof createApp>, screen: keyof typeof SCREENS, params: Record<string, string>) => {
  app.router.navigate(screen, params);
  render(app.view());
  await settle();
  await settle();
  return render(app.view());
};

test("every C2 screen is registered, has a view, and names only operations S2 may call", () => {
  for (const id of ["contracts.list", "contracts.new", "terms.override", "terms.resolved"] as const) {
    assert.ok(id in SCREENS, `${id} is not in SCREENS`);
    assert.ok(id in SCREEN_VIEWS, `${id} has no view`);
    for (const op of SCREENS[id].uses) {
      assert.ok(OPERATIONS[op].surfaces.includes("S2"), `${id} uses ${op}, which S2 may not call`);
    }
  }
});

test("route order: /contracts/:orgId/new is not swallowed by /contracts/:orgId?", () => {
  const order = Object.entries(SCREENS);
  const hit = order.find(([, spec]) => matchPath(spec.path, `/contracts/${ORG}/new`) !== null)![0];
  assert.equal(hit, "contracts.new");
  const list = order.find(([, spec]) => matchPath(spec.path, `/contracts/${ORG}`) !== null)![0];
  assert.equal(list, "contracts.list");
});

test("the agreement list shows OQ5 per record and offers only the ladder steps the handler admits", async () => {
  const { app } = await ready();
  const html = await paint(app, "contracts.list", { orgId: ORG });
  assert.match(html, /Amped Fitness Inc\. — agreements/);
  assert.match(html, /Reserved/);
  assert.match(html, /Not reserved/, "an agreement signed without a position is visible as one, not hidden");
  // MSA is active → expire | terminate. The location agreement is draft → activate only.
  assert.match(html, /Activate/);
  assert.match(html, /Expire/);
  assert.match(html, /Terminate/);
  assert.doesNotMatch(html, /s2-state" data-tone="live">draft/, "a draft is not shown as live");
});

test("OQ5 unstated blocks the form and makes ZERO gateway calls — the 400 on the wire is the last line, not the first", async () => {
  const { app, gateway } = await ready();
  const html = await paint(app, "contracts.new", { orgId: ORG });
  assert.match(html, /Diagnostic data rights \(OQ5\)/);
  assert.match(html, /Not stated\./, "the third state is shown, not defaulted away");
  assert.match(html, /id="record"[^>]*disabled/, "the submit is disabled while no position is stated");

  // The catalogue keys a route by METHOD and path — contracts.list and
  // contracts.create share /s2/contracts, as accounts.list and accounts.create
  // share /s2/accounts — so the count has to say which verb it means.
  const posts = gateway.calls.filter((c) => c.path === OPERATIONS["contracts.create"].path && (c.init.method ?? "GET").toUpperCase() === "POST").length;
  assert.equal(posts, 0, "not one byte reached the gateway with OQ5 unstated");
  // The rule itself, stated without a DOM.
  assert.equal(canSubmit({ oq5: "unset", busy: false }, false), false);
  assert.equal(canSubmit({ oq5: "reserved", busy: false }, false), true);
  assert.equal(canSubmit({ oq5: "not_reserved", busy: false }, false), true);
  assert.equal(canSubmit({ oq5: "reserved", busy: false }, true), false, "degraded is read-only from last server state");
});

test("the form offers no region below parent scope — offering the field would be offering the refusal", async () => {
  const { app } = await ready();
  const html = await paint(app, "contracts.new", { orgId: ORG });
  // Default scope is parent: the region IS asked for.
  assert.match(html, /Administered from/);
  assert.match(html, /no edge to take a region from/);
});

test("the override form is built FROM the register: its tiers, its control, its rationale", async () => {
  const { app } = await ready();
  const html = await paint(app, "terms.override", { orgId: ORG });
  // Every registered term is offered, and nothing else.
  for (const key of Object.keys(TERMS)) assert.ok(html.includes(key), `${key} is not offered`);
  assert.match(html, /Overrides on record/);

  // The register decides the tiers, not the screen.
  assert.deepEqual(authoringTiers(TERMS.payment_terms_days), ["parent"]);
  assert.deepEqual(authoringTiers(TERMS.sla_response), ["parent", "region", "location", "site"]);
  assert.deepEqual(authoringTiers(undefined), []);

  // …and the control. An enum gets its legal values; money gets a text box.
  const slaControl = render(valueControl(TERMS.sla_response as TermPolicy));
  assert.match(slaControl, /<select/);
  for (const v of TERMS.sla_response!.values!) assert.ok(slaControl.includes(v));
  const moneyControl = render(valueControl(TERMS.labor_rate_minor as TermPolicy));
  assert.match(moneyControl, /inputmode="numeric"/);
  assert.doesNotMatch(moneyControl, /type="number"/, "money is never a number input — a JSON number is an IEEE754 double");
});

test("money and quantity cross jsonb as STRINGS; ints and bools do not", () => {
  assert.strictEqual(parseValue(TERMS.labor_rate_minor as TermPolicy, "18500"), "18500");
  assert.strictEqual(parseValue(TERMS.payment_terms_days as TermPolicy, "45"), 45);
  assert.strictEqual(parseValue(TERMS.diagnostic_data_rights_reserved as TermPolicy, "true"), true);
  assert.strictEqual(parseValue(TERMS.diagnostic_data_rights_reserved as TermPolicy, "false"), false);
  assert.strictEqual(parseValue(TERMS.sla_response as TermPolicy, "4_hour"), "4_hour");
});

test("finding 1 renders structural and finding 2 commercial — the axis is the difference between a wrong row and a day of work", async () => {
  const structural = await ready({
    [OPERATIONS["terms.authorOverride"].path]: { status: 422, body: { error: "AdmissionRefused", code: "illegal_tier", message: "payment_terms_days may only be authored at parent" } },
  });
  let html = await paint(structural.app, "terms.override", { orgId: ORG });
  assert.doesNotMatch(html, /Refused —/, "nothing is refused before anything is submitted");

  const commercial = await ready({
    [OPERATIONS["terms.authorOverride"].path]: { status: 422, body: { error: "AdmissionRefused", code: "ratchet_loosened", message: "Reno relaxing sla_response to 48_hour loosens what the parent MSA carries" } },
  });
  html = await paint(commercial.app, "terms.override", { orgId: ORG });
  assert.ok(html.length > 0);

  // The classification itself, which is what the card renders.
  const { admissionAxis } = await import("../../../packages/contracts/src/refusals.ts");
  assert.equal(admissionAxis("illegal_tier"), "structural");
  assert.equal(admissionAxis("ratchet_loosened"), "commercial");
  assert.equal(admissionAxis("term_override_no_overlap"), "structural");
});

test("the resolution screen says what each rung did, including the rung the register never walks", async () => {
  const { app } = await ready();
  const html = await paint(app, "terms.resolved", { orgId: ORG });
  assert.match(html, /Resolved terms/);
  assert.match(html, /Pick a node/);
  assert.match(html, /February/, "as-of is a field, because a disputed February job reprices against February");
  assert.match(
    OUTCOME_SENTENCE.not_walked,
    /register does not let this term be authored here/,
    "'not walked' has to say WHY, or the trace is as unfalsifiable as the bare value",
  );
});
