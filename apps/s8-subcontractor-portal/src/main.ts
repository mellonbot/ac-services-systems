import { createShell, connectShell, type ConnectConfig } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

/**
 * S8 — Subcontractor Portal
 *
 * Block INV · Phase 1 · comfort density · enabled
 *
 * Auth: subcontractor firm namespace
 * Writes: compliance_doc, crew_roster, settlement_ack, dispute
 *
 * Degraded mode:
 *   Document upload queues to durable storage and acknowledges on receipt, not on processing. Settlement views serve last statement. A firm sees its own crews, its own jobs, its own compliance, its own money — never another firm's rate card.
 *
 * This surface owns no data. Every read and every write goes through
 * `shell.gateway` — the client generated from the operation catalogue — and
 * nothing else. It cannot resolve a database driver (.npmrc isolation,
 * ac/no-db-in-surface, tools/ci/schema-guard.ts) and it cannot call fetch
 * (ac/no-fetch-in-surface, the same guard). A request that is not in
 * packages/contracts/src/operations.ts has no method here.
 */
export const SURFACE = SURFACES.S8;

/** Configuration-only shell — the registry checks, no transport. */
export const boot = (principal: Principal) => createShell({ surfaceId: "S8", principal });

/** Live shell — login, hierarchy context, generated client, event stream, degraded flag. */
export const connect = (cfg: Omit<ConnectConfig, "surfaceId">) => connectShell({ ...cfg, surfaceId: "S8" });
