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

/** 0024. Mirrored by CREW_KINDS in packages/contracts; a test holds them equal. */
export const CREW_KINDS = ["service", "install"] as const;

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
    {
      name: "kind", type: "text", check: `kind IN (${CREW_KINDS.map((k) => `'${k}'`).join(",")})`, default: "'service'",
      comment: "0024: service — one technician's dispatch unit; install — an install crew. A technician is never on an install crew.",
    },
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
 * 0020 — the technician roster: every person who works our jobs, ours or a
 * firm's, whether or not they ever sign in. A login is a `users` row; this is
 * the person the office calls, routes and staffs by specialty. firm_id null is
 * ours. The home address is personal data for people who are mostly not our
 * employees: RLS keeps it internal, and the gateway serves it to account
 * owners only.
 */
/** 0024. Mirrored by TECHNICIAN_ROLES in packages/contracts; a test holds them equal. */
export const TECHNICIAN_ROLES = ["technician", "lead_installer", "installer", "helper"] as const;
export const TECHNICIAN_SPECIALTIES = ["residential_hvac", "light_commercial", "commercial_rtu", "refrigeration", "chillers_boilers", "controls_bas"] as const;

export const technicians = operationalTable("technicians", {
  columns: [
    { name: "firm_id", type: "uuid", nullable: true, references: "subcontractor_firms(id)", comment: "Null: one of ours." },
    { name: "crew_id", type: "uuid", nullable: true, references: "crews(id)" },
    { name: "name", type: "text" },
    { name: "phone", type: "text", nullable: true },
    { name: "home_address", type: "jsonb", nullable: true, comment: "AddressWire. Served to account owners only." },
    {
      name: "specialties",
      type: "jsonb",
      default: "'[]'::jsonb",
      check: `jsonb_typeof(specialties) = 'array' AND specialties <@ '${JSON.stringify(TECHNICIAN_SPECIALTIES)}'::jsonb`,
    },
    { name: "active", type: "boolean", default: "true" },
    {
      name: "role", type: "text", check: `role IN (${TECHNICIAN_ROLES.map((r) => `'${r}'`).join(",")})`, default: "'technician'",
      comment: "0024: a technician works alone on a service unit; the installer roles work on an install crew.",
    },
  ],
  indexes: [["firm_id"], ["crew_id"]],
});

/**
 * Rate confidentiality between firms is a commercial requirement. Gateway
 * scope check AND row-level security. One forgotten WHERE returns zero rows,
 * not every firm's pricing.
 */
export const rate_cards = operationalTable("rate_cards", {
  columns: [
    { name: "firm_id", type: "uuid", references: "subcontractor_firms(id)" },
    { name: "service_code", type: "text", references: "service_codes(code)", comment: "0026: a code in the service catalogue, as a job's is." },
    { name: "emergency_multiplier_bp", type: "integer", default: "15000", check: "emergency_multiplier_bp >= 10000", comment: "0027: an emergency job is settled at the rate x this, in basis points (15000 = 1.5x)." },
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
    // Item 7 (S8): the firm's position on a statement we issued. Set by the
    // firm's two writes and by nothing else; 0007's trigger holds that a firm
    // changes these four columns and no other.
    { name: "acknowledged_at", type: "timestamptz", nullable: true },
    { name: "disputed_at", type: "timestamptz", nullable: true },
    { name: "dispute_reason", type: "text", nullable: true },
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
