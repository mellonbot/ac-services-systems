import { REQUIRED_AT_ACTIVATION } from "../../../../contracts/src/terms.ts";
import type { AuthorOverrideInput } from "../../../../contracts/src/operations.ts";

/** A value for every term an MSA must state before it goes live. Fixtures override the ones they test. */
export const MSA_TERMS: Readonly<Record<string, unknown>> = Object.freeze({
  sla_response: "4_hour",
  sla_credit_pct: 10,
  pm_visits_per_year: 2,
  payment_terms_days: 30,
  labor_rate_minor: "12500",
  diagnostic_data_rights_reserved: true,
});

/** Authors every activation-required term at the MSA's parent node, so the fixture can then activate it. */
export const stateMsaTerms = async (
  gateway: { authorTermOverride(input: AuthorOverrideInput): Promise<unknown> },
  at: { readonly contractId: string; readonly orgId: string; readonly regionId: string; readonly effectiveFrom: string },
  values: Readonly<Record<string, unknown>> = {},
): Promise<void> => {
  for (const termKey of REQUIRED_AT_ACTIVATION) {
    await gateway.authorTermOverride({
      contractId: at.contractId, scopeTier: "parent", scopeId: at.orgId, termKey,
      termValue: termKey in values ? values[termKey] : MSA_TERMS[termKey],
      effectiveFrom: at.effectiveFrom, orgId: at.orgId, regionId: at.regionId,
    });
  }
};
