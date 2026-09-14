/**
 * SLA TIMERS AND THE ESCALATION CASCADE.
 *
 * §2.4: "staged alert cascade: regional dispatch → account owner → ops leadership".
 * Risk register: "SLA alert fatigue — more than one false positive per week in
 * shadow mode: do not enable paging. Tune first. Trust in the alert is spent once."
 *
 * Two design consequences of that risk line, both structural:
 *
 * 1. SHADOW MODE IS A FIELD, NOT A DEPLOYMENT. A timer carries shadow_mode, so
 *    the cascade can run for real against real jobs and record what it WOULD
 *    have done, per region, without paging anyone. Turning it on is a data
 *    change per region, which means it turns on where it has earned trust and
 *    stays off where it has not.
 *
 * 2. THE TIMER IS DERIVED, NEVER TYPED IN. due_at comes from the resolved
 *    contract for that site (web-arch S3 rule). A dispatcher cannot set an SLA
 *    clock, because a dispatcher who can set the clock is a dispatcher who will
 *    be asked to.
 */

export type Stage = 0 | 1 | 2 | 3;
export const STAGE_NAMES: Record<Stage, string> = {
  0: "none", 1: "regional_dispatch", 2: "account_owner", 3: "ops_leadership",
};

export type SlaTerms = {
  /** e.g. "same_day" | "4_hour" | "next_day" — resolved, never raw. */
  response: string;
  /** Escalate at these fractions of the window consumed. */
  escalate_at?: readonly number[];
  business_hours_only?: boolean;
};

const WINDOW_MS: Record<string, number> = {
  "1_hour": 3_600_000, "2_hour": 7_200_000, "4_hour": 14_400_000,
  same_day: 28_800_000, next_day: 86_400_000, "48_hour": 172_800_000,
};

export class UnknownSlaTermError extends Error {}

/** Derived from the resolved contract. Throwing beats defaulting: a silent
 *  fallback window is an SLA we are measured against and never agreed to. */
export function deriveDueAt(openedAt: Date, terms: SlaTerms): Date {
  const ms = WINDOW_MS[terms.response];
  if (ms == null)
    throw new UnknownSlaTermError(
      `unknown response term "${terms.response}". Add it to WINDOW_MS deliberately — defaulting here ` +
      `would invent a commitment nobody signed.`);
  return new Date(openedAt.getTime() + ms);
}

export type TimerState = {
  opened_at: Date; due_at: Date;
  satisfied_at: Date | null; breached_at: Date | null;
  escalation_stage: Stage; shadow_mode: boolean;
};

export type CascadeAction = {
  stage: Stage; audience: string; shadow: boolean; reason: string;
};

const DEFAULT_ESCALATIONS = [0.5, 0.8, 1.0] as const;

/**
 * Pure. Returns the action the cascade WOULD take, and whether it is shadowed.
 * The caller decides whether to page; this decides whether there is anything
 * to page about. That separation is what makes shadow mode honest — the same
 * code path runs either way, so a tuned shadow week means something.
 */
export function evaluateCascade(t: TimerState, now: Date, terms: SlaTerms): CascadeAction | null {
  if (t.satisfied_at) return null;
  const total = t.due_at.getTime() - t.opened_at.getTime();
  if (total <= 0) return null;
  const consumed = (now.getTime() - t.opened_at.getTime()) / total;
  const marks = terms.escalate_at ?? DEFAULT_ESCALATIONS;

  let stage: Stage = 0;
  for (let i = 0; i < marks.length; i++) if (consumed >= marks[i]!) stage = (i + 1) as Stage;
  if (stage <= t.escalation_stage) return null;

  return {
    stage,
    audience: STAGE_NAMES[stage],
    shadow: t.shadow_mode,
    reason:
      stage === 3
        ? `SLA window fully consumed (${terms.response}); breach is live and the credit is ours — under Model A there is no counterparty to attribute it to.`
        : `${Math.round(consumed * 100)}% of the ${terms.response} window consumed with no response recorded.`,
  };
}
