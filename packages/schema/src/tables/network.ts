import { operationalTable } from "../tenancy.ts";

/** Model A: we provide crews and own execution. The network is ours to run. */
export const subcontractor_firms = operationalTable("subcontractor_firms", {
  columns: [
    { name: "legal_name", type: "text" },
    { name: "status", type: "text", check: "status IN ('onboarding','active','suspended','terminated')" },
    { name: "settlement_terms_days", type: "integer", comment: "D13. Measured from day one." },
    { name: "msa_signed_at", type: "timestamptz", nullable: true },
    { name: "diagnostic_data_rights_reserved", type: "boolean", comment: "OQ5, firm side. NOT NULL — the MSA states its position or is not recorded." },
    { name: "w9_document_key", type: "text", nullable: true },
  ],
});

export const crews = operationalTable("crews", {
  columns: [
    { name: "label", type: "text" },
    {
      name: "employment_type",
      type: "text",
      check: "employment_type IN ('employed','subcontracted')",
      comment: "Non-negotiable #9 — read ONLY by the compliance gate. Barred from the field layer by lint rule and CI guard. One field experience regardless of employment.",
    },
    { name: "firm_id", type: "uuid", nullable: true, references: "subcontractor_firms(id)" },
    { name: "home_region_id", type: "uuid", references: "regions(id)", comment: "Where the crew is normally dispatched from. region_id (tenancy) equals this on insert; a crew lent across regions keeps its home." },
    { name: "active", type: "boolean", default: "true" },
  ],
  indexes: [["firm_id"], ["home_region_id"]],
  constraints: [
    { name: "crews_subcontracted_have_firm", sql: "CHECK ((employment_type = 'subcontracted') = (firm_id IS NOT NULL))" },
  ],
});

export const crew_credentials = operationalTable("crew_credentials", {
  columns: [
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    { name: "kind", type: "text", check: "kind IN ('insurance','license','certification','background_check')" },
    { name: "identifier", type: "text" },
    { name: "valid_from", type: "date" },
    {
      name: "valid_to",
      type: "date",
      comment: "The gate checks the whole service window against this, never `now`. A certificate valid today that expires Tuesday does not clear a job scheduled Thursday.",
    },
    { name: "document_key", type: "text", nullable: true },
    { name: "verified_at", type: "timestamptz", nullable: true },
    { name: "verified_by", type: "uuid", nullable: true },
  ],
  indexes: [["crew_id", "valid_to"], ["valid_to"]],
});

/**
 * Rate confidentiality between firms is a commercial requirement. Gateway
 * scope check AND row-level security. One forgotten WHERE returns zero rows,
 * not every firm's pricing.
 */
export const rate_cards = operationalTable("rate_cards", {
  columns: [
    { name: "firm_id", type: "uuid", references: "subcontractor_firms(id)" },
    { name: "service_code", type: "text" },
    { name: "rate_minor", type: "bigint", comment: "Integer minor units. No float in the money path, enforced by lint." },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "effective", type: "daterange" },
  ],
  indexes: [["firm_id", "service_code"]],
  constraints: [
    { name: "rate_cards_no_overlap", sql: "EXCLUDE USING gist (firm_id WITH =, service_code WITH =, effective WITH &&)" },
  ],
});

/** Model A's economics are only visible at job level: receivable and payable reconcile per job. */
export const settlements = operationalTable("settlements", {
  columns: [
    { name: "firm_id", type: "uuid", references: "subcontractor_firms(id)" },
    { name: "period", type: "daterange" },
    { name: "total_minor", type: "bigint" },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "state", type: "text", check: "state IN ('draft','issued','acknowledged','disputed','paid')", default: "'draft'" },
    { name: "issued_at", type: "timestamptz", nullable: true },
  ],
  indexes: [["firm_id"]],
});

export const settlement_lines = operationalTable("settlement_lines", {
  columns: [
    { name: "settlement_id", type: "uuid", references: "settlements(id)" },
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "rate_card_id", type: "uuid", references: "rate_cards(id)" },
    { name: "quantity_milli", type: "bigint" },
    { name: "amount_minor", type: "bigint" },
  ],
  indexes: [["settlement_id"], ["job_id"]],
});
