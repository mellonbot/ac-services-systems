/**
 * Every entity any surface may write. A write not listed here cannot be
 * expressed, let alone allowlisted. Adding one is a reviewed diff on this file.
 */
export const WRITE_ENTITIES = [
  // S1 — anonymous intake
  "lead", "call_record",
  // S2 — the only authoring surface
  "account", "contract", "invoice", "warranty_case", "part", "purchase_order",
  // item 11: purchasing. A vendor and our receiving points are recorded by the
  // office; a catalogue item is a `part`; accepting or rejecting a vendor's
  // price, receiving goods and asking for a return are the office's side of
  // the four vendor writes below.
  "vendor", "receiving_point", "price_decision", "po_receipt", "rma_request",
  "subcontractor_firm", "crew", "crew_credential", "rate_card", "brand_theme",
  // item 4: a job is created in Office & Dispatch, same as everything above.
  // `device`/`device_grant` are D-2a's primitive ("this device, this crew,
  // this shift window") — recorded by the office because nobody else is
  // positioned to author it; reassigning that is a one-line diff on the
  // registry below, not a schema change.
  "job", "device", "device_grant",
  // item 9: the site record — what a site is, recorded by the office.
  "equipment", "account_contact",
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
