import { operationalTable } from "../tenancy.ts";

/**
 * A contract binds to a node in the customer tree. The master service
 * agreement binds to the parent (scope_tier='parent', scope_id=org id);
 * amendments and location agreements bind lower. The term OVERRIDE rows below
 * are what resolution walks — a contract row is the signed document they
 * belong to, and the audit anchor for "who agreed to this and when".
 */
export const contracts = operationalTable("contracts", {
  columns: [
    { name: "scope_tier", type: "text", check: "scope_tier IN ('parent','region','location','site')" },
    { name: "scope_id", type: "uuid", comment: "organizations(id) when scope_tier='parent', else accounts(id). Trigger-checked." },
    { name: "kind", type: "text", check: "kind IN ('msa','amendment','location_agreement','project_sow','residential_membership','one_time')" },
    { name: "parent_contract_id", type: "uuid", nullable: true, references: "contracts(id)", comment: "An amendment's MSA." },
    {
      name: "billing_path", type: "text",
      check: "billing_path IN ('one_time','residential_membership','enterprise_sla','project')",
      comment: "Four paths, chosen at signature. NOT a flag on one function — see packages/domain/src/billing.",
    },
    { name: "signed_at", type: "timestamptz" },
    { name: "effective", type: "daterange", comment: "Half-open [from, to). NULL upper bound = evergreen." },
    {
      name: "diagnostic_data_rights_reserved", type: "boolean",
      comment: "OQ5 — NOT NULL on purpose. A contract cannot be recorded without stating its position.",
    },
    { name: "document_key", type: "text", nullable: true, comment: "StorageKey of the signed PDF." },
    { name: "state", type: "text", check: "state IN ('draft','active','expired','terminated')", default: "'draft'" },
  ],
  indexes: [["scope_tier", "scope_id"], ["parent_contract_id"]],
});

/**
 * SPARSE OVERRIDE ROWS — the thing resolution walks.
 *
 * Keyed by (scope_tier, scope_id, term_key) with an effective range. Three
 * refusals happen AT INSERT, not at resolve:
 *
 *   authoring tier   the trigger reads `term_registry` (mirrored from code) and
 *                    raises if this tier may not hold this term. A location
 *                    setting payment_terms_days is a data error, not a preference.
 *   overlap          the EXCLUDE constraint refuses two rows for the same
 *                    (scope, term) with overlapping effective ranges. Finding 4:
 *                    every tie-break available produces an invoice that is wrong
 *                    in a way nobody can see. So the state is unrepresentable.
 *   ratchet          direction is checked by the gateway's admission (it needs
 *                    the resolved parent value at the instant), and re-checked by
 *                    the resolver. It is not in SQL because SQL would need the
 *                    resolver; the DB layer holds the two checks that are local.
 *
 * `term_value` is jsonb. Money and quantities inside it are STRINGS of integer
 * minor units — a JSON number is an IEEE754 double.
 */
export const contract_term_overrides = operationalTable("contract_term_overrides", {
  columns: [
    { name: "contract_id", type: "uuid", references: "contracts(id)", comment: "The signed document this row came from." },
    { name: "scope_tier", type: "text", check: "scope_tier IN ('parent','region','location','site')" },
    { name: "scope_id", type: "uuid" },
    { name: "term_key", type: "text", references: "term_registry(key)" },
    { name: "term_value", type: "jsonb" },
    { name: "effective", type: "daterange", comment: "Half-open. Resolution takes an instant; a February job reprices against the February row." },
    { name: "authored_by", type: "uuid" },
  ],
  indexes: [["scope_tier", "scope_id", "term_key"], ["contract_id"]],
  constraints: [
    {
      name: "term_override_no_overlap",
      sql: "EXCLUDE USING gist (scope_tier WITH =, scope_id WITH =, term_key WITH =, effective WITH &&)",
    },
  ],
});
