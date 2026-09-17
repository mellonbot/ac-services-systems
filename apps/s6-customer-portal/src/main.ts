import { createShell, connectShell, type ConnectConfig, installBrand, type BrandConfig, type BrandSlot } from "../../../packages/shell/src/index.ts";
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
 * This surface owns no data. Every read and every write goes through
 * `shell.gateway` — the client generated from the operation catalogue — and
 * nothing else. It cannot resolve a database driver (.npmrc isolation,
 * ac/no-db-in-surface, tools/ci/schema-guard.ts) and it cannot call fetch
 * (ac/no-fetch-in-surface, the same guard). A request that is not in
 * packages/contracts/src/operations.ts has no method here.
 */
export const SURFACE = SURFACES.S6;

/** Configuration-only shell — the registry checks, no transport. */
export const boot = (principal: Principal) => createShell({ surfaceId: "S6", principal });

/** Live shell — login, hierarchy context, generated client, event stream, degraded flag. */
export const connect = (cfg: Omit<ConnectConfig, "surfaceId">) => connectShell({ ...cfg, surfaceId: "S6" });

/**
 * White-label. Called FIRST, before connect() — a portal branded only after a
 * successful password looks like someone else's until you are already inside it.
 *
 *   await brand({ baseUrl, fetch, host: location.hostname }, document.getElementById("ac-brand"));
 *
 * It cannot fail in a way that matters: no theme, no answer and an unknown host
 * all leave the page in the plate the frame already carries.
 */
export const brand = (cfg: Omit<BrandConfig, "surfaceId">, slot: BrandSlot | null) =>
  installBrand({ ...cfg, surfaceId: "S6" }, slot);
