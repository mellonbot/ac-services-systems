import { operationalTable } from "../tenancy.ts";

/**
 * The awkward case, with a home. A lead arrives before a customer exists — so
 * it is owned by the PROSPECT organization in the UNASSIGNED region. Operational
 * like everything else. `region_id` stays total; the shard key needs no fallback.
 */
export const leads = operationalTable("leads", {
  columns: [
    { name: "source", type: "text" },
    { name: "contact", type: "jsonb" },
    { name: "requested_metro", type: "text", nullable: true },
    { name: "converted_account_id", type: "uuid", nullable: true, references: "accounts(id)" },
  ],
  indexes: [["converted_account_id"]],
});

export const call_records = operationalTable("call_records", {
  columns: [
    { name: "lead_id", type: "uuid", nullable: true, references: "leads(id)" },
    { name: "direction", type: "text", check: "direction IN ('inbound','outbound')" },
    { name: "recording_key", type: "text", nullable: true },
    { name: "occurred_at", type: "timestamptz" },
  ],
  indexes: [["lead_id"]],
});

export const service_requests = operationalTable("service_requests", {
  columns: [
    { name: "site_id", type: "uuid", references: "accounts(id)" },
    { name: "requested_by", type: "uuid" },
    { name: "priority", type: "text", check: "priority IN ('emergency','urgent','routine')", default: "'routine'" },
    { name: "description", type: "text" },
    { name: "job_id", type: "uuid", nullable: true, references: "jobs(id)" },
  ],
  indexes: [["site_id"]],
});
