import type { AuthorOverrideInput } from "../../../../contracts/src/operations.ts";

/** Commercial defaults used by fixtures. Matches the register fallbacks so resolution is identical whether the override is written or not. */
export const MSA_TERMS: Readonly<Record<string, unknown>> = Object.freeze({
  sla_response: "4_hour",
  sla_credit_pct: 10,
  pm_visits_per_year: 2,
  payment_terms_days: 30,
  labor_rate_minor: "12500",
  diagnostic_data_rights_reserved: true,
});

/** Authors the commercial default terms at the MSA's parent node so fixtures that assert on override rows still see them. */
export const stateMsaTerms = async (
  gateway: { authorTermOverride(input: AuthorOverrideInput): Promise<unknown> },
  at: { readonly contractId: string; readonly orgId: string; readonly regionId: string; readonly effectiveFrom: string },
  values: Readonly<Record<string, unknown>> = {},
): Promise<void> => {
  for (const termKey of Object.keys(MSA_TERMS)) {
    await gateway.authorTermOverride({
      contractId: at.contractId, scopeTier: "parent", scopeId: at.orgId, termKey,
      termValue: termKey in values ? values[termKey] : MSA_TERMS[termKey],
      effectiveFrom: at.effectiveFrom, orgId: at.orgId, regionId: at.regionId,
    });
  }
};
