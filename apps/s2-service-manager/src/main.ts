import { createShell, connectShell, type ConnectConfig } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

/**
 * S2 — Service Manager
 *
 * Block OFC · Phase 1 · console density · enabled
 *
 * Auth: role-based, org-wide
 * Writes: account, contract, invoice, warranty_case, part, purchase_order, subcontractor_firm, crew, crew_credential, rate_card
 *
 * Degraded mode:
 *   Read-only from last server state. NO offline writes, ever — this is the only surface that authors hierarchy, contract and subcontractor-network truth, and a forked truth here is unrecoverable.
 *
 * This surface owns no data. Every read and every write goes through
 * `shell.gateway` — the client generated from the operation catalogue — and
 * nothing else. It cannot resolve a database driver (.npmrc isolation,
 * ac/no-db-in-surface, tools/ci/schema-guard.ts) and it cannot call fetch
 * (ac/no-fetch-in-surface, the same guard). A request that is not in
 * packages/contracts/src/operations.ts has no method here.
 */
export const SURFACE = SURFACES.S2;

/** Configuration-only shell — the registry checks, no transport. */
export const boot = (principal: Principal) => createShell({ surfaceId: "S2", principal });

/** Live shell — login, hierarchy context, generated client, event stream, degraded flag. */
export const connect = (cfg: Omit<ConnectConfig, "surfaceId">) => connectShell({ ...cfg, surfaceId: "S2" });
