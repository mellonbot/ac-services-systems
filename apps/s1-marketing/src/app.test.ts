import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { createLeadBuffer, BUFFER_KEY, DUPLICATE_CODE, type BufferStore } from "./buffer.ts";
import { S1_CSS } from "./styles.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import { OPERATIONS, SURFACES } from "../../../packages/contracts/src/index.ts";

/**
 * S1 against a scripted gateway, through the REAL shell and the REAL
 * generated client — only `fetch` and the storage are faked.
 *
 * What this file holds, and the order is the order of what would actually
 * hurt:
 *   1. the page renders with NO gateway at all, and the form still takes a
 *      lead — the registry's degraded line, as a test;
 *   2. a queued lead says queued and never says sent;
 *   3. a replay carries the same submission id, and a duplicate is success;
 *   4. the copy makes no availability or response-time claim, because the
 *      ceiling for one (D7a/OQ6) is not written yet;
 *   5. nothing in the bundle hard-codes a metro.
 *
 * Whether the gateway lets an anonymous principal write, and refuses it every
 * read, is 0008's and is test/integration/s1.test.ts.
 */
const U = (n: number) => `e1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const METROS = [{ code: "DFW", name: "Dallas–Fort Worth" }, { code: "AUS", name: "Austin" }];

type Reply = { status: number; body: unknown };
const fakeGateway = (opts: { down?: boolean; overrides?: Partial<Record<string, Reply | ((init: Parameters<FetchLike>[1]) => Reply)>> } = {}) => {
  const calls: { path: string; init: Parameters<FetchLike>[1] }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (opts.down) throw new Error("gateway unreachable");
    const o = opts.overrides?.[path];
    if (o) return typeof o === "function" ? reply(o(init).status, o(init).body) : reply(o.status, o.body);
    if (path === OPERATIONS["coverage.list"].path) return reply(200, { metros: METROS });
    if (path === OPERATIONS["auth.anonymousSession"].path) return reply(200, { token: "anon-token", expiresAt: "2026-09-18T12:15:00.000Z" });
    if (path === OPERATIONS["leads.submit"].path) return reply(200, { id: U(1), eventId: U(2) });
    if (path === OPERATIONS["callRecords.record"].path) return reply(200, { id: U(3), eventId: U(4) });
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls };
};

const memoryStore = (): BufferStore & { dump(): string | null } => {
  let v: string | null = null;
  return { getItem: () => v, setItem: (_k, val) => { v = val; }, dump: () => v };
};

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

let ids = 0;
const appWith = (g: { fetch: FetchLike }, store: BufferStore | null = null) =>
  createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now: () => 1_000, store, newId: () => U(500 + ++ids), session: "bearer" });

const form = {
  name: "Dana Reyes", email: "", phone: "555 0101", note: "Roof unit short-cycling.", metro: "Dallas", source: "web_form" as const,
};

test("SCREENS and SCREEN_VIEWS agree — every registered screen has a view and every view is registered", () => {
  assert.deepEqual(Object.keys(SCREEN_VIEWS).sort(), Object.keys(SCREENS).sort());
});

test("S1's registry has no login screen and no read of a lead — the two things a surface with no principal must not have", () => {
  const uses = Object.values(SCREENS).flatMap((s) => [...s.uses]);
  assert.equal(uses.some((u) => u.startsWith("auth.")), false, "no login on the one page with no session behind it");
  assert.equal(uses.some((u) => u.startsWith("leads.") && u !== "leads.submit"), false, "a lead is written here and never read back");
  for (const u of uses) {
    const op = OPERATIONS[u as keyof typeof OPERATIONS] as { surfaces: readonly string[] } | undefined;
    assert.ok(op, `${u} is a catalogue operation`);
    assert.ok(op!.surfaces.includes("S1"), `${u} admits S1`);
  }
});

test("THE PAGE RENDERS WITH NO GATEWAY AT ALL, and the form still takes a lead", async () => {
  const g = fakeGateway({ down: true });
  const store = memoryStore();
  const app = appWith(g, store);
  // No await before the first render: that is the whole of "site stays up".
  const first = render(app.view());
  assert.match(first, /Commercial HVAC service/);
  app.router.navigate("enquire", {});
  render(app.view());
  app.submit(form);
  await settle();
  assert.equal(app.buffer.pending.value.length, 1, "the lead is held, not lost");
  const html = render(app.view());
  assert.match(html, /waiting to send/);
  assert.equal(/we have your message/i.test(html), false, "it must never say sent while it is queued");
  assert.ok(store.dump()?.includes("Dana Reyes"), "and it survives the tab");
});

test("a queued lead replays under the SAME submission id, and lands once", async () => {
  const store = memoryStore();
  const down = appWith(fakeGateway({ down: true }), store);
  down.router.navigate("enquire", {});
  const submissionId = down.submit(form);
  await settle();
  assert.equal(down.buffer.pending.value.length, 1);

  // The connection comes back — a second app, same storage, as a reload would be.
  const g = fakeGateway();
  const back = appWith(g, store);
  await back.flush();
  await settle();
  back.router.navigate("enquire", {});
  const posted = g.calls.filter((c) => c.path === OPERATIONS["leads.submit"].path);
  assert.equal(posted.length, 1);
  assert.equal(JSON.parse(String(posted[0]!.init?.body)).submissionId, submissionId, "the same id the visitor's first press minted");
  assert.equal(back.buffer.pending.value.length, 0);
  assert.match(render(back.view()), /we have your message/i);
});

test("a duplicate replay is SUCCESS — the unique index answering means the first attempt landed", async () => {
  const store = memoryStore();
  const g = fakeGateway({ overrides: { [OPERATIONS["leads.submit"].path]: { status: 422, body: { error: "DatabaseRefusal", code: DUPLICATE_CODE, message: "duplicate key value violates unique constraint" } } } });
  const app = appWith(g, store);
  app.buffer.enqueue({ submissionId: U(77), source: "web_form", contact: { name: "Dana Reyes", phone: "555 0101" } });
  await app.flush();
  await settle();
  assert.equal(app.buffer.pending.value.length, 0, "dropped, not retried forever");
  assert.equal(app.buffer.attention.value.length, 0, "and not shown to the visitor as a failure");
});

test("a refusal on the merits stops being retried and is shown to the visitor in the gateway's words", async () => {
  const g = fakeGateway({ overrides: { [OPERATIONS["leads.submit"].path]: { status: 422, body: { error: "InputRefused", code: "no_way_to_answer", message: "a lead we cannot answer is not a lead: leave an email address or a phone number" } } } });
  const app = appWith(g);
  app.buffer.enqueue({ submissionId: U(78), source: "web_form", contact: { name: "Dana Reyes" } });
  await app.flush();
  await settle();
  assert.equal(app.buffer.pending.value.length, 0);
  assert.equal(app.buffer.attention.value.length, 1);
  app.router.navigate("enquire", {});
  assert.match(render(app.view()), /leave an email address or a phone number/);
});

test("the queue stops at the first unanswered lead rather than firing the rest at a gateway that is down", async () => {
  const g = fakeGateway({ down: true });
  const app = appWith(g);
  for (let i = 0; i < 3; i++) app.buffer.enqueue({ submissionId: U(80 + i), source: "web_form", contact: { name: `Visitor ${i}`, phone: "555" } });
  await app.flush();
  await settle();
  const posted = g.calls.filter((c) => c.path === OPERATIONS["leads.submit"].path);
  assert.ok(posted.length <= 1, `stopped at the first no-answer, saw ${posted.length}`);
  assert.equal(app.buffer.pending.value.length, 3, "all three still queued");
});

test("the session is minted lazily — reading the page mints nothing", async () => {
  const g = fakeGateway();
  const app = appWith(g);
  render(app.view());
  await settle();
  assert.equal(g.calls.some((c) => c.path === OPERATIONS["auth.anonymousSession"].path), false, "no session row per page view");
  app.submit(form);
  await settle();
  assert.equal(g.calls.filter((c) => c.path === OPERATIONS["auth.anonymousSession"].path).length, 1, "one, at the first write");
  app.submit({ ...form, name: "Second Visitor" });
  await settle();
  assert.equal(g.calls.filter((c) => c.path === OPERATIONS["auth.anonymousSession"].path).length, 1, "and not again");
});

test("the coverage list is the gateway's rows — the bundle hard-codes no metro (D14: no map without supply behind it)", async () => {
  const g = fakeGateway();
  const app = appWith(g);
  render(app.view());
  await settle();
  const html = render(app.view());
  assert.match(html, /Dallas–Fort Worth/);
  assert.match(html, /Austin/);
  // The empty answer renders as "we don't know", never as a fallback list.
  const empty = appWith(fakeGateway({ overrides: { [OPERATIONS["coverage.list"].path]: { status: 200, body: { metros: [] } } } }));
  render(empty.view()); await settle();
  const e = render(empty.view());
  assert.match(e, /coverage list is being updated/);
  assert.equal(/Dallas|Austin|Houston|Phoenix/.test(e), false, "no metro appears without a row behind it");
});

test("the coverage read asks for names, and the page shows no density or availability figure", async () => {
  const g = fakeGateway();
  const app = appWith(g);
  render(app.view()); await settle();
  const html = render(app.view());
  assert.equal(/density/i.test(html), false, "the D14 supply rule is not a public claim");
  assert.equal(/\b\d+\s*(crews?|technicians?|vans?|trucks?)\b/i.test(html), false, "and neither is a count of them");
});

/**
 * THE COPY CEILING, as a test.
 *
 * 05 §S1: availability and response-time language on this surface is bounded
 * by OQ6 and D7a, "neither of which is visible to whoever writes the copy",
 * and F9 is where the ceiling gets written down. Until it is, the ceiling is
 * ZERO, and this is what makes that a mechanism rather than an intention: a
 * sentence promising a time fails here, in the same commit that adds it.
 *
 * Delete this test when F9 lands and replace it with the ceiling it sets.
 */
test("NO TIME OR AVAILABILITY CLAIM ANYWHERE IN S1'S COPY — the ceiling is unwritten (D7a, OQ6, F9), so it is zero", async () => {
  const g = fakeGateway();
  const app = appWith(g);
  const pages: string[] = [];
  for (const screen of ["home", "coverage", "enquire"] as const) {
    app.router.navigate(screen, {});
    render(app.view()); await settle();
    pages.push(render(app.view()));
  }
  const copy = pages.join("\n") + "\n" + SURFACES.S1.name;
  const claims: readonly [RegExp, string][] = [
    [/\b24[\s/-]?7\b/i, "round-the-clock availability"],
    [/\bwithin\s+\d+\s*(minute|hour|day|business)/i, "a response window"],
    [/\b\d+\s*[- ]?(hour|minute)\s+(response|callback|call[- ]back|arrival|turnaround)/i, "a response time"],
    [/\bsame[- ]day\b/i, "same-day service"],
    [/\bguarantee[ds]?\b/i, "a guarantee"],
    [/\balways available\b/i, "always available"],
    [/\bany\s?time\b/i, "anytime availability"],
    [/\bemergency\s+(service|response|cover)/i, "an emergency commitment"],
    [/\buptime\b/i, "an uptime number"],
    [/\bSLA\b/, "an SLA, which is a contract term and not a web page's to state"],
  ];
  for (const [re, what] of claims) {
    assert.equal(re.test(copy), false, `S1's copy claims ${what}; the ceiling for that is D7a/OQ6 and it is not written yet (F9)`);
  }
});

test("S1 is the one surface that wears the house red, and its stylesheet names the brand role rather than a colour", () => {
  assert.equal(SURFACES.S1.stateRamp, false, "nothing on this page bears state, which is why the red is allowed here");
  assert.match(S1_CSS, /var\(--color-brand\)/);
  assert.equal(/#[0-9a-f]{3,8}|rgb\(/i.test(S1_CSS), false, "colour literals live in packages/tokens and nowhere else");
});

test("the buffer degrades to memory when storage throws, which is what a browser with site data blocked does", async () => {
  const hostile: BufferStore = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("SecurityError"); },
  };
  const buffer = createLeadBuffer({ store: hostile, now: () => 1 });
  assert.deepEqual([...buffer.pending.value], []);
  buffer.enqueue({ submissionId: U(90), source: "web_form", contact: { name: "Dana", phone: "555" } });
  assert.equal(buffer.pending.value.length, 1, "the form still works; the queue is just this session's");
});

test("the buffer reads back what a previous tab wrote, and ignores anything else in that key", () => {
  const store = memoryStore();
  store.setItem(BUFFER_KEY, JSON.stringify([
    { input: { submissionId: U(91), source: "web_form", contact: { name: "Dana", phone: "555" } }, queuedAt: 1, attempts: 0 },
    { nonsense: true },
    "a string",
  ]));
  const buffer = createLeadBuffer({ store, now: () => 2 });
  assert.equal(buffer.pending.value.length, 1);
  assert.equal(buffer.pending.value[0]!.input.submissionId, U(91));
});

test("enqueue is idempotent on the submission id — a double-press is one lead", () => {
  const buffer = createLeadBuffer({ store: null, now: () => 1 });
  const input = { submissionId: U(92), source: "web_form" as const, contact: { name: "Dana", phone: "555" } };
  buffer.enqueue(input);
  buffer.enqueue(input);
  assert.equal(buffer.pending.value.length, 1);
});

test("recordCall never throws at the page, whatever the gateway does — a call we failed to log is still a call", async () => {
  const app = appWith(fakeGateway({ down: true }));
  await assert.doesNotReject(() => app.recordCall());
});
