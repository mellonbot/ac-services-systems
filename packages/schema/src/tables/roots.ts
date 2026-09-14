import { tenancyRootTable } from "../tenancy.ts";

/** Above the region boundary by definition — cannot carry region_id. */
export const organizations = tenancyRootTable("organizations", {
  comment: "Tenant roots. PROSPECT is a real row here, which is why pre-account leads need no nullable column.",
  columns: [
    { name: "id", type: "uuid", default: "gen_random_uuid()" },
    { name: "name", type: "text" },
    { name: "kind", type: "text", check: "kind IN ('internal','customer','subcontractor','vendor','prospect')" },
    { name: "external_ref", type: "text", nullable: true },
    { name: "active", type: "boolean", default: "true" },
    { name: "created_at", type: "timestamptz", default: "now()" },
  ],
});

export const regions = tenancyRootTable("regions", {
  comment: "The shard boundary itself.",
  columns: [
    { name: "id", type: "uuid", default: "gen_random_uuid()" },
    { name: "code", type: "text" },
    { name: "name", type: "text" },
    { name: "timezone", type: "text", default: "'America/Chicago'" },
    {
      name: "min_crew_density",
      type: "integer",
      default: "0",
      comment: "D14 — supply before signature. The account-authoring check reads this; it is 0 until the partners set it, and the check reports 'rule not set' rather than silently passing.",
    },
    { name: "active", type: "boolean", default: "true" },
    { name: "created_at", type: "timestamptz", default: "now()" },
  ],
  uniques: [["code"]],
});
