import { createShell, connectShell, type ConnectConfig } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

/**
 * S7 — Vendor Portal
 *
 * Block INV · Phase 4 · comfort density · NOT ENABLED (phase gate)
 *
 * Auth: separate vendor namespace
 * Writes: po_ack, ship_date, vendor_invoice, catalog_price, rma
 *
 * Degraded mode:
 *   Read-only PO list. Vendors see parts, POs and destination tier — never customer names, never job records.
 *
 * This surface owns no data. Every read and every write goes through
 * `shell.gateway` — the client generated from the operation catalogue — and
 * nothing else. It cannot resolve a database driver (.npmrc isolation,
 * ac/no-db-in-surface, tools/ci/schema-guard.ts) and it cannot call fetch
 * (ac/no-fetch-in-surface, the same guard). A request that is not in
 * packages/contracts/src/operations.ts has no method here.
 */
export const SURFACE = SURFACES.S7;

/** Configuration-only shell — the registry checks, no transport. */
export const boot = (principal: Principal) => createShell({ surfaceId: "S7", principal });

/** Live shell — login, hierarchy context, generated client, event stream, degraded flag. */
export const connect = (cfg: Omit<ConnectConfig, "surfaceId">) => connectShell({ ...cfg, surfaceId: "S7" });
