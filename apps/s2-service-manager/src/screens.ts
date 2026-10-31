import type { ScreenSpec } from "../../../packages/ui/src/index.ts";

/**
 * S2's SCREEN REGISTRY (09 §3.4). Screens are data: id → path pattern + the
 * operations the screen uses. The router is built from this; the navigation
 * is emitted from it; and `tools/ci/schema-guard.ts` §4d checks that every
 * operation named here exists in the catalogue and lists S2 in `surfaces`. A
 * screen written against an operation S2 may not call fails the build, not
 * the demo.
 *
 * Order matters: first declared match wins, so the specific routes come
 * before the ones whose optional trailing param would otherwise claim them —
 * `accounts.tree` after the `/accounts/...` forms, `contracts.list` after
 * `/contracts/:orgId/new`. A screen that is not itself a tab names that tab
 * with `nav`.
 */
export const SCREENS = {
  "login":             { path: "/login",                                 uses: ["auth.login"] },
  "organizations.new": { path: "/organizations/new",                     uses: ["organizations.create", "customers.createResidential", "regions.list"], title: "New customer", nav: "accounts.tree" },
  "leads":             { path: "/follow-ups",                            uses: ["leads.list", "leads.convert", "regions.list"], title: "Follow-ups" },
  "accounts.new":      { path: "/accounts/:orgId/new/:tier/:parentId?",  uses: ["accounts.create", "regions.list", "accounts.list"], nav: "accounts.tree" },
  "accounts.move":     { path: "/accounts/:orgId/move/:id",              uses: ["accounts.move", "accounts.list"], nav: "accounts.tree" },
  "accounts.tree":     { path: "/accounts/:orgId?",                      uses: ["organizations.list", "accounts.list", "regions.list", "contracts.list", "equipment.list", "jobs.list", "sites.mapTile", "sites.locate"], title: "Accounts" },
  "contracts.new":     { path: "/contracts/:orgId/new",                  uses: ["contracts.create", "contracts.list", "accounts.list", "regions.list"], nav: "contracts.list" },
  "terms.override":    { path: "/terms/:orgId/override",                 uses: ["terms.authorOverride", "terms.register", "terms.overrides.list", "contracts.list", "accounts.list"], nav: "contracts.list" },
  "terms.resolved":    { path: "/terms/:orgId/resolved/:nodeId?",        uses: ["terms.resolved", "terms.register", "accounts.list"], nav: "contracts.list" },
  // 0024 — what an install was sold under, and who sold it.
  "projects":          { path: "/projects/:orgId?",                      uses: ["organizations.list", "projects.list", "projects.create", "contracts.list"], title: "Projects" },
  "contracts.list":    { path: "/contracts/:orgId?",                     uses: ["organizations.list", "contracts.list", "contracts.transition", "accounts.list"], title: "Agreements" },
  "network.firm.new":  { path: "/network/firms/new",                     uses: ["firms.create", "regions.list"], nav: "network" },
  "network.crew.new":  { path: "/network/crews/new/:firmId?",            uses: ["crews.create", "firms.list", "regions.list"], nav: "network" },
  "network.crew.documents": { path: "/network/crews/:crewId/documents",  uses: ["credentials.list", "credentials.record", "credentials.verify", "crews.list"], nav: "network" },
  // 0020 — the roster. Before `network`, whose optional :firmId would otherwise claim "/network/technicians".
  "network.technician.new":  { path: "/network/technicians/new/:firmId?", uses: ["technicians.record", "crews.list", "firms.list", "regions.list"], nav: "network" },
  "network.technician.edit": { path: "/network/technicians/:technicianId", uses: ["technicians.list", "technicians.update", "crews.list", "firms.list", "regions.list"], nav: "network" },
  "network.rates":     { path: "/network/rates/:firmId",                 uses: ["rateCards.list", "rateCards.set", "firms.list"], nav: "network" },
  "network":           { path: "/network/:firmId?",                      uses: ["firms.list", "firms.update", "crews.list", "regions.list", "technicians.list"], title: "Technician Network" },
  // item 11: purchasing — the office's side of procurement (S7 is the vendor's).
  "purchasing.vendor": { path: "/purchasing/vendors/:vendorId",          uses: ["vendors.list", "catalog.list", "catalog.addItem", "prices.decide", "receivingPoints.list", "pos.create"], nav: "purchasing" },
  "purchasing.po":     { path: "/purchasing/pos/:poId",                  uses: ["pos.detail", "pos.issue", "pos.cancel", "receipts.record", "rmas.request"], nav: "purchasing" },
  // 0030: what was paid against each invoice. The invoice route before `billing`.
  "billing.invoice":   { path: "/invoicing/invoices/:invoiceId",          uses: ["invoices.list", "payments.list", "organizations.list"], nav: "billing" },
  // D-2a: the hardware S5 signs in with, and the shift grant that admits a technician to it. The forms before `devices`.
  "devices.new":       { path: "/devices/new",                           uses: ["devices.register", "regions.list", "firms.list"], nav: "devices" },
  "devices.grant":     { path: "/devices/grant/:deviceId?",              uses: ["devices.grantShift", "devices.list", "crews.list"], nav: "devices" },
  "devices":           { path: "/devices",                               uses: ["devices.list", "firms.list", "devices.listGrants", "devices.extendShift", "devices.revokeShift"], title: "Field devices" },
  // 0038: People — a principal's. The forms before `people.person`, whose :userId would otherwise claim "/people/new".
  "people.new":        { path: "/people/new/:kind?",                     uses: ["people.createStaff", "people.createTechnician", "regions.list", "firms.list"], nav: "people" },
  // 0039: Regions, inside People and a principal's too. Before `people.person`, whose :userId would claim "/people/regions".
  "people.region.new": { path: "/people/regions/new",                     uses: ["regions.create"], nav: "people" },
  "people.region":     { path: "/people/regions/:regionId",               uses: ["regions.list", "regions.update", "regions.setActive"], nav: "people" },
  "people.person":     { path: "/people/:userId",                        uses: ["people.list", "people.update", "people.setActive", "people.resetPassword", "regions.list"], nav: "people" },
  "people":            { path: "/people",                                uses: ["people.list", "regions.list"], title: "People" },
  "billing":           { path: "/invoicing",                             uses: ["invoices.list", "organizations.list"], title: "Invoicing" },
  "purchasing":        { path: "/purchasing",                            uses: ["pos.list", "vendors.list", "vendors.create", "receivingPoints.list", "receivingPoints.create", "regions.list"], title: "Purchasing" },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;
