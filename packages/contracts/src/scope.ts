import type { Tier } from "./tiers.ts";

/**
 * Everything the gateway knows about a caller, resolved at login from the
 * hierarchy. Surfaces never construct this; they receive it.
 */
export type Principal = {
  readonly namespace: Namespace;
  readonly subjectId: string;
  readonly orgId: string;
  /**
   * Non-null for every operational caller. `UNASSIGNED` only for anonymous S1
   * traffic, which writes exclusively into the PROSPECT org.
   * @see packages/schema/src/tenancy.ts
   */
  readonly regionId: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly roles: readonly string[];
  /** Customer tier claim from the customer IdP — drives S6's four scopes. */
  readonly tierClaim?: string;
};

/**
 * Namespaces are hard walls, not roles. A subcontractor is neither a customer
 * nor a parts vendor; an internal role cannot be granted into a vendor
 * namespace. Rate confidentiality (S8) and job blindness (S7) both depend on
 * this separation existing below the role layer.
 */
export const NAMESPACES = ["internal", "customer", "subcontractor", "vendor", "anonymous"] as const;
export type Namespace = (typeof NAMESPACES)[number];
