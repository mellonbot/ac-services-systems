/**
 * The tier ladder. ONE constant — master plan D2 is still open, and this is
 * the single place it lands. The resolver and the scope model derive from it.
 *
 * D2 must close BEFORE schema freeze (M1/B2). The frame cannot protect against
 * changing the ladder after freeze; see 06_Software_Architecture_Frame §8.
 */
export const TIERS = ["parent", "region", "location", "asset"] as const;
export type Tier = (typeof TIERS)[number];

/** Index of a tier — lower is broader. Used for override precedence. */
export const tierRank = (t: Tier): number => TIERS.indexOf(t);

/** Contract terms resolve most-specific-wins. Ambiguity throws; it never ties. */
export const isNarrower = (a: Tier, b: Tier): boolean => tierRank(a) > tierRank(b);
