import { tierRank, type Tier } from "../../../contracts/src/tiers.ts";
import { termPolicy, termRank, checkTermValue, type TermPolicy } from "../../../contracts/src/terms.ts";

/**
 * A sparse override row, as stored. `effectiveFrom`/`effectiveTo` are ISO
 * dates (half-open, `effectiveTo` null = evergreen). Values are exactly what
 * sits in the jsonb column.
 */
export type Override = {
  readonly id: string;
  readonly contractId: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly termKey: string;
  readonly termValue: unknown;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
};

/** The chain from the parent down to the node being resolved. Broadest first. */
export type ScopePath = readonly { readonly tier: Tier; readonly id: string; readonly name?: string }[];

export type TraceStep = {
  readonly tier: Tier;
  readonly id: string;
  readonly outcome: "no_override" | "candidate" | "won" | "not_walked";
  readonly value?: unknown;
  readonly overrideId?: string;
  readonly note?: string;
};

export type Resolution = {
  readonly termKey: string;
  readonly value: unknown;
  readonly wonAt: { readonly tier: Tier; readonly id: string } | "fallback";
  readonly policy: TermPolicy;
  /** Every rung, including the empty ones. M2's evidence. */
  readonly trace: readonly TraceStep[];
  readonly asOf: string;
};

export type ResolutionCode = "ambiguous" | "illegal_tier" | "ratchet_loosened" | "no_value" | "bad_value";

export class ResolutionError extends Error {
  readonly termKey: string;
  readonly code: ResolutionCode;
  constructor(message: string, termKey: string, code: ResolutionCode) {
    super(message);
    this.name = "ResolutionError";
    this.termKey = termKey;
    this.code = code;
  }
}

const inEffect = (o: Override, asOf: string): boolean =>
  o.effectiveFrom <= asOf && (o.effectiveTo === null || asOf < o.effectiveTo);

/**
 * THE RESOLVER. Non-negotiable #1, D2 part two.
 *
 * `asOf` is an ISO date. The domain has no clock; a disputed February job
 * reprices against the February contract because the caller says "February".
 *
 * Rules the policy register imposes, all of which RAISE rather than tie-break:
 *
 *   authoring   an override row at a tier the term does not permit is an
 *               illegal row. The DB trigger refuses it at insert; if one is
 *               found here anyway (an old row, a bypassed path) resolution
 *               refuses too. Two layers.
 *   ambiguity   two rows in effect at the same node for the same term. The
 *               EXCLUDE constraint makes this unrepresentable at insert; the
 *               resolver still refuses, because rows can arrive from a restore.
 *   nearest     the most specific tier with a row wins.
 *   ratchet     walking down, each row must be at least as strict as the one
 *               above it. A looser row raises with both values named.
 *   attach      only the node itself is consulted; nothing above it is walked.
 */
export const resolveTerm = (
  overrides: readonly Override[],
  path: ScopePath,
  termKey: string,
  asOf: string,
): Resolution => {
  const policy = termPolicy(termKey);
  const ordered = [...path].sort((a, b) => tierRank(a.tier) - tierRank(b.tier));
  const trace: TraceStep[] = [];

  const nodes = policy.combine.kind === "attach" ? ordered.slice(-1) : ordered;
  if (policy.combine.kind === "attach") {
    for (const n of ordered.slice(0, -1)) trace.push({ tier: n.tier, id: n.id, outcome: "not_walked", note: "attach terms bind to one node and never inherit" });
  }

  let winner: { override: Override; node: ScopePath[number] } | null = null;
  let winnerRank: number | null = null;

  for (const node of nodes) {
    const here = overrides.filter(
      (o) => o.termKey === termKey && o.scopeTier === node.tier && o.scopeId === node.id && inEffect(o, asOf),
    );
    if (here.length === 0) {
      trace.push({ tier: node.tier, id: node.id, outcome: "no_override" });
      continue;
    }
    if (here.length > 1) {
      throw new ResolutionError(
        `[inheritance] ${here.length} overrides for "${termKey}" in effect at ${node.tier}:${node.id} on ${asOf} ` +
        `(${here.map((o) => o.id).join(", ")}). This is ambiguous, and resolving it by sort order would make a ` +
        `pricing decision silently. End one of them.`,
        termKey, "ambiguous",
      );
    }
    const only = here[0]!;
    if (!policy.authoring.includes(node.tier)) {
      throw new ResolutionError(
        `[inheritance] "${termKey}" is set at ${node.tier}:${node.id} (row ${only.id}) but may only be authored at ` +
        `[${policy.authoring.join(", ")}]. ${policy.rationale}`,
        termKey, "illegal_tier",
      );
    }
    try {
      checkTermValue(policy, only.termValue);
    } catch (e) {
      throw new ResolutionError((e as Error).message + ` (row ${only.id})`, termKey, "bad_value");
    }

    if (policy.combine.kind === "ratchet") {
      const r = termRank(policy, only.termValue);
      if (winnerRank !== null) {
        const loosened = policy.combine.stricter === "lower" ? r > winnerRank : r < winnerRank;
        if (loosened) {
          throw new ResolutionError(
            `[inheritance] "${termKey}" at ${node.tier}:${node.id} is ${JSON.stringify(only.termValue)}, which is LOOSER than ` +
            `${JSON.stringify(winner!.override.termValue)} inherited from ${winner!.node.tier}:${winner!.node.id}. ` +
            `Overrides may only tighten this term. ${policy.rationale}`,
            termKey, "ratchet_loosened",
          );
        }
      }
      winnerRank = r;
    }

    trace.push({ tier: node.tier, id: node.id, outcome: "candidate", value: only.termValue, overrideId: only.id });
    winner = { override: only, node };
  }

  if (!winner) {
    if (policy.fallback === undefined) {
      throw new ResolutionError(
        `[inheritance] no value for "${termKey}" anywhere on the path as of ${asOf}, and the register declares no default. ${policy.rationale}`,
        termKey, "no_value",
      );
    }
    return { termKey, value: policy.fallback, wonAt: "fallback", policy, trace: [...trace, { tier: ordered[0]!.tier, id: "-", outcome: "won", value: policy.fallback, note: "register default" }], asOf };
  }

  const finalTrace = trace.map((s) =>
    s.outcome === "candidate" && s.overrideId === winner!.override.id ? { ...s, outcome: "won" as const } : s,
  );
  return { termKey, value: winner.override.termValue, wonAt: { tier: winner.node.tier, id: winner.node.id }, policy, trace: finalTrace, asOf };
};

/** Every registered term at a node, for the S2 "resolved terms" panel and the invoice engine. */
export const resolveAll = (
  overrides: readonly Override[],
  path: ScopePath,
  asOf: string,
  keys: readonly string[],
): { readonly resolved: Record<string, Resolution>; readonly refused: Record<string, ResolutionError> } => {
  const resolved: Record<string, Resolution> = {};
  const refused: Record<string, ResolutionError> = {};
  for (const k of keys) {
    try {
      resolved[k] = resolveTerm(overrides, path, k, asOf);
    } catch (e) {
      if (e instanceof ResolutionError) refused[k] = e;
      else throw e;
    }
  }
  return { resolved, refused };
};
