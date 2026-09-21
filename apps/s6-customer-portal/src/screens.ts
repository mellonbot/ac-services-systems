import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S6's SCREEN REGISTRY (09 §3.4). What a customer sees is decided by the
 * gateway — every screen here reads an operation whose rows RLS has already
 * narrowed to this principal's org and scope node (migration 0006). The
 * registry decides only which operations a screen may name; the guard reads
 * it and refuses a `uses` the catalogue does not serve to S6.
 *
 * Phase 1 scopes per the scope-cut ladder (04 §0 item 5): the facility
 * manager (a location) and the parent read-only (the org). The mechanism is
 * the same for a region-scoped principal; only the screens' prose assumes
 * the two.
 *
 * Specific paths before general, so `/terms/site/<id>` is never swallowed.
 */
export const SCREENS = {
  "login":      { path: "/login",                  uses: ["auth.login"] },
  "terms":      { path: "/terms/:tier/:nodeId/:asOf?", uses: ["terms.resolved", "terms.register", "accounts.list"] },
  "request":    { path: "/request/:siteId?",       uses: ["accounts.list", "serviceRequests.create", "serviceRequests.list"] },
  // item 9: the site card — what a site IS. Seven reads; the rows are 0009's.
  "site":       { path: "/site/:siteId",           uses: ["accounts.list", "equipment.list", "contacts.list", "invoices.list", "jobs.list", "serviceRequests.list", "sites.imagery"], title: "Site" },
  "work":       { path: "/work",                   uses: ["jobs.list", "accounts.list", "serviceRequests.list"], title: "Work" },
  "agreements": { path: "/agreements",             uses: ["contracts.list", "accounts.list"], title: "Agreements" },
  "sites":      { path: "/",                       uses: ["accounts.list", "jobs.list", "serviceRequests.list"], title: "Sites" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
