import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS, REREAD_MS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { figures, metShare, money, freshness, densityStatus } from "./screens/common.ts";
import { headline } from "./screens/overview.ts";
import { metricsOf, rowsFor, series } from "./screens/area.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import { OPERATIONS, SURFACES, HQ_METRIC_KEYS, HQ_AREAS, type Principal, type HierarchyContext, type HqMetricsOutput, type HqHistoryOutput } from "../../../packages/contracts/src/index.ts";

/**
 * S4 against a scripted gateway, through the REAL shell and the REAL
 * generated client — only `fetch` is faked. What this holds: the company
 * figure is the sum of the region rows the gateway returned; a rate is two
 * sums divided, and "no data" is not 0%; state is a pill only where the
 * number is a state; the page says how old the figures are; nothing on it
 * can write. Whether the rollup computes the right figures is the worker's,
 * held in test/integration/s4.test.ts.
 */
const U = (n: number) => `e4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INTERNAL = "00000000-0000-0000-0000-000000000003", UNASSIGNED = "00000000-0000-0000-0000-000000000002";
const SOUTH = U(1), WEST = U(2), EXEC = U(3);
const NOW = Date.parse("2026-09-27T15:10:00.000Z");

const exec: Principal = {
  namespace: "internal", subjectId: EXEC, orgId: INTERNAL, regionId: SOUTH, scopeTier: "parent", scopeId: INTERNAL,
  roles: ["principal"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-4",
};
const context: HierarchyContext = {
  principal: exec,
  path: [{ tier: "parent", id: INTERNAL, name: "Rankine Operating Company" }],
  parent: { tier: "parent", id: INTERNAL, name: "Rankine Operating Company", regionId: null, customerGroup: null },
  regions: [], activeRegionId: SOUTH,
};
const v = (regionId: string, metric: string, value: number | string) => ({ regionId, metric, value: String(value) });
const metrics: HqMetricsOutput = {
  day: "2026-09-27", asOf: "2026-09-27T15:00:00.000Z", refreshMinutes: 15,
  regions: [
    { id: SOUTH, code: "SOUTH", name: "South", active: true, placed: true },
    { id: WEST, code: "WEST", name: "West", active: true, placed: true },
    { id: UNASSIGNED, code: "UNASSIGNED", name: "Unassigned (pre-account)", active: true, placed: false },
  ],
  values: [
    v(SOUTH, "sla_closed_30d", 40), v(SOUTH, "sla_met_30d", 36), v(SOUTH, "sla_breached_30d", 4),
    v(WEST, "sla_closed_30d", 10), v(WEST, "sla_met_30d", 10), v(WEST, "sla_breached_30d", 0),
    v(SOUTH, "jobs_open_now", 12), v(WEST, "jobs_open_now", 3), v(SOUTH, "jobs_unassigned_now", 2), v(SOUTH, "jobs_at_risk_now", 1),
    v(SOUTH, "invoiced_minor_30d", "1234500"), v(WEST, "invoiced_minor_30d", "500000"),
    v(SOUTH, "settlements_disputed", 1), v(SOUTH, "settlements_open_minor", "108000"),
    v(SOUTH, "crews_active", 5), v(SOUTH, "crews_cleared_now", 4), v(SOUTH, "min_crew_density", 3),
    v(WEST, "crews_active", 1), v(WEST, "crews_cleared_now", 1), v(WEST, "min_crew_density", 2),
    v(UNASSIGNED, "leads_30d", 9), v(UNASSIGNED, "leads_web_form_30d", 7), v(UNASSIGNED, "leads_call_button_30d", 2),
    v(SOUTH, "service_requests_30d", 6), v(SOUTH, "customers_active", 2), v(WEST, "customers_active", 1),
  ],
};
const history: HqHistoryOutput = {
  metric: "sla_closed_30d", days: 30,
  points: [
    { day: "2026-09-26", regionId: SOUTH, value: "38" }, { day: "2026-09-26", regionId: WEST, value: "9" },
    { day: "2026-09-27", regionId: SOUTH, value: "40" }, { day: "2026-09-27", regionId: WEST, value: "10" },
  ],
};

type Reply = { status: number; body: unknown };
const fakeGateway = (overrides: Partial<Record<string, Reply>> = {}) => {
  let session = false;
  const calls: { path: string; method: string }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method });
    const o = overrides[path];
    if (o) return reply(o.status, o.body);
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "never-held", expiresAt: "2026-09-28T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["hq.metrics"].path) return reply(200, metrics);
    if (path === OPERATIONS["hq.history"].path) return reply(200, history);
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls };
};
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };
const ready = async (overrides?: Partial<Record<string, Reply>>, now = () => NOW) => {
  const g = fakeGateway(overrides);
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now });
  await app.login("exec@rankine.test", "pw");
  render(app.view()); await settle();
  return { app, gateway: g };
};

test("SCREENS and SCREEN_VIEWS agree, and every screen reads through hq.* or signs in — S4 names no write", () => {
  assert.deepEqual(Object.keys(SCREEN_VIEWS).sort(), Object.keys(SCREENS).filter((k) => k !== "login").sort());
  for (const [id, s] of Object.entries(SCREENS)) {
    for (const op of s.uses) assert.ok(op === "auth.login" || OPERATIONS[op].kind === "query", `${id} uses ${op}`);
  }
  assert.deepEqual(SURFACES.S4.writes, [], "the registry still says read only");
  for (const op of Object.values(OPERATIONS)) {
    if ((op.surfaces as readonly string[]).includes("S4")) assert.ok(op.kind !== "mutation" || op.id === "auth.logout", `${op.id} is served to S4 and writes`);
  }
});

test("the register's areas each carry figures, and every figure belongs to an area", () => {
  assert.equal(HQ_AREAS.flatMap((a) => metricsOf(a)).length, HQ_METRIC_KEYS.length);
  for (const a of HQ_AREAS) assert.ok(metricsOf(a).length > 0, a);
});

test("company figures are sums of the region rows; a rate is two sums divided, and nothing closed is not 0%", () => {
  const f = figures(metrics);
  assert.equal(f.of("jobs_open_now"), 15n);
  assert.equal(f.of("invoiced_minor_30d"), 1_734_500n);
  assert.equal(metShare(f), 92, "46 of 50, not the mean of 90% and 100%");
  assert.equal(metShare(f, SOUTH), 90);
  assert.equal(metShare(figures({ ...metrics, values: [] })), null);
  assert.equal(money(1_734_500n), "17,345 USD");
  assert.equal(money(-5_049n), "−50 USD");
});

test("the D14 column is a state: at or above the rule is ok, below it is at risk", () => {
  const f = figures(metrics);
  assert.deepEqual(densityStatus(f, SOUTH), { status: "ok", word: "Meets density" });
  assert.deepEqual(densityStatus(f, WEST), { status: "at_risk", word: "Below density" });
  assert.equal(densityStatus(f, UNASSIGNED), null);
});

test("freshness: current within two refreshes, stale after, and no rollup says so rather than showing zeros", () => {
  assert.equal(freshness(metrics, NOW).status, "ok");
  assert.equal(freshness(metrics, NOW).age, "10 min ago");
  assert.equal(freshness(metrics, NOW + 25 * 60_000).status, "at_risk");
  assert.equal(freshness({ asOf: null, refreshMinutes: 15 }, NOW).word, "No rollup yet");
});

test("headline pills appear only where the number is a state", () => {
  const h = headline(figures(metrics));
  assert.equal(h.service.find((t) => t.label === "At risk now")?.state?.status, "at_risk");
  assert.equal(h.service.find((t) => t.label === "Breached, 30 days")?.state?.status, "breached");
  assert.equal(h.service.find((t) => t.label === "Open jobs")?.state, undefined);
  const quiet = headline(figures({ ...metrics, values: metrics.values.filter((x) => !["jobs_at_risk_now", "sla_breached_30d"].includes(x.metric)) }));
  assert.equal(quiet.service.find((t) => t.label === "At risk now")?.state, undefined, "zero at risk is not a state");
});

test("COMPANY: four areas, the as-of line, the region grid without the unplaced row, and the read-only line", async () => {
  const { app, gateway } = await ready();
  const out = render(app.view());
  assert.match(out, /Rankine Operating Company/);
  for (const a of ["Service &amp; SLA", "Revenue &amp; money", "Network &amp; compliance", "Growth &amp; web"]) assert.match(out, new RegExp(a));
  assert.match(out, /id="as-of"/);
  assert.match(out, /10 min ago/);
  assert.match(out, /92\.0%/);
  assert.match(out, /46 of 50 response clocks/);
  assert.match(out, /17,345 USD/);
  assert.match(out, /9<\/span>/, "leads are counted company-wide");
  assert.match(out, /Below density/);
  assert.doesNotMatch(out, /Not yet placed/, "the unplaced row is growth's, not the region grid's");
  assert.match(out, /Read only/);
  assert.ok(gateway.calls.every((c) => c.method === "GET" || c.path === OPERATIONS["auth.login"].path), "nothing but reads after sign-in");
});

test("AREA: the region table with a company row, the trend per region and in total, and what each figure means", async () => {
  const { app } = await ready();
  app.router.navigate("area", { area: "growth" });
  render(app.view()); await settle();
  let out = render(app.view());
  assert.match(out, /Growth &amp; web by region/);
  assert.match(out, /Not yet placed/, "growth shows where leads wait");
  assert.match(out, /<strong>Company<\/strong>/);
  assert.match(out, /What each figure means/);

  app.router.navigate("area", { area: "service" });
  render(app.view()); await settle();
  out = render(app.view());
  assert.match(out, /id="trends"/);
  assert.match(out, /2026-09-26 → 2026-09-27/);
  assert.doesNotMatch(out, /Not yet placed/);
});

test("series: one line per region and a company line that sums them day by day", () => {
  const s = series(history, rowsFor("service", metrics.regions));
  assert.deepEqual(s.map((x) => x.label), ["Company", "South", "West"]);
  assert.deepEqual(s[0]!.points.map((p) => p.value), [47n, 50n]);
});

test("REGION: one region's every figure, and an unknown id is said plainly", async () => {
  const { app } = await ready();
  app.router.navigate("region", { regionId: WEST });
  let out = render(app.view());
  assert.match(out, /West/);
  assert.match(out, /Below density/);
  assert.match(out, /100\.0%/);
  app.router.navigate("region", { regionId: U(77) });
  out = render(app.view());
  assert.match(out, /No region/);
});

test("before the first rollup the page says so and draws no figures", async () => {
  const { app } = await ready({ [OPERATIONS["hq.metrics"].path]: { status: 200, body: { ...metrics, day: null, asOf: null, values: [] } } });
  const out = render(app.view());
  assert.match(out, /No rollup yet/);
  assert.match(out, /No figures yet/);
  assert.doesNotMatch(out, /s4-areas/);
});

test("the open page re-reads the rollup on its own clock, not on events", async () => {
  let t = NOW;
  const { app, gateway } = await ready(undefined, () => t);
  const before = gateway.calls.filter((c) => c.path === OPERATIONS["hq.metrics"].path).length;
  t += REREAD_MS;
  app.tick();
  render(app.view()); await settle();
  assert.equal(gateway.calls.filter((c) => c.path === OPERATIONS["hq.metrics"].path).length, before + 1);
  assert.ok(!gateway.calls.some((c) => c.path === OPERATIONS["events.stream"].path), "S4 is not realtime");
});

test("a refused read is the heading and the gateway's words", async () => {
  const { app } = await ready({ [OPERATIONS["hq.metrics"].path]: { status: 403, body: { error: "RoleDenied", message: "role dispatcher is not admitted to S4" } } });
  const out = render(app.view());
  assert.match(out, /role dispatcher is not admitted to S4/);
});
