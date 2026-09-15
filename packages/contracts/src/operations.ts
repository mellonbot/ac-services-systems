import type { SurfaceId } from "./surfaces.ts";
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
  "dispatch.assign": { input: AssignInput; output: AssignOutput };
  "sync.replay": { input: SyncReplayInput; output: SyncReplayOutput };
  "events.stream": { input: void; output: never };
  "system.health": { input: void; output: HealthOutput };
};
// Both directions: every operation has IO, and no IO names a missing operation.
type _IoCoversCatalogue = { [K in OperationId]: OperationIO[K] };
type _CatalogueCoversIo = { [K in keyof OperationIO]: (typeof OPERATIONS)[K] };
export type _OperationIoParity = [_IoCoversCatalogue, _CatalogueCoversIo];
