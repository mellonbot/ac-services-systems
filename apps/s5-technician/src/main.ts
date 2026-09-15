import { createShell, connectShell, type ConnectConfig } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

/**
 * S5 — Technician web fallback
 *
 * Block FLD · Phase 1 · field density · enabled
 *
 * Auth: tech credential + shift device grant
 * Writes: job_state, checklist, photo, part_used, time_entry, signature
 *
 * Degraded mode:
 *   Offline-first: device holds intent, server holds truth, replay is idempotent by client-generated mutation id. `assignments` is server-authoritative so an offline device cannot route around the compliance gate. IDENTICAL for employed and subcontracted crews.
 *
 * This surface owns no data. Every read and every write goes through
 * `shell.gateway` — the client generated from the operation catalogue — and
 * nothing else. It cannot resolve a database driver (.npmrc isolation,
 * ac/no-db-in-surface, tools/ci/schema-guard.ts) and it cannot call fetch
 * (ac/no-fetch-in-surface, the same guard). A request that is not in
 * packages/contracts/src/operations.ts has no method here.
 */
export const SURFACE = SURFACES.S5;

/** Configuration-only shell — the registry checks, no transport. */
export const boot = (principal: Principal) => createShell({ surfaceId: "S5", principal });

/** Live shell — login, hierarchy context, generated client, event stream, degraded flag. */
export const connect = (cfg: Omit<ConnectConfig, "surfaceId">) => connectShell({ ...cfg, surfaceId: "S5" });
