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
    { name: "voided_at", type: "timestamptz", nullable: true, comment: "0030: voided by the office (invoices.void) — never owed, never paid. Set once; refused while any payment stands." },
    { name: "void_reason", type: "text", nullable: true, comment: "Why it was voided. Present exactly when voided_at is." },
  ],
  indexes: [["bill_to_tier", "bill_to_id"], ["contract_id"]],
  constraints: [
    { name: "invoices_void_has_reason", sql: "CHECK ((voided_at IS NULL) = (void_reason IS NULL) AND (void_reason IS NULL OR length(btrim(void_reason)) > 0))" },
    { name: "invoices_void_once_issued", sql: "CHECK (voided_at IS NULL OR issued_at IS NOT NULL)" },
  ],
});

/**
 * 0030 — what was received against an invoice. The invoice's paid status is
 * DERIVED from these rows (succeeded sum against the total), never a column
 * someone sets: S6 payments spec, 2026-10-21, §2 item 4. Today the office
 * records each payment as it arrives (payments.record); a processor's webhook
 * adds rows the same way once Y1–Y3 are decided. A row is never deleted or
 * re-priced: a bounced check or an ACH return is the same row marked returned.
 */
export const payments = operationalTable("payments", {
  columns: [
    { name: "invoice_id", type: "uuid", references: "invoices(id)" },
    { name: "amount_minor", type: "bigint", check: "amount_minor > 0", comment: "Integer minor units, in the invoice's currency (0030 refuses another)." },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "method", type: "text", check: "method IN ('ach','wire','check','card','cash','other')" },
    { name: "reference", type: "text", nullable: true, comment: "The check number, the bank trace, the processor's id — what finance would search for." },
    { name: "state", type: "text", default: "'succeeded'", check: "state IN ('pending','succeeded','failed','returned','refunded')", comment: "The spec's states. The office records a payment that has landed (succeeded); pending and failed are the processor's." },
    { name: "received_at", type: "timestamptz", comment: "When the money arrived — not when someone typed it in." },
    { name: "returned_at", type: "timestamptz", nullable: true, comment: "When a succeeded payment came back (state returned or refunded)." },
    { name: "return_reason", type: "text", nullable: true },
    { name: "recorded_by", type: "uuid", references: "users(id)" },
  ],
  indexes: [["invoice_id"]],
  constraints: [
    { name: "payments_returned_has_when", sql: "CHECK ((state IN ('returned','refunded')) = (returned_at IS NOT NULL) AND (returned_at IS NULL OR returned_at >= received_at))" },
  ],
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
