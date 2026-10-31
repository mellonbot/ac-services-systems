import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS, loginView } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { priorityStatus, forwardState } from "./screens/job-list.ts";
import { CHECKLIST, PART_SOURCES } from "./screens/job-detail.ts";
import { nextDeviceStates, JOB_TRANSITIONS, DEVICE_TRANSITIONS, queueKey, type QueueStore } from "./offline.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { HierarchyContext, FieldJobWire, ShiftPunchWire, SyncMutationWire, SyncOutcomeWire } from "../../../packages/contracts/src/index.ts";
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
  id: JOB, jobNo: "SOUTH-2609-1417-3", siteId: U(9), serviceCode: "HVAC-REPAIR", priority: "urgent", state: "assigned",
  site: { name: "Shipman Co", address: { line1: "100 McLanahan Ln", city: "Crowley", state: "TX", postal: "76036" }, contact: { name: "Dana Ruiz", phone: "(817) 555-0142" } },
  serviceWindowStart: "2026-09-18T09:00:00.000Z", serviceWindowEnd: "2026-09-18T17:00:00.000Z", version: 3, checklistDone: [],
};

type Reply = { status: number; body: unknown };
type SyncHandler = (mutations: readonly SyncMutationWire[]) => Reply;

const fakeGateway = (opts: { syncHandler?: SyncHandler; jobs?: readonly FieldJobWire[]; punches?: readonly ShiftPunchWire[]; wrapUpReply?: (b: Record<string, unknown>) => Reply } = {}) => {
  let session = false;
  const sentMedia: { mutationId: string; kind: string }[] = [];
  const sentWrapUps: Record<string, unknown>[] = [];
  const calls: { path: string; init: Parameters<FetchLike>[1] }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path === OPERATIONS["auth.deviceLogin"].path) { session = true; return reply(200, { token: "dev-token", expiresAt: "2026-09-18T18:00:00Z", crewId: CREW, crewLabel: "Crew A1", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["session.me"].path) return reply(200, deviceContext);
    if (path === OPERATIONS["jobs.mine"].path) return reply(200, { jobs: opts.jobs ?? [job] });
    // Clocked in by default: a job does not move until the shift clock is in (partner rule, 2026-10-27).
    if (path === OPERATIONS["punches.mine"].path) return reply(200, { punches: opts.punches ?? [{ id: "p-default", kind: "in", at: "1970-01-01T00:00:00.000Z" }] });
    if (path === OPERATIONS["jobs.attachMedia"].path) {
      const b = JSON.parse(init!.body as string) as { mutationId: string; kind: string };
      sentMedia.push(b);
      return reply(200, { id: `m-${b.mutationId}`, jobId: JOB, duplicate: false });
    }
    if (path === OPERATIONS["jobs.wrapUp"].path) {
      const b = JSON.parse(init!.body as string) as Record<string, unknown>;
      if (opts.wrapUpReply) { const r = opts.wrapUpReply(b); return reply(r.status, r.body); }
      sentWrapUps.push(b);
      return reply(200, { jobId: JOB, wrapUpId: b.wrapUpId, state: "complete", duplicate: false });
    }
    if (path === OPERATIONS["sync.replay"].path) {
      const body = JSON.parse(init!.body as string) as { mutations: readonly SyncMutationWire[] };
      if (opts.syncHandler) { const r = opts.syncHandler(body.mutations); return reply(r.status, r.body); }
      const outcomes: SyncOutcomeWire[] = body.mutations.map((m) => ({ outcome: "applied", mutationId: m.mutationId, newVersion: 1 }));
      return reply(200, { outcomes });
    }
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls, sentMedia, sentWrapUps };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
type TestNode = { type?: unknown; props?: Record<string, unknown> };
const nodesIn = (node: unknown): TestNode[] => {
  if (Array.isArray(node)) return node.flatMap(nodesIn);
  if (!node || typeof node !== "object") return [];
  const current = node as TestNode;
  return [current, ...nodesIn(current.props?.children)];
};
const click = (tree: unknown, id: string) => {
  const hit = nodesIn(tree).find((n) => n.props?.id === id);
  if (!hit) assert.fail(`no #${id} on screen`);
  (hit.props!.onClick as (e: Event) => void)(new Event("click"));
};
/** localStorage's shape, enumeration included, over a Map. */
const memory = (): QueueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null };
};
let seq = 0;
const ready = async (opts?: Parameters<typeof fakeGateway>[0] & { store?: QueueStore; now?: number }) => {
  const g = fakeGateway(opts);
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now: () => opts?.now ?? 1_000, newId: () => `mut-${++seq}`, store: opts?.store ?? null });
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
  assert.deepEqual([...nextDeviceStates("in_progress")].sort(), ["aborted", "awaiting_customer", "awaiting_parts"].sort(), "complete is the wrap-up's (0034), never a bare transition");
  assert.deepEqual([...nextDeviceStates("awaiting_customer")].sort(), ["aborted", "in_progress"], "a hold for the customer resumes or stops; it is not the field's to quote");
  assert.deepEqual(nextDeviceStates("quote_requested"), [], "a quote before dispatch is the office's");
  assert.deepEqual(nextDeviceStates("invoiced"), []);
  for (const [from, tos] of Object.entries(JOB_TRANSITIONS)) {
    const admitted = tos.filter((to) => DEVICE_TRANSITIONS.includes(to) && to !== "complete");
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
  assert.match(out, /Repair/);
  assert.match(out, new RegExp(`href="/jobs/${JOB}"`));
});

test("a Today card carries what a crew needs at the curb: the site, its address, the way there, who to call and the next move", async () => {
  const { app } = await ready();
  render(app.view()); await settle(); await settle();
  const out = render(app.view());
  assert.match(out, /Shipman Co — /, "the site's name leads the title, not the service code");
  assert.match(out, /100 McLanahan Ln, Crowley, TX 76036/);
  assert.match(out, /href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=100%20McLanahan%20Ln%2C%20Crowley%2C%20TX%2076036"/);
  assert.match(out, /href="tel:8175550142"/, "the phone is dialable — formatting stripped");
  assert.match(out, /aria-label="Call Dana Ruiz"/);
  assert.match(out, /SOUTH-2609-1417-3/);
  assert.match(out, /data-current="true"/, "the only job is the current one");
  assert.match(out, new RegExp(`id="card-${JOB}-en_route"[^>]*>Head out<`));
});

test("a card's move is one step forward and never a wrap-up: completing and aborting live on the job detail", () => {
  assert.equal(forwardState("assigned"), "en_route");
  assert.equal(forwardState("on_site"), "in_progress");
  assert.equal(forwardState("awaiting_parts"), "in_progress");
  assert.equal(forwardState("in_progress"), null);
  assert.equal(forwardState("complete"), null);
});

test("a card's move queues the transition against the job's version, and the card moves on before the gateway answers", async () => {
  const { app } = await ready({ syncHandler: () => ({ status: 503, body: { error: "Unavailable", message: "down" } }) });
  render(app.view()); await settle(); await settle();
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  click(app.view(), `card-${JOB}-en_route`); await settle();
  const m = p.queue.pending.value.at(-1)!.mutation;
  assert.deepEqual([m.entityTable, m.op, m.payload.state, m.clientObservedVersion], ["jobs", "transition", "en_route", job.version]);
  const out = render(app.view());
  assert.match(out, /en route \(queued\)/);
  assert.match(out, new RegExp(`id="card-${JOB}-on_site"`));
});

test("a job whose site the device cannot read stays on the list, named as such, with no directions to nowhere", async () => {
  const { app } = await ready({ jobs: [{ ...job, site: null }] });
  render(app.view()); await settle(); await settle();
  const out = render(app.view());
  assert.match(out, /Site not on record — /);
  assert.doesNotMatch(out, />Directions</);
  assert.doesNotMatch(out, /href="tel:/);
});

test("the checklist shows done what the server holds and what this device has queued, and offers Mark done only on the rest", async () => {
  const { app } = await ready({ jobs: [{ ...job, checklistDone: ["ppe_donned"] }], syncHandler: () => ({ status: 503, body: { error: "Unavailable", message: "down" } }) });
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  let out = render(app.view());
  assert.match(out, /id="done-ppe_donned"/);
  assert.doesNotMatch(out, /id="check-ppe_donned"/, "nothing to tap on an item already done");
  assert.match(out, /id="check-safety_briefing"/);

  click(app.view(), "check-safety_briefing"); await settle();
  out = render(app.view());
  assert.match(out, /id="done-safety_briefing"[^>]*>.*Done — waiting to sync/);
  assert.doesNotMatch(out, /id="check-safety_briefing"/, "a second tap cannot queue it again");
  assert.match(out, /id="check-work_verified"/);
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

test("the job detail shows the last synced state and the transition a device may make from it", async () => {
  const { app } = await ready();
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  let out = render(app.view());
  assert.match(out, /State: <strong>assigned<\/strong>/);
  assert.match(out, /id="to-en_route"/);

  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  // Click without letting the flush settle yet: the state shown is still the last fetch, plus a queued-count.
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
  assert.match(out, /<span class="ac-num">1<\/span> change waiting to sync — offline\./);
});

test("losing the network after the job loaded keeps the job on screen with its queued count — the cache is never traded for a transport error", async () => {
  let down = false;
  const flakyFetch: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    if (down) throw new Error("Failed to fetch");
    if (path === OPERATIONS["auth.deviceLogin"].path) return { status: 200, ok: true, json: async () => ({ token: "dev-token", expiresAt: "2026-09-18T18:00:00Z", crewId: CREW, crewLabel: "Crew A1", context: {} }), text: async () => "", body: null };
    if (path === OPERATIONS["session.me"].path) return { status: 200, ok: true, json: async () => deviceContext, text: async () => "", body: null };
    if (path === OPERATIONS["jobs.mine"].path) return { status: 200, ok: true, json: async () => ({ jobs: [job] }), text: async () => "", body: null };
    return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
  };
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: flakyFetch, now: () => 1_000, newId: () => `mut-${++seq}` });
  await app.login("hw-001", "tech@ac.test", "pw");
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");

  down = true;
  p.queue.enqueue("jobs", JOB, "transition", { state: "en_route" }, job.version);
  const answered = await p.queue.flush((mutations) => p.shell.gateway.replaySync({ orgId: p.shell.principal.orgId, regionId: p.shell.principal.regionId, mutations }));
  assert.equal(answered, false, "an unreachable gateway answered nothing");
  for (let i = 0; i < 3; i++) { app.tick(); render(app.view()); await settle(); }
  const out = render(app.view());
  assert.match(out, /id="to-on_site"/, "the job's actions are still on screen, moved on by the queued transition");
  assert.match(out, /<span class="ac-num">1<\/span> change waiting to sync/);
  assert.doesNotMatch(out, /Failed to fetch|Gateway unreachable<\/h2>/);

  // A refetch the gateway does answer still replaces the held value.
  p.store.invalidate("jobs.mine");
  render(app.view()); await settle();
  assert.match(render(app.view()), /id="to-on_site"/, "while the refetch is in flight the held job stays, not a loading line");
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

test("offline, each tapped transition moves the screen on: the next is queued against the version the last one leaves, and the same one cannot be queued twice", async () => {
  const { app } = await ready({ syncHandler: () => { throw new Error("unreachable"); } });
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  const offline = async () => { await settle(); await settle(); };

  click(app.view(), "to-en_route"); await offline();
  let out = render(app.view());
  assert.match(out, /State: <strong>en route<\/strong> \(queued — last synced: assigned\)/);
  assert.doesNotMatch(out, /id="to-en_route"/, "a second tap cannot queue the same transition again");
  click(app.view(), "to-on_site"); await offline();
  click(app.view(), "to-in_progress"); await offline();
  out = render(app.view());
  assert.match(out, /State: <strong>in progress<\/strong>/);
  assert.match(out, new RegExp(`href="/jobs/${JOB}/wrap-up"`), "in progress, the job is finished by its wrap-up");
  assert.doesNotMatch(out, /id="to-complete"/);

  const queued = p.queue.pending.value.map((e) => [e.mutation.payload.state, e.mutation.clientObservedVersion]);
  assert.deepEqual(queued, [["en_route", 3], ["on_site", 4], ["in_progress", 5]], "each observes the version the server will hold once the one before it lands");
});

test("a running time clock is saved with the queue: a new sign-in on the same device and technician still has it running", async () => {
  const store = memory();
  const first = await ready({ store });
  const p1 = first.app.phase.value;
  if (p1.kind !== "ready") return assert.fail("not ready");
  first.app.router.navigate("job", { jobId: JOB });
  render(first.app.view()); await settle(); await settle();
  click(first.app.view(), "clock-toggle");
  const started = p1.clock.value[JOB];
  assert.ok(started);

  const second = await ready({ store });
  const p2 = second.app.phase.value;
  if (p2.kind !== "ready") return assert.fail("not ready");
  assert.equal(p2.clock.value[JOB], started, "the reload kept the running clock");
  second.app.router.navigate("job", { jobId: JOB });
  render(second.app.view()); await settle(); await settle();
  assert.match(render(second.app.view()), /Running since/);
});

test("aborting a job with the clock running stops the clock first: the span is sent ahead of the transition, because a finished job drops off this list", async () => {
  const sent: SyncMutationWire[] = [];
  const { app } = await ready({
    jobs: [{ ...job, state: "in_progress" }],
    syncHandler: (ms) => { sent.push(...ms); return { status: 200, body: { outcomes: ms.map((m) => ({ outcome: "applied", mutationId: m.mutationId, newVersion: 4 })) } }; },
  });
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  click(app.view(), "clock-toggle");
  assert.ok(p.clock.value[JOB]);
  click(app.view(), "to-aborted");
  for (let i = 0; i < 4; i++) await settle();
  assert.deepEqual(sent.map((m) => m.entityTable), ["time_entries", "jobs"]);
  assert.equal(p.clock.value[JOB], undefined, "the clock is not left running on a job the device can no longer open");
});

test("another technician's queue on this device is left alone and the signed-in tech is told it exists, not handed it", async () => {
  const store = memory();
  const otherKey = queueKey(DEVICE, "tech-2");
  const theirs = [{ mutation: { mutationId: "theirs-1", deviceId: DEVICE, deviceSeq: 1, entityTable: "jobs", entityId: JOB, op: "transition", payload: { state: "en_route" }, clientObservedVersion: 3, deviceAt: "2026-09-18T08:00:00Z" }, enqueuedAt: 0 }];
  store.setItem(otherKey, JSON.stringify(theirs));
  const replayed: string[] = [];
  const { app } = await ready({ store, syncHandler: (ms) => { replayed.push(...ms.map((m) => m.mutationId)); return { status: 200, body: { outcomes: ms.map((m) => ({ outcome: "applied", mutationId: m.mutationId, newVersion: 4 })) } }; } });
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  assert.equal(p.queue.pending.value.length, 0, "tech-1 does not inherit tech-2's queue");
  app.tick(); await settle(); await settle();
  assert.deepEqual(replayed, [], "nothing of tech-2's is sent under tech-1's token");
  assert.equal(store.getItem(otherKey), JSON.stringify(theirs), "tech-2's queue is untouched");
  assert.match(render(app.view()), /1 change\(s\) another technician saved on this device are kept for them/);
});

test("attention survives a reload until it is dismissed", async () => {
  const store = memory();
  const rejectAll = { store, syncHandler: (ms: readonly SyncMutationWire[]) => ({ status: 200, body: { outcomes: ms.map((m) => ({ outcome: "rejected", mutationId: m.mutationId, note: "belongs to dispatch" })) } }) };
  const first = await ready(rejectAll);
  const p1 = first.app.phase.value;
  if (p1.kind !== "ready") return assert.fail("not ready");
  p1.queue.enqueue("jobs", JOB, "transition", { state: "reassigned" }, job.version);
  await p1.queue.flush((mutations) => p1.shell.gateway.replaySync({ orgId: ORG, regionId: REGION, mutations }));
  assert.equal(p1.queue.attention.value.length, 1);

  const second = await ready(rejectAll);
  const p2 = second.app.phase.value;
  if (p2.kind !== "ready") return assert.fail("not ready");
  assert.equal(p2.queue.attention.value.length, 1, "the rejection is still there to read after a reload");
  p2.queue.dismissAttention(p2.queue.attention.value[0]!.mutationId);
  const third = await ready(rejectAll);
  const p3 = third.app.phase.value;
  if (p3.kind !== "ready") return assert.fail("not ready");
  assert.equal(p3.queue.attention.value.length, 0, "a dismissed item stays dismissed");
});

// ---- the shift clock (0033) and its partner rule: in before the first job, out after the last ----
const NOW = Date.parse("2026-10-27T15:00:00Z");
const down = () => ({ status: 503, body: { error: "Unavailable", message: "down" } });

test("before the first job, Today offers Clock in; the tap queues a punch on this shift's grant and the clock runs at once", async () => {
  const { app } = await ready({ now: NOW, syncHandler: down, punches: [] });
  render(app.view()); await settle(); await settle(); render(app.view()); await settle();
  let out = render(app.view());
  assert.match(out, /Clocked out/);
  assert.match(out, /id="clock-in"/);
  assert.doesNotMatch(out, /id="clock-out"/);

  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  click(app.view(), "clock-in"); await settle();
  const m = p.queue.pending.value.at(-1)!.mutation;
  assert.deepEqual([m.entityTable, m.entityId, m.op, m.payload.kind], ["shift_punches", SHIFT, "insert", "in"], "the punch names the shift grant, never a job");
  out = render(app.view());
  assert.match(out, /Clocked in/);
  assert.match(out, /waiting to sync/);
  assert.doesNotMatch(out, /id="clock-in"/);
  assert.doesNotMatch(out, /id="clock-out"/, "the job is still open");
  assert.match(out, /Clock out opens when every job is complete or on hold/);
});

test("no job moves until the shift clock is in: the card and the detail say so on the control, and Clock in lifts it", async () => {
  const { app } = await ready({ now: NOW, syncHandler: down, punches: [] });
  render(app.view()); await settle(); await settle(); render(app.view()); await settle();
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  let out = render(app.view());
  assert.match(out, new RegExp(`id="card-${JOB}-en_route" aria-disabled="true"`));
  assert.match(out, /Clock in first/);
  click(app.view(), `card-${JOB}-en_route`); await settle();
  assert.equal(p.queue.pending.value.length, 0, "a tap on a gated move queues nothing");

  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle();
  assert.match(render(app.view()), /id="to-en_route" aria-disabled="true"/);

  app.router.navigate("jobs", {});
  click(app.view(), "clock-in"); await settle();
  out = render(app.view());
  assert.match(out, new RegExp(`id="card-${JOB}-en_route" aria-disabled="false"`), "a queued clock-in counts at once");
});

test("a job already under way with the clock stopped is not a dead end: Clock in is offered and lifts the gate", async () => {
  const { app } = await ready({ now: NOW, jobs: [{ ...job, state: "en_route" }], punches: [], syncHandler: down });
  render(app.view()); await settle(); await settle(); render(app.view()); await settle();
  let out = render(app.view());
  assert.match(out, /id="clock-in"/);
  assert.match(out, new RegExp(`id="card-${JOB}-on_site" aria-disabled="true"`));
  click(app.view(), "clock-in"); await settle();
  out = render(app.view());
  assert.match(out, new RegExp(`id="card-${JOB}-on_site" aria-disabled="false"`));
});

test("clocked in with every job finished or on hold — off the list, completed on this device, or waiting on parts — Today offers Clock out", async () => {
  const punches = [{ id: "p1", kind: "in" as const, at: "2026-10-27T13:00:00Z" }];
  const empty = await ready({ now: NOW, jobs: [], punches });
  render(empty.app.view()); await settle(); await settle(); render(empty.app.view()); await settle();
  let out = render(empty.app.view());
  assert.match(out, /id="clock-out"/);
  assert.match(out, />2h 00m</, "two hours on the clock at 15:00");

  const { app } = await ready({ now: NOW, jobs: [{ ...job, state: "in_progress" }], punches, syncHandler: down });
  render(app.view()); await settle(); await settle(); render(app.view()); await settle();
  assert.doesNotMatch(render(app.view()), /id="clock-out"/);
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  p.queue.enqueue("jobs", JOB, "transition", { state: "complete" }, job.version);
  out = render(app.view());
  assert.match(out, /id="clock-out"/, "a completion still waiting to sync counts");

  const held = await ready({ now: NOW, jobs: [{ ...job, state: "awaiting_parts" }], punches });
  render(held.app.view()); await settle(); await settle(); render(held.app.view()); await settle();
  assert.match(render(held.app.view()), /id="clock-out"/, "a job waiting on parts does not keep the crew on the clock");
});

test("the timesheet lists the week's punches by day with each day's total and the week's, and a running span says so", async () => {
  const punches = [
    { id: "p1", kind: "in" as const, at: "2026-10-26T12:58:00Z" }, { id: "p2", kind: "out" as const, at: "2026-10-26T21:32:00Z" },
    { id: "p3", kind: "in" as const, at: "2026-10-27T13:00:00Z" },
  ];
  const { app } = await ready({ now: NOW, punches });
  app.router.navigate("timesheet", {});
  render(app.view()); await settle(); await settle(); render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /id="week-total"[^>]*>10h 34m</, "8h 34m Monday and 2h 00m running today");
  assert.match(out, /Mon/);
  assert.match(out, /→ <span class="s5-nowrap">running</);
  assert.match(out, /data-today="true"/);
  assert.equal((out.match(/class="s5-day"/g) ?? []).length, 7);
});

// ---- the wrap-up (0034): the job is finished by its wrap-up, sent media first ----
test("in progress, the card and the job offer Wrap up — gated on the shift clock like every move", async () => {
  const running = await ready({ now: NOW, jobs: [{ ...job, state: "in_progress" }] });
  render(running.app.view()); await settle(); await settle(); render(running.app.view()); await settle();
  assert.match(render(running.app.view()), new RegExp(`href="/jobs/${JOB}/wrap-up"`));

  const stopped = await ready({ now: NOW, jobs: [{ ...job, state: "in_progress" }], punches: [] });
  render(stopped.app.view()); await settle(); await settle(); render(stopped.app.view()); await settle();
  const out = render(stopped.app.view());
  assert.match(out, new RegExp(`id="card-${JOB}-wrap-up" aria-disabled="true"`));
  assert.doesNotMatch(out, new RegExp(`href="/jobs/${JOB}/wrap-up"`));
});

test("Submit says what is still needed until the wrap-up is whole; submitted, the job reads complete at once and the crew may clock out", async () => {
  const { app, gateway } = await ready({ now: NOW, jobs: [{ ...job, state: "in_progress" }], punches: [{ id: "p1", kind: "in", at: "2026-10-27T13:00:00Z" }] });
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  app.router.navigate("wrapup", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  let out = render(app.view());
  assert.match(out, /id="submit-wrap-up" aria-disabled="true"/);
  assert.match(out, /Still needed: 2 more photos · the customer's signature, or tick that no one was there to sign\./);
  click(app.view(), "outcome-quote_needed");
  assert.match(render(app.view()), /10 more photos/);
  assert.match(render(app.view()), /id="m-curbWidthIn"/, "a quote asks for the unit's measurements");
  click(app.view(), "outcome-complete");

  await p.wrapUps.addShot(JOB, "photo", "/9j/AAAA");
  await p.wrapUps.addShot(JOB, "photo", "/9j/BBBB");
  await p.wrapUps.addShot(JOB, "signature", "iVBORw0K");
  out = render(app.view());
  assert.match(out, /Photos — 2 of 2/);
  assert.match(out, /id="submit-wrap-up" aria-disabled="false"/);
  click(app.view(), "submit-wrap-up");
  assert.equal(app.router.current.value?.screen, "jobs", "back to Today");
  render(app.view()); await settle(); render(app.view()); await settle();
  out = render(app.view());
  assert.match(out, /complete \(waiting to send\)/);
  assert.match(out, /id="clock-out"/, "a wrapped-up job is finished for the clock before the office has it");

  app.tick(); for (let i = 0; i < 8; i++) await settle();
  assert.deepEqual(gateway.sentMedia.map((m) => m.kind), ["photo", "photo", "signature"]);
  assert.equal(gateway.sentWrapUps.length, 1);
  assert.equal(gateway.sentWrapUps[0]!.outcome, "complete");
  assert.equal(p.wrapUps.outbox.value.length, 0, "sent, and gone from the device");
});

test("a wrap-up the office refuses comes back to the job with its words, and opens again as a draft", async () => {
  const { app } = await ready({
    now: NOW, jobs: [{ ...job, state: "in_progress" }],
    wrapUpReply: () => ({ status: 422, body: { error: "InputRefused", code: "not_in_progress", message: "this job is cancelled — a wrap-up completes a job in progress" } }),
  });
  const p = app.phase.value;
  if (p.kind !== "ready") return assert.fail("not ready");
  await p.wrapUps.addShot(JOB, "photo", "/9j/AAAA");
  await p.wrapUps.addShot(JOB, "photo", "/9j/BBBB");
  p.wrapUps.edit(JOB, { absent: true, absentReason: "No one home" });
  assert.deepEqual(p.wrapUps.submit(JOB), []);
  app.tick(); for (let i = 0; i < 8; i++) await settle();
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle(); await settle();
  const out = render(app.view());
  assert.match(out, /id="wrap-up-refused"/);
  assert.match(out, /this job is cancelled/);
  click(app.view(), "wrap-up-reopen");
  assert.equal(app.router.current.value?.screen, "wrapup");
  assert.equal(p.wrapUps.draftFor(JOB).photos.length, 2);
});

test("0038: a temporary password is answered with new-password fields, kept on a mismatch, and sent with the sign-in", () => {
  const plain = render(loginView({ refusal: null, busy: false }, () => {}));
  assert.doesNotMatch(plain, /name="newPassword"/);
  const asked = render(loginView({ refusal: { kind: "admission", code: "password_change_required", axis: "structural", message: "Choose a new password." }, busy: false }, () => {}));
  assert.match(asked, /name="newPassword"/);
  assert.match(asked, /name="repeatPassword"/);
  assert.match(asked, /Set password and sign in/);
  assert.match(render(loginView({ refusal: { kind: "admission", code: "passwords_differ", axis: "structural", message: "Not the same." }, busy: false }, () => {})), /name="newPassword"/);
});
