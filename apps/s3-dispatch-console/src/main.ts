import { createShell } from "@ac/shell";
import { SURFACES } from "@ac/contracts";
import type { Principal } from "@ac/contracts";

/**
 * S3 — Dispatch Console
 *
 * Block OFC · Phase 1 · console density · enabled
 *
 * Auth: region-scoped
 * Writes: assignment, job_state, crew_release, escalation
 *
 * Degraded mode:
 *   Board freezes with a visible staleness clock and stops accepting assignments. A dispatcher acting on a stale board is worse than a dispatcher who knows the board is stale. The compliance gate is enforced HERE, at assignment, with no override path.
 *
 * This surface owns no data. Every read and every write goes through the shell
 * to the gateway. It cannot resolve a database driver: .npmrc isolation, then
 * ac/no-db-in-surface, then tools/ci/schema-guard.ts.
 */
export const SURFACE = SURFACES.S3;

export const boot = (principal: Principal) => createShell({ surfaceId: "S3", principal });
