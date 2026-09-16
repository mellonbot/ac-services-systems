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
 *
 * The classification IS the register's combine axis, so it is a lookup on the
 * domain's admission code and not a second table anyone maintains.
 */
export type AdmissionAxis = "structural" | "commercial";

/** Codes the domain raises — `AdmissionCode` in domain/inheritance/admit.ts and `ResolutionCode` in resolve.ts, mirrored here as wire values. */
export const ADMISSION_AXIS: Readonly<Record<string, AdmissionAxis>> = Object.freeze({
  // authoring axis and value shape — the row can never be right
  unknown_term: "structural",
  illegal_tier: "structural",
  bad_value: "structural",
  overlap: "structural",
  ambiguous: "structural",
  no_value: "structural",
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
});

export const admissionAxis = (code: string | undefined): AdmissionAxis =>
  (code && ADMISSION_AXIS[code]) || "structural";

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
  | { readonly kind: "admission"; readonly code: string; readonly axis: AdmissionAxis; readonly message: string }
  /** 400 — the input did not parse or lacked a required field. */
  | { readonly kind: "bad_request"; readonly message: string }
  /** 5xx or no response — the gateway is unreachable or broken. The ONLY kind that flips degraded mode. */
  | { readonly kind: "transport"; readonly status: number | null; readonly message: string };

export type WireError = { readonly error?: string; readonly code?: string; readonly message?: string };

/** Status + body → Refusal. Pure, so it is tested without a socket. */
export const classifyRefusal = (status: number, body: WireError | null): Refusal => {
  const message = body?.message ?? `HTTP ${status}`;
  if (status === 401) return { kind: "token", code: (body?.code as TokenFault | undefined) ?? "malformed", message };
  if (status === 403) return { kind: "scope", error: body?.error ?? "Forbidden", message };
  if (status === 404) return body?.error === "SurfaceDisabled" ? { kind: "phase_disabled", message } : { kind: "no_route", message };
  if (status === 422) return { kind: "admission", code: body?.code ?? "unknown", axis: admissionAxis(body?.code), message };
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
