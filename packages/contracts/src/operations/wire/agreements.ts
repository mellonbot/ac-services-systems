import type { Tier } from "../../tiers.ts";
import type { TermPolicy } from "../../terms.ts";

// ---- C2 wire shapes ----
export type ContractKind = "msa" | "amendment" | "location_agreement" | "project_sow" | "residential_membership" | "one_time";
export type BillingPath = "one_time" | "residential_membership" | "enterprise_sla" | "project";
export type ContractState = "draft" | "active" | "expired" | "terminated";

export type ContractWire = {
  readonly id: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly kind: ContractKind;
  readonly parentContractId: string | null;
  readonly billingPath: BillingPath;
  /**
   * OUR region, the one this agreement is administered from. Carried on the
   * wire because `terms.authorOverride` requires a region and the override
   * screen authors against a contract — without it the surface would have to
   * guess one, which is how a term override ends up in the wrong shard.
   */
  readonly regionId: string;
  readonly signedAt: string;
  /** ISO date, inclusive. */
  readonly effectiveFrom: string;
  /** ISO date, exclusive; null = evergreen. */
  readonly effectiveTo: string | null;
  readonly diagnosticDataRightsReserved: boolean;
  readonly documentKey: string | null;
  readonly state: ContractState;
};
export type ListContractsInput = { readonly orgId: string; readonly scopeId?: string };
export type ListContractsOutput = { readonly contracts: readonly ContractWire[] };

export type CreateContractInput = {
  readonly orgId: string;
  /** OUR region — for a parent-scope agreement only, the one scope with no edge to derive it from. Refused below it, the same rule C1 applies to a node. */
  readonly regionId?: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly kind: ContractKind;
  /** An amendment's MSA. Required for kind "amendment" and refused when the named agreement has already ended. */
  readonly parentContractId?: string;
  readonly billingPath: BillingPath;
  readonly signedAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  /** OQ5, per record. No default: absent or non-boolean is a 400, because nothing was refused on its merits — no position was stated. */
  readonly diagnosticDataRightsReserved: boolean;
  readonly documentKey?: string;
};
export type CreateContractOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };

export type TransitionContractInput = { readonly contractId: string; readonly to: "active" | "expired" | "terminated" };
export type TransitionContractOutput = { readonly id: string; readonly state: ContractState; readonly eventId: string };

export type TermOverrideWire = {
  readonly id: string; readonly contractId: string; readonly scopeTier: Tier; readonly scopeId: string;
  readonly termKey: string; readonly termValue: unknown;
  readonly effectiveFrom: string; readonly effectiveTo: string | null;
};
export type ListTermOverridesInput = { readonly orgId: string; readonly termKey?: string; readonly contractId?: string };
export type ListTermOverridesOutput = { readonly overrides: readonly TermOverrideWire[] };

/** The register as data. S2 builds the override form from this rather than hard-coding eleven inputs. */
export type TermRegisterOutput = { readonly terms: readonly TermPolicy[] };

