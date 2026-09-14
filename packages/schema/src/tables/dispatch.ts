import { operationalTable } from "../tenancy.ts";

export const jobs = operationalTable("jobs", {
  columns: [
    { name: "account_id", type: "uuid", references: "accounts(id)" },
    { name: "contract_id", type: "uuid", nullable: true, references: "contracts(id)" },
    { name: "service_code", type: "text" },
    { name: "window_start", type: "timestamptz" },
    { name: "window_end", type: "timestamptz", comment: "The gate evaluates the whole window, not the instant of assignment." },
    { name: "sla_due_at", type: "timestamptz", nullable: true, comment: "Derived from the RESOLVED contract for this site, not from a default." },
    { name: "state", type: "text" },
  ],
  indexes: [["account_id"], ["state", "window_start"]],
});

/**
 * Server-authoritative. An offline device holds intent, never an assignment —
 * which is precisely what stops an offline device routing around the
 * compliance gate (non-negotiable #6 meeting non-negotiable #8).
 */
export const assignments = operationalTable("assignments", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    {
      name: "clearance_id",
      type: "uuid",
      references: "compliance_clearances(id)",
      comment: "NOT NULL, and a database trigger re-verifies it covers the job window. The type system covers application code; this covers scripts, migrations and services that do not exist yet.",
    },
    { name: "assigned_by", type: "uuid" },
    { name: "released_at", type: "timestamptz", nullable: true },
  ],
  indexes: [["job_id"], ["crew_id"]],
});

/**
 * The evaluator's output, recorded. Three layers of the gate: the type covers
 * application code, the trigger covers everything else, and this row covers
 * the subrogation conversation afterwards.
 */
export const compliance_clearances = operationalTable("compliance_clearances", {
  columns: [
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    { name: "window_start", type: "timestamptz" },
    { name: "window_end", type: "timestamptz" },
    { name: "credential_ids", type: "jsonb", comment: "Exactly which documents cleared it, frozen at evaluation." },
    { name: "evaluated_at", type: "timestamptz", default: "now()" },
  ],
  indexes: [["crew_id", "window_end"]],
});

export const job_state_events = operationalTable("job_state_events", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "from_state", type: "text", nullable: true },
    { name: "to_state", type: "text" },
    { name: "actor_id", type: "uuid" },
    { name: "surface_id", type: "text" },
    {
      name: "mutation_id",
      type: "text",
      comment: "Client-generated. Makes offline replay idempotent — unique per (job_id, mutation_id).",
    },
    { name: "occurred_at", type: "timestamptz" },
  ],
  indexes: [["job_id", "occurred_at"], ["job_id", "mutation_id"]],
});
