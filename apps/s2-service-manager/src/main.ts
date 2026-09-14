import { createShell } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

/**
 * S2 — Service Manager
 *
 * Block OFC · Phase 1 · console density · enabled
 *
 * Auth: role-based, org-wide
 * Writes: account, contract, invoice, warranty_case, part, purchase_order, subcontractor_firm, crew_credential, rate_card
 *
 * Degraded mode:
 *   Read-only from last server state. NO offline writes, ever — this is the only surface that authors hierarchy, contract and subcontractor-network truth, and a forked truth here is unrecoverable.
 *
 * This surface owns no data. Every read and every write goes through the shell
 * to the gateway. It cannot resolve a database driver: .npmrc isolation, then
 * ac/no-db-in-surface, then tools/ci/schema-guard.ts.
 */
export const SURFACE = SURFACES.S2;

export const boot = (principal: Principal) => createShell({ surfaceId: "S2", principal });
