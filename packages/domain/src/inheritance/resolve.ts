import { TIERS, tierRank, type Tier } from "@ac/contracts";

export type Override = {
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly termKey: string;
  readonly termValue: unknown;
};

/** The chain from the account up to its parent, narrowest last. */
export type ScopePath = readonly { readonly tier: Tier; readonly id: string }[];

export type Resolution = {
  readonly value: unknown;
  /** Every rung considered and why it did or did not win. M2's evidence. */
  readonly trace: readonly string[];
  readonly wonAt: { readonly tier: Tier; readonly id: string };
};

/**
 * Non-negotiable #1. Sparse override rows, most-specific-wins, with an
 * inspectable trace.
 *
 * Two properties matter more than the algorithm:
 *
 * 1. AMBIGUITY THROWS. Two overrides at the same tier for the same key is not
 *    a tie to be broken by a sort order — that is a pricing decision made by an
 *    ORDER BY clause, discovered six months later in an invoice dispute.
 *
 * 2. THE TRACE IS THE PRODUCT. "Why is this location billed at that rate?" is
 *    asked by a customer, on a call, about money. An answer that requires
 *    reading code is not an answer.
 */
export const resolveTerm = (
  overrides: readonly Override[],
  path: ScopePath,
  termKey: string,
  fallback?: unknown,
): Resolution => {
  const trace: string[] = [];
  let winner: { override: Override; node: ScopePath[number] } | null = null;

  for (const node of [...path].sort((a, b) => tierRank(a.tier) - tierRank(b.tier))) {
    const here = overrides.filter(
      (o) => o.termKey === termKey && o.scopeTier === node.tier && o.scopeId === node.id,
    );
    if (here.length === 0) {
      trace.push(`${node.tier}:${node.id} — no override`);
      continue;
    }
    if (here.length > 1) {
      throw new Error(
        `[inheritance] ${here.length} overrides for "${termKey}" at ${node.tier}:${node.id}. ` +
        `This is ambiguous, and resolving it by sort order would make a pricing ` +
        `decision silently. Delete the duplicate or scope them differently.`,
      );
    }
    const only = here[0]!;
    trace.push(`${node.tier}:${node.id} — override ${JSON.stringify(only.termValue)}`);
    winner = { override: only, node };
  }

  if (!winner) {
    if (fallback === undefined) {
      throw new Error(`[inheritance] no value for "${termKey}" anywhere on the path, and no default.`);
    }
    trace.push(`default — ${JSON.stringify(fallback)}`);
    return { value: fallback, trace, wonAt: { tier: TIERS[0], id: "-" } };
  }
  trace.push(`resolved at ${winner.node.tier}:${winner.node.id}`);
  return { value: winner.override.termValue, trace, wonAt: winner.node };
};
