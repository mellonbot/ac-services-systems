import { createShell, openAnonymousShell, type AnonymousConfig } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

/**
 * S1 — Front door
 *
 * Block OFC · Phase 1 · comfort density · enabled
 *
 * Auth: none — signs a person in and hands them to their surface
 * Writes: NOTHING — read-only by construction
 *
 * Degraded mode:
 *   Statically generated; the page renders with no gateway call. Signing in needs the gateway: when it does not answer, the form says so and keeps what was typed. Nothing is queued — a sign-in is not a write to replay.
 *
 * This surface owns no data. Every read and every write goes through
 * `shell.gateway` — the client generated from the operation catalogue — and
 * nothing else. It cannot resolve a database driver (.npmrc isolation,
 * ac/no-db-in-surface, tools/ci/schema-guard.ts) and it cannot call fetch
 * (ac/no-fetch-in-surface, the same guard). A request that is not in
 * packages/contracts/src/operations.ts has no method here.
 */
export const SURFACE = SURFACES.S1;

/** Configuration-only shell — the registry checks, no transport. */
export const boot = (principal: Principal) => createShell({ surfaceId: "S1", principal });

/** Live shell — no session of its own. The principal is the shared constant; signing in mints the destination surface's session. */
export const open = (cfg: Omit<AnonymousConfig, "surfaceId">) => openAnonymousShell({ ...cfg, surfaceId: "S1" });
