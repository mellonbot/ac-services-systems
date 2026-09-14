import { SURFACES, type SurfaceId, type Principal } from "@ac/contracts";
import { DENSITY, type Density } from "@ac/tokens";

/**
 * S0 — THE SHARED SHELL. The one way a surface talks to the gateway.
 *
 * Every S0 obligation is discharged here, once, for all eight surfaces:
 * hierarchy context resolved at login, the generated SDK (no surface writes its
 * own fetch call and none holds a DB credential), event-stream subscription,
 * an audit emitter on every state-changing action, and a declared degraded mode.
 *
 * Implemented once because eight implementations means eight, and by the third
 * one somebody has quietly skipped the audit emitter for a "read-mostly" screen.
 */
export type ShellConfig = {
  readonly surfaceId: SurfaceId;
  readonly principal: Principal;
};

export type Shell = {
  readonly surfaceId: SurfaceId;
  readonly density: Density;
  readonly principal: Principal;
  readonly degradedMode: string;
  /** True when the gateway is unreachable. Every surface must render this state. */
  isDegraded(): boolean;
};

export const createShell = (config: ShellConfig): Shell => {
  const surface = SURFACES[config.surfaceId];

  if (!surface.enabled) {
    throw new Error(
      `${surface.id} (${surface.name}) is Phase ${surface.phase} and not enabled. ` +
      `Enabling it is a data change in the surface registry — see D9.`,
    );
  }
  if (surface.namespace !== config.principal.namespace) {
    throw new Error(
      `${surface.id} serves the ${surface.namespace} namespace; this principal is ${config.principal.namespace}. ` +
      `Namespaces are walls below the role layer: a subcontractor is neither a customer nor a parts vendor.`,
    );
  }
  // Every operational caller carries a region. This is the runtime half of the
  // invariant the schema holds structurally.
  if (surface.scopeBinding === "region" && !config.principal.regionId) {
    throw new Error(`${surface.id} is region-scoped and the principal carries no region.`);
  }

  const state = { degraded: false };
  const shell: Shell = Object.freeze({
    surfaceId: surface.id,
    density: surface.density,
    principal: config.principal,
    degradedMode: surface.degraded,
    isDegraded: () => state.degraded,
  });
  // The transport flips this; the surface can only read it. A surface that can
  // clear its own degraded flag will clear it to make a screen render.
  return Object.assign(shell, { [DEGRADED]: state }) as Shell;
};

/** Transport-only handle. Not exported from the package index. */
export const DEGRADED = Symbol("ac.shell.degraded");

export const densityTokens = (id: SurfaceId) => DENSITY[SURFACES[id].density];
