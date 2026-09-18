import { test } from "node:test";
import assert from "node:assert/strict";
import { createShell, connectShell } from "./index.ts";
import { guardedTransport, unconnectedTransport } from "./transport.ts";
import type { Transport } from "../../sdk/src/runtime.ts";
import type { FetchLike } from "../../sdk/src/runtime.ts";
import { GatewayRefusal, type Principal, type HierarchyContext, type EventEnvelope, SUBSCRIBERS, OPERATIONS } from "../../contracts/src/index.ts";

/**
 * The shell's transport obligations, executed. Rev E's lesson: a package with
 * no test file is unexecuted, and a mechanism entry must describe code that
 * has run. Every claim in the S0 paragraph of 05 that involves talking to the
 * gateway has an assertion here against a fake wire.
 */
const dispatcher: Principal = {
  namespace: "internal", subjectId: "u-disp", orgId: "org-ac", regionId: "reg-south",
  scopeTier: "region", scopeId: "reg-south", roles: ["dispatcher"],
  firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
const contextFor = (p: Principal): HierarchyContext => ({
  principal: p,
  path: [{ tier: "parent", id: p.orgId, name: "AC Services" }, { tier: "region", id: p.regionId, name: "South" }],
  parent: { tier: "parent", id: p.orgId, name: "AC Services", regionId: null, customerGroup: null },
  regions: [{ tier: "region", id: p.regionId, name: "South", regionId: p.regionId, customerGroup: null }],
  activeRegionId: p.regionId,
});

/** A scripted transport: each request answers from the queue, or throws the queued error. */
const scripted = (answers: (unknown | Error)[]) => {
  const calls: { op: string; input: unknown }[] = [];
  const t: Transport = {
    request: async (op, input) => {
      calls.push({ op: op.id, input });
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a;
    },
    stream: () => () => {},
  };
  return { t, calls };
};
const down = () => new GatewayRefusal({ kind: "transport", status: null, message: "fetch failed" });
const refused = () => new GatewayRefusal({ kind: "admission", code: "illegal_tier", axis: "structural", message: "payment_terms_days may not be set at location" });

test("a shell without a transport is degraded on first contact and says why", async () => {
  const shell = createShell({ surfaceId: "S3", principal: dispatcher });
  assert.equal(shell.isDegraded(), false, "declared, not yet observed");
  await assert.rejects(shell.gateway.me(), /no transport/);
  assert.equal(shell.isDegraded(), true);
  assert.equal(shell.context, null);
});

test("a transport failure flips degraded; the next answered request clears it — and a REFUSAL is an answer", async () => {
  const { t } = scripted([down(), refused(), { ok: true, surfaces: ["S3"] }]);
  const shell = createShell({ surfaceId: "S3", principal: dispatcher, transport: t });

  await assert.rejects(shell.gateway.health());
  assert.equal(shell.isDegraded(), true, "no answer → degraded");

  await assert.rejects(shell.gateway.health(), (e: unknown) => shell.refusalOf(e)?.kind === "admission");
  assert.equal(shell.isDegraded(), false, "a 422 is a gateway that is up");

  await shell.gateway.health();
  assert.equal(shell.isDegraded(), false);
});

test("the stream drives degraded too: open clears, failed sets", () => {
  const states: ((s: "connecting" | "open" | "closed" | "failed") => void)[] = [];
  const inner: Transport = { request: async () => ({}), stream: (_op, _onEvent, onState) => { states.push(onState); return () => {}; } };
  const shell = createShell({ surfaceId: "S3", principal: dispatcher, transport: inner });
  shell.subscribe(() => {});
  states[0]!("failed");
  assert.equal(shell.isDegraded(), true);
  states[0]!("open");
  assert.equal(shell.isDegraded(), false);
});

test("refusalOf hands a surface the typed refusal and nothing for other errors", () => {
  const shell = createShell({ surfaceId: "S2", principal: { ...dispatcher, scopeTier: "parent", scopeId: "org-ac", roles: ["account_owner"] } });
  const r = shell.refusalOf(refused());
  assert.equal(r?.kind, "admission");
  if (r?.kind === "admission") assert.equal(r.axis, "structural");
  assert.equal(shell.refusalOf(new Error("plain")), null);
  assert.equal(shell.refusalOf("string"), null);
});

test("subscribe dedupes on eventId and filters to the surface's block subscriptions by default", () => {
  let emit: ((e: EventEnvelope) => void) | null = null;
  const inner: Transport = { request: async () => ({}), stream: (_op, onEvent) => { emit = onEvent; return () => {}; } };
  const shell = createShell({ surfaceId: "S3", principal: dispatcher, transport: inner });
  const got: string[] = [];
  shell.subscribe((e) => got.push(`${e.topic}#${e.eventId}`));
  const ev = (topic: EventEnvelope["topic"], eventId: string): EventEnvelope => ({
    topic, eventId, entity: "job", entityId: "j1", regionId: "reg-south", orgId: "org-amped", occurredAt: "2026-09-15T00:00:00Z",
  });
  assert.ok(SUBSCRIBERS.OFC.includes("job.transitioned"));
  assert.ok(!SUBSCRIBERS.OFC.includes("job.created"), "the worker's topic, not the console's");
  emit!(ev("job.transitioned", "e1"));
  emit!(ev("job.transitioned", "e1")); // at-least-once: the relay republished
  emit!(ev("job.created", "e2"));      // not on OFC's declared list
  emit!(ev("sla.breached", "e3"));
  assert.deepEqual(got, ["job.transitioned#e1", "sla.breached#e3"]);
});

test("subscribe with topics:'all' passes every topic through; an explicit list narrows", () => {
  let emit: ((e: EventEnvelope) => void) | null = null;
  const inner: Transport = { request: async () => ({}), stream: (_op, onEvent) => { emit = onEvent; return () => {}; } };
  const shell = createShell({ surfaceId: "S3", principal: dispatcher, transport: inner });
  const all: string[] = [];
  shell.subscribe((e) => all.push(e.topic), { topics: "all" });
  const base = { eventId: "x", entity: "job", entityId: "j", regionId: "r", orgId: "o", occurredAt: "t" } as const;
  emit!({ ...base, topic: "job.created", eventId: "1" });
  emit!({ ...base, topic: "invoice.paid", eventId: "2" });
  assert.deepEqual(all, ["job.created", "invoice.paid"]);
});

test("guardedTransport is what the shell wraps; unconnectedTransport fails every call as transport", async () => {
  const state = { degraded: false };
  const g = guardedTransport(unconnectedTransport(), state);
  await assert.rejects(g.request(OPERATIONS["system.health"], undefined), (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "transport");
  assert.equal(state.degraded, true);
  let last = "";
  g.stream(OPERATIONS["events.stream"], () => {}, (s) => { last = s; });
  assert.equal(last, "failed");
});

// ---------------------------------------------------------------------------
// connectShell — login, hierarchy context, and the principal the GATEWAY says.
// ---------------------------------------------------------------------------
const fakeGateway = (opts: { loginStatus?: number; principal?: Principal } = {}) => {
  const p = opts.principal ?? dispatcher;
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
    if (path === "/auth/login") {
      if (opts.loginStatus && opts.loginStatus !== 200) return reply(opts.loginStatus, { error: "AuthError", code: "bad_claims", message: "invalid credentials" });
      const b = JSON.parse(init.body!) as { surface: string };
      return reply(200, { token: `tok-for-${b.surface}`, expiresAt: "2026-09-16T00:00:00Z", context: {} });
    }
    if (path === "/me") {
      if (init.headers.authorization !== `Bearer tok-for-${init.headers["x-ac-surface"]}`) return reply(401, { error: "AuthError", code: "malformed", message: "no bearer token" });
      return reply(200, contextFor(p));
    }
    return reply(404, { error: "Error", message: `no route ${path}` });
  };
  return { fetch, calls };
};

test("connectShell: login → me → a shell carrying the gateway-resolved principal and context, token attached to every later call", async () => {
  const gw = fakeGateway();
  const shell = await connectShell({ surfaceId: "S3", baseUrl: "https://gw.test", fetch: gw.fetch, credentials: { email: "d@ac", password: "pw" } });
  assert.equal(shell.principal.subjectId, "u-disp");
  assert.equal(shell.context?.activeRegionId, "reg-south");
  assert.equal(shell.token(), "tok-for-S3");
  assert.equal(shell.isDegraded(), false);
  assert.deepEqual(gw.calls.map((c) => new URL(c.url).pathname), ["/auth/login", "/me"]);
  assert.equal(JSON.parse(gw.calls[0]!.init.body!).surface, "S3", "login names the surface so the gateway can check namespace");
  assert.equal(gw.calls[1]!.init.headers["x-ac-surface"], "S3");
});

test("connectShell with a held token skips login", async () => {
  const gw = fakeGateway();
  const shell = await connectShell({ surfaceId: "S3", baseUrl: "https://gw.test", fetch: gw.fetch, credentials: { token: "tok-for-S3" } });
  assert.deepEqual(gw.calls.map((c) => new URL(c.url).pathname), ["/me"]);
  assert.equal(shell.principal.regionId, "reg-south");
});

test("connectShell refuses when the gateway resolves a principal the surface does not serve — the check runs on the gateway's answer, not the surface's claim", async () => {
  const customer: Principal = { ...dispatcher, namespace: "customer", scopeTier: "location", scopeId: "loc-1", roles: [] };
  const gw = fakeGateway({ principal: customer });
  await assert.rejects(
    connectShell({ surfaceId: "S3", baseUrl: "https://gw.test", fetch: gw.fetch, credentials: { token: "tok-for-S3" } }),
    /serves the internal namespace/,
  );
});

test("connectShell surfaces a bad login as a token refusal", async () => {
  const gw = fakeGateway({ loginStatus: 401 });
  await assert.rejects(
    connectShell({ surfaceId: "S3", baseUrl: "https://gw.test", fetch: gw.fetch, credentials: { email: "d@ac", password: "wrong" } }),
    (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "token",
  );
});

test("connectShell in cookie mode: login's token is discarded, every call carries credentials:include, token() is null, logout revokes and stays null", async () => {
  const gw = fakeGateway();
  // The fake gateway authenticates by bearer; in cookie mode nothing script-side holds one, so /me must succeed on the cookie alone.
  // Model that: accept the request when credentials:include is set and no authorization header is present.
  const fetch: FetchLike = async (url, init) => {
    if (new URL(url).pathname !== "/auth/login" && init.credentials === "include" && !init.headers.authorization) {
      const reply = { status: 200, ok: true, json: async () => (new URL(url).pathname === "/me" ? contextFor(dispatcher) : { ok: true, sessionId: "s" }), text: async () => "", body: null };
      gw.calls.push({ url, init });
      return reply;
    }
    return gw.fetch(url, init);
  };
  const shell = await connectShell({ surfaceId: "S3", baseUrl: "https://gw.test", fetch, credentials: { email: "d@ac", password: "pw", session: "cookie" } });
  assert.equal(shell.token(), null, "script never holds the token in cookie mode");
  assert.equal(shell.principal.subjectId, "u-disp");
  for (const c of gw.calls) assert.equal(c.init.credentials, "include", `${c.url} sent without credentials:include`);
  await shell.logout();
  assert.equal(new URL(gw.calls.at(-1)!.url).pathname, "/auth/logout");
  assert.equal(shell.token(), null);
});

test("connectShell resumes a cookie session without logging in", async () => {
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(new URL(url).pathname);
    assert.equal(init.credentials, "include");
    return { status: 200, ok: true, json: async () => contextFor(dispatcher), text: async () => "", body: null };
  };
  const shell = await connectShell({ surfaceId: "S3", baseUrl: "https://gw.test", fetch, credentials: { session: "cookie" } });
  assert.deepEqual(calls, ["/me"]);
  assert.equal(shell.token(), null);
});

test("connectShell bearer mode still retains the token and logout forgets it", async () => {
  const gw = fakeGateway();
  const shell = await connectShell({ surfaceId: "S3", baseUrl: "https://gw.test", fetch: gw.fetch, credentials: { email: "d@ac", password: "pw" } });
  assert.equal(shell.token(), "tok-for-S3");
  await shell.logout().catch(() => {}); // the fake gateway has no /auth/logout route → 404 no_route; the token is forgotten regardless
  assert.equal(shell.token(), null);
});

test("a stream belongs to a page that is showing: closed on pagehide, reopened on pageshow from the cache, dedupe kept across the gap", () => {
  // drive-s6 check 11: six full navigations in, the page on screen could not
  // open a request — the five pages in the back/forward cache each held an
  // event stream, and the browser allows about six connections per origin.
  const opens: ((e: EventEnvelope) => void)[] = [];
  let closed = 0;
  const inner: Transport = { request: async () => ({}), stream: (_op, onEvent) => { opens.push(onEvent); return () => { closed++; }; } };
  const listeners = new Map<string, (ev: { persisted?: boolean }) => void>();
  const page = {
    document: {},
    addEventListener: (t: string, cb: (ev: { persisted?: boolean }) => void) => { listeners.set(t, cb); },
    removeEventListener: (t: string) => { listeners.delete(t); },
  };
  const shell = createShell({ surfaceId: "S3", principal: dispatcher, transport: inner, page });
  const got: string[] = [];
  const states: string[] = [];
  const stop = shell.subscribe((e) => got.push(e.eventId), { topics: "all", onState: (s) => states.push(s) });
  const ev = (eventId: string): EventEnvelope => ({ topic: "job.transitioned", eventId, entity: "job", entityId: "j", regionId: "r", orgId: "o", occurredAt: "t" });
  assert.equal(opens.length, 1);
  opens[0]!(ev("e1"));

  listeners.get("pagehide")!({});
  assert.equal(closed, 1, "hidden → the stream is closed");
  assert.deepEqual(states, ["closed"]);
  listeners.get("pagehide")!({});
  assert.equal(closed, 1, "hiding twice closes once");

  listeners.get("pageshow")!({ persisted: false });
  assert.equal(opens.length, 1, "a fresh load is not a page back from the cache — the shell there is new");
  listeners.get("pageshow")!({ persisted: true });
  assert.equal(opens.length, 2, "back from the cache → the stream reopens");
  opens[1]!(ev("e1")); // republished across the gap
  opens[1]!(ev("e2"));
  assert.deepEqual(got, ["e1", "e2"], "the dedupe set survives the gap");

  stop();
  assert.equal(closed, 2, "unsubscribe closes the live stream");
  assert.equal(listeners.size, 0, "and removes both listeners");
  listeners.get("pagehide")?.({});
  assert.equal(closed, 2);
});

test("under node there is no page: subscribe returns the stream's own stop and listens to nothing", () => {
  let closed = 0;
  const inner: Transport = { request: async () => ({}), stream: () => () => { closed++; } };
  const shell = createShell({ surfaceId: "S3", principal: dispatcher, transport: inner });
  const stop = shell.subscribe(() => {});
  stop();
  assert.equal(closed, 1);
});
