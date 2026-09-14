import { operationalTable } from "../tenancy.ts";

/** Model A: we provide crews and own execution. The network is ours to run. */
export const subcontractor_firms = operationalTable("subcontractor_firms", {
  columns: [
    { name: "legal_name", type: "text" },
    { name: "status", type: "text", check: "status IN ('onboarding','active','suspended','terminated')" },
    { name: "settlement_terms_days", type: "integer" },
    { name: "diagnostic_data_rights_reserved", type: "boolean", comment: "OQ5, firm side." },
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
    { name: "active", type: "boolean", default: "true" },
  ],
  indexes: [["firm_id"]],
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
  ],
  indexes: [["crew_id", "valid_to"]],
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
    { name: "effective_from", type: "date" },
    { name: "effective_to", type: "date", nullable: true },
  ],
  indexes: [["firm_id", "service_code"]],
});
