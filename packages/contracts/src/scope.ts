import type { Tier } from "./tiers.ts";

/**
 * Namespaces are hard walls, not roles. A subcontractor is neither a customer
 * nor a parts vendor; an internal role cannot be granted into a vendor
 * namespace. Rate confidentiality (S8) and job blindness (S7) both depend on
 * this separation existing BELOW the role layer.
 */
export const NAMESPACES = ["internal", "customer", "subcontractor", "vendor", "device", "anonymous"] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** Internal roles. Data, so a new role is a diff here and not a string typo in a handler. */
export const ROLES = [
  "principal", "ops_leadership", "account_owner", "office_manager",
  "dispatcher", "foreman", "technician", "warehouse", "finance", "readonly",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * THE CLAIMS A TOKEN CARRIES. Minted by the gateway at login, verified on every
 * request. Deliberately thin: the token names WHO and WHERE; the gateway
 * resolves WHAT THAT MEANS against the hierarchy (HierarchyContext) at login
 * and caches it per session. A token that carried resolved permissions would be
 * a token that is wrong the moment a contract is amended.
 */
export type Claims = {
  readonly sub: string;
  readonly ns: Namespace;
  readonly org: string;
  /** Our service region. Total for every operational caller; UNASSIGNED only for anonymous S1. */
  readonly region: string;
  readonly scope_tier: Tier;
  readonly scope_id: string;
  readonly roles: readonly string[];
  /** Subcontractor namespace only. */
  readonly firm?: string;
  /** Device namespace only — S5 and the tablet. A shift grant, not a person. */
  readonly device?: string;
  readonly shift?: string;
  /** Customer namespace only — the customer IdP's tier claim, drives S6's four scopes. */
  readonly tier_claim?: string;
  readonly iat: number;
  readonly exp: number;
  readonly sid: string;
};

/**
 * Everything the gateway knows about a caller, resolved from Claims plus the
 * hierarchy. Surfaces never construct this; they receive it.
 */
export type Principal = {
  readonly namespace: Namespace;
  readonly subjectId: string;
  readonly orgId: string;
  readonly regionId: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly roles: readonly string[];
  readonly firmId: string | null;
  readonly deviceId: string | null;
  readonly shiftId: string | null;
  readonly tierClaim: string | null;
  readonly sessionId: string;
};

/**
 * What the database sees. These are the ONLY settings RLS policies read
 * (migrations/0002). Set with SET LOCAL inside the transaction by the gateway's
 * scope binding — never by a surface, never from a query string.
 */
export type ScopeBinding = {
  readonly "ac.namespace": Namespace;
  readonly "ac.org_id": string;
  readonly "ac.region_id": string;
  readonly "ac.scope_tier": Tier;
  readonly "ac.scope_id": string;
  readonly "ac.firm_id": string;
  readonly "ac.device_id": string;
  readonly "ac.actor_id": string;
  readonly "ac.surface_id": string;
};
