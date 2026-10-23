/**
 * REFUSALS, AS THE SHELL HANDS THEM TO A SURFACE.
 *
 * The gateway answers a refused request with a distinct HTTP status and a
 * body of `{ error, code, message }` — the human-readable reason, because a
 * dispatcher or contract administrator reads it under time pressure. The shell
 * turns that into one of the shapes below, once, so no surface parses a status
 * code and no surface keeps its own table of reasons.
 *
 * The load-bearing case is `admission`. 05 Rev D obliges S2 to render every
 * term-override refusal as a decision with a route, not a generic validation
 * error, and to say which of two kinds it is:
 *
 *   structural  — never valid at that tier on any account. Nothing to
 *                 escalate; the row is wrong. The authoring axis (this tier may
 *                 not hold this term) and overlap (two amendments in effect at
 *                 once) are structural.
 *   commercial  — someone has to agree to it and price it. The ratchet, in
 *                 both directions: a relaxation of a term we carry, or a parent
 *                 tightening over an existing looser child row.
 *   incomplete  — nothing is wrong with the request; the account is missing
 *                 a term it needs (no value anywhere on the path, no register
 *                 default). It goes through once contracts authors the term.
 *
 * The classification IS the register's combine axis, so it is a lookup on the
 * domain's admission code and not a second table anyone maintains.
 */
export type AdmissionAxis = "structural" | "commercial" | "incomplete";

/** Codes the domain raises — `AdmissionCode` in domain/inheritance/admit.ts and `ResolutionCode` in resolve.ts, mirrored here as wire values. */
export const ADMISSION_AXIS: Readonly<Record<string, AdmissionAxis>> = Object.freeze({
  // authoring axis and value shape — the row can never be right
  unknown_term: "structural",
  illegal_tier: "structural",
  bad_value: "structural",
  overlap: "structural",
  ambiguous: "structural",
  // nothing to resolve and no default — the request is fine, the account is not finished
  no_value: "incomplete",
  // an MSA activated before it states every no-default term — author them, then activate
  missing_terms: "incomplete",
  // the ratchet, both directions — somebody has to agree and price it
  ratchet_loosened: "commercial",
  would_orphan_descendants: "commercial",
  // D14 — supply before signature: a location in a region whose crew density is below the rule. Somebody has to staff it or price it.
  supply_below_density: "commercial",
  // the database's second layer (migration 0004 / constraints) — the row can never be right
  ac_admit_term_override: "structural",
  ac_accounts_derive_region: "structural",
  ac_inherit_tenancy_from_account: "structural",
  ac_contract_scope_exists: "structural",
  ac_assignment_requires_clearance: "structural",
  ac_clearance_is_earned: "structural",
  term_override_no_overlap: "structural",
  rate_cards_no_overlap: "structural",
  // handler input refusals
  unknown_scope: "structural",
  unknown_job: "structural",
  unknown_crew: "structural",
  tenancy_mismatch: "structural",
  // C2 — the agreement's own shape, decided by the handler before the row exists.
  // All structural: an amendment with no MSA, a window that ends before it starts
  // or a step off the state ladder is a row that can never be right, and there is
  // nobody to escalate it to.
  unknown_contract: "structural",
  region_not_an_input: "structural",
  amendment_needs_parent: "structural",
  parent_contract_ended: "structural",
  empty_window: "structural",
  illegal_transition: "structural",
  // C4 — the network registry. Structural, all of it: a subcontracted crew with
  // no firm, a firm activated before its MSA is signed, a second verification of
  // a document, a rate that begins on a day one already begins — each is a row
  // that can never be right, and the route is to fix the row.
  use_firms_create: "structural",
  unknown_firm: "structural",
  firm_ended: "structural",
  firm_required: "structural",
  firm_not_an_input: "structural",
  msa_unsigned: "structural",
  unknown_credential: "structural",
  already_verified: "structural",
  rate_begins_same_day: "structural",
  ac_credential_verification_is_earned: "structural",
  // 0020 — the roster. A technician who is not there, a crew of another employer,
  // and an address from a role that may not hold one: none of them is priced.
  unknown_technician: "structural",
  crew_employer_mismatch: "structural",
  address_restricted: "structural",
  ac_technician_crew_is_the_employers: "structural",
  // item 4 — S3/S5. All structural: a site that is not a site, a job past the
  // point a release is meaningful, a grant that overlaps the one device can
  // hold at a time, a technician granted onto a crew they are not on — each is
  // a row that can never be right, not a commercial position to price.
  unknown_site: "structural",
  not_a_site: "structural",
  tile_out_of_reach: "structural",
  bad_window: "structural",
  already_released: "structural",
  job_in_progress: "structural",
  job_not_dispatchable: "structural",
  crew_reinstated_by_office: "structural",
  contract_not_in_force: "structural",
  unknown_project: "structural",
  open_jobs_in_region: "structural",
  unknown_device: "structural",
  unknown_assignment: "structural",
  device_inactive: "structural",
  crew_inactive_for_grant: "structural",
  not_crew_member: "structural",
  grant_overlap: "structural",
  // 0016: a published update is final, and an update id that is not this job's draft is not one to edit.
  already_published: "structural",
  unknown_update: "structural",
});

export const admissionAxis = (code: string | undefined): AdmissionAxis =>
  (code && ADMISSION_AXIS[code]) || "structural";

/**
 * What an `incomplete` refusal was missing, as facts rather than a sentence:
 * the term, where it was looked for, and on what day. The gateway's message
 * says it in the resolver's words; a surface whose reader cannot author a term
 * builds its sentence from these and the register's `label`, so the reason
 * still lives in one place.
 */
export type MissingTerm = {
  readonly termKey: string;
  readonly siteId: string;
  readonly siteName: string;
  readonly customer: string;
  readonly asOf: string;
};

export type TokenFault = "malformed" | "bad_signature" | "expired" | "unknown_key" | "bad_claims" | "revoked";

export type Refusal =
  /** 401 — the token, not the request. Re-authenticate; there is nothing else to do. */
  | { readonly kind: "token"; readonly code: TokenFault; readonly message: string }
  /** 403 — scope, role, tenancy or write allowlist. The request was understood and this principal may not make it. */
  | { readonly kind: "scope"; readonly error: string; readonly message: string }
  /** 404 SurfaceDisabled — the surface is behind a phase gate (D9). */
  | { readonly kind: "phase_disabled"; readonly message: string }
  /** 404 — no such route. Only possible if the client and the gateway disagree about the catalogue, which the guard prevents. */
  | { readonly kind: "no_route"; readonly message: string }
  /** 422 — the register refused the row. Carries the axis so S2 can route it. */
  | { readonly kind: "admission"; readonly code: string; readonly axis: AdmissionAxis; readonly message: string; readonly missingTerm?: MissingTerm }
  /** 400 — the input did not parse or lacked a required field. */
  | { readonly kind: "bad_request"; readonly message: string }
  /** 5xx or no response — the gateway is unreachable or broken. The ONLY kind that flips degraded mode. */
  | { readonly kind: "transport"; readonly status: number | null; readonly message: string };

export type WireError = { readonly error?: string; readonly code?: string; readonly message?: string; readonly missingTerm?: MissingTerm };

/** Status + body → Refusal. Pure, so it is tested without a socket. */
export const classifyRefusal = (status: number, body: WireError | null): Refusal => {
  const message = body?.message ?? `HTTP ${status}`;
  if (status === 401) return { kind: "token", code: (body?.code as TokenFault | undefined) ?? "malformed", message };
  if (status === 403) return { kind: "scope", error: body?.error ?? "Forbidden", message };
  if (status === 404) return body?.error === "SurfaceDisabled" ? { kind: "phase_disabled", message } : { kind: "no_route", message };
  if (status === 422) return { kind: "admission", code: body?.code ?? "unknown", axis: admissionAxis(body?.code), message, ...(body?.missingTerm ? { missingTerm: body.missingTerm } : {}) };
  if (status === 400) return { kind: "bad_request", message };
  return { kind: "transport", status, message };
};

export class GatewayRefusal extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(refusal.message);
    this.name = "GatewayRefusal";
    this.refusal = refusal;
  }
}
