import { operationalTable } from "../tenancy.ts";

/**
 * Non-negotiable #1 — four-tier hierarchy with inheritance and per-level
 * override. One table, self-referencing, with the tier named on the row.
 * A separate table per tier makes "resolve up the chain" a four-way union and
 * makes adding a tier a rewrite.
 */
export const accounts = operationalTable("accounts", {
  columns: [
    { name: "parent_id", type: "uuid", nullable: true, references: "accounts(id)" },
    { name: "tier", type: "text", check: "tier IN ('parent','region','location','asset')" },
    { name: "name", type: "text" },
    { name: "external_ref", type: "text", nullable: true },
    { name: "address", type: "jsonb", nullable: true },
    { name: "active", type: "boolean", default: "true" },
  ],
  indexes: [["parent_id"], ["tier"]],
});
