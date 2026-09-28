import { operationalTable } from "../tenancy.ts";

/**
 * ITEM 11 — PROCUREMENT, and the vendor's side of it (S7).
 *
 * A vendor is a tenant root the way a subcontractor firm is: the
 * `organizations` row and the `vendors` row share an id, and every row a
 * vendor may read carries `org_id = the vendor`. So "a vendor sees its own"
 * is one rule on every table below, and "never customer names, never job
 * records" (the registry's degraded line) holds because nothing here names a
 * customer, a site or a job — a purchase order goes to one of OUR receiving
 * points, by code.
 *
 * region_id: a vendor's own rows live in the region it is administered from;
 * a purchase order and everything hanging off it live in the region of the
 * receiving point the goods are going to. Tenancy is inherited by trigger
 * (migration 0011), never typed by a handler.
 */
export const vendors = operationalTable("vendors", {
  columns: [
    { name: "legal_name", type: "text" },
    { name: "status", type: "text", check: "status IN ('active','suspended','terminated')", default: "'active'" },
    { name: "payment_terms_days", type: "integer", default: "30", comment: "Days from a matched invoice. Payment itself is not modelled yet." },
    { name: "contact_email", type: "text", nullable: true },
  ],
});

export const receiving_points = operationalTable("receiving_points", {
  comment: "Where OUR goods are received: a regional hub, the national warehouse, or a location stock room. Named by code — a vendor reads this row, so it never carries a customer's name.",
  columns: [
    { name: "code", type: "text" },
    { name: "tier", type: "text", check: "tier IN ('location_stock','regional_hub','national')" },
    { name: "address", type: "jsonb" },
    { name: "active", type: "boolean", default: "true" },
  ],
  uniques: [["code"]],
});

export const vendor_catalog_items = operationalTable("vendor_catalog_items", {
  columns: [
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "vendor_sku", type: "text" },
    { name: "description", type: "text" },
    { name: "manufacturer_id", type: "uuid", nullable: true, references: "part_manufacturers(id)" },
    { name: "uom", type: "text", default: "'each'" },
    { name: "active", type: "boolean", default: "true" },
  ],
  indexes: [["vendor_id"]],
  uniques: [["vendor_id", "vendor_sku"]],
});

export const vendor_catalog_prices = operationalTable("vendor_catalog_prices", {
  comment: "A vendor PROPOSES a price from a day; it applies to a purchase order only once the office has accepted it. Two accepted prices for one item at once are unrepresentable (the EXCLUDE below).",
  columns: [
    { name: "item_id", type: "uuid", references: "vendor_catalog_items(id)" },
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "price_minor", type: "bigint" },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "effective", type: "daterange" },
    { name: "state", type: "text", check: "state IN ('proposed','accepted','rejected','withdrawn')", default: "'proposed'" },
    { name: "proposed_at", type: "timestamptz", default: "now()" },
    { name: "decided_at", type: "timestamptz", nullable: true },
    { name: "decided_by", type: "uuid", nullable: true },
    { name: "decision_note", type: "text", nullable: true },
  ],
  indexes: [["item_id"], ["vendor_id"]],
  constraints: [
    { name: "vendor_catalog_prices_no_overlap", sql: "EXCLUDE USING gist (item_id WITH =, effective WITH &&) WHERE (state = 'accepted')" },
  ],
});

export const purchase_orders = operationalTable("purchase_orders", {
  columns: [
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "number", type: "text" },
    { name: "receiving_point_id", type: "uuid", references: "receiving_points(id)" },
    { name: "state", type: "text", check: "state IN ('draft','issued','acknowledged','received','cancelled')", default: "'draft'" },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "total_minor", type: "bigint", default: "0" },
    { name: "raised_by", type: "uuid" },
    { name: "issued_at", type: "timestamptz", nullable: true },
    { name: "acknowledged_at", type: "timestamptz", nullable: true },
    { name: "promised_ship_on", type: "date", nullable: true },
  ],
  indexes: [["vendor_id"], ["receiving_point_id"]],
  uniques: [["number"]],
});

export const purchase_order_lines = operationalTable("purchase_order_lines", {
  columns: [
    { name: "po_id", type: "uuid", references: "purchase_orders(id)" },
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "line_no", type: "integer" },
    { name: "item_id", type: "uuid", references: "vendor_catalog_items(id)" },
    { name: "price_id", type: "uuid", references: "vendor_catalog_prices(id)", comment: "The accepted price the line was raised at. The line keeps it whatever the catalogue does next." },
    { name: "quantity_milli", type: "bigint" },
    { name: "unit_price_minor", type: "bigint" },
  ],
  indexes: [["po_id"]],
  uniques: [["po_id", "line_no"]],
});

export const shipments = operationalTable("shipments", {
  columns: [
    { name: "po_id", type: "uuid", references: "purchase_orders(id)" },
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "shipped_on", type: "date" },
    { name: "carrier", type: "text" },
    { name: "tracking", type: "text", nullable: true },
  ],
  indexes: [["po_id"]],
});

export const shipment_lines = operationalTable("shipment_lines", {
  columns: [
    { name: "shipment_id", type: "uuid", references: "shipments(id)" },
    { name: "po_line_id", type: "uuid", references: "purchase_order_lines(id)" },
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "quantity_milli", type: "bigint" },
  ],
  indexes: [["shipment_id"], ["po_line_id"]],
});

export const po_receipts = operationalTable("po_receipts", {
  columns: [
    { name: "po_id", type: "uuid", references: "purchase_orders(id)" },
    { name: "po_line_id", type: "uuid", references: "purchase_order_lines(id)" },
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "quantity_milli", type: "bigint" },
    { name: "received_at", type: "timestamptz", default: "now()" },
    { name: "received_by", type: "uuid" },
  ],
  indexes: [["po_id"], ["po_line_id"]],
});

export const vendor_invoices = operationalTable("vendor_invoices", {
  columns: [
    { name: "po_id", type: "uuid", references: "purchase_orders(id)" },
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "invoice_number", type: "text" },
    { name: "invoice_date", type: "date" },
    { name: "total_minor", type: "bigint" },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "match_state", type: "text", check: "match_state IN ('matched','held')" },
    { name: "match_notes", type: "jsonb", default: "'[]'", comment: "Why a held invoice is held, one entry per disagreement with the order or the receipt." },
    { name: "document_key", type: "text", nullable: true },
  ],
  indexes: [["po_id"], ["vendor_id"]],
  uniques: [["vendor_id", "invoice_number"]],
});

export const vendor_invoice_lines = operationalTable("vendor_invoice_lines", {
  columns: [
    { name: "invoice_id", type: "uuid", references: "vendor_invoices(id)" },
    { name: "po_line_id", type: "uuid", references: "purchase_order_lines(id)" },
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "quantity_milli", type: "bigint" },
    { name: "unit_price_minor", type: "bigint" },
    { name: "amount_minor", type: "bigint" },
  ],
  indexes: [["invoice_id"], ["po_line_id"]],
});

export const rmas = operationalTable("rmas", {
  comment: "A return. The office requests it against a received line; the vendor authorizes it (with its RMA number) or rejects it (with a reason).",
  columns: [
    { name: "po_id", type: "uuid", references: "purchase_orders(id)" },
    { name: "po_line_id", type: "uuid", references: "purchase_order_lines(id)" },
    { name: "vendor_id", type: "uuid", references: "vendors(id)" },
    { name: "quantity_milli", type: "bigint" },
    { name: "reason", type: "text" },
    { name: "state", type: "text", check: "state IN ('requested','authorized','rejected')", default: "'requested'" },
    { name: "requested_by", type: "uuid" },
    { name: "rma_number", type: "text", nullable: true },
    { name: "vendor_note", type: "text", nullable: true },
    { name: "responded_at", type: "timestamptz", nullable: true },
  ],
  indexes: [["po_id"], ["vendor_id"]],
});
