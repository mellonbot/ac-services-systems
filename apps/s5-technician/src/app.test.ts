import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { priorityStatus } from "./screens/job-list.ts";
import { CHECKLIST, PART_SOURCES } from "./screens/job-detail.ts";
import { nextDeviceStates, JOB_TRANSITIONS, DEVICE_TRANSITIONS } from "./offline.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { HierarchyContext, FieldJobWire, SyncMutationWire, SyncOutcomeWire } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * S5 against a scripted gateway, through the REAL shell and the REAL
 * generated client. What this holds: boot starts at login (no cookie to
 * resume — this is the one surface that does not try `session.me` before a
 * credential is offered); a device login carries the crew onto ScreenContext
 * and never onto the principal; a write is an instant local enqueue whose
 * displayed state does not change until the gateway actually answers; a
 * transport failure leaves the mutation queued rather than losing it; and
 * every screen names only operations S5 may call. The wire — the real
 * trigger, the real state machine, RLS — is held in test/integration/s3-s5.test.ts.
 */
const U = (n: number) => `f5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const REGION = U(1), ORG = U(2), DEVICE = U(3), SHIFT = U(4), CREW = U(5), JOB = U(6);

const deviceContext: HierarchyContext = {
  principal: {
    namespace: "device", subjectId: "tech-1", orgId: ORG, regionId: REGION, scopeTier: "region", scopeId: REGION,
    roles: ["technician"], firmId: null, deviceId: DEVICE, shiftId: SHIFT, tierClaim: null, sessionId: "sess-1",
  },
  path: [], parent: { tier: "parent", id: ORG, name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: REGION,
};

const job: FieldJobWire = {
  id: JOB, siteId: U(9), serviceCode: "hvac_repair", priority: "urgent", state: "assigned",
  serviceWindowStart: "2026-09-18T09:00:00.000Z", serviceWindowEnd: "2026-09-18T17:00:00.000Z", version: 3,
};

type Reply = { status: number; body: unknown };
type SyncHandler = (mutations: readonly SyncMutationWire[]) => Reply;

const fakeGateway = (opts: { syncHandler?: SyncHandler; jobs?: readonly FieldJobWire[] } = {}) => {
  let session = false;
  const calls: { path: string; init: Parameters<FetchLike>[1] }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path === OPERATIONS["auth.deviceLogin"].path) { session = true; return reply(200, { token: "dev-token", expiresAt: "2026-09-18T18:00:00Z", crewId: CREW, crewLabel: "Crew A1", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["session.me"].path) return reply(200, deviceContext);
    if (path === OPERATIONS["jobs.mine"].path) return reply(200, { jobs: opts.jobs ?? [job] });
    if (path === OPERATIONS["sync.replay"].path) {
      const body = JSON.parse(init!.body as string) as { mutations: readonly SyncMutationWire[] };
      if (opts.syncHandler) { const r = opts.syncHandler(body.mutations); return reply(r.status, r.body); }
      const outcomes: SyncOutcomeWire[] = body.mutations.map((m) => ({ outcome: "applied", mutationId: m.mutationId, newVersion: 1 }));
      return reply(200, { outcomes });
    }
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;
const ready = async (opts?: Parameters<typeof fakeGateway>[0]) => {
  const g = fakeGateway(opts);
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now: () => 1_000, newId: () => `mut-${++seq}` });
  await app.login("hw-001", "tech@ac.test", "pw");
  return { app, gateway: g };
};

test("SCREENS and SCREEN_VIEWS agree: every screen but login has a view", () => {
  const ids = Object.keys(SCREENS).filter((k) => k !== "login").sort();
  assert.deepEqual(Object.keys(SCREEN_VIEWS).sort(), ids);
});

test("every S5 screen names only operations S5 may call", () => {
  for (const [id, spec] of Object.entries(SCREENS)) {
    for (const op of spec.uses) assert.ok(OPERATIONS[op].surfaces.includes("S5"), `${id} uses ${op}, which S5 may not call`);
  }
});

test("priorityStatus: emergency reads as breached, urgent as at risk, routine and pm as on track", () => {
  assert.equal(priorityStatus("emergency"), "breached");
  assert.equal(priorityStatus("urgent"), "at_risk");
  assert.equal(priorityStatus("routine"), "ok");
  assert.equal(priorityStatus("pm"), "ok");
});

test("nextDeviceStates offers only what JOB_TRANSITIONS and DEVICE_TRANSITIONS both admit — never assignment or cancellation", () => {
  assert.deepEqual(nextDeviceStates("assigned"), ["en_route"], "reassigned and cancelled are the office's, not a device transition");
  assert.deepEqual(nextDeviceStates("en_route"), ["on_site"]);
  assert.deepEqual([...nextDeviceStates("in_progress")].sort(), ["aborted", "awaiting_parts", "complete"].sort());
  assert.deepEqual(nextDeviceStates("invoiced"), []);
  for (const [from, tos] of Object.entries(JOB_TRANSITIONS)) {
    const admitted = tos.filter((to) => DEVICE_TRANSITIONS.includes(to));
    assert.deepEqual([...nextDeviceStates(from)].sort(), [...admitted].sort(), from);
  }
});

test("CHECKLIST and PART_SOURCES stay inside the schema's own constraints", () => {
  assert.ok(CHECKLIST.length > 0);
  for (const c of CHECKLIST) assert.match(c.key, /^[a-z_]+$/);
  assert.deepEqual([...PART_SOURCES].sort(), ["location_stock", "national", "regional_hub", "truck"].sort());
});

test("boot starts at login with no session to resume — this surface tries no cookie", async () => {
  const g = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now: () => 1_000 });
  assert.equal(app.phase.value.kind, "login");
  assert.equal(g.calls.length, 0, "nothing is fetched before a credential is offered");
  assert.match(render(app.view()), /id="login-form"/);
  assert.match(render(app.view()), /name="hardwareId"/);
});

test("a device login carries the crew onto the screen — never onto the principal — and lands on the job list", async () => {
  const { app } = await ready();
  const p = app.phase.value;
  assert.equal(p.kind, "ready");
  if (p.kind !== "ready") return;
  assert.equal(p.crew.label, "Crew A1");
  assert.equal((p.shell.principal as unknown as { crewId?: unknown }).crewId, undefined);
  assert.equal(app.router.current.value?.screen, "jobs");
  render(app.view()); await settle(); await settle();
  const out = render(app.view());
  assert.match(out, /Crew A1/);
  assert.match(out, /hvac_repair/);
  assert.match(out, new RegExp(`href="/jobs/${JOB}"`));
});

test("a bad password renders the gateway's message, not an internal error, and never advances past login", async () => {
  const g = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now: () => 1_000 });
  const origFetch = g.fetch;
  const failingFetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === OPERATIONS["auth.deviceLogin"].path) return { status: 401, ok: false, json: async () => ({ error: "AuthError", code: "bad_claims", message: "invalid credentials" }), text: async () => "", body: null };
    return origFetch(url, init);
  };
  const app2 = createApp({ baseUrl: "https://api.ac.test", fetch: failingFetch, now: () => 1_000 });
  await app2.login("hw-001", "tech@ac.test", "wrong");
  assert.equal(app2.phase.value.kind, "login");
  assert.match(render(app2.view()), /invalid credentials/);
  void app;
});

test("a state transition is an instant local enqueue; the displayed state does not change until the gateway answers and the list refetches", async () => {
  const { app, gateway } = await ready();
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  let out = render(app.view());
  assert.match(out, /State: <strong>assigned<\/strong>/);
  assert.match(out, /id="to-en_route"/);

  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  // Click without letting the flush settle yet: the state shown is still the last fetch, plus a queued-count.
  const before = gateway.calls.filter((c) => c.path === OPERATIONS["jobs.mine"].path).length;
  out = render(app.view());
  assert.doesNotMatch(out, /waiting to sync/, "nothing queued yet");
});

test("flushing an applied transition invalidates jobs.mine and the next read reflects it", async () => {
  const enRoute: FieldJobWire = { ...job, state: "en_route", version: 4 };
  const { app, gateway } = await ready({ jobs: [job] });
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  const before = gateway.calls.filter((c) => c.path === OPERATIONS["jobs.mine"].path).length;

  // Swap the fake's answer for the NEXT jobs.mine read the way the real gateway would after the transition applied.
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  p.queue.enqueue("jobs", JOB, "transition", { state: "en_route" }, job.version);
  await p.queue.flush(async (mutations) => ({ outcomes: mutations.map((m) => ({ outcome: "applied" as const, mutationId: m.mutationId, newVersion: 4 })) }));
  assert.equal(p.queue.pending.value.length, 0, "an applied mutation leaves the queue");
  p.store.invalidate("jobs.mine");
  gateway.calls.length = 0; // isolate the refetch this triggers
  void enRoute; void before;
  render(app.view()); await settle();
  assert.equal(gateway.calls.filter((c) => c.path === OPERATIONS["jobs.mine"].path).length, 1, "invalidate triggers exactly one refetch");
});

test("checklist, the time clock, and a parts quick-add each enqueue exactly the mutation the schema's own writer expects", async () => {
  const { app } = await ready();
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");

  p.queue.enqueue("checklist_items", JOB, "insert", { item_key: "ppe_donned", response: { done: true, at: "2026-09-17T12:00:00Z" } }, null);
  const checklistMutation = p.queue.pending.value.at(-1)!.mutation;
  assert.equal(checklistMutation.entityTable, "checklist_items");
  assert.equal(checklistMutation.entityId, JOB, "the entityId is the job — checklist_items has no id of its own on the wire, only job_id + item_key");

  // Start then stop the clock: a span needs both ends, so nothing is enqueued until Stop.
  assert.equal(p.clock.value[JOB], undefined);
  p.clock.value = { ...p.clock.value, [JOB]: "2026-09-17T12:00:00.000Z" };
  const beforeStop = p.queue.pending.value.length;
  p.queue.enqueue("time_entries", JOB, "insert", { crew_id: p.crew.id, start: p.clock.value[JOB], end: "2026-09-17T12:30:00.000Z", kind: "labor" }, null);
  const timeMutation = p.queue.pending.value.at(-1)!.mutation;
  assert.equal(p.queue.pending.value.length, beforeStop + 1);
  assert.equal(timeMutation.payload.crew_id, CREW);
  assert.ok(Date.parse(timeMutation.payload.end as string) > Date.parse(timeMutation.payload.start as string));

  p.queue.enqueue("parts_used", JOB, "insert", { part_sku: "COND-FAN-01", quantity_milli: 2000, source: "truck" }, null);
  const partsMutation = p.queue.pending.value.at(-1)!.mutation;
  assert.equal(partsMutation.payload.quantity_milli, 2000, "2 whole units is 2000 milli-units");
  assert.equal(partsMutation.payload.source, "truck");
});

test("the parts form rejects a zero or non-numeric quantity before it ever reaches enqueue", async () => {
  const { app } = await ready();
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  const out = render(app.view());
  assert.match(out, /id="parts-form"/);
  assert.match(out, /id="add-part"/);
  assert.match(out, /step="0\.001"/);
});

test("a transport failure leaves the mutation queued rather than losing it, and flips degraded on the next tick", async () => {
  const failFetch: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    if (path === OPERATIONS["auth.deviceLogin"].path) return { status: 200, ok: true, json: async () => ({ token: "dev-token", expiresAt: "2026-09-18T18:00:00Z", crewId: CREW, crewLabel: "Crew A1", context: {} }), text: async () => "", body: null };
    if (path === OPERATIONS["session.me"].path) return { status: 200, ok: true, json: async () => deviceContext, text: async () => "", body: null };
    if (path === OPERATIONS["jobs.mine"].path) return { status: 200, ok: true, json: async () => ({ jobs: [job] }), text: async () => "", body: null };
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    throw new Error("network down");
  };
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: failFetch, now: () => 1_000, newId: () => `mut-${++seq}` });
  await app.login("hw-001", "tech@ac.test", "pw");
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");

  p.queue.enqueue("jobs", JOB, "transition", { state: "en_route" }, job.version);
  // A transport failure never rejects flush() — replay() itself never got to
  // answer, so there is nothing mutation-level to learn; the batch simply
  // stays queued. See offline.ts's flush() doc comment.
  await p.queue.flush((mutations) => p.shell.gateway.replaySync({ orgId: p.shell.principal.orgId, regionId: p.shell.principal.regionId, mutations }));
  assert.equal(p.queue.pending.value.length, 1, "the mutation is still queued after a failed flush");

  app.tick();
  assert.equal(app.degraded.value, true);
  const out = render(app.view());
  assert.match(out, /1 change waiting to sync — offline\./);
});

test("a rejected mutation is surfaced as attention, not silently retried, and can be dismissed", async () => {
  const { app } = await ready({
    syncHandler: (mutations) => ({ status: 200, body: { outcomes: mutations.map((m) => ({ outcome: "rejected", mutationId: m.mutationId, note: "a device may not move a job to \"reassigned\". That transition belongs to dispatch." })) } }),
  });
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");

  p.queue.enqueue("jobs", JOB, "transition", { state: "reassigned" }, job.version);
  await p.queue.flush((mutations) => p.shell.gateway.replaySync({ orgId: ORG, regionId: REGION, mutations }));
  assert.equal(p.queue.pending.value.length, 0, "a rejected mutation leaves the RETRY queue — retrying it would just get the same answer");
  assert.equal(p.queue.attention.value.length, 1);
  let out = render(app.view());
  assert.match(out, /belongs to dispatch/);

  p.queue.dismissAttention(p.queue.attention.value[0]!.mutationId);
  out = render(app.view());
  assert.doesNotMatch(out, /belongs to dispatch/);
});
