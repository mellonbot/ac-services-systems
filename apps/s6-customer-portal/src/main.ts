import { createShell } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

/**
 * S6 — Customer Portal
 *
 * Block INV · Phase 1 · comfort density · enabled
 *
 * Auth: customer IdP + tier claim
 * Writes: service_request, payment, contact_update
 *
 * Degraded mode:
 *   Cached read of last known job and invoice state, clearly timestamped; request intake queues. One codebase, four scopes — scoping is enforced at the gateway, never by client-side filtering.
 *
 * This surface owns no data. Every read and every write goes through the shell
 * to the gateway. It cannot resolve a database driver: .npmrc isolation, then
 * ac/no-db-in-surface, then tools/ci/schema-guard.ts.
 */
export const SURFACE = SURFACES.S6;

export const boot = (principal: Principal) => createShell({ surfaceId: "S6", principal });
