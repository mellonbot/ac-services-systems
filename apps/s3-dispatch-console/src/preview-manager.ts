import type { ManagerOverviewOutput } from "../../../packages/contracts/src/index.ts";

/**
 * Local preview only: what manager.overview would return, in the shape the
 * gateway sends, with the reference layout's figures — so the dashboard can
 * be looked at without a database. The team is the preview board's crews.
 */
const mondayWeeksBack = (n: number): string => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * n);
  return d.toISOString().slice(0, 10);
};
const DFW = "region-preview", HOU = "region-houston", OKC = "region-okc";

export const previewManagerOverview = (): ManagerOverviewOutput => ({
  asOf: new Date().toISOString(),
  ledgerSyncedAt: new Date().toISOString(),
  billed: [{ currency: "USD", minor: "18420000", priorMinor: "17380000" }],
  collected: [{ currency: "USD", minor: "13190000", priorMinor: "12650000" }],
  completed: { now: 142, prior: 133 },
  fixedFirstVisit: 124,
  waits: [
    { step: "request_to_scheduled", avgDays: 1.4, jobs: 151 },
    { step: "scheduled_to_on_site", avgDays: 2.3, jobs: 148 },
    { step: "on_site_to_finished", avgDays: 0.8, jobs: 142 },
    { step: "finished_to_invoiced", avgDays: 18.2, jobs: 60 },
    { step: "invoiced_to_paid", avgDays: 21.5, jobs: 54 },
  ],
  labor: { hours: 503, techs: 17 },
  unbilled: { complete: 5, needsPricing: 57, awaitingPo: 0, awaitingPictures: 0, invoiceTrouble: 20 },
  urgentUnassigned: [{ regionId: HOU, count: 2 }],
  credentials: { expired: 0, expiring: 3 },
  nearOvertime: 2,
  weeks: [31, 34, 29, 36, 38, 35, 40, 42].map((completed, i) => ({ weekStart: mondayWeeksBack(7 - i), completed, invoiced: [27, 28, 22, 25, 24, 21, 22, 19][i]! })),
  branches: [
    { regionId: DFW, name: "Dallas–Fort Worth", techs: 9, laborHours: 284, unbilled: 41 },
    { regionId: HOU, name: "Houston", techs: 5, laborHours: 142, unbilled: 29 },
    { regionId: OKC, name: "Oklahoma City", techs: 3, laborHours: 62, unbilled: 12 },
  ],
  team: [
    { userId: "u1", name: "Blake Keating", roles: ["foreman"], branch: "Dallas–Fort Worth", onJob: true, hoursThisWeek: 36, credential: "ok" },
    { userId: "u2", name: "Brian Martinez", roles: ["technician"], branch: "Dallas–Fort Worth", onJob: true, hoursThisWeek: 32, credential: "at_risk" },
    { userId: "u3", name: "Colton Dawson", roles: ["technician"], branch: "Dallas–Fort Worth", onJob: true, hoursThisWeek: 40.5, credential: "ok" },
    { userId: "u4", name: "Dylan Lemons", roles: ["principal"], branch: "Dallas–Fort Worth", onJob: false, hoursThisWeek: null, credential: null },
    { userId: "u5", name: "Garrett Howard", roles: ["ops_leadership"], branch: "Houston", onJob: false, hoursThisWeek: null, credential: null },
    { userId: "u6", name: "Herberto Vega", roles: ["technician"], branch: "Houston", onJob: true, hoursThisWeek: 41, credential: "ok" },
    { userId: "u7", name: "Johnny Fontez", roles: ["technician"], branch: "Houston", onJob: false, hoursThisWeek: 24, credential: "ok" },
    { userId: "u8", name: "Priya Nair", roles: ["finance"], branch: "Dallas–Fort Worth", onJob: false, hoursThisWeek: null, credential: null },
    { userId: "u9", name: "Rachel Ortiz", roles: ["dispatcher"], branch: "Dallas–Fort Worth", onJob: false, hoursThisWeek: null, credential: null },
  ],
});
