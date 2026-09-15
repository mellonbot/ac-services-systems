import { test } from "node:test";
import assert from "node:assert/strict";
import { httpTransport, parseSseFrame, type FetchLike } from "./runtime.ts";
import { createGatewayClient, GENERATED_METHODS } from "./generated/client.ts";
import { OPERATIONS, OPERATION_IDS } from "../../contracts/src/operations.ts";
import { GatewayRefusal } from "../../contracts/src/refusals.ts";

/**
 * The wire, without a socket. A fake fetch records what the transport sent
 * and answers what the test says; the assertions are about what a surface
 * would see.
 */
type Call = { url: string; init: Parameters<FetchLike>[1] };
const fakeFetch = (answer: (c: Call) => { status: number; body?: unknown; throws?: Error }) => {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const c = { url, init };
    calls.push(c);
    const a = answer(c);
    if (a.throws) throw a.throws;
    return {
      status: a.status, ok: a.status >= 200 && a.status < 300,
      json: async () => a.body, text: async () => JSON.stringify(a.body), body: null,
    };
  };
  return { fetch, calls };
};

const transportWith = (f: FetchLike, extra: Partial<Parameters<typeof httpTransport>[0]> = {}) => {
  const outcomes: boolean[] = [];
  const t = httpTransport({
    baseUrl: "https://gateway.test", surfaceId: "S2", fetch: f,
    token: () => "tok-1", requestId: () => "req-1", onOutcome: (ok) => outcomes.push(ok), ...extra,
  });
  return { t, outcomes };
};

test("the generated client has exactly one method per catalogue operation, named as the catalogue says", () => {
  const client = createGatewayClient({ request: async () => ({}), stream: () => () => {} });
  const expected = OPERATION_IDS.map((id) => OPERATIONS[id].sdkMethod).sort();
  assert.deepEqual(Object.keys(client).sort(), expected);
  assert.deepEqual([...GENERATED_METHODS].sort(), expected);
});

test("a POST carries the body, the surface header, the bearer token and a request id — and hits the catalogue path on the configured origin", async () => {
  const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { id: "ov-1", eventId: "ev-1" } }));
  const { t, outcomes } = transportWith(fetch);
  const client = createGatewayClient(t);
  const out = await client.authorTermOverride({ contractId: "c", scopeTier: "location", scopeId: "loc", termKey: "sla_response", termValue: 4, effectiveFrom: "2026-10-01", orgId: "o", regionId: "r" });
  assert.deepEqual(out, { id: "ov-1", eventId: "ev-1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://gateway.test/s2/terms/override");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(calls[0]!.init.headers["x-ac-surface"], "S2");
  assert.equal(calls[0]!.init.headers.authorization, "Bearer tok-1");
  assert.equal(calls[0]!.init.headers["x-request-id"], "req-1");
  assert.equal(JSON.parse(calls[0]!.init.body!).termKey, "sla_response");
  assert.deepEqual(outcomes, [true]);
});

test("a GET with a query carrier puts the input on the query string and sends no body; undefined fields are omitted", async () => {
  const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { resolved: {}, refused: {} } }));
  const { t } = transportWith(fetch);
  await createGatewayClient(t).resolvedTerms({ nodeId: "site-1", asOf: "2026-02-15" });
  const u = new URL(calls[0]!.url);
  assert.equal(u.pathname, "/terms/resolved");
  assert.equal(u.searchParams.get("nodeId"), "site-1");
  assert.equal(u.searchParams.get("asOf"), "2026-02-15");
  assert.equal(u.searchParams.has("orgId"), false);
  assert.equal(calls[0]!.init.body, undefined);
});

test("no token → no authorization header; login is the unauthenticated case", async () => {
  const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { token: "t", expiresAt: "x", context: {} } }));
  const { t } = transportWith(fetch, { token: () => null });
  await createGatewayClient(t).login({ email: "a@b", password: "p", surface: "S2" });
  assert.equal("authorization" in calls[0]!.init.headers, false);
});

test("a 422 becomes an admission refusal carrying the axis — ratchet is commercial", async () => {
  const { fetch } = fakeFetch(() => ({ status: 422, body: { error: "AdmissionRefused", code: "ratchet_loosened", message: '"sla_response" = 48 at location is LOOSER than 4 inherited from parent' } }));
  const { t, outcomes } = transportWith(fetch);
  await assert.rejects(createGatewayClient(t).authorTermOverride({} as never), (e: unknown) => {
    assert.ok(e instanceof GatewayRefusal);
    assert.equal(e.refusal.kind, "admission");
    if (e.refusal.kind === "admission") { assert.equal(e.refusal.axis, "commercial"); assert.equal(e.refusal.code, "ratchet_loosened"); }
    assert.match(e.message, /LOOSER/);
    return true;
  });
  // A refusal the gateway ANSWERED is not a transport failure. The gateway is up.
  assert.deepEqual(outcomes, [true]);
});

test("401 → token, 403 → scope, 404 SurfaceDisabled → phase_disabled — all reachable outcomes", async () => {
  for (const [status, body, kind] of [
    [401, { error: "AuthError", code: "expired", message: "expired" }, "token"],
    [403, { error: "SurfaceWriteDenied", message: "S3 may not write contract" }, "scope"],
    [404, { error: "SurfaceDisabled", message: "S4 is Phase 2" }, "phase_disabled"],
  ] as const) {
    const { fetch } = fakeFetch(() => ({ status, body }));
    const { t, outcomes } = transportWith(fetch);
    await assert.rejects(t.request(OPERATIONS["session.me"], undefined), (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === kind);
    assert.deepEqual(outcomes, [true], `${status} should count as reachable`);
  }
});

test("a thrown fetch and a 5xx are transport refusals and report unreachable — the only thing that flips degraded", async () => {
  const down = fakeFetch(() => ({ status: 0, throws: new TypeError("fetch failed") }));
  const a = transportWith(down.fetch);
  await assert.rejects(a.t.request(OPERATIONS["system.health"], undefined), (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "transport" && e.refusal.status === null);
  assert.deepEqual(a.outcomes, [false]);

  const broken = fakeFetch(() => ({ status: 503, body: null }));
  const b = transportWith(broken.fetch);
  await assert.rejects(b.t.request(OPERATIONS["system.health"], undefined), (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "transport" && e.refusal.status === 503);
  assert.deepEqual(b.outcomes, [false]);
});

test("the transport never lets a caller choose the origin — every URL starts with baseUrl", async () => {
  const { fetch, calls } = fakeFetch(() => ({ status: 200, body: {} }));
  const { t } = transportWith(fetch);
  const client = createGatewayClient(t);
  await client.health();
  await client.me();
  await client.resolvedTerms({ nodeId: "https://evil.test/x" });
  for (const c of calls) assert.ok(c.url.startsWith("https://gateway.test/"), c.url);
});

test("parseSseFrame reads the gateway's `event: domain` frames and ignores comments and other events", () => {
  const ev = { eventId: "e1", topic: "job.assigned", entity: "assignment", entityId: "j1", regionId: "r", orgId: "o", occurredAt: "2026-09-15T00:00:00Z" };
  assert.deepEqual(parseSseFrame(`event: domain\ndata: ${JSON.stringify(ev)}`), ev);
  assert.equal(parseSseFrame(": keepalive"), null);
  assert.equal(parseSseFrame("event: ping\ndata: {}"), null);
  assert.equal(parseSseFrame("event: domain\ndata: not json"), null);
});

test("cookie-session mode sends credentials:include and never an authorization header; bearer mode sends neither the flag nor a cookie", async () => {
  const cookie = fakeFetch(() => ({ status: 200, body: {} }));
  const c = httpTransport({ baseUrl: "https://gateway.test", surfaceId: "S2", fetch: cookie.fetch, token: () => null, session: "cookie" });
  await c.request(OPERATIONS["session.me"], undefined);
  assert.equal(cookie.calls[0]!.init.credentials, "include");
  assert.equal("authorization" in cookie.calls[0]!.init.headers, false);
  assert.equal(cookie.calls[0]!.init.headers["x-ac-surface"], "S2", "the header the gateway requires of a cookie principal is always sent");

  const bearer = fakeFetch(() => ({ status: 200, body: {} }));
  const b = httpTransport({ baseUrl: "https://gateway.test", surfaceId: "S2", fetch: bearer.fetch, token: () => "tok" });
  await b.request(OPERATIONS["session.me"], undefined);
  assert.equal(bearer.calls[0]!.init.credentials, undefined);
  assert.equal(bearer.calls[0]!.init.headers.authorization, "Bearer tok");
});
