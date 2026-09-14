import { createShell } from "../../../packages/shell/src/index.ts";
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
 * This surface owns no data. Every read and every write goes through the shell
 * to the gateway. It cannot resolve a database driver: .npmrc isolation, then
 * ac/no-db-in-surface, then tools/ci/schema-guard.ts.
 */
export const SURFACE = SURFACES.S7;

export const boot = (principal: Principal) => createShell({ surfaceId: "S7", principal });
