import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S4's screens. Two operations and a login — `SURFACES.S4.writes` is [] and
 * the catalogue serves S4 nothing that writes, so no screen here could name
 * one if it tried.
 */
export const SCREENS = {
  "login":    { path: "/login",              uses: ["auth.login"] },
  "area":     { path: "/area/:area",         uses: ["hq.metrics", "hq.history"] },
  "region":   { path: "/region/:regionId",   uses: ["hq.metrics"] },
  "overview": { path: "/",                   uses: ["hq.metrics"], title: "Company" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
