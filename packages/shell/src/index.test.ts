import { test } from "node:test";
import assert from "node:assert/strict";
import { createShell, connectShell, densityTokens, heldShift, holdShift, forgetShift, resumeHeldShift, SHIFT_TAB_KEY, HELD_SHIFT_KEY, type TabMark } from "./index.ts";
import { DEGRADED, type DegradedState } from "./internal.ts";
import { SURFACES, SURFACE_IDS, OPERATIONS, type Principal, type SurfaceId, type HierarchyContext } from "../../contracts/src/index.ts";
import type { FetchLike } from "../../sdk/src/runtime.ts";

/**
 * The shell had no test file, and so `createShell` threw TypeError on every
 * call for every surface — Object.freeze followed by Object.assign, which is a
 * silent no-op in sloppy mode and a throw in strict mode, and every ES module
 * is strict. 82 unit tests passed the whole time, because none of them ever
 * constructed a shell.
 *
 * The first test below is that one. The rest hold the boundaries the shell is
 * the only enforcement point for.
 */

const principalFor = (id: SurfaceId): Principal => {
  const s = SURFACES[id];
  return {
    namespace: s.namespace,
    subjectId: "sub-1",
    orgId: "org-1",
    regionId: s.namespace === "anonymous" ? "UNASSIGNED" : "region-1",
    scopeTier: "region",
    scopeId: "region-1",
    roles: s.roles ? [s.roles[0]!] : [],
    firmId: s.namespace === "subcontractor" ? "firm-1" : null,
    deviceId: s.namespace === "device" ? "device-1" : null,
    shiftId: s.namespace === "device" ? "shift-1" : null,
    tierClaim: s.namespace === "customer" ? "location" : null,
    sessionId: "sess-1",
  };
};

test("createShell constructs — every enabled surface boots", () => {
  for (const id of SURFACE_IDS) {
    if (!SURFACES[id].enabled) continue;
    const shell = createShell({ surfaceId: id, principal: principalFor(id) });
    assert.equal(shell.surfaceId, id);
    assert.equal(shell.density, SURFACES[id].density);
    assert.equal(shell.isDegraded(), false);
  }
});

test("a phase-disabled surface refuses to boot — enabling it is a data change (D9)", () => {
  const disabled = SURFACE_IDS.filter((id) => !SURFACES[id].enabled);
  assert.ok(disabled.length > 0, "the registry should carry at least one deferred surface");
  for (const id of disabled) {
    assert.throws(
      () => createShell({ surfaceId: id, principal: principalFor(id) }),
      /not enabled/,
      id,
    );
  }
});

test("a principal from the wrong namespace is refused — the wall sits below the role layer", () => {
  // A subcontractor principal pointed at the customer portal. Under Model A this
  // is the exact confusion that would leak one firm's work into a customer view.
  const subcontractor = { ...principalFor("S8"), namespace: "subcontractor" as const };
  assert.throws(
    () => createShell({ surfaceId: "S6", principal: subcontractor }),
    /serves the customer namespace/,
  );
});

test("a region-scoped surface refuses a principal carrying no region", () => {
  const regionScoped = SURFACE_IDS.filter(
    (id) => SURFACES[id].enabled && SURFACES[id].scopeBinding === "region",
  );
  assert.ok(regionScoped.length > 0);
  for (const id of regionScoped) {
    const noRegion = { ...principalFor(id), regionId: "" };
    assert.throws(
      () => createShell({ surfaceId: id, principal: noRegion }),
      /carries no region/,
      id,
    );
  }
});

test("a surface cannot clear its own degraded flag", () => {
  const shell = createShell({ surfaceId: "S3", principal: principalFor("S3") });
  // Everything on the public shape is frozen: no surface can swap isDegraded
  // for one that returns false.
  assert.throws(() => {
    (shell as unknown as { isDegraded: unknown }).isDegraded = () => false;
  }, TypeError);
  assert.equal(Object.isFrozen(shell), true);
});

test("the transport — and only the transport — can flip degraded", () => {
  const shell = createShell({ surfaceId: "S3", principal: principalFor("S3") });
  const state = (shell as unknown as Record<symbol, DegradedState>)[DEGRADED]!;
  assert.equal(shell.isDegraded(), false);
  state.degraded = true;
  assert.equal(shell.isDegraded(), true, "freezing the shell must not freeze the state it reads");
});

test("every surface carries its declared degraded mode to the shell", () => {
  for (const id of SURFACE_IDS) {
    if (!SURFACES[id].enabled) continue;
    const shell = createShell({ surfaceId: id, principal: principalFor(id) });
    assert.equal(shell.degradedMode, SURFACES[id].degraded);
  }
});

test("densityTokens resolves each surface to its declared density set", () => {
  assert.equal(densityTokens("S5").hoverAffordances, false, "no cursor on a tablet");
  assert.equal(densityTokens("S3").hoverAffordances, true);
});

/**
 * connectShell's device path (item 4, S5). What this holds: a device-login
 * connect carries the crew auth.deviceLogin resolved on `deviceCrew` — the
 * one place a device-namespace shell can read it, since it is deliberately
 * not a token claim — and an ordinary email/password connect carries none.
 */
const deviceContext: HierarchyContext = {
  principal: {
    namespace: "device", subjectId: "tech-1", orgId: "org-internal", regionId: "region-1", scopeTier: "region", scopeId: "region-1",
    roles: ["technician"], firmId: null, deviceId: "device-1", shiftId: "shift-1", tierClaim: null, sessionId: "sess-1",
  },
  path: [], parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: "region-1",
};

const fakeDeviceGateway = (): FetchLike => async (url) => {
  const path = new URL(url).pathname;
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  if (path === OPERATIONS["auth.deviceLogin"].path) return reply(200, { token: "dev-token", expiresAt: "2026-09-18T18:00:00Z", crewId: "crew-1", crewLabel: "Crew A1", context: {} });
  if (path === OPERATIONS["session.me"].path) return reply(200, deviceContext);
  return reply(404, { error: "NoRoute", message: `no route ${path}` });
};

test("connectShell with a device grant carries the resolved crew on deviceCrew — never on the principal", async () => {
  const shell = await connectShell({ surfaceId: "S5", baseUrl: "https://api.ac.test", fetch: fakeDeviceGateway(), credentials: { hardwareId: "hw-001", email: "tech@ac.test", password: "pw" } });
  assert.deepEqual(shell.deviceCrew, { id: "crew-1", label: "Crew A1" });
  assert.equal(shell.principal.shiftId, "shift-1");
  assert.equal((shell.principal as unknown as { crewId?: unknown }).crewId, undefined, "the crew is not a claim on the principal");
});

test("connectShell with email/password carries no deviceCrew", async () => {
  const fetch: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
    if (path === OPERATIONS["auth.login"].path) return reply(200, { token: "office-token", expiresAt: "2026-09-18T18:00:00Z", context: {} });
    if (path === OPERATIONS["session.me"].path) {
      return reply(200, {
        principal: { namespace: "internal", subjectId: "u-1", orgId: "org-internal", regionId: "region-1", scopeTier: "region", scopeId: "region-1", roles: ["dispatcher"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-2" },
        path: [], parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: "region-1",
      });
    }
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  const shell = await connectShell({ surfaceId: "S3", baseUrl: "https://api.ac.test", fetch, credentials: { email: "dispatcher@ac.test", password: "pw" } });
  assert.equal(shell.deviceCrew, null);
});

/**
 * The held shift (offline entry). It holds only what the gateway answered for
 * a device session, only in a tab S1 marked, and never past the session's end.
 */
const tabStore = (entries: Record<string, string> = {}): TabMark & { map: Map<string, string> } => {
  const map = new Map(Object.entries(entries));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
};
const ENDS = "2026-11-02T18:00:00.000Z";
const before = Date.parse(ENDS) - 1;
const heldContext = { ...deviceContext, deviceCrew: { id: "crew-1", label: "Crew A1" }, deviceShiftEndsAt: ENDS };

test("a shift is held only in a marked tab, and read back only before it ends", () => {
  const unmarked = tabStore();
  holdShift(unmarked, { context: heldContext });
  assert.equal(unmarked.map.has(HELD_SHIFT_KEY), false, "no mark, nothing held — a fresh tab never opens a shift offline");

  const tab = tabStore({ [SHIFT_TAB_KEY]: "1" });
  holdShift(tab, { context: heldContext });
  assert.equal(heldShift(tab, before)?.deviceCrew.label, "Crew A1");
  assert.equal(heldShift(tab, Date.parse(ENDS)), null, "at the session's end it is gone");

  tab.removeItem(SHIFT_TAB_KEY);
  assert.equal(heldShift(tab, before), null, "a record without the mark is not a shift");
  tab.setItem(SHIFT_TAB_KEY, "1");
  forgetShift(tab);
  assert.equal(heldShift(tab, before), null);
});

test("only a device session with a crew and an end is held; anything malformed reads as nothing", () => {
  const tab = tabStore({ [SHIFT_TAB_KEY]: "1" });
  holdShift(tab, { context: { ...heldContext, deviceShiftEndsAt: undefined } as unknown as HierarchyContext });
  holdShift(tab, { context: { ...heldContext, deviceCrew: null } });
  holdShift(tab, { context: { ...heldContext, principal: { ...heldContext.principal, namespace: "internal" } } });
  holdShift(tab, { context: null });
  assert.equal(tab.map.has(HELD_SHIFT_KEY), false);
  tab.setItem(HELD_SHIFT_KEY, "{not json");
  assert.equal(heldShift(tab, before), null);
  const throwing: TabMark = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(heldShift(throwing, before), null);
  holdShift(throwing, { context: heldContext });
  forgetShift(throwing);
});

test("resumeHeldShift opens the held device session with no session.me, and the gateway still judges every call", async () => {
  const paths: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    paths.push(new URL(url).pathname);
    assert.equal((init as { credentials?: string } | undefined)?.credentials, "include", "the live cookie goes with every call");
    throw new TypeError("Failed to fetch");
  };
  const shell = resumeHeldShift({ surfaceId: "S5", baseUrl: "https://api.ac.test", fetch }, heldContext);
  assert.deepEqual(paths, [], "opening it asks the gateway nothing");
  assert.equal(shell.principal.subjectId, "tech-1");
  assert.deepEqual(shell.deviceCrew, { id: "crew-1", label: "Crew A1" });
  assert.equal(shell.token(), null);
  await assert.rejects(shell.gateway.myJobs());
  assert.equal(shell.isDegraded(), true, "an unreachable gateway is the degraded state, as everywhere");
  assert.deepEqual(paths, [OPERATIONS["jobs.mine"].path]);
});
