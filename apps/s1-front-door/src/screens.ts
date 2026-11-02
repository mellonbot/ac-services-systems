import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S1's SCREEN REGISTRY (09 §3.4). One screen, and one operation.
 *
 * S1 is the front door: everyone signs in here and the gateway sends them to
 * the surface their login belongs to (`auth.signIn`). The guard reads this and
 * refuses a `uses` the catalogue does not serve to S1, so what the one page
 * with no session behind it may ask of the platform is settled here and
 * reviewed as a diff.
 *
 * Every other path on the site that no surface claims lands on S1's
 * not-found page (`missing`), which is not a screen: it has no route of its own.
 */
export const SCREENS = {
  "home": { path: "/", uses: ["auth.signIn"], title: "Sign in" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
