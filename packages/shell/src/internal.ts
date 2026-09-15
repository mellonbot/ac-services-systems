/**
 * Transport-only handles. NOT re-exported from this package's entry point
 * (src/index.ts), so a surface package cannot reach them: the package `exports`
 * map names "." alone, and this module is not on it.
 *
 * The distinction is load-bearing. A surface that can reach DEGRADED can clear
 * its own degraded flag, and it will — to make a screen render during a demo,
 * at which point "declared degraded mode per surface" is decoration. Only the
 * transport, which is the thing that actually knows the gateway is unreachable,
 * may write it.
 */
export const DEGRADED = Symbol("ac.shell.degraded");

export type DegradedState = { degraded: boolean };
