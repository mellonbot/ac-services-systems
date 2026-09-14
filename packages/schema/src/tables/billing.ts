import { operationalTable } from "../tenancy.ts";

/**
 * Non-negotiable #7 — consolidated parent invoicing with per-location
 * itemization. The header bills to the parent tier; every line carries its own
 * account_id. allocate() guarantees the lines sum to the header exactly.
 */
export const invoices = operationalTable("invoices", {
  columns: [
    { name: "bill_to_tier", type: "text", check: "bill_to_tier IN ('parent','region','location','site')", comment: "Resolved billing_rollup_tier at issue. Enterprise SLA bills to the parent." },
    { name: "bill_to_id", type: "uuid", comment: "organizations(id) when bill_to_tier='parent', else accounts(id)." },
    { name: "contract_id", type: "uuid", references: "contracts(id)" },
    { name: "billing_path", type: "text", check: "billing_path IN ('one_time','residential_membership','enterprise_sla','project')" },
    { name: "period_start", type: "date", nullable: true },
    { name: "period_end", type: "date", nullable: true },
    { name: "total_minor", type: "bigint" },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "issued_at", type: "timestamptz", nullable: true },
    { name: "due_at", type: "timestamptz", nullable: true },
  ],
  indexes: [["bill_to_tier", "bill_to_id"], ["contract_id"]],
});

export const invoice_lines = operationalTable("invoice_lines", {
  columns: [
    { name: "invoice_id", type: "uuid", references: "invoices(id)" },
    { name: "location_id", type: "uuid", references: "accounts(id)", comment: "Per-location itemization under a consolidated parent header. Always set, even on a single-location invoice." },
    { name: "customer_group", type: "text", nullable: true, comment: "Copied from the location at issue, for the customer's internal cost allocation. Never resolved through." },
    { name: "job_id", type: "uuid", nullable: true, references: "jobs(id)" },
    { name: "description", type: "text" },
    { name: "quantity_milli", type: "bigint", comment: "Integer thousandths. No float, anywhere in this path." },
    { name: "unit_price_minor", type: "bigint" },
    { name: "amount_minor", type: "bigint" },
  ],
  indexes: [["invoice_id"], ["location_id"]],
});

/** D13 — the float is measured from day one rather than sized after it hurts. */
export const working_capital_positions = operationalTable("working_capital_positions", {
  columns: [
    { name: "as_of", type: "date" },
    { name: "receivable_minor", type: "bigint" },
    { name: "subcontractor_payable_minor", type: "bigint" },
    { name: "parts_payable_minor", type: "bigint" },
    { name: "currency", type: "text", references: "currencies(code)" },
  ],
  indexes: [["as_of"]],
});
