import { operationalTable } from "../tenancy.ts";

export const contracts = operationalTable("contracts", {
  columns: [
    { name: "account_id", type: "uuid", references: "accounts(id)" },
    {
      name: "billing_path",
      type: "text",
      check: "billing_path IN ('one_time','residential_membership','enterprise_sla','project')",
      comment: "Four paths, chosen at signature. NOT a flag on one function — see packages/domain/billing.",
    },
    { name: "effective_from", type: "date" },
    { name: "effective_to", type: "date", nullable: true },
    {
      name: "diagnostic_data_rights_reserved",
      type: "boolean",
      comment: "OQ5 — NOT NULL on purpose. A contract cannot be recorded without stating its position. The Phase 4 licensing question is answered at signature time instead of discovered in year six.",
    },
    { name: "payment_terms_days", type: "integer", comment: "D13 — measured from day one so the float is sized before it hurts." },
  ],
  indexes: [["account_id"]],
});

/**
 * Sparse override rows keyed by (scope_tier, scope_id, term_key).
 * Inheritance is resolution over these rows, not copied values. Two overrides
 * at the same tier for the same key is ambiguity: the resolver throws. It never
 * tie-breaks, because a tie-break is a pricing decision made by a sort order.
 */
export const contract_term_overrides = operationalTable("contract_term_overrides", {
  columns: [
    { name: "contract_id", type: "uuid", references: "contracts(id)" },
    { name: "scope_tier", type: "text", check: "scope_tier IN ('parent','region','location','asset')" },
    { name: "scope_id", type: "uuid", references: "accounts(id)" },
    { name: "term_key", type: "text" },
    { name: "term_value", type: "jsonb" },
  ],
  indexes: [["contract_id", "term_key"], ["scope_id"]],
});
