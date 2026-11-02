import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { S1_CSS } from "./styles.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import { OPERATIONS, SURFACES, type SignInInput, type SignInOutput } from "../../../packages/contracts/src/index.ts";

/**
 * S1, THE FRONT DOOR, against a scripted gateway, through the REAL shell and
 * the REAL generated client — only `fetch` and the browser's location are faked.
 *
 * What this file holds, in the order of what would actually hurt:
 *   1. the page renders with NO gateway at all — the registry's degraded line;
 *   2. a sign-in sends the person where the gateway says, and nowhere else;
 *   3. a login that opens several surfaces is asked, and the pick re-sends the
 *      same credentials naming one — and only while the chooser is open;
 *   4. a field device sends its ID; nothing else does;
 *   5. a refusal is shown in the gateway's words and nobody is sent anywhere;
 *   6. the copy makes no availability or response-time claim.
 *
 * Whether the gateway routes a real login to the right surface, and mints the
 * session the surface then resumes, is test/integration/s1.test.ts.
 */
const SIGN_IN = OPERATIONS["auth.signIn"].path;

type Reply = { status: number; body: unknown };
const fakeGateway = (opts: { down?: boolean; signIn?: (input: SignInInput) => Reply } = {}) => {
  const calls: { path: string; init: Parameters<FetchLike>[1]; input: SignInInput | null }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const input = init?.body ? JSON.parse(String(init.body)) as SignInInput : null;
    calls.push({ path, init, input });
    if (opts.down) throw new Error("gateway unreachable");
    if (path === SIGN_IN && opts.signIn) { const r = opts.signIn(input!); return reply(r.status, r.body); }
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls, signIns: () => calls.filter((c) => c.path === SIGN_IN) };
};

const signedIn = (surface: "S2" | "S3" | "S5"): Reply => ({
  status: 200,
  body: { kind: "signed_in", surface, path: `${{ S2: "/service-manager", S3: "/dispatch", S5: "/technician" }[surface]}/`, token: "t", expiresAt: "2026-11-01T22:00:00.000Z" } satisfies SignInOutput,
});
const CHOICES: SignInOutput = {
  kind: "choose",
  choices: [
    { surface: "S2", name: SURFACES.S2.name, path: "/service-manager/" },
    { surface: "S3", name: SURFACES.S3.name, path: "/dispatch/" },
  ],
};

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

const appWith = (g: { fetch: FetchLike }) => {
  const went: string[] = [];
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, session: "bearer", go: (p) => { went.push(p); } });
  return { app, went };
};

const DANA = { email: "dana@ac.test", password: "pw" };

test("SCREENS and SCREEN_VIEWS agree — every registered screen has a view and every view is registered", () => {
  assert.deepEqual(Object.keys(SCREEN_VIEWS).sort(), Object.keys(SCREENS).sort());
});

test("S1 asks the platform for exactly one thing — a sign-in — and writes nothing", () => {
  const uses = Object.values(SCREENS).flatMap((s) => [...s.uses]);
  assert.deepEqual(uses, ["auth.signIn"]);
  for (const u of uses) assert.ok((OPERATIONS[u] as { surfaces: readonly string[] }).surfaces.includes("S1"), `${u} admits S1`);
  assert.deepEqual([...SURFACES.S1.writes], [], "the front door mints the destination's session; it holds and writes nothing of its own");
  assert.equal(SURFACES.S1.name, "Front door");
});

test("THE PAGE RENDERS WITH NO GATEWAY AT ALL — the sign-in form, and no list of portals to guess from", () => {
  const g = fakeGateway({ down: true });
  const { app } = appWith(g);
  // No await before the first render: that is the whole of "the page renders with no gateway call".
  const page = render(app.view());
  assert.match(page, /AC Services — Service System/);
  assert.match(page, /id="sign-in-form"/);
  assert.match(page, /name="email"/);
  assert.match(page, /name="password"/);
  assert.equal(/name="hardwareId"/.test(page), false, "the device field waits until it is asked for");
  for (const id of ["S2", "S3", "S4", "S5", "S6", "S7", "S8"] as const) {
    assert.equal(page.includes(SURFACES[id].name), false, `${id} is not listed before sign-in — where a login belongs is the gateway's answer`);
  }
  assert.equal(g.calls.length, 0, "reading the page asks the gateway nothing");
});

test("one surface: the gateway's path is where the person goes, and the request names S1", async () => {
  const g = fakeGateway({ signIn: () => signedIn("S3") });
  const { app, went } = appWith(g);
  app.signIn(DANA);
  await settle();
  assert.deepEqual(went, ["/dispatch/"]);
  const [call] = g.signIns();
  assert.deepEqual(call!.input, { email: DANA.email, password: DANA.password });
  assert.equal((call!.init?.headers as Record<string, string>)["x-ac-surface"], "S1");
  assert.equal(app.door.value.step, "going");
  assert.match(render(app.view()), /Opening Dispatch Console…/);
});

test("several surfaces: the person is asked, and the pick re-sends the same credentials naming one", async () => {
  const g = fakeGateway({ signIn: (i) => (i.surface ? signedIn(i.surface as "S2") : { status: 200, body: CHOICES }) });
  const { app, went } = appWith(g);
  app.signIn(DANA);
  await settle();
  assert.deepEqual(went, [], "nobody is sent anywhere before they choose");
  const page = render(app.view());
  assert.match(page, /Where to\?/);
  assert.match(page, /id="go-S2"/);
  assert.match(page, /id="go-S3"/);
  app.choose("S2");
  await settle();
  const [first, second] = g.signIns();
  assert.equal(first!.input!.surface, undefined);
  assert.deepEqual(second!.input, { ...DANA, surface: "S2" });
  assert.deepEqual(went, ["/service-manager/"]);
});

test("starting over drops the held credentials — a pick after it sends nothing", async () => {
  const g = fakeGateway({ signIn: () => ({ status: 200, body: CHOICES }) });
  const { app } = appWith(g);
  app.signIn(DANA);
  await settle();
  app.startOver();
  app.choose("S2");
  await settle();
  assert.equal(g.signIns().length, 1, "the chooser closed; its credentials went with it");
  assert.equal(app.door.value.step, "form");
});

test("a field device: the box shows the device ID field, and the ID goes with the sign-in", async () => {
  const g = fakeGateway({ signIn: () => signedIn("S5") });
  const { app, went } = appWith(g);
  app.setDevice(true);
  assert.match(render(app.view()), /name="hardwareId"/);
  app.signIn({ ...DANA, hardwareId: "TAB-0042" });
  await settle();
  assert.deepEqual(g.signIns()[0]!.input, { ...DANA, hardwareId: "TAB-0042" });
  assert.deepEqual(went, ["/technician/"]);
});

test("ticking the device box while a sign-in is in flight survives the refusal that comes back", async () => {
  let answer!: () => void;
  const g = fakeGateway({ signIn: () => ({ status: 403, body: { error: "HttpError", message: "This login signs in on a field device." } }) });
  const slow: FetchLike = async (url, init) => { await new Promise<void>((r) => { answer = r; }); return g.fetch(url, init); };
  const { app } = appWith({ fetch: slow });
  app.signIn(DANA);
  app.setDevice(true);
  answer();
  await settle();
  const d = app.door.value;
  assert.ok(d.step === "form" && d.device && d.refusal !== null && !d.busy);
  assert.match(render(app.view()), /name="hardwareId"/);
});

test("a refusal is shown in the gateway's words, the form stays, and nobody is sent anywhere", async () => {
  const g = fakeGateway({ signIn: () => ({ status: 403, body: { error: "HttpError", message: "Your portal is not open yet." } }) });
  const { app, went } = appWith(g);
  app.signIn(DANA);
  await settle();
  assert.deepEqual(went, []);
  const d = app.door.value;
  assert.equal(d.step, "form");
  assert.equal(d.step === "form" && d.busy, false);
  const page = render(app.view());
  assert.match(page, /Your portal is not open yet\./);
  assert.match(page, /id="sign-in-form"/);
});

test("with the gateway down, signing in says it could not get through — nothing is queued, nothing navigates", async () => {
  const g = fakeGateway({ down: true });
  const { app, went } = appWith(g);
  app.signIn(DANA);
  await settle();
  assert.deepEqual(went, []);
  const d = app.door.value;
  assert.ok(d.step === "form" && d.refusal?.kind === "transport");
  app.tick();
  assert.equal(app.degraded.value, true, "and the page raises the degraded banner, as every surface does");
});

test("a second press while one sign-in is in flight sends nothing more", async () => {
  let answer!: () => void;
  const g = fakeGateway({ signIn: () => signedIn("S2") });
  const slow: FetchLike = async (url, init) => { await new Promise<void>((r) => { answer = r; }); return g.fetch(url, init); };
  const { app } = appWith({ fetch: slow });
  app.signIn(DANA);
  app.signIn(DANA);
  answer();
  await settle();
  assert.equal(g.signIns().length, 1);
});

test("an address no screen answers names the address and sends the person to sign in", () => {
  const w = { location: { pathname: "/vendor/old-link" }, history: { pushState: () => {} }, addEventListener: () => {}, removeEventListener: () => {} };
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: fakeGateway().fetch, window: w as unknown as Window, session: "bearer" });
  assert.equal(app.router.current.value, null);
  const page = render(app.view());
  assert.match(page, /Nothing at this address/);
  assert.match(page, /<code>\/vendor\/old-link<\/code>/);
  assert.match(page, /href="\/"[^>]*>Go to sign-in</);
});

/**
 * THE COPY CEILING, as a test.
 *
 * 05 §S1: availability and response-time language on this surface is bounded
 * by OQ6 and D7a, "neither of which is visible to whoever writes the copy",
 * and F9 is where the ceiling gets written down. Until it is, the ceiling is
 * ZERO, and this is what makes that a mechanism rather than an intention: a
 * sentence promising a time fails here, in the same commit that adds it. It
 * outlived the marketing page because the front door is still the page every
 * customer reads first.
 *
 * Delete this test when F9 lands and replace it with the ceiling it sets.
 */
test("NO TIME OR AVAILABILITY CLAIM ANYWHERE IN S1'S COPY — the ceiling is unwritten (D7a, OQ6, F9), so it is zero", async () => {
  const pages: string[] = [];
  const form = appWith(fakeGateway());
  form.app.setDevice(true);
  pages.push(render(form.app.view()));
  const choosing = appWith(fakeGateway({ signIn: () => ({ status: 200, body: CHOICES }) }));
  choosing.app.signIn(DANA);
  await settle();
  pages.push(render(choosing.app.view()));
  const w = { location: { pathname: "/nowhere" }, history: { pushState: () => {} }, addEventListener: () => {}, removeEventListener: () => {} };
  pages.push(render(createApp({ baseUrl: "https://api.ac.test", fetch: fakeGateway().fetch, window: w as unknown as Window, session: "bearer" }).view()));
  const copy = pages.join("\n") + "\n" + SURFACES.S1.name + "\n" + SURFACES.S1.degradedNotice;
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

test("S1 is the one surface that wears the house red, and its stylesheet holds no colour of its own", () => {
  assert.equal(SURFACES.S1.stateRamp, false, "nothing on this page bears state, which is why the red is allowed here");
  assert.equal(/#[0-9a-f]{3,8}|rgb\(/i.test(S1_CSS), false, "colour literals live in packages/tokens and nowhere else");
});
