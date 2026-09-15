import { createShell, connectShell, type ConnectConfig } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

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
 * This surface owns no data. Every read and every write goes through
 * `shell.gateway` — the client generated from the operation catalogue — and
 * nothing else. It cannot resolve a database driver (.npmrc isolation,
 * ac/no-db-in-surface, tools/ci/schema-guard.ts) and it cannot call fetch
 * (ac/no-fetch-in-surface, the same guard). A request that is not in
 * packages/contracts/src/operations.ts has no method here.
 */
export const SURFACE = SURFACES.S3;

/** Configuration-only shell — the registry checks, no transport. */
export const boot = (principal: Principal) => createShell({ surfaceId: "S3", principal });

/** Live shell — login, hierarchy context, generated client, event stream, degraded flag. */
export const connect = (cfg: Omit<ConnectConfig, "surfaceId">) => connectShell({ ...cfg, surfaceId: "S3" });
