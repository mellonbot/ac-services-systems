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
import type { CustomerSegment } from "./operations/wire/hierarchy.ts";

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

/**
 * What the office calls each account tier, by segment. The ladder is one
 * ladder; the words are not. A home is made by customers.createResidential as
 * region node named for the homeowner → location at the address → the house,
 * so the screens say exactly that — "Customer", "Address", "House" — and keep
 * "region node", "location" and "site" for commercial trees, where a customer
 * really does have regions, facilities and equipment groups.
 */
export const TIER_WORD: Readonly<Record<CustomerSegment, Readonly<Record<AccountTier, string>>>> = {
  commercial: { region: "Region node", location: "Location", site: "Site" },
  residential: { region: "Customer", location: "Address", site: "House" },
};

/** The tier word for a customer whose segment may be unknown (not visible, or not a customer) — commercial's words. */
export const tierWord = (tier: AccountTier, segment: CustomerSegment | null | undefined): string => TIER_WORD[segment ?? "commercial"][tier];
