import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S2's SCREEN REGISTRY (09 §3.4). Screens are data: id → path pattern + the
 * operations the screen uses. The router is built from this; the navigation
 * is emitted from it; and `tools/ci/schema-guard.ts` §4d checks that every
 * operation named here exists in the catalogue and lists S2 in `surfaces`. A
 * screen written against an operation S2 may not call fails the build, not
 * the demo.
 *
 * Order matters: first declared match wins, so the specific routes come
 * before the ones whose optional trailing param would otherwise claim them —
 * `accounts.tree` after the `/accounts/...` forms, `contracts.list` after
 * `/contracts/:orgId/new`.
 */
export const SCREENS = {
  "login":             { path: "/login",                                 uses: ["auth.login"] },
  "organizations.new": { path: "/organizations/new",                     uses: ["organizations.create", "regions.list"], title: "New customer" },
  "accounts.new":      { path: "/accounts/:orgId/new/:tier/:parentId?",  uses: ["accounts.create", "regions.list", "accounts.list"] },
  "accounts.move":     { path: "/accounts/:orgId/move/:id",              uses: ["accounts.move", "accounts.list"] },
  "accounts.tree":     { path: "/accounts/:orgId?",                      uses: ["organizations.list", "accounts.list", "regions.list"], title: "Accounts" },
  "contracts.new":     { path: "/contracts/:orgId/new",                  uses: ["contracts.create", "contracts.list", "accounts.list", "regions.list"] },
  "terms.override":    { path: "/terms/:orgId/override",                 uses: ["terms.authorOverride", "terms.register", "terms.overrides.list", "contracts.list", "accounts.list"] },
  "terms.resolved":    { path: "/terms/:orgId/resolved/:nodeId?",        uses: ["terms.resolved", "terms.register", "accounts.list"] },
  "contracts.list":    { path: "/contracts/:orgId?",                     uses: ["organizations.list", "contracts.list", "contracts.transition", "accounts.list"], title: "Agreements" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
