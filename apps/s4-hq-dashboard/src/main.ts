import { createShell } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

/**
 * S4 — HQ Ops Dashboard
 *
 * Block OFC · Phase 2 · console density · NOT ENABLED (phase gate)
 *
 * Auth: org-wide READ only
 * Writes: NOTHING — read-only by construction
 *
 * Degraded mode:
 *   Warehouse-backed and already asynchronous; shows the age of its last rollup and nothing more.
 *
 * This surface owns no data. Every read and every write goes through the shell
 * to the gateway. It cannot resolve a database driver: .npmrc isolation, then
 * ac/no-db-in-surface, then tools/ci/schema-guard.ts.
 */
export const SURFACE = SURFACES.S4;

export const boot = (principal: Principal) => createShell({ surfaceId: "S4", principal });
