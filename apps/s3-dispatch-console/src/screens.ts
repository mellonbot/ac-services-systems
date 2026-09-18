import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S3's SCREEN REGISTRY (09 §3.4, mirroring S2's). Two screens: the board a
 * dispatcher lands on, and the one gated door for a single job. Order does
 * not matter here — the two path prefixes ("board", "dispatch") never
 * overlap — but is kept specific-to-general anyway, matching every other
 * surface's registry.
 */
export const SCREENS = {
  "login":    { path: "/login",             uses: ["auth.login"] },
  "dispatch": { path: "/dispatch/:jobId",   uses: ["dispatch.candidates", "dispatch.assign", "jobs.list"] },
  "board":    { path: "/board",             uses: ["jobs.list", "dispatch.release"], title: "Board" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
