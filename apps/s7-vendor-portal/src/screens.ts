import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S7's screens — the vendor's side of procurement. Every write here is one of
 * the registry's five (po_ack, ship_date, catalog_price, vendor_invoice, rma);
 * the guard checks each operation named below is one the catalogue serves S7.
 */
export const SCREENS = {
  "login":     { path: "/login",           uses: ["auth.login"] },
  "order":     { path: "/orders/:poId",    uses: ["pos.detail", "pos.acknowledge", "shipments.record", "vendorInvoices.submit", "rmas.respond"] },
  "catalogue": { path: "/catalogue",       uses: ["catalog.list", "prices.propose", "prices.withdraw"], title: "Catalogue" },
  "invoices":  { path: "/invoices",        uses: ["vendorInvoices.list"], title: "Invoices" },
  "returns":   { path: "/returns",         uses: ["rmas.list"], title: "Returns" },
  "orders":    { path: "/",                uses: ["pos.list", "vendors.list"], title: "Orders" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
