import { createShell } from "@ac/shell";
import { SURFACES } from "@ac/contracts";
import type { Principal } from "@ac/contracts";

/**
 * S1 — Marketing / lead-gen
 *
 * Block OFC · Phase 1 · comfort density · enabled
 *
 * Auth: none (anonymous)
 * Writes: lead, call_record
 *
 * Degraded mode:
 *   Statically generated; forms queue to a durable buffer and replay. Site stays up when the gateway does not. Coverage map is read from the hierarchy — never hard-coded (D14: supply before signature).
 *
 * This surface owns no data. Every read and every write goes through the shell
 * to the gateway. It cannot resolve a database driver: .npmrc isolation, then
 * ac/no-db-in-surface, then tools/ci/schema-guard.ts.
 */
export const SURFACE = SURFACES.S1;

export const boot = (principal: Principal) => createShell({ surfaceId: "S1", principal });
