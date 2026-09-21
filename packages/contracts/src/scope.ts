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
 * THE ONE PRINCIPAL A SURFACE IS ALLOWED TO NAME (item 8).
 *
 * Every other principal in this system is resolved by the gateway from a
 * token, and `Principal` above says so: "surfaces never construct this; they
 * receive it." S1 is the exception, and it is an exception because there is
 * nothing to resolve — a visitor to a marketing page has no identity, and a
 * round trip to be told so would make the site depend on the gateway to
 * render, which is the one thing the registry's degraded line for S1 says it
 * must not do.
 *
 * So the anonymous principal is DATA, here, shared: the shell boots S1 with
 * it, and the gateway binds transactions with it. Neither side invents it,
 * which is the property that matters — a constant two files read is not the
 * same thing as a surface asserting who it is.
 *
 * The ids are PROSPECT and UNASSIGNED from packages/schema (tenancy.ts), and
 * they are spelled literally here because the shell may not import the schema
 * package — dependencies point one way and that rule is enforced by the
 * guard. `apps/gateway/src/auth.test.ts` holds the two spellings together, so
 * changing one and not the other fails a test rather than an integration.
 *
 * Note what it carries: no roles. S1 declares no `roles` in the surface
 * registry, so the unit of work's role check does not run for it, and the
 * write allowlist — `lead`, `call_record` — is the whole of what this
 * principal can do.
 */
export const ANONYMOUS_PRINCIPAL_IDS = {
  /** PROSPECT — the tenant root pre-account rows belong to. */
  org: "00000000-0000-0000-0000-000000000001",
  /** UNASSIGNED — the region a lead has before anyone has decided who serves it. */
  region: "00000000-0000-0000-0000-000000000002",
  /** A named nobody. `actor_id` is a uuid and not a foreign key, so this is honest rather than invented. */
  actor: "00000000-0000-0000-0000-0000000000a1",
} as const;

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

/**
 * The anonymous principal itself. `sessionId` is the actor constant until the
 * shell mints a session — an anonymous shell that has not yet written has no
 * session, which is the point of minting it lazily.
 */
export const ANONYMOUS_PRINCIPAL: Principal = Object.freeze({
  namespace: "anonymous",
  subjectId: ANONYMOUS_PRINCIPAL_IDS.actor,
  orgId: ANONYMOUS_PRINCIPAL_IDS.org,
  regionId: ANONYMOUS_PRINCIPAL_IDS.region,
  scopeTier: "parent",
  scopeId: ANONYMOUS_PRINCIPAL_IDS.org,
  roles: Object.freeze([]),
  firmId: null,
  deviceId: null,
  shiftId: null,
  tierClaim: null,
  sessionId: ANONYMOUS_PRINCIPAL_IDS.actor,
});
