/**
 * THE TIER LADDER — D2, closed in three parts (see docs/BACKBONE_CONTRACT.md §2).
 *
 * One constant. The resolver, the scope model, the term register and the
 * hierarchy trigger in migrations/0002 all derive from it.
 *
 *   parent    the customer organisation — a row in `organizations`, ABOVE the
 *             region boundary, because a parent spans our regions by definition
 *   region    OUR service region, bound to a `regions` row. The shard key
 *             derives from this edge and from nothing else (finding 5)
 *   location  a customer facility, dispatched from exactly one of our regions
 *   site      equipment group inside a location — where vendor terms attach
 *
 * The customer's own administrative grouping ("Mountain", "Northeast", their
 * org chart) is NOT a tier. It is `accounts.customer_group`, a plain attribute
 * on the location. See tables/hierarchy.ts.
 */
export const TIERS = ["parent", "region", "location", "site"] as const;
export type Tier = (typeof TIERS)[number];

/** Index of a tier — lower is broader. */
export const tierRank = (t: Tier): number => TIERS.indexOf(t);

export const isNarrower = (a: Tier, b: Tier): boolean => tierRank(a) > tierRank(b);

/** Tiers that live in `accounts` (everything below the parent). */
export const ACCOUNT_TIERS = ["region", "location", "site"] as const;
export type AccountTier = (typeof ACCOUNT_TIERS)[number];

/** The tier each account-tree node's parent must have. `region` hangs off the organization. */
export const PARENT_TIER_OF: Readonly<Record<AccountTier, Tier>> = {
  region: "parent",
  location: "region",
  site: "location",
};
