import { termPolicy, termRank, checkTermValue } from "../../../contracts/src/terms.ts";
import { resolveTerm, ResolutionError, type Override, type ScopePath } from "./resolve.ts";

/**
 * WRITE-TIME ADMISSION. The point where a human can still do something.
 *
 * The register makes an illegal override unrepresentable in a RESOLVED result;
 * this makes it unrepresentable in the TABLE. S2 calls this before the gateway
 * writes the row; the gateway calls it again inside the unit of work; the DB
 * trigger and EXCLUDE constraint hold the two checks that are local to a row.
 * The ratchet check is here and only here, because it needs the resolver.
 *
 * Returns nothing on success. Throws a Refusal with the reason a contract
 * administrator needs to read, not a code.
 */
export type Candidate = Omit<Override, "id">;

export type AdmissionCode = "unknown_term" | "illegal_tier" | "bad_value" | "overlap" | "ratchet_loosened" | "would_orphan_descendants";

export class AdmissionRefused extends Error {
  readonly code: AdmissionCode;
  constructor(message: string, code: AdmissionCode) {
    super(message);
    this.name = "AdmissionRefused";
    this.code = code;
  }
}

const overlaps = (a: Candidate, b: Override): boolean => {
  const aTo = a.effectiveTo ?? "9999-12-31";
  const bTo = b.effectiveTo ?? "9999-12-31";
  return a.effectiveFrom < bTo && b.effectiveFrom < aTo;
};

/**
 * @param candidate   the row S2 wants to write
 * @param existing    every override row in the org for this term (all tiers)
 * @param pathOf      the ancestor chain for any node, broadest first, ending at the node
 */
export const admitOverride = (
  candidate: Candidate,
  existing: readonly Override[],
  pathOf: (tier: Override["scopeTier"], id: string) => ScopePath,
): void => {
  let policy;
  try {
    policy = termPolicy(candidate.termKey);
  } catch (e) {
    throw new AdmissionRefused((e as Error).message, "unknown_term");
  }

  if (!policy.authoring.includes(candidate.scopeTier)) {
    throw new AdmissionRefused(
      `"${candidate.termKey}" cannot be set at the ${candidate.scopeTier} tier. It may be authored at [${policy.authoring.join(", ")}]. ${policy.rationale}`,
      "illegal_tier",
    );
  }
  try {
    checkTermValue(policy, candidate.termValue);
  } catch (e) {
    throw new AdmissionRefused((e as Error).message, "bad_value");
  }

  const sameNode = existing.filter(
    (o) => o.termKey === candidate.termKey && o.scopeTier === candidate.scopeTier && o.scopeId === candidate.scopeId,
  );
  const clash = sameNode.find((o) => overlaps(candidate, o));
  if (clash) {
    throw new AdmissionRefused(
      `"${candidate.termKey}" already has a row at ${candidate.scopeTier}:${candidate.scopeId} in effect ` +
      `${clash.effectiveFrom} → ${clash.effectiveTo ?? "open"} (row ${clash.id}, contract ${clash.contractId}). ` +
      `Overlapping amendments are refused, not tie-broken: end the existing row on the day the new one starts.`,
      "overlap",
    );
  }

  if (policy.combine.kind !== "ratchet") return;

  const stricter = policy.combine.stricter;
  const candidateRank = termRank(policy, candidate.termValue);
  const isLooser = (a: number, b: number) => (stricter === "lower" ? a > b : a < b);

  // 1. Against ancestors, at every instant the inherited value could change
  //    inside the candidate's window.
  const path = pathOf(candidate.scopeTier, candidate.scopeId);
  const ancestors = path.slice(0, -1);
  const ancestorRows = existing.filter(
    (o) => o.termKey === candidate.termKey && ancestors.some((n) => n.tier === o.scopeTier && n.id === o.scopeId),
  );
  const changePoints = new Set<string>([candidate.effectiveFrom]);
  for (const r of ancestorRows) {
    if (overlaps(candidate, r) && r.effectiveFrom > candidate.effectiveFrom) changePoints.add(r.effectiveFrom);
  }
  for (const asOf of changePoints) {
    let inherited;
    try {
      inherited = resolveTerm(ancestorRows, ancestors, candidate.termKey, asOf);
    } catch (e) {
      if (e instanceof ResolutionError && e.code === "no_value") continue;
      throw e;
    }
    if (inherited.wonAt === "fallback") continue;
    if (isLooser(candidateRank, termRank(policy, inherited.value))) {
      throw new AdmissionRefused(
        `"${candidate.termKey}" = ${JSON.stringify(candidate.termValue)} at ${candidate.scopeTier} is LOOSER than ` +
        `${JSON.stringify(inherited.value)} inherited from ${inherited.wonAt.tier}:${inherited.wonAt.id} as of ${asOf}. ` +
        `An override may only tighten this term. ${policy.rationale}`,
        "ratchet_loosened",
      );
    }
  }

  // 2. Against descendants: tightening above an existing looser row would make
  //    that row illegal — a term a customer currently believes they have.
  const descendantRows = existing.filter((o) => {
    if (o.termKey !== candidate.termKey || !overlaps(candidate, o)) return false;
    if (o.scopeTier === candidate.scopeTier && o.scopeId === candidate.scopeId) return false;
    return pathOf(o.scopeTier, o.scopeId).some((n) => n.tier === candidate.scopeTier && n.id === candidate.scopeId);
  });
  const orphaned = descendantRows.filter((o) => isLooser(termRank(policy, o.termValue), candidateRank));
  if (orphaned.length > 0) {
    throw new AdmissionRefused(
      `Setting "${candidate.termKey}" = ${JSON.stringify(candidate.termValue)} at ${candidate.scopeTier}:${candidate.scopeId} would make ` +
      `${orphaned.length} existing lower-tier row(s) looser than their parent: ` +
      orphaned.map((o) => `${o.scopeTier}:${o.scopeId} = ${JSON.stringify(o.termValue)} (row ${o.id})`).join("; ") +
      `. Those are terms a customer currently believes they have. Amend them first, or set this no tighter than the loosest.`,
      "would_orphan_descendants",
    );
  }
};
