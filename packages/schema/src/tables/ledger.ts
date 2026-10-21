import { operationalTable } from "../tenancy.ts";

/**
 * QUICKBOOKS ONLINE IS THE LEDGER OF RECORD (decided 2026-10-21). Invoices
 * are written and paid there, through QuickBooks' own pay link; these tables
 * are the worker's mirror of them (0018), read by the office and written by
 * nothing but apps/worker/src/ledger.ts. A row carries the tenancy of the job
 * its memo names, or INTERNAL / UNASSIGNED until it names one.
 */
export const ledger_invoices = operationalTable("ledger_invoices", {
  columns: [
    { name: "realm_id", type: "text", comment: "The QuickBooks company." },
    { name: "qbo_id", type: "text", comment: "QuickBooks' Invoice.Id, unique within the realm." },
    { name: "doc_number", type: "text", nullable: true },
    { name: "customer_name", type: "text", nullable: true },
    { name: "memo", type: "text", nullable: true, comment: "The invoice's memo as QuickBooks holds it — where the office writes the job." },
    { name: "job_id", type: "uuid", nullable: true, references: "jobs(id)", comment: "The job the memo names; null until it names one this database holds." },
    { name: "txn_date", type: "date" },
    { name: "due_date", type: "date", nullable: true },
    { name: "total_minor", type: "bigint" },
    { name: "balance_minor", type: "bigint" },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "qbo_updated_at", type: "timestamptz", comment: "MetaData.LastUpdatedTime — the sync cursor reads it." },
    { name: "synced_at", type: "timestamptz" },
  ],
  indexes: [["job_id"], ["txn_date"]],
  uniques: [["realm_id", "qbo_id"]],
});

/** One row per payment per invoice it pays: a QuickBooks Payment's lines, each linked to an Invoice. A line QuickBooks drops is zeroed, never deleted. */
export const ledger_payments = operationalTable("ledger_payments", {
  columns: [
    { name: "realm_id", type: "text" },
    { name: "qbo_id", type: "text", comment: "QuickBooks' Payment.Id." },
    { name: "invoice_qbo_id", type: "text", comment: "The Invoice.Id this line pays." },
    { name: "amount_minor", type: "bigint" },
    { name: "currency", type: "text", references: "currencies(code)" },
    { name: "received_on", type: "date", comment: "Payment.TxnDate." },
    { name: "qbo_updated_at", type: "timestamptz" },
    { name: "synced_at", type: "timestamptz" },
  ],
  indexes: [["realm_id", "invoice_qbo_id"], ["received_on"]],
  uniques: [["realm_id", "qbo_id", "invoice_qbo_id"]],
});

/** Where the sync is up to, per QuickBooks company, and the refresh token it renews with (AES-256-GCM, key in AC_QBO_TOKEN_KEY). */
export const ledger_sync_state = operationalTable("ledger_sync_state", {
  columns: [
    { name: "realm_id", type: "text" },
    { name: "cursor", type: "timestamptz", nullable: true, comment: "The newest LastUpdatedTime mirrored; the next sync asks for everything at or after it." },
    { name: "refresh_token_enc", type: "text", nullable: true },
    { name: "synced_at", type: "timestamptz", nullable: true },
  ],
  uniques: [["realm_id"]],
});
