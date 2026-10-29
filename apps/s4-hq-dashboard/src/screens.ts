import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S4's screens. The rollup, plus S2's and S3's reads — `SURFACES.S4.writes`
 * is [] and the catalogue serves S4 nothing that writes, so no screen here
 * could name one if it tried. Specific routes before their general form.
 */
export const SCREENS = {
  "login":    { path: "/login",              uses: ["auth.login"] },
  // Office — Service Manager's records, read only.
  "office.customer":  { path: "/office/customers/:orgId",   uses: ["organizations.list", "accounts.list", "contracts.list", "projects.list", "regions.list"] },
  "office.customers": { path: "/office/customers",          uses: ["organizations.list"], title: "Customers" },
  "office.leads":     { path: "/office/leads",              uses: ["leads.list"], title: "Leads" },
  "office.projects":  { path: "/office/projects",           uses: ["projects.list"], title: "Projects" },
  "office.network":   { path: "/office/network",            uses: ["firms.list", "crews.list", "technicians.list", "regions.list"], title: "Technician network" },
  "office.po":        { path: "/office/purchasing/:poId",   uses: ["pos.detail"] },
  "office.purchasing":{ path: "/office/purchasing",         uses: ["pos.list", "vendors.list", "regions.list"], title: "Purchasing" },
  "office.invoice":   { path: "/office/billing/:invoiceId", uses: ["invoices.list", "payments.list"] },
  "office.billing":   { path: "/office/billing",            uses: ["invoices.list", "organizations.list"], title: "Billing" },
  "office.devices":   { path: "/office/devices",            uses: ["devices.list", "regions.list"], title: "Field devices" },
  // Dispatch — the Dispatch Console's views across every region, read only.
  "dispatch.job":     { path: "/dispatch/jobs/:jobId",      uses: ["jobs.detail", "regions.list"] },
  "dispatch.jobs":    { path: "/dispatch/jobs",             uses: ["jobs.list", "regions.list"], title: "All jobs" },
  "dispatch.intake":  { path: "/dispatch/intake",           uses: ["serviceRequests.list", "regions.list"], title: "Intake" },
  "dispatch.manager": { path: "/dispatch/manager",          uses: ["manager.overview"], title: "Manager" },
  "dispatch.board":   { path: "/dispatch",                  uses: ["jobs.list", "regions.list"], title: "Dispatch board" },
  "area":     { path: "/area/:area",         uses: ["hq.metrics", "hq.history"] },
  "region":   { path: "/region/:regionId",   uses: ["hq.metrics"] },
  "overview": { path: "/",                   uses: ["hq.metrics"], title: "Company" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
