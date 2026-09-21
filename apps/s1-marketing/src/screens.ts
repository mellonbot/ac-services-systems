import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S1's SCREEN REGISTRY (09 §3.4). Three screens, and the shortest `uses` list
 * in the repository — which is the point of the file rather than an accident
 * of how early it is.
 *
 * The guard reads this and refuses a `uses` the catalogue does not serve to
 * S1, so what a marketing page is allowed to ask the platform for is settled
 * here and reviewed as a diff. The catalogue serves S1 exactly one query, and
 * it returns metro names.
 *
 * WHAT IS NOT IN THIS FILE, deliberately:
 *   - no `login`. Every other surface's registry opens with one; S1 has no
 *     principal to be. The portal's sign-in lives on the portal's domain
 *     (05 §S1) and a customer-login form on the marketing site would be a
 *     credential field on the one page with no session behind it.
 *   - no screen that reads a lead back. There is no operation for it, and the
 *     reason is in migration 0008's header.
 */
export const SCREENS = {
  "enquire":  { path: "/enquire",  uses: ["coverage.list", "leads.submit", "callRecords.record"], title: "Ask us to call" },
  "coverage": { path: "/coverage", uses: ["coverage.list"], title: "Where we work" },
  "home":     { path: "/",         uses: ["coverage.list"], title: "Rankine Operating Company" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
