/**
 * Every entity any surface may write. A write not listed here cannot be
 * expressed, let alone allowlisted. Adding one is a reviewed diff on this file.
 */
export const WRITE_ENTITIES = [
  // S1 — anonymous intake
  "lead", "call_record",
  // S2 — the only authoring surface
  "account", "contract", "invoice", "warranty_case", "part", "purchase_order",
  "subcontractor_firm", "crew_credential", "rate_card", "brand_theme",
  // S3 — dispatch
  "assignment", "job_state", "crew_release", "escalation",
  // S4 — commentary (see OPEN-S4 in docs/OPEN_DECISIONS.md; not granted)
  "annotation", "acknowledgement",
  // S5 — field execution
  "checklist", "photo", "part_used", "time_entry", "signature",
  // S6 — customer
  "service_request", "payment", "contact_update",
  // S7 — vendor
  "po_ack", "ship_date", "vendor_invoice", "catalog_price", "rma",
  // S8 — subcontractor firm
  "compliance_doc", "crew_roster", "settlement_ack", "dispute",
] as const;

export type WriteEntity = (typeof WRITE_ENTITIES)[number];
