import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S3's SCREEN REGISTRY (09 §3.4, mirroring S2's). The board a dispatcher
 * lands on, the job dashboard, and the one gated door for a single job. Order does
 * not matter here — the path prefixes ("board", "jobs", "job/") never
 * overlap — but is kept specific-to-general anyway, matching every other
 * surface's registry.
 */
export const SCREENS = {
  "login":    { path: "/login",             uses: ["auth.login"] },
  "dispatch": { path: "/job/:jobId",        uses: ["dispatch.candidates", "dispatch.assign", "jobs.list"] },
  "board":    { path: "/board",             uses: ["jobs.list", "dispatch.release"], title: "Board" },
  "jobs":     { path: "/jobs",              uses: ["jobs.list", "jobs.transition"], title: "Job Dashboard" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
