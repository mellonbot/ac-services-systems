import { createShell } from "@ac/shell";
import { SURFACES } from "@ac/contracts";
import type { Principal } from "@ac/contracts";

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
 * This surface owns no data. Every read and every write goes through the shell
 * to the gateway. It cannot resolve a database driver: .npmrc isolation, then
 * ac/no-db-in-surface, then tools/ci/schema-guard.ts.
 */
export const SURFACE = SURFACES.S5;

export const boot = (principal: Principal) => createShell({ surfaceId: "S5", principal });
