import { createShell } from "../../../packages/shell/src/index.ts";
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
 * This surface owns no data. Every read and every write goes through the shell
 * to the gateway. It cannot resolve a database driver: .npmrc isolation, then
 * ac/no-db-in-surface, then tools/ci/schema-guard.ts.
 */
export const SURFACE = SURFACES.S8;

export const boot = (principal: Principal) => createShell({ surfaceId: "S8", principal });
