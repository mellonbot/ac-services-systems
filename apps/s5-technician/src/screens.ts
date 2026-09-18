import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S5's SCREEN REGISTRY. "login" here is a route placeholder the way S2's and
 * S3's are — its actual form lives in app.ts's own loginView, because a
 * device login collects three fields (hardwareId, email, password), not the
 * two `auth.login` takes, and is a different operation entirely
 * (`auth.deviceLogin`, surfaces: ["S5"] only).
 */
export const SCREENS = {
  "login": { path: "/login",           uses: ["auth.deviceLogin"] },
  "job":   { path: "/jobs/:jobId",     uses: ["jobs.mine", "sync.replay"] },
  "jobs":  { path: "/jobs",            uses: ["jobs.mine"], title: "My jobs" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
