import { mintClearance, type ComplianceClearance, type Refusal } from "./clearance.ts";

export type Credential = {
  readonly id: string;
  readonly kind: string;
  readonly validFrom: number;
  readonly validTo: number;
  readonly verifiedAt: number | null;
};

export type Crew = {
  readonly id: string;
  readonly active: boolean;
  /**
   * Read HERE and nowhere else. Non-negotiable #9: the gate is the only code
   * that reads employment shape, and it produces no field-visible difference.
   * `employment_type` is barred from the field layer by lint rule and CI guard.
   */
  readonly employmentType: "employed" | "subcontracted";
};

export type ServiceWindow = { readonly start: number; readonly end: number };

/**
 * Requirements by employment shape. Subcontracted crews carry the same field
 * experience and a stricter document set — that difference lives here, in
 * data, and dies here. It never reaches S5.
 */
export const REQUIRED: Readonly<Record<Crew["employmentType"], readonly string[]>> = {
  employed: ["license", "background_check"],
  subcontracted: ["insurance", "license", "background_check"],
};

/**
 * The one function that can produce a ComplianceClearance.
 *
 * It evaluates the WHOLE SERVICE WINDOW, not the instant of assignment. A
 * certificate valid today that expires on Tuesday does not clear a job
 * scheduled for Thursday. Checking `now` produces a gate that feels correct
 * right up until the first time it matters.
 */
export const evaluate = (
  crew: Crew,
  credentials: readonly Credential[],
  window: ServiceWindow,
  // Callers were threading the same value through four layers to get here.
  // Defaulting it removes the ceremony; anyone who needs a different instant
  // can still pass one.
  evaluatedAt: number = Date.now(),
): ComplianceClearance | Refusal => {
  if (!crew.active) {
    return { ok: false, reason: "crew_inactive", credentialKind: "-", detail: `Crew ${crew.id} is not active.` };
  }

  const used: string[] = [];
  for (const kind of REQUIRED[crew.employmentType]) {
    const held = credentials.filter((c) => c.kind === kind && c.id !== undefined);
    if (held.length === 0) {
      return { ok: false, reason: "missing", credentialKind: kind, detail: `No ${kind} on file for crew ${crew.id}.` };
    }
    const verified = held.filter((c) => c.verifiedAt !== null);
    if (verified.length === 0) {
      return { ok: false, reason: "unverified", credentialKind: kind, detail: `${kind} on file for crew ${crew.id} has never been verified.` };
    }
    const covering = verified.find((c) => c.validFrom <= window.start && c.validTo >= window.end);
    if (!covering) {
      const best = verified.reduce((a, b) => (a.validTo > b.validTo ? a : b));
      return {
        ok: false,
        reason: "expired_in_window",
        credentialKind: kind,
        detail:
          `Crew ${crew.id} ${kind} expires ${new Date(best.validTo).toISOString().slice(0, 10)}, ` +
          `inside the service window ending ${new Date(window.end).toISOString().slice(0, 10)}.`,
      };
    }
    used.push(covering.id);
  }

  return mintClearance({
    crewId: crew.id,
    windowStart: window.start,
    windowEnd: window.end,
    credentialIds: Object.freeze(used),
    evaluatedAt,
  });
};

export const isRefusal = (r: ComplianceClearance | Refusal): r is Refusal =>
  (r as Refusal).ok === false;
