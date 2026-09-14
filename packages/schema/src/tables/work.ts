import { operationalTable } from "../tenancy.ts";

/** Foreman tier: multi-day, multi-location. Requests and releases crews through dispatch. */
export const projects = operationalTable("projects", {
  columns: [
    { name: "contract_id", type: "uuid", references: "contracts(id)" },
    { name: "name", type: "text" },
    { name: "foreman_id", type: "uuid", nullable: true, references: "users(id)" },
    { name: "service_window", type: "tstzrange" },
    { name: "state", type: "text", check: "state IN ('planned','active','closed','cancelled')", default: "'planned'" },
  ],
  indexes: [["contract_id"], ["foreman_id"]],
});

export const JOB_STATES = [
  "created", "assigned", "en_route", "on_site", "in_progress", "awaiting_parts",
  "complete", "reopened", "invoiced", "cancelled", "aborted",
] as const;

export const jobs = operationalTable("jobs", {
  columns: [
    { name: "site_id", type: "uuid", references: "accounts(id)", comment: "Work happens at a site. The location, region and parent are its ancestors." },
    { name: "contract_id", type: "uuid", nullable: true, references: "contracts(id)" },
    { name: "project_id", type: "uuid", nullable: true, references: "projects(id)" },
    { name: "service_code", type: "text" },
    { name: "priority", type: "text", check: "priority IN ('emergency','urgent','routine','pm')", default: "'routine'" },
    { name: "service_window", type: "tstzrange", comment: "The gate evaluates the WHOLE window, not the instant of assignment." },
    { name: "state", type: "text", check: `state IN (${JOB_STATES.map((s) => `'${s}'`).join(",")})`, default: "'created'" },
    { name: "version", type: "integer", default: "1", comment: "Optimistic version the sync engine compares against." },
    { name: "opened_at", type: "timestamptz", default: "now()" },
  ],
  indexes: [["site_id"], ["state"], ["project_id"], ["contract_id"]],
});

/**
 * The evaluator's output, recorded. Three layers of the gate: the type covers
 * application code, the trigger covers everything else, and this row covers
 * the subrogation conversation afterwards.
 */
export const compliance_clearances = operationalTable("compliance_clearances", {
  columns: [
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    { name: "service_window", type: "tstzrange" },
    { name: "credential_ids", type: "jsonb", comment: "Exactly which documents cleared it, frozen at evaluation." },
    { name: "evaluated_at", type: "timestamptz" },
    { name: "evaluated_by", type: "uuid" },
  ],
  indexes: [["crew_id"]],
});

/**
 * SERVER-AUTHORITATIVE. An offline device holds intent, never an assignment —
 * which is what stops an offline device routing around the compliance gate
 * (non-negotiable #6 meeting non-negotiable #8). Written by S3 only.
 */
export const assignments = operationalTable("assignments", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    {
      name: "clearance_id", type: "uuid", references: "compliance_clearances(id)",
      comment: "NOT NULL, and a trigger re-verifies the clearance covers the job window for this crew.",
    },
    { name: "assigned_by", type: "uuid" },
    { name: "assigned_at", type: "timestamptz", default: "now()" },
    { name: "released_at", type: "timestamptz", nullable: true },
    { name: "release_reason", type: "text", nullable: true },
  ],
  indexes: [["job_id"], ["crew_id"]],
});

/**
 * The append-only record of every job transition. `mutation_id` is client
 * generated (offline replay is idempotent by construction); UNIQUE per job.
 */
export const job_state_events = operationalTable("job_state_events", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "from_state", type: "text", nullable: true },
    { name: "to_state", type: "text" },
    { name: "actor_id", type: "uuid" },
    { name: "surface_id", type: "text" },
    { name: "mutation_id", type: "text" },
    { name: "occurred_at", type: "timestamptz" },
    { name: "recorded_at", type: "timestamptz", default: "now()" },
  ],
  indexes: [["job_id", "occurred_at"]],
  uniques: [["job_id", "mutation_id"]],
});

/** Field artefacts — append-only under sync. */
export const job_media = operationalTable("job_media", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "storage_key", type: "text" },
    { name: "kind", type: "text", check: "kind IN ('photo','diagnostic_capture','signature','document')" },
    { name: "captured_at", type: "timestamptz" },
    { name: "captured_by", type: "uuid" },
    { name: "mutation_id", type: "text" },
    { name: "meta", type: "jsonb", nullable: true },
  ],
  indexes: [["job_id"]],
  uniques: [["job_id", "mutation_id"]],
});

export const time_entries = operationalTable("time_entries", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    { name: "span", type: "tstzrange" },
    { name: "kind", type: "text", check: "kind IN ('travel','labor','wait')" },
    { name: "mutation_id", type: "text" },
  ],
  indexes: [["job_id"], ["crew_id"]],
  uniques: [["job_id", "mutation_id"]],
});

/** Checklist responses — device-authoritative under sync (the tech was standing in front of it). */
export const checklist_items = operationalTable("checklist_items", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "item_key", type: "text" },
    { name: "response", type: "jsonb" },
    { name: "answered_at", type: "timestamptz" },
    { name: "answered_by", type: "uuid" },
    { name: "version", type: "integer", default: "1" },
  ],
  indexes: [["job_id"]],
  uniques: [["job_id", "item_key"]],
});

export const parts_used = operationalTable("parts_used", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "part_sku", type: "text" },
    { name: "quantity_milli", type: "bigint" },
    { name: "source", type: "text", check: "source IN ('truck','location_stock','regional_hub','national')" },
    { name: "mutation_id", type: "text" },
  ],
  indexes: [["job_id"]],
  uniques: [["job_id", "mutation_id"]],
});

/** Immutable decision log. Office manager resolves routine; principal resolves high value. */
export const warranty_cases = operationalTable("warranty_cases", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "equipment_id", type: "uuid", nullable: true, references: "equipment(id)" },
    { name: "claimed_minor", type: "bigint" },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "state", type: "text", check: "state IN ('open','approved','denied','escalated')", default: "'open'" },
    { name: "decided_by", type: "uuid", nullable: true },
    { name: "decided_at", type: "timestamptz", nullable: true },
    { name: "decision_note", type: "text", nullable: true },
  ],
  indexes: [["job_id"], ["state"]],
});
