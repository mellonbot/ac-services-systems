/**
 * NON-NEGOTIABLE #8 — the compliance gate is a TYPE, not a check.
 *
 * The master plan is blunt about why: "an override that exists will be used on
 * the worst day of the quarter", and "dispatching an uninsured crew to an
 * enterprise site is the one operational failure that can end the company."
 *
 * A checked gate — `if (!isCompliant(crew)) throw` — is an override waiting for
 * a deadline, because the call site can be edited by whoever needs it to pass.
 * So there is no check to edit. `buildAssignment` takes a ComplianceClearance
 * positionally, and a ComplianceClearance carries a symbol this module never
 * exports. There is no flag to set and no value to fake. Getting past it means
 * deleting this file, which is a reviewed diff with a name on it.
 */

// Never exported. This is the whole mechanism.
const CLEARED = Symbol("ac.compliance.cleared");

export type ComplianceClearance = {
  readonly [CLEARED]: true;
  readonly crewId: string;
  readonly windowStart: number;
  readonly windowEnd: number;
  /** Exactly which documents cleared it, frozen at evaluation time. */
  readonly credentialIds: readonly string[];
  readonly evaluatedAt: number;
};

/** Internal to the evaluator. Not exported from the package index. */
export const mintClearance = (c: Omit<ComplianceClearance, typeof CLEARED>): ComplianceClearance =>
  Object.freeze({ [CLEARED]: true, ...c }) as ComplianceClearance;

export type Refusal = {
  readonly ok: false;
  readonly reason: "missing" | "expired_in_window" | "unverified" | "crew_inactive";
  readonly credentialKind: string;
  /** Said plainly, because a dispatcher reads this under time pressure. */
  readonly detail: string;
};
