import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S8's SCREEN REGISTRY (09 §3.4). What a firm sees is decided by the gateway
 * — every screen here reads an operation whose rows RLS has already narrowed
 * to this principal's firm (0005 for the network tables, 0007 for the work,
 * the site and the money). The registry decides only which operations a
 * screen may name; the guard reads it and refuses a `uses` the catalogue does
 * not serve to S8.
 *
 * Five screens, one per sentence of the registry's degraded line: the firm
 * (its own row), the roster (its own crews), the documents (its own
 * compliance), the work (its own jobs), the statements (its own money).
 * D12's four writes live on three of them: enroll and retire on the roster,
 * submit on a crew's documents, acknowledge and dispute on a statement.
 *
 * Specific paths before general, so `/crews/<id>/documents` is never swallowed.
 */
export const SCREENS = {
  "login":      { path: "/login",                          uses: ["auth.login"] },
  "documents":  { path: "/crews/:crewId/documents",        uses: ["crews.list", "credentials.list", "credentials.submit"] },
  "crews":      { path: "/crews",                          uses: ["crews.list", "firms.list", "crews.enroll", "crews.retire"], title: "Crews" },
  "work":       { path: "/work",                           uses: ["jobs.list"], title: "Work" },
  "statement":  { path: "/statements/:settlementId",       uses: ["settlements.list", "settlements.lines", "settlements.acknowledge", "settlements.dispute"] },
  "statements": { path: "/statements",                     uses: ["settlements.list"], title: "Statements" },
  "firm":       { path: "/",                               uses: ["firms.list", "crews.list", "settlements.list", "jobs.list"], title: "Your firm" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
