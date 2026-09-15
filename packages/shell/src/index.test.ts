import { test } from "node:test";
import assert from "node:assert/strict";
import { createShell, densityTokens } from "./index.ts";
import { DEGRADED, type DegradedState } from "./internal.ts";
import { SURFACES, SURFACE_IDS, type Principal, type SurfaceId } from "../../contracts/src/index.ts";

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
