import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S3's SCREEN REGISTRY (09 §3.4, mirroring S2's). The board a dispatcher
 * lands on, the job dashboard, one job's detail (and the pick list the tab
 * opens when no job is chosen), and the one gated door for a single job.
 * Kept specific-to-general: "/jobs/:jobId" is listed before "/jobs", and
 * "/job/:jobId" (the gated door) is a different first segment entirely.
 */
export const SCREENS = {
  "login":    { path: "/login",             uses: ["auth.login"] },
  "dispatch": { path: "/job/:jobId",        uses: ["dispatch.candidates", "dispatch.assign", "jobs.list"] },
  "detail":   { path: "/jobs/:jobId",       uses: ["jobs.detail", "jobs.addNote", "jobs.saveUpdate", "jobs.publishUpdate", "jobs.postMessage"] },
  "board":    { path: "/board",             uses: ["jobs.list", "dispatch.release"], title: "Board" },
  "jobs":     { path: "/jobs",              uses: ["jobs.list", "jobs.transition", "jobs.addNote", "jobs.setReturnTrip"], title: "Job Dashboard" },
  "pick":     { path: "/detail",            uses: ["jobs.list"], title: "Job Detail" },
  "intake":   { path: "/intake",            uses: ["serviceRequests.list", "media.get"], title: "Intake" },
  "manager":  { path: "/manager",           uses: ["manager.overview"], title: "Manager" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
