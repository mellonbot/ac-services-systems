import type { Tier } from "./tiers.ts";
import type { Principal } from "./scope.ts";

/**
 * HIERARCHY CONTEXT — the shape the gateway resolves at login and every
 * surface reads from. Web-arch S0: "hierarchy context resolved at login: the
 * principal's scope path, the parent, the visible region nodes, supplied by
 * the gateway."
 *
 * Lives in contracts, not in the gateway, because both ends of the wire name
 * it: the gateway builds it (apps/gateway/src/context.ts) and the shell hands
 * it to surfaces. A shell that imported the gateway's type would be a shell
 * with a dependency pointing the wrong way.
 */
export type ScopeNode = { readonly tier: Tier; readonly id: string; readonly name?: string };

/** The ancestor chain of a node, broadest first, ending at the node. */
export type ScopePath = readonly ScopeNode[];

export type HierarchyNode = {
  readonly tier: Tier;
  readonly id: string;
  readonly name: string;
  readonly regionId: string | null;
  /** The customer's own grouping. An attribute, never structure — finding 5. */
  readonly customerGroup: string | null;
};

export type HierarchyContext = {
  readonly principal: Principal;
  readonly path: ScopePath;
  /** The organization at the top of the tree. */
  readonly parent: HierarchyNode;
  /** Region nodes visible to this principal — all for org scope, one otherwise. */
  readonly regions: readonly HierarchyNode[];
  readonly activeRegionId: string;
};
