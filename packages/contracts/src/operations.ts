import { WHITE_LABEL_SURFACES, type SurfaceId } from "./surfaces.ts";
import type { Tier } from "./tiers.ts";
import type { TermPolicy } from "./terms.ts";
import type { HierarchyContext } from "./context.ts";

/**
 * THE OPERATION CATALOGUE.
 *
 * Every request a surface may make of the gateway, as data. The gateway's
 * route table is built from this constant and nothing else; the SDK client is
 * generated from it (tools/ci/emit-sdk.ts); the guard fails the build if the
 * two disagree or the generated client has drifted.
 *
 * That is the whole mechanism behind master plan non-negotiable #14 — "no
 * surface writes its own fetch call". Before this file existed the sentence
 * was enforced by nothing: `packages/sdk` was a type with a header promising a
 * generator that did not exist. A surface could invent a request the gateway
 * never agreed to serve, and a surface could be pointed at a second origin.
 * Now a request that is not a row here has no method on the client and no
 * route at the gateway — the same move the term register made for terms and
 * the surface registry made for writes.
 *
 * What a row declares:
 *   - `method` + `path`: the wire. Paths are literal; no path parameters, so
 *     the gateway's lookup is a Map hit and a typo is a 404 in the smoke test.
 *   - `kind`: `query` opens a read-only transaction; `mutation` opens a unit of
 *     work; `stream` is the SSE feed; `login` and `system` run unscoped.
 *   - `auth`: `bearer` requires a verified token; `none` does not.
 *   - `surfaces`: which surfaces may call it. The client sends `x-ac-surface`;
 *     the gateway refuses a surface not on the list (403) and then opens the
 *     unit of work FOR THAT SURFACE, so the write allowlist and role admission
 *     in SURFACES apply. The header selects; the token authorizes. A surface
 *     that lies about its id gains a surface whose roles its token lacks.
 *   - `carrier`: where the input travels — JSON body, query string, or nowhere.
 *   - `sdkMethod`: the generated client's method name. Stable; renaming one is
 *     a breaking change for every surface, which is the point of naming it here.
 */
export type OperationKind = "login" | "query" | "mutation" | "stream" | "system";
export type OperationAuth = "none" | "bearer";
export type InputCarrier = "body" | "query" | "none";

type OperationSpec = {
  readonly id: string;
  readonly method: "GET" | "POST";
  readonly path: `/${string}`;
  readonly kind: OperationKind;
  readonly auth: OperationAuth;
  readonly surfaces: readonly SurfaceId[];
  readonly carrier: InputCarrier;
  readonly sdkMethod: string;
  readonly summary: string;
};

const AUTHENTICATED: readonly SurfaceId[] = ["S2", "S3", "S4", "S5", "S6", "S7", "S8"];
/** Surfaces whose principals hold a password at OUR gateway. Customers federate to their IdP; devices carry a shift grant; S1 is anonymous. */
const PASSWORD_LOGIN: readonly SurfaceId[] = ["S2", "S3", "S4", "S8"];

export const OPERATIONS = {
  "auth.login": {
    id: "auth.login", method: "POST", path: "/auth/login", kind: "login", auth: "none",
    surfaces: PASSWORD_LOGIN, carrier: "body", sdkMethod: "login",
    summary: "Mint a token and resolve the hierarchy context once. The surface named in the body must serve the user's namespace.",
  },
  "auth.logout": {
    id: "auth.logout", method: "POST", path: "/auth/logout", kind: "mutation", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "logout",
    summary: "Revoke the session behind this token and clear the session cookie. The next request with either is 401 revoked.",
  },
  "session.me": {
    id: "session.me", method: "GET", path: "/me", kind: "query", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "me",
    summary: "The principal and its hierarchy context, re-resolved. What the shell reads at boot.",
  },
  "terms.authorOverride": {
    id: "terms.authorOverride", method: "POST", path: "/s2/terms/override", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "authorTermOverride",
    summary: "Author a contract term override. Admitted or refused at insert against the register; a refusal is a 422 with the reason and its axis.",
  },
  "terms.resolved": {
    id: "terms.resolved", method: "GET", path: "/terms/resolved", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "resolvedTerms",
    summary: "Every term at a node as of a date, with the trace naming every rung.",
  },
  // ---- C1: the hierarchy S2 authors (09 §3.6) ----
  "regions.list": {
    id: "regions.list", method: "GET", path: "/regions", kind: "query", auth: "bearer",
    surfaces: ["S2", "S3"], carrier: "none", sdkMethod: "listRegions",
    summary: "OUR service regions — the shard boundary. What a region node binds to; what D14's density rule is set on.",
  },
  "organizations.list": {
    id: "organizations.list", method: "GET", path: "/s2/organizations", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listOrganizations",
    summary: "Customer and subcontractor organizations — the parent tier — with how many of our regions each one meets.",
  },
  "organizations.create": {
    id: "organizations.create", method: "POST", path: "/s2/organizations", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createOrganization",
    summary: "Create a customer parent WITH its first region node in one unit of work. No orphan parent: a parent never exists without a place we serve it from.",
  },
  "accounts.list": {
    id: "accounts.list", method: "GET", path: "/s2/accounts", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "query", sdkMethod: "listAccounts",
    summary: "Every node in an organization's tree the caller may see. S6 sees its own subtree by RLS; same operation.",
  },
  "accounts.create": {
    id: "accounts.create", method: "POST", path: "/s2/accounts", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createAccount",
    summary: "Author a region node, location or site. region_id is an input for a region node only; below that it derives from the parent edge. D14 is checked for a location.",
  },
  "accounts.move": {
    id: "accounts.move", method: "POST", path: "/s2/accounts/move", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "moveAccount",
    summary: "Re-parent a node. The shard key follows the edge by trigger; the output says how many descendants moved with it.",
  },
  "accounts.update": {
    id: "accounts.update", method: "POST", path: "/s2/accounts/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateAccount",
    summary: "Attributes of a node — name, the customer's own grouping, external ref, address, timezone, active. Never parent_id or region_id; those are accounts.move.",
  },
  // ---- C2: the agreements and term overrides S2 authors (09 §3.6) ----
  "contracts.list": {
    id: "contracts.list", method: "GET", path: "/s2/contracts", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listContracts",
    summary: "The signed agreements in an organization — what a term override must belong to, and where the state machine currently stands.",
  },
  "contracts.create": {
    id: "contracts.create", method: "POST", path: "/s2/contracts", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createContract",
    summary: "Record an agreement against a node. OQ5's position is required with no default; regionId is an input for a parent-scope agreement alone and derives from the node below it.",
  },
  "contracts.transition": {
    id: "contracts.transition", method: "POST", path: "/s2/contracts/transition", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "transitionContract",
    summary: "draft → active → expired | terminated. A step off that ladder is refused by name; activation and ending are what the other blocks subscribe to.",
  },
  "terms.overrides.list": {
    id: "terms.overrides.list", method: "GET", path: "/s2/terms/overrides", kind: "query", auth: "bearer",
    surfaces: ["S2"], carrier: "query", sdkMethod: "listTermOverrides",
    summary: "The override rows an organization holds — every tier, optionally narrowed to one term or one agreement. What the override screen lists before it adds to it.",
  },
  "terms.register": {
    id: "terms.register", method: "GET", path: "/terms/register", kind: "query", auth: "bearer",
    surfaces: ["S2", "S6"], carrier: "none", sdkMethod: "termRegister",
    summary: "The term policy register as data — value kind, enum values, authoring tiers, rationale. S2 renders the override form FROM this, so a twelfth term is a register diff and the form follows.",
  },

  // ---- C4: the subcontractor network S2 records (09 §3.6, item 7) ----
  // Reads are served to S8 as well: a firm reads its own row, its own crews,
  // its own documents and its own price, and RLS is what makes "its own" true.
  // Writes are S2's. S8's intake (a firm PROPOSING a document) is a separate
  // operation with its own entity, not yet in the catalogue.
  "firms.list": {
    id: "firms.list", method: "GET", path: "/network/firms", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listFirms",
    summary: "Subcontractor firms — legal name, status on the ladder, settlement terms, the MSA, OQ5 firm-side, and how many crews they field. S8 sees one row: itself.",
  },
  "firms.create": {
    id: "firms.create", method: "POST", path: "/s2/network/firms", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createFirm",
    summary: "Record a firm WITH its tenant root in one unit of work: the organizations row and the subcontractor_firms row share an id. A firm starts onboarding, in the region it is dispatched from. OQ5 is stated or the firm is not recorded.",
  },
  "firms.update": {
    id: "firms.update", method: "POST", path: "/s2/network/firms/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateFirm",
    summary: "Attributes and the status ladder: onboarding → active ⇄ suspended → terminated. Activation needs a signed MSA; a step off the ladder is refused by name.",
  },
  "crews.list": {
    id: "crews.list", method: "GET", path: "/network/crews", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listCrews",
    summary: "Crews — ours and the firms' — with a document summary per crew: what the gate would need, what is on file, what is verified, and the earliest expiry. Read by S2 and by a firm for its own crews; never by the field layer.",
  },
  "crews.create": {
    id: "crews.create", method: "POST", path: "/s2/network/crews", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "createCrew",
    summary: "Record a crew in its home region. An employed crew is ours and names no firm; a subcontracted crew names its firm and is that firm's row. The tenancy follows from which.",
  },
  "crews.update": {
    id: "crews.update", method: "POST", path: "/s2/network/crews/update", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "updateCrew",
    summary: "Label and active flag. Never the firm, never the home region — a crew that changes employer or region is a new crew with a new document set.",
  },
  "credentials.list": {
    id: "credentials.list", method: "GET", path: "/network/credentials", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listCredentials",
    summary: "The documents on file for a crew or a firm's crews, verified or not. An unverified certificate is on the list AS unverified — it is not hidden, and it does not clear anything.",
  },
  "credentials.record": {
    id: "credentials.record", method: "POST", path: "/s2/network/credentials", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "recordCredential",
    summary: "Put a document on file — kind, identifier, the window it is valid for. ALWAYS unverified: there is no field for verified_at here, and the trigger refuses one on any path.",
  },
  "credentials.verify": {
    id: "credentials.verify", method: "POST", path: "/s2/network/credentials/verify", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "verifyCredential",
    summary: "THE ONLY PATH that sets verified_at — by S2, by the principal doing it, once. After this the document is immutable; a correction is a new document. The gate reads nothing else.",
  },
  "rateCards.list": {
    id: "rateCards.list", method: "GET", path: "/network/rate-cards", kind: "query", auth: "bearer",
    surfaces: ["S2", "S8"], carrier: "query", sdkMethod: "listRateCards",
    summary: "A firm's rates by service code over time. A firm sees its own and no other's — RLS, not a WHERE clause.",
  },
  "rateCards.set": {
    id: "rateCards.set", method: "POST", path: "/s2/network/rate-cards", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "setRateCard",
    summary: "Set a rate from a day forward: the row in effect that day is closed at it and the new row inserted, both audited. A row that would overlap is refused by the EXCLUDE constraint — two prices at once is unrepresentable, not tie-broken.",
  },

  // ---- S3 ----
  "dispatch.assign": {
    id: "dispatch.assign", method: "POST", path: "/s3/assign", kind: "mutation", auth: "bearer",
    surfaces: ["S3"], carrier: "body", sdkMethod: "assignCrew",
    summary: "The one gated door. A crew that does not clear the whole service window is refused in plain words and nothing is written to assignments.",
  },
  "sync.replay": {
    id: "sync.replay", method: "POST", path: "/s5/sync", kind: "mutation", auth: "bearer",
    surfaces: ["S5"], carrier: "body", sdkMethod: "replaySync",
    summary: "Replay a device's offline log in device order. The device is the source of intent; the server is the source of truth.",
  },
  "events.stream": {
    id: "events.stream", method: "GET", path: "/events", kind: "stream", auth: "bearer",
    surfaces: AUTHENTICATED, carrier: "none", sdkMethod: "events",
    summary: "Server-sent domain events, filtered to the subscriber's region. At-least-once; dedupe on eventId.",
  },
  "brand.setTheme": {
    id: "brand.setTheme", method: "POST", path: "/s2/brand/theme", kind: "mutation", auth: "bearer",
    surfaces: ["S2"], carrier: "body", sdkMethod: "setBrandTheme",
    summary: "Store a tenant's white-label theme. Validated against the ink schedule BEFORE it is a row: a theme that would break the portal is a 422 with the ratio, not a stylesheet nobody looks at until a customer does.",
  },
  "brand.theme": {
    id: "brand.theme", method: "GET", path: "/brand/theme", kind: "system", auth: "none",
    surfaces: WHITE_LABEL_SURFACES, carrier: "query", sdkMethod: "brandTheme",
    summary: "The stored theme for a host, as the stylesheet the shell installs. Unauthenticated because a portal is branded on its sign-in screen, before a principal exists; an unknown host gets Rankine's own plate rather than a 404, so the route cannot be used to ask which tenants exist.",
  },
  "system.health": {
    id: "system.health", method: "GET", path: "/healthz", kind: "system", auth: "none",
    surfaces: ["S1", ...AUTHENTICATED], carrier: "none", sdkMethod: "health",
    summary: "Liveness and the enabled surface list. The shell's degraded probe.",
  },
} as const satisfies Record<string, OperationSpec>;

export type OperationId = keyof typeof OPERATIONS;
export type Operation = (typeof OPERATIONS)[OperationId];
export const OPERATION_IDS = Object.freeze(Object.keys(OPERATIONS)) as readonly OperationId[];

export const isOperationId = (s: string): s is OperationId => Object.hasOwn(OPERATIONS, s);

/** `METHOD /path` → operation. The gateway's dispatcher and the generator both index by this. */
export const routeKey = (op: Pick<Operation, "method" | "path">): string => `${op.method} ${op.path}`;

/** Which of an operation's surfaces a principal of this namespace may call it as. */
export const surfacesFor = (
  id: OperationId,
  namespaceOf: (s: SurfaceId) => string,
  namespace: string,
): readonly SurfaceId[] => OPERATIONS[id].surfaces.filter((s) => namespaceOf(s) === namespace);

// ---------------------------------------------------------------------------
// Wire shapes. Declared beside the catalogue so the generated client is typed
// without a type-checker in the generator: `OperationIO[id]["input"]` is a
// type reference the emitter writes as text.
//
// These mirror the gateway handlers' inputs and outputs structurally. The
// domain's own types (Mutation, SyncOutcome, Refusal, Resolution) live below
// contracts in the dependency order and are not imported here; the
// integration suite is what holds the two shapes together.
// ---------------------------------------------------------------------------
export type LoginInput = { readonly email: string; readonly password: string; readonly surface: SurfaceId };
export type LoginOutput = {
  /** Also set as the httpOnly `ac_session` cookie. A browser surface ignores this field; devices and tests use it as a bearer. */
  readonly token: string;
  readonly expiresAt: string;
  readonly context: Pick<HierarchyContext, "path" | "parent" | "regions" | "activeRegionId">;
};
export type LogoutOutput = { readonly ok: true; readonly sessionId: string };

export type AuthorOverrideInput = {
  readonly contractId: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly termKey: string;
  /** Money is a string of integer minor units. A JSON number is a double and is refused. */
  readonly termValue: unknown;
  /** ISO date, inclusive. */
  readonly effectiveFrom: string;
  /** ISO date, exclusive; null or absent = open-ended. */
  readonly effectiveTo?: string | null;
  readonly orgId: string;
  readonly regionId: string;
};
export type AuthorOverrideOutput = { readonly id: string; readonly eventId: string };

export type ResolvedTermsInput = {
  /** Defaults to the principal's org. */
  readonly orgId?: string;
  /** Defaults to `site`. */
  readonly tier?: Tier;
  readonly nodeId: string;
  /** ISO date. Defaults to the gateway's today. A disputed February job reprices against February by saying "February" here. */
  readonly asOf?: string;
  /** Comma-separated on the query string. Absent = every registered term; the trace panel asks for one. */
  readonly termKeys?: string;
};
export type TraceStepWire = {
  readonly tier: Tier; readonly id: string;
  readonly outcome: "no_override" | "candidate" | "won" | "not_walked";
  readonly value?: unknown; readonly overrideId?: string; readonly note?: string;
};
export type ResolutionWire = {
  readonly termKey: string;
  readonly value: unknown;
  readonly wonAt: { readonly tier: Tier; readonly id: string } | "fallback";
  readonly policy: TermPolicy;
  readonly trace: readonly TraceStepWire[];
  readonly asOf: string;
};
export type ResolvedTermsOutput = {
  readonly resolved: Readonly<Record<string, ResolutionWire>>;
  readonly refused: Readonly<Record<string, { readonly code: string; readonly message: string }>>;
};

// ---- C1 wire shapes ----
export type RegionWire = { readonly id: string; readonly code: string; readonly name: string; readonly timezone: string; readonly minCrewDensity: number; readonly active: boolean };
export type ListRegionsOutput = { readonly regions: readonly RegionWire[] };

export type OrganizationKind = "customer" | "subcontractor";
export type ListOrganizationsInput = { readonly kind?: OrganizationKind };
export type OrganizationWire = { readonly id: string; readonly name: string; readonly kind: OrganizationKind; readonly externalRef: string | null; readonly active: boolean; readonly regionNodeCount: number };
export type ListOrganizationsOutput = { readonly organizations: readonly OrganizationWire[] };

export type CreateOrganizationInput = {
  readonly name: string;
  readonly kind?: OrganizationKind;
  readonly externalRef?: string;
  /** The first region node — created in the same unit of work. A parent never exists without a place we serve it from. */
  readonly firstRegionNode: { readonly regionId: string; readonly name: string };
};
export type CreateOrganizationOutput = { readonly orgId: string; readonly regionNodeId: string; readonly eventId: string };

export type AccountTierWire = "region" | "location" | "site";
export type AccountWire = {
  readonly id: string; readonly tier: AccountTierWire; readonly name: string; readonly parentId: string | null; readonly regionId: string;
  readonly customerGroup: string | null; readonly externalRef: string | null; readonly timezone: string | null; readonly active: boolean;
  /** Ancestor ids, region node first, this node last. */
  readonly path: readonly string[];
};
export type ListAccountsInput = { readonly orgId: string };
export type ListAccountsOutput = { readonly nodes: readonly AccountWire[] };

export type CreateAccountInput = {
  readonly orgId: string;
  readonly tier: AccountTierWire;
  /** Absent for a region node (its parent is the organization); required below. */
  readonly parentId?: string;
  /** OUR region — for tier "region" only, where it is the binding. Below that it derives from the parent edge and is refused as an input. */
  readonly regionId?: string;
  readonly name: string;
  readonly customerGroup?: string;
  readonly externalRef?: string;
  readonly address?: Readonly<Record<string, unknown>>;
  readonly timezone?: string;
};
export type CreateAccountOutput = {
  readonly id: string; readonly regionId: string; readonly eventId: string;
  /** Admitted with a caveat rather than refused — "D14 rule not set for <region>". S2 renders these as a banner, not a modal. */
  readonly caveats: readonly string[];
};

export type MoveAccountInput = { readonly accountId: string; readonly newParentId: string };
export type MoveAccountOutput = { readonly id: string; readonly regionId: string; readonly movedDescendants: number; readonly eventId: string };

export type UpdateAccountInput = {
  readonly accountId: string;
  readonly name?: string; readonly customerGroup?: string | null; readonly externalRef?: string | null;
  readonly address?: Readonly<Record<string, unknown>> | null; readonly timezone?: string | null; readonly active?: boolean;
};
export type UpdateAccountOutput = { readonly id: string; readonly eventId: string };

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

// ---- C4 wire shapes ----
export type FirmStatus = "onboarding" | "active" | "suspended" | "terminated";
export type FirmWire = {
  /** The firm's id IS its organization's id — one tenant root, one operational row, created together. */
  readonly id: string;
  readonly legalName: string;
  readonly status: FirmStatus;
  /** OUR region the firm is dispatched from — its crews' home by default and the shard its rows live in. */
  readonly regionId: string;
  /** D13. Measured from day one. */
  readonly settlementTermsDays: number;
  readonly msaSignedAt: string | null;
  /** OQ5, firm side. Always stated — the row does not exist otherwise. */
  readonly diagnosticDataRightsReserved: boolean;
  readonly w9DocumentKey: string | null;
  readonly crewCount: number;
  readonly activeCrewCount: number;
};
export type ListFirmsInput = { readonly status?: FirmStatus };
export type ListFirmsOutput = { readonly firms: readonly FirmWire[] };

export type CreateFirmInput = {
  readonly legalName: string;
  /** OUR region — the one the firm is dispatched from. An input here, because a firm is a root and has no edge to derive it from. */
  readonly regionId: string;
  readonly settlementTermsDays: number;
  /** OQ5, firm side. No default: absent or non-boolean is a 400 — no position was stated. */
  readonly diagnosticDataRightsReserved: boolean;
  readonly msaSignedAt?: string;
  readonly w9DocumentKey?: string;
  readonly externalRef?: string;
};
export type CreateFirmOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };

export type UpdateFirmInput = {
  readonly firmId: string;
  readonly legalName?: string;
  readonly settlementTermsDays?: number;
  readonly msaSignedAt?: string | null;
  readonly w9DocumentKey?: string | null;
  /** A step on the ladder. Refused by name when it is not an edge from the current status. */
  readonly status?: Exclude<FirmStatus, "onboarding">;
};
export type UpdateFirmOutput = { readonly id: string; readonly status: FirmStatus; readonly eventId: string };

export type EmploymentType = "employed" | "subcontracted";
/** What the gate would say about this crew's documents today — not a clearance, a summary S2 reads. */
export type CrewDocumentSummary = {
  /** The kinds the gate requires for this employment shape (domain/compliance/gate.ts REQUIRED). */
  readonly required: readonly string[];
  /** Required kinds with a VERIFIED document on file whose window includes today. */
  readonly satisfied: readonly string[];
  /** Required kinds with a document on file but none verified. */
  readonly unverified: readonly string[];
  /** Required kinds with a verified document on file, none of which covers today. */
  readonly expired: readonly string[];
  /** Required kinds with nothing on file at all. */
  readonly missing: readonly string[];
  /** Earliest valid_to among the verified documents that satisfy a required kind, ISO date, or null. */
  readonly earliestExpiry: string | null;
};
export type CrewWire = {
  readonly id: string;
  readonly label: string;
  readonly employmentType: EmploymentType;
  readonly firmId: string | null;
  readonly homeRegionId: string;
  readonly active: boolean;
  readonly documents: CrewDocumentSummary;
};
export type ListCrewsInput = { readonly firmId?: string; readonly regionId?: string };
export type ListCrewsOutput = { readonly crews: readonly CrewWire[] };

export type CreateCrewInput = {
  readonly label: string;
  readonly employmentType: EmploymentType;
  /** Required for a subcontracted crew; refused for an employed one. */
  readonly firmId?: string;
  /** OUR region the crew is normally dispatched from. Its tenancy region on insert. */
  readonly homeRegionId: string;
};
export type CreateCrewOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };
export type UpdateCrewInput = { readonly crewId: string; readonly label?: string; readonly active?: boolean };
export type UpdateCrewOutput = { readonly id: string; readonly eventId: string };

export type CredentialKind = "insurance" | "license" | "certification" | "background_check";
export type CredentialWire = {
  readonly id: string;
  readonly crewId: string;
  readonly kind: CredentialKind;
  readonly identifier: string;
  /** ISO dates, both inclusive — the gate covers the whole service window with them. */
  readonly validFrom: string;
  readonly validTo: string;
  readonly documentKey: string | null;
  readonly verifiedAt: string | null;
  readonly verifiedBy: string | null;
};
export type ListCredentialsInput = { readonly crewId?: string; readonly firmId?: string };
export type ListCredentialsOutput = { readonly credentials: readonly CredentialWire[] };
export type RecordCredentialInput = {
  readonly crewId: string;
  readonly kind: CredentialKind;
  readonly identifier: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly documentKey?: string;
};
export type RecordCredentialOutput = { readonly id: string; readonly eventId: string };
export type VerifyCredentialInput = { readonly credentialId: string };
export type VerifyCredentialOutput = { readonly id: string; readonly verifiedAt: string; readonly verifiedBy: string; readonly eventId: string };

export type RateCardWire = {
  readonly id: string;
  readonly firmId: string;
  readonly serviceCode: string;
  /** Integer minor units as a STRING. A JSON number is a double. */
  readonly rateMinor: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  /** Exclusive; null = open. */
  readonly effectiveTo: string | null;
};
export type ListRateCardsInput = { readonly firmId: string; readonly serviceCode?: string };
export type ListRateCardsOutput = { readonly rateCards: readonly RateCardWire[] };
export type SetRateCardInput = {
  readonly firmId: string;
  readonly serviceCode: string;
  /** Integer minor units as a string of digits. */
  readonly rateMinor: string;
  readonly currency: string;
  /** ISO date the new rate takes effect. The row in effect that day is closed at it. */
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
};
export type SetRateCardOutput = { readonly id: string; readonly closedId: string | null; readonly eventId: string };

export type AssignInput = { readonly jobId: string; readonly crewId: string; readonly orgId: string; readonly regionId: string };
export type ComplianceRefusalWire = {
  readonly ok: false;
  readonly reason: "missing" | "expired_in_window" | "unverified" | "crew_inactive";
  readonly credentialKind: string;
  readonly detail: string;
};
export type AssignOutput =
  | { readonly ok: true; readonly assignmentId: string; readonly clearanceId: string; readonly eventId: string }
  | { readonly ok: false; readonly refusal: ComplianceRefusalWire; readonly eventId: string };

export type SyncMutationWire = {
  readonly mutationId: string;
  readonly deviceId: string;
  readonly deviceSeq: number;
  readonly entityTable: string;
  readonly entityId: string;
  readonly op: "insert" | "update" | "transition";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly clientObservedVersion: number | null;
  readonly deviceAt: string;
};
export type SyncReplayInput = { readonly orgId: string; readonly regionId: string; readonly mutations: readonly SyncMutationWire[] };
export type ServerStateWire = { readonly version: number; readonly state?: string; readonly fields: Readonly<Record<string, unknown>> };
export type SyncOutcomeWire =
  | { readonly outcome: "applied"; readonly mutationId: string; readonly newVersion: number }
  | { readonly outcome: "duplicate"; readonly mutationId: string }
  | { readonly outcome: "superseded"; readonly mutationId: string; readonly note: string; readonly serverState: ServerStateWire | null }
  | { readonly outcome: "queued_for_human"; readonly mutationId: string; readonly note: string; readonly serverState: ServerStateWire | null }
  | { readonly outcome: "rejected"; readonly mutationId: string; readonly note: string };
export type SyncReplayOutput = { readonly outcomes: readonly SyncOutcomeWire[] };

export type HealthOutput = { readonly ok: true; readonly surfaces: readonly SurfaceId[] };

/**
 * A TENANT'S THEME, on the wire.
 *
 * `overrides` is the accent slots and nothing else — packages/tokens
 * BRAND_OVERRIDABLE is the list, and the gateway refuses a key outside it with
 * the reason. The structural tokens, the focus ring and the state ramp are not
 * here because a themeable focus ring is an accessibility regression shipped
 * under someone else's logo, and a themeable state ramp is an instrument a
 * tenant re-keyed.
 *
 * `host` is the key, not the org id: the browser asking for a theme has not
 * authenticated yet and cannot be trusted to name an org. It names where it is,
 * and the gateway decides whose that is.
 */
export type BrandThemeInput = {
  readonly host: string;
  readonly orgId: string;
  readonly regionId: string;
  /** The tenant's brand colour, gated separately from the slots — see `admission`. */
  readonly accent: string;
  readonly overrides: Readonly<Record<string, string>>;
};

/** Where an accent may be painted. Narrower than "admitted": the gate refuses the slot, never the tenant. */
export type AccentAdmissionWire = {
  readonly stateSurfaces: boolean;
  readonly achromatic: boolean;
  readonly minSeparation: number;
  readonly nearestState: string;
  readonly tiers: Readonly<Record<string, { readonly text: boolean; readonly fill: boolean }>>;
  readonly notes: readonly string[];
};

export type BrandThemeOutput = {
  readonly host: string;
  readonly eventId: string;
  readonly admission: AccentAdmissionWire;
};

/**
 * What the shell installs. `css` is already scoped by packages/tokens
 * TENANT_SCOPE, so it cannot reach the field frame whatever a surface does
 * with it, and `tenant` is false for a host with no theme — which is a plain
 * answer, not a 404, so this route says nothing about which tenants exist.
 */
export type BrandStylesheetInput = { readonly host?: string };
export type BrandStylesheetOutput = {
  readonly tenant: boolean;
  readonly css: string;
  readonly admission: AccentAdmissionWire | null;
};

/**
 * One entry per operation, enforced by `satisfies`: add a row to OPERATIONS
 * without a shape here and the file does not type-check; the generator, which
 * writes these names as text, then emits a method whose type does not resolve.
 */
export type OperationIO = {
  "auth.login": { input: LoginInput; output: LoginOutput };
  "auth.logout": { input: void; output: LogoutOutput };
  "session.me": { input: void; output: HierarchyContext };
  "terms.authorOverride": { input: AuthorOverrideInput; output: AuthorOverrideOutput };
  "terms.resolved": { input: ResolvedTermsInput; output: ResolvedTermsOutput };
  "regions.list": { input: void; output: ListRegionsOutput };
  "organizations.list": { input: ListOrganizationsInput; output: ListOrganizationsOutput };
  "organizations.create": { input: CreateOrganizationInput; output: CreateOrganizationOutput };
  "accounts.list": { input: ListAccountsInput; output: ListAccountsOutput };
  "accounts.create": { input: CreateAccountInput; output: CreateAccountOutput };
  "accounts.move": { input: MoveAccountInput; output: MoveAccountOutput };
  "accounts.update": { input: UpdateAccountInput; output: UpdateAccountOutput };
  "contracts.list": { input: ListContractsInput; output: ListContractsOutput };
  "contracts.create": { input: CreateContractInput; output: CreateContractOutput };
  "contracts.transition": { input: TransitionContractInput; output: TransitionContractOutput };
  "terms.overrides.list": { input: ListTermOverridesInput; output: ListTermOverridesOutput };
  "terms.register": { input: void; output: TermRegisterOutput };
  "firms.list": { input: ListFirmsInput; output: ListFirmsOutput };
  "firms.create": { input: CreateFirmInput; output: CreateFirmOutput };
  "firms.update": { input: UpdateFirmInput; output: UpdateFirmOutput };
  "crews.list": { input: ListCrewsInput; output: ListCrewsOutput };
  "crews.create": { input: CreateCrewInput; output: CreateCrewOutput };
  "crews.update": { input: UpdateCrewInput; output: UpdateCrewOutput };
  "credentials.list": { input: ListCredentialsInput; output: ListCredentialsOutput };
  "credentials.record": { input: RecordCredentialInput; output: RecordCredentialOutput };
  "credentials.verify": { input: VerifyCredentialInput; output: VerifyCredentialOutput };
  "rateCards.list": { input: ListRateCardsInput; output: ListRateCardsOutput };
  "rateCards.set": { input: SetRateCardInput; output: SetRateCardOutput };
  "dispatch.assign": { input: AssignInput; output: AssignOutput };
  "sync.replay": { input: SyncReplayInput; output: SyncReplayOutput };
  "brand.setTheme": { input: BrandThemeInput; output: BrandThemeOutput };
  "brand.theme": { input: BrandStylesheetInput; output: BrandStylesheetOutput };
  "events.stream": { input: void; output: never };
  "system.health": { input: void; output: HealthOutput };
};
// Both directions: every operation has IO, and no IO names a missing operation.
type _IoCoversCatalogue = { [K in OperationId]: OperationIO[K] };
type _CatalogueCoversIo = { [K in keyof OperationIO]: (typeof OPERATIONS)[K] };
export type _OperationIoParity = [_IoCoversCatalogue, _CatalogueCoversIo];
