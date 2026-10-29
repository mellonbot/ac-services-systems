/**
 * Demo stand-in state: seeded rows, the visibility imitation, and event fan-out.
 * Handlers mutate these rows. This module imports no handler, so publish can
 * call eventFor in the same file without a cycle.
 */
import {
  WORK_DONE_STATES,
  mayReadTechnicianAddress,
} from "../../packages/contracts/src/operations.ts";
import type * as W from "../../packages/contracts/src/operations.ts";
import {
  invoiceStatusOf,
} from "../../packages/contracts/src/operations.ts";
import {
  type SurfaceId,
} from "../../packages/contracts/src/surfaces.ts";
import {
  type Principal,
} from "../../packages/contracts/src/scope.ts";
import {
  type EventEnvelope,
  type Topic,
} from "../../packages/contracts/src/events.ts";
import {
  type Tier,
} from "../../packages/contracts/src/tiers.ts";
import {
  type Override,
  type ScopePath,
} from "../../packages/domain/src/inheritance/resolve.ts";
import {
  REQUIRED,
} from "../../packages/domain/src/compliance/gate.ts";
import {
  type HierarchyReader,
} from "../../apps/gateway/src/context.ts";
import {
  INTERNAL_ORG_ID,
  UNASSIGNED_REGION_ID,
} from "../../packages/schema/src/tenancy.ts";
import {
  HQ_METRICS,
  type HqMetricKey,
} from "../../packages/contracts/src/hq.ts";
import {
  ORG as AMPED,
  REGION_WEST,
  REGION_MOUNTAIN,
  REGION_SOUTH,
  N,
  MSA,
  AMEND_SJ,
  AMEND_AUSTIN_JULY,
  BOULDER_WARRANTY,
  OVERRIDES,
} from "../../packages/domain/src/inheritance/fixtures/amped.ts";

// ---------------------------------------------------------------------------
// Time. Everything is seeded relative to the moment the page loads, so SLA
// clocks, expiries and statement periods read as live.
// ---------------------------------------------------------------------------
export const NOW = Date.now();
export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const at = (ms: number) => new Date(NOW + ms).toISOString();
export const day = (days: number) => new Date(NOW + days * DAY).toISOString().slice(0, 10);
export const today = () => new Date().toISOString().slice(0, 10);
export let seq = 0;
export const uid = (prefix: string) => `${prefix}${(++seq).toString(16).padStart(8, "0")}-demo-4000-8000-${Date.now().toString(16).slice(-12).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Refusals, shaped as the real gateway's describe() shapes them.
// ---------------------------------------------------------------------------
export class Refused extends Error {
  readonly status: number; readonly name2: string; readonly code: string | undefined;
  constructor(status: number, name2: string, message: string, code?: string) { super(message); this.status = status; this.name2 = name2; this.code = code; }
}
export const input422 = (message: string, code: string) => new Refused(422, "InputRefused", message, code);

// ---------------------------------------------------------------------------
// Seed — Rankine's own tree, Amped Fitness (the fixture the D2 findings were
// found against), a second customer, two subcontractor firms, the crews, the
// work, and the money.
// ---------------------------------------------------------------------------
/** The demo's rows are mutable; the wire types they are shaped from are not. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type Region = W.RegionWire;
export type Org = { id: string; name: string; kind: "customer" | "subcontractor" | "internal" | "vendor"; externalRef: string | null; active: boolean; createdAt?: string };
export type Account = { id: string; orgId: string; tier: W.AccountTierWire; name: string; parentId: string | null; regionId: string; customerGroup: string | null; externalRef: string | null; timezone: string | null; active: boolean; address: W.AddressWire | null };
export type Firm = Mutable<Omit<W.FirmWire, "crewCount" | "activeCrewCount">>;
export type Crew = Mutable<Omit<W.CrewWire, "documents">>;
export type Credential = Mutable<W.CredentialWire>;
export type Job = { id: string; siteId: string; orgId: string; regionId: string; contractId: string | null; serviceCode: string; priority: W.JobPriority; state: W.JobStateWire; serviceWindowStart: string; serviceWindowEnd: string; version: number; openedAt: string; stateChangedAt: string; slaDueAt: string | null; slaEscalationStage: number | null; slaSatisfiedAt: string | null; equipmentIds: string[]; returnTrip: boolean; notes: W.JobNoteWire[]; updates: Mutable<W.JobUpdateWire>[]; messages: W.JobMessageWire[] };
export type Assignment = { id: string; jobId: string; crewId: string; assignedAt: string; releasedAt: string | null };
export type Settlement = Mutable<Omit<W.SettlementWire, "lineCount">>;
export type User = { id: string; email: string; password: string; name: string; principal: Omit<Principal, "sessionId">; surfaces: SurfaceId[]; crewId?: string };

export const REGIONS: Region[] = [
  { id: REGION_WEST, code: "WEST", name: "West", timezone: "America/Los_Angeles", minCrewDensity: 2, active: true },
  { id: REGION_MOUNTAIN, code: "MOUNTAIN", name: "Mountain", timezone: "America/Denver", minCrewDensity: 1, active: true },
  { id: REGION_SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 3, active: true },
];

export const CEDAR = "b0000000-0000-0000-0000-000000000001";
export const FIRM_A = "f0000000-0000-0000-0000-00000000000a";
export const FIRM_B = "f0000000-0000-0000-0000-00000000000b";
export const FIRM_C = "f0000000-0000-0000-0000-00000000000c";

export const orgs: Org[] = [
  { id: INTERNAL_ORG_ID, name: "Rankine Operating Company", kind: "internal", externalRef: null, active: true },
  { id: AMPED, name: "Amped Fitness Inc.", kind: "customer", externalRef: "AMP-MSA-2026", active: true },
  { id: CEDAR, name: "Cedar Lane Clinics", kind: "customer", externalRef: "CLC-0042", active: true },
  { id: FIRM_A, name: "Lone Star Mechanical LLC", kind: "subcontractor", externalRef: null, active: true },
  { id: FIRM_B, name: "Gulf Coast Air Partners", kind: "subcontractor", externalRef: null, active: true },
  { id: FIRM_C, name: "Front Range Refrigeration Co.", kind: "subcontractor", externalRef: null, active: true },
];

export const S = {
  renoRoof: "a0000000-0000-0000-0000-000000000033",
  elPasoFloor: "a0000000-0000-0000-0000-000000000034",
  austinRoof: "a0000000-0000-0000-0000-000000000035",
  austinPool: "a0000000-0000-0000-0000-000000000036",
  cedarSouth: "b0000000-0000-0000-0000-000000000010",
  cedarHouston: "b0000000-0000-0000-0000-000000000020",
  cedarHoustonMain: "b0000000-0000-0000-0000-000000000030",
} as const;

export const addr = (line1: string, city: string, state: string, postal: string, lat?: number, lng?: number): W.AddressWire =>
  ({ line1, city, state, postal, country: "US", ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}) });

export const accounts: Account[] = [
  { id: N.west, orgId: AMPED, tier: "region", name: "Amped / West", parentId: null, regionId: REGION_WEST, customerGroup: null, externalRef: null, timezone: "America/Los_Angeles", active: true, address: null },
  { id: N.mountain, orgId: AMPED, tier: "region", name: "Amped / Mountain", parentId: null, regionId: REGION_MOUNTAIN, customerGroup: null, externalRef: null, timezone: "America/Denver", active: true, address: null },
  { id: N.south, orgId: AMPED, tier: "region", name: "Amped / South", parentId: null, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: "America/Chicago", active: true, address: null },
  { id: N.sanJose, orgId: AMPED, tier: "location", name: "Amped San Jose", parentId: N.west, regionId: REGION_WEST, customerGroup: "Pacific", externalRef: "AMP-117", timezone: "America/Los_Angeles", active: true, address: addr("1840 Coleman Ave", "San Jose", "CA", "95110") },
  { id: N.reno, orgId: AMPED, tier: "location", name: "Amped Reno", parentId: N.west, regionId: REGION_WEST, customerGroup: "Pacific", externalRef: "AMP-121", timezone: "America/Los_Angeles", active: true, address: addr("6770 S McCarran Blvd", "Reno", "NV", "89509") },
  { id: N.boulder, orgId: AMPED, tier: "location", name: "Amped Boulder", parentId: N.mountain, regionId: REGION_MOUNTAIN, customerGroup: "Mountain", externalRef: "AMP-204", timezone: "America/Denver", active: true, address: addr("2525 Arapahoe Ave", "Boulder", "CO", "80302") },
  { id: N.elPaso, orgId: AMPED, tier: "location", name: "Amped El Paso", parentId: N.south, regionId: REGION_SOUTH, customerGroup: "Mountain", externalRef: "AMP-310", timezone: "America/Denver", active: true, address: addr("7500 N Mesa St", "El Paso", "TX", "79912") },
  { id: N.austin, orgId: AMPED, tier: "location", name: "Amped Austin", parentId: N.south, regionId: REGION_SOUTH, customerGroup: "Texas", externalRef: "AMP-322", timezone: "America/Chicago", active: true, address: addr("4001 S Lamar Blvd", "Austin", "TX", "78704") },
  { id: N.sanJoseRoof, orgId: AMPED, tier: "site", name: "San Jose — Roof Units", parentId: N.sanJose, regionId: REGION_WEST, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("1840 Coleman Ave", "San Jose", "CA", "95110", 37.3496, -121.9254) },
  { id: S.renoRoof, orgId: AMPED, tier: "site", name: "Reno — Rooftop", parentId: N.reno, regionId: REGION_WEST, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("6770 S McCarran Blvd", "Reno", "NV", "89509") },
  { id: N.boulderRoof, orgId: AMPED, tier: "site", name: "Boulder — Roof Units", parentId: N.boulder, regionId: REGION_MOUNTAIN, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("2525 Arapahoe Ave", "Boulder", "CO", "80302", 40.0149, -105.2626) },
  { id: N.boulderAhu, orgId: AMPED, tier: "site", name: "Boulder — Basement AHU", parentId: N.boulder, regionId: REGION_MOUNTAIN, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("2525 Arapahoe Ave", "Boulder", "CO", "80302") },
  { id: S.elPasoFloor, orgId: AMPED, tier: "site", name: "El Paso — Main Floor", parentId: N.elPaso, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("7500 N Mesa St", "El Paso", "TX", "79912") },
  { id: S.austinRoof, orgId: AMPED, tier: "site", name: "Austin — Rooftop RTUs", parentId: N.austin, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("4001 S Lamar Blvd", "Austin", "TX", "78704", 30.2396, -97.7866) },
  { id: S.austinPool, orgId: AMPED, tier: "site", name: "Austin — Pool Hall Dehumidifier", parentId: N.austin, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("4001 S Lamar Blvd", "Austin", "TX", "78704") },
  { id: S.cedarSouth, orgId: CEDAR, tier: "region", name: "Cedar Lane / South", parentId: null, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: "America/Chicago", active: true, address: null },
  { id: S.cedarHouston, orgId: CEDAR, tier: "location", name: "Cedar Lane Houston", parentId: S.cedarSouth, regionId: REGION_SOUTH, customerGroup: null, externalRef: "CLC-H1", timezone: "America/Chicago", active: true, address: addr("2100 W Loop S", "Houston", "TX", "77027") },
  { id: S.cedarHoustonMain, orgId: CEDAR, tier: "site", name: "Houston — Clinic Main", parentId: S.cedarHouston, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("2100 W Loop S", "Houston", "TX", "77027") },
];

export const CEDAR_MSA = "c0000000-0000-0000-0000-000000000020";
export const contracts: (Mutable<W.ContractWire> & { orgId: string })[] = [
  { id: MSA, orgId: AMPED, scopeTier: "parent", scopeId: AMPED, kind: "msa", parentContractId: null, billingPath: "enterprise_sla", regionId: REGION_SOUTH, signedAt: "2025-12-12", effectiveFrom: "2026-01-01", effectiveTo: "2028-12-31", diagnosticDataRightsReserved: true, documentKey: "contracts/amped/msa-2026.pdf", state: "active" },
  { id: AMEND_SJ, orgId: AMPED, scopeTier: "location", scopeId: N.sanJose, kind: "amendment", parentContractId: MSA, billingPath: "enterprise_sla", regionId: REGION_WEST, signedAt: "2026-02-20", effectiveFrom: "2026-03-01", effectiveTo: null, diagnosticDataRightsReserved: true, documentKey: "contracts/amped/amend-sj-4h.pdf", state: "active" },
  { id: AMEND_AUSTIN_JULY, orgId: AMPED, scopeTier: "location", scopeId: N.austin, kind: "amendment", parentContractId: MSA, billingPath: "enterprise_sla", regionId: REGION_SOUTH, signedAt: "2026-06-10", effectiveFrom: "2026-07-01", effectiveTo: null, diagnosticDataRightsReserved: true, documentKey: null, state: "active" },
  { id: BOULDER_WARRANTY, orgId: AMPED, scopeTier: "site", scopeId: N.boulderRoof, kind: "location_agreement", parentContractId: null, billingPath: "enterprise_sla", regionId: REGION_MOUNTAIN, signedAt: "2026-02-10", effectiveFrom: "2026-02-15", effectiveTo: null, diagnosticDataRightsReserved: false, documentKey: "contracts/amped/boulder-carrier-warranty.pdf", state: "active" },
  { id: CEDAR_MSA, orgId: CEDAR, scopeTier: "parent", scopeId: CEDAR, kind: "msa", parentContractId: null, billingPath: "enterprise_sla", regionId: REGION_SOUTH, signedAt: "2026-04-02", effectiveFrom: "2026-05-01", effectiveTo: null, diagnosticDataRightsReserved: false, documentKey: null, state: "active" },
];
/** 0024: what an install was sold under, and the foreman who sold it. Fictional people. */
export const foremen: W.ForemanWire[] = [{ id: "u0000000-0000-0000-0000-0000000000f1", name: "Blake Keating" }];
export const projects: Mutable<W.ProjectWire>[] = [
  { id: "p0000000-0000-0000-0000-000000000001", orgId: AMPED, regionId: REGION_SOUTH, contractId: MSA, customer: "Amped", name: "Austin roof — RTU changeout",
    foremanId: foremen[0]!.id, foremanName: foremen[0]!.name, serviceWindowStart: "2026-11-02T13:00:00.000Z", serviceWindowEnd: "2026-11-07T05:00:00.000Z", state: "planned", installJobs: 0 },
];
export const overrides: (Override & { orgId: string; regionId: string })[] = [
  ...OVERRIDES.map((o) => ({ ...o, orgId: AMPED, regionId: REGION_SOUTH })),
  { id: "o-100", contractId: CEDAR_MSA, scopeTier: "parent", scopeId: CEDAR, termKey: "sla_response", termValue: "next_day", effectiveFrom: "2026-05-01", effectiveTo: null, orgId: CEDAR, regionId: REGION_SOUTH },
  { id: "o-101", contractId: CEDAR_MSA, scopeTier: "parent", scopeId: CEDAR, termKey: "payment_terms_days", termValue: 30, effectiveFrom: "2026-05-01", effectiveTo: null, orgId: CEDAR, regionId: REGION_SOUTH },
];

export const firms: Firm[] = [
  { id: FIRM_A, legalName: "Lone Star Mechanical LLC", status: "active", regionId: REGION_SOUTH, settlementTermsDays: 30, msaSignedAt: "2026-03-02", diagnosticDataRightsReserved: true, w9DocumentKey: "network/lonestar/w9.pdf" },
  { id: FIRM_B, legalName: "Gulf Coast Air Partners", status: "active", regionId: REGION_SOUTH, settlementTermsDays: 45, msaSignedAt: "2026-05-18", diagnosticDataRightsReserved: false, w9DocumentKey: "network/gulfcoast/w9.pdf" },
  { id: FIRM_C, legalName: "Front Range Refrigeration Co.", status: "onboarding", regionId: REGION_MOUNTAIN, settlementTermsDays: 30, msaSignedAt: null, diagnosticDataRightsReserved: true, w9DocumentKey: null },
];

export const C = {
  south1: "e0000000-0000-0000-0000-000000000001",
  south2: "e0000000-0000-0000-0000-000000000002",
  west1: "e0000000-0000-0000-0000-000000000003",
  mountain1: "e0000000-0000-0000-0000-000000000004",
  lsA: "e0000000-0000-0000-0000-0000000000a1",
  lsB: "e0000000-0000-0000-0000-0000000000a2",
  gc1: "e0000000-0000-0000-0000-0000000000b1",
  fr1: "e0000000-0000-0000-0000-0000000000c1",
  southInstall1: "e0000000-0000-0000-0000-000000000005",
} as const;
export const crews: Crew[] = [
  { id: C.south1, label: "South Crew 1", employmentType: "employed", kind: "service", firmId: null, homeRegionId: REGION_SOUTH, active: true },
  { id: C.south2, label: "South Crew 2", employmentType: "employed", kind: "service", firmId: null, homeRegionId: REGION_SOUTH, active: true },
  { id: C.west1, label: "West Crew 1", employmentType: "employed", kind: "service", firmId: null, homeRegionId: REGION_WEST, active: true },
  { id: C.mountain1, label: "Mountain Crew 1", employmentType: "employed", kind: "service", firmId: null, homeRegionId: REGION_MOUNTAIN, active: true },
  { id: C.lsA, label: "Lone Star — Crew A", employmentType: "subcontracted", kind: "service", firmId: FIRM_A, homeRegionId: REGION_SOUTH, active: true },
  { id: C.lsB, label: "Lone Star — Crew B", employmentType: "subcontracted", kind: "service", firmId: FIRM_A, homeRegionId: REGION_SOUTH, active: true },
  { id: C.gc1, label: "Gulf Coast — Crew 1", employmentType: "subcontracted", kind: "service", firmId: FIRM_B, homeRegionId: REGION_SOUTH, active: true },
  { id: C.fr1, label: "Front Range — Crew 1", employmentType: "subcontracted", kind: "service", firmId: FIRM_C, homeRegionId: REGION_MOUNTAIN, active: true },
  // 0024: installers only. A technician is never on one.
  { id: C.southInstall1, label: "South Install 1", employmentType: "employed", kind: "install", firmId: null, homeRegionId: REGION_SOUTH, active: true },
];

/** 0020 — the roster. Fictional people; 555 numbers. The address is served to account owners and principals only, as the gateway does. */
export type Tech = Omit<W.TechnicianWire, "addressRestricted">;
export const tech = (name: string, firmId: string | null, crewId: string, phone: string, line1: string, city: string, postal: string, specialties: W.TechnicianSpecialty[], role: W.TechnicianRole = "technician"): Tech =>
  ({ id: uid("t"), firmId, crewId, name, phone, homeAddress: { line1, city, state: "TX", postal }, role, specialties, homeRegionId: REGION_SOUTH, active: true });
export const technicians: Tech[] = [
  tech("Marcus Bell", null, C.south1, "(214) 555-0110", "1208 Peavy Rd", "Dallas", "75228", ["commercial_rtu", "controls_bas"]),
  tech("Ana Reyes", null, C.southInstall1, "(214) 555-0111", "3412 Oates Dr", "Mesquite", "75150", ["residential_hvac"], "lead_installer"),
  tech("Jordan Pike", null, C.south2, "(972) 555-0112", "77 Brookhaven Ct", "Garland", "75043", ["refrigeration", "chillers_boilers"]),
  tech("Luis Ortega", FIRM_A, C.lsA, "(817) 555-0120", "905 Hemphill St", "Fort Worth", "76104", ["commercial_rtu", "refrigeration"]),
  tech("Kim Tran", FIRM_A, C.lsB, "(817) 555-0121", "2210 Bowen Rd", "Arlington", "76013", ["light_commercial", "residential_hvac"]),
  tech("Dee Alvarez", FIRM_B, C.gc1, "(469) 555-0130", "618 Sunnyvale St", "Irving", "75061", ["refrigeration"]),
];
export const techWire = (t: Tech, p: Principal): W.TechnicianWire => {
  const sees = mayReadTechnicianAddress(p.roles);
  return { ...t, homeAddress: sees ? t.homeAddress : null, addressRestricted: !sees };
};

export const verifiedBy = "u0000000-0000-0000-0000-000000000001";
export const cred = (crewId: string, kind: W.CredentialKind, identifier: string, from: number, to: number, verified: boolean): Credential =>
  ({ id: uid("d"), crewId, kind, identifier, validFrom: day(from), validTo: day(to), documentKey: `network/docs/${identifier.toLowerCase()}.pdf`, verifiedAt: verified ? at(from * DAY + 2 * DAY) : null, verifiedBy: verified ? verifiedBy : null });
export const credentials: Credential[] = [
  cred(C.south1, "license", "TX-ACR-88213", -300, 400, true), cred(C.south1, "background_check", "BG-S1-2026", -200, 165, true),
  cred(C.south2, "license", "TX-ACR-90177", -250, 420, true), cred(C.south2, "background_check", "BG-S2-2026", -180, 185, true),
  cred(C.west1, "license", "CA-C20-771402", -400, 300, true), cred(C.west1, "background_check", "BG-W1-2026", -100, 265, true),
  cred(C.mountain1, "license", "CO-HVAC-5521", -320, 11, true), cred(C.mountain1, "background_check", "BG-M1-2026", -90, 275, true),
  // Lone Star Crew A: fully cleared.
  cred(C.lsA, "insurance", "TXL-GL-440921", -120, 245, true), cred(C.lsA, "license", "TX-ACR-61550", -500, 230, true), cred(C.lsA, "background_check", "BG-LSA-2026", -60, 305, true),
  // Lone Star Crew B: insurance filed through S8 and not yet verified — the gate refuses it.
  cred(C.lsB, "insurance", "TXL-GL-440977", -3, 362, false), cred(C.lsB, "license", "TX-ACR-61602", -410, 320, true), cred(C.lsB, "background_check", "BG-LSB-2026", -40, 325, true),
  // Gulf Coast Crew 1: insurance lapses tonight — cleared for today's work, refused for tomorrow's.
  cred(C.gc1, "insurance", "GC-GL-2025-118", -360, 0, true), cred(C.gc1, "license", "TX-ACR-70331", -200, 500, true), cred(C.gc1, "background_check", "BG-GC1-2026", -30, 335, true),
  // Front Range: onboarding, license only.
  cred(C.fr1, "license", "CO-HVAC-7788", -20, 700, false),
];

export const rateCards: Mutable<W.RateCardWire>[] = [
  { id: uid("r"), firmId: FIRM_A, serviceCode: "PM-VISIT", rateMinor: "18500", currency: "USD", effectiveFrom: "2026-03-01", effectiveTo: "2026-08-01", emergencyMultiplier: "1.5", emergencyRateMinor: "27750" },
  { id: uid("r"), firmId: FIRM_A, serviceCode: "PM-VISIT", rateMinor: "19500", currency: "USD", effectiveFrom: "2026-08-01", effectiveTo: null, emergencyMultiplier: "1.5", emergencyRateMinor: "29250" },
  { id: uid("r"), firmId: FIRM_A, serviceCode: "HVAC-REPAIR", rateMinor: "12500", currency: "USD", effectiveFrom: "2026-03-01", effectiveTo: null, emergencyMultiplier: "1.5", emergencyRateMinor: "18750" },
  { id: uid("r"), firmId: FIRM_B, serviceCode: "PM-VISIT", rateMinor: "17200", currency: "USD", effectiveFrom: "2026-05-20", effectiveTo: null, emergencyMultiplier: "1.5", emergencyRateMinor: "25800" },
  { id: uid("r"), firmId: FIRM_B, serviceCode: "HVAC-REPAIR", rateMinor: "11800", currency: "USD", effectiveFrom: "2026-05-20", effectiveTo: null, emergencyMultiplier: "1.5", emergencyRateMinor: "17700" },
];

export const job = (id: string, siteId: string, serviceCode: string, priority: W.JobPriority, state: W.JobStateWire, startMs: number, hours: number, sla: { dueMs: number; stage: number; satisfiedMs?: number } | null, equipmentIds: string[] = []): Job => {
  const site = accounts.find((a) => a.id === siteId)!;
  const contractId = site.orgId === AMPED ? MSA : CEDAR_MSA;
  return {
    id, siteId, orgId: site.orgId, regionId: site.regionId, contractId, serviceCode, priority, state,
    serviceWindowStart: at(startMs), serviceWindowEnd: at(startMs + hours * HOUR), version: state === "created" ? 1 : 3,
    openedAt: at(Math.min(startMs, 0) - 2 * HOUR), stateChangedAt: state === "created" ? at(Math.min(startMs, 0) - 2 * HOUR) : at(Math.min(startMs, 0)),
    slaDueAt: sla ? at(sla.dueMs) : null, slaEscalationStage: sla ? sla.stage : null, slaSatisfiedAt: sla?.satisfiedMs !== undefined ? at(sla.satisfiedMs) : null,
    equipmentIds, returnTrip: false, notes: [], updates: [], messages: [],
  };
};

export const E = {
  austinRtu1: "q0000000-0000-0000-0000-000000000001", austinRtu2: "q0000000-0000-0000-0000-000000000002", austinRtu3: "q0000000-0000-0000-0000-000000000003",
  austinDehu: "q0000000-0000-0000-0000-000000000004", elPasoSplit: "q0000000-0000-0000-0000-000000000005", boulderRtu: "q0000000-0000-0000-0000-000000000006",
  sjRtu: "q0000000-0000-0000-0000-000000000007", houstonRtu: "q0000000-0000-0000-0000-000000000008",
} as const;

export const J = {
  austinLeak: "j0000000-0000-0000-0000-000000000001", elPasoNoCool: "j0000000-0000-0000-0000-000000000002",
  austinPm: "j0000000-0000-0000-0000-000000000003", houstonRepair: "j0000000-0000-0000-0000-000000000004",
  austinPoolPm: "j0000000-0000-0000-0000-000000000005", elPasoPm: "j0000000-0000-0000-0000-000000000006",
  sjCompressor: "j0000000-0000-0000-0000-000000000007", boulderPm: "j0000000-0000-0000-0000-000000000008",
  austinAugPm: "j0000000-0000-0000-0000-000000000009", houstonAug: "j0000000-0000-0000-0000-00000000000a",
  elPasoAug: "j0000000-0000-0000-0000-00000000000b", austinJulyPm: "j0000000-0000-0000-0000-00000000000c",
} as const;
export const jobs: Job[] = [
  // Unassigned and on the clock.
  job(J.austinLeak, S.austinRoof, "HVAC-REPAIR", "emergency", "created", 20 * MIN, 4, { dueMs: 38 * MIN, stage: 1 }, [E.austinRtu2]),
  job(J.elPasoNoCool, S.elPasoFloor, "HVAC-REPAIR", "urgent", "created", 3 * HOUR, 4, { dueMs: 5 * HOUR, stage: 0 }, [E.elPasoSplit]),
  job(J.houstonRepair, S.cedarHoustonMain, "HVAC-REPAIR", "routine", "created", DAY, 4, { dueMs: 20 * HOUR, stage: 0 }, [E.houstonRtu]),
  job(J.boulderPm, N.boulderRoof, "PM-VISIT", "pm", "created", 2 * DAY, 6, { dueMs: 2 * DAY, stage: 0 }, [E.boulderRtu]),
  // Assigned and moving.
  job(J.austinPm, S.austinRoof, "PM-VISIT", "pm", "assigned", 2 * HOUR, 5, { dueMs: -1 * HOUR, stage: 0, satisfiedMs: -3 * HOUR }, [E.austinRtu1, E.austinRtu3]),
  job(J.austinPoolPm, S.austinPool, "PM-VISIT", "pm", "en_route", 30 * MIN, 3, { dueMs: -2 * HOUR, stage: 0, satisfiedMs: -5 * HOUR }, [E.austinDehu]),
  job(J.elPasoPm, S.elPasoFloor, "PM-VISIT", "pm", "assigned", DAY + 2 * HOUR, 5, { dueMs: -DAY, stage: 0, satisfiedMs: -DAY - HOUR }),
  job(J.sjCompressor, N.sanJoseRoof, "HVAC-REPAIR", "urgent", "in_progress", -HOUR, 4, { dueMs: -2 * HOUR, stage: 0, satisfiedMs: -3 * HOUR }, [E.sjRtu]),
  // Done — the work behind the statements.
  job(J.austinAugPm, S.austinRoof, "PM-VISIT", "pm", "invoiced", -30 * DAY, 5, null, [E.austinRtu1, E.austinRtu2, E.austinRtu3]),
  job(J.houstonAug, S.cedarHoustonMain, "HVAC-REPAIR", "routine", "complete", -26 * DAY, 3, null, [E.houstonRtu]),
  job(J.elPasoAug, S.elPasoFloor, "HVAC-REPAIR", "urgent", "invoiced", -22 * DAY, 4, null, [E.elPasoSplit]),
  job(J.austinJulyPm, S.austinPool, "PM-VISIT", "pm", "invoiced", -60 * DAY, 3, null, [E.austinDehu]),
];

// The Austin leak's conversation (0016): one published update, one draft the
// customer must not see, and the thread — so S3's Job Detail and S6's job page
// both open on something.
{
  const leak = jobs.find((j) => j.id === J.austinLeak)!;
  leak.updates.push(
    { id: uid("u"), sourceNoteId: null, body: "We have your emergency call. A technician is being dispatched to the roof units now.", state: "published", updatedAt: at(-10 * MIN), publishedAt: at(-10 * MIN), publishedByName: "South dispatcher" },
    { id: uid("u"), sourceNoteId: null, body: "Draft — water traced to RTU-2 condensate line; confirm before telling the customer.", state: "draft", updatedAt: at(-2 * MIN), publishedAt: null, publishedByName: null },
  );
  leak.messages.push(
    { id: uid("m"), authorKind: "customer", authorName: "Amped Austin manager", body: "Water is coming through the ceiling over the front desk. Roof hatch is by the loading dock.", at: at(-25 * MIN) },
    { id: uid("m"), authorKind: "office", authorName: "South dispatcher", body: "Thanks — the crew will use the loading-dock hatch. Please keep the area clear.", at: at(-12 * MIN) },
  );
}
export const assignments: Assignment[] = [
  { id: uid("x"), jobId: J.austinPm, crewId: C.lsA, assignedAt: at(-3 * HOUR), releasedAt: null },
  { id: uid("x"), jobId: J.austinPoolPm, crewId: C.south1, assignedAt: at(-5 * HOUR), releasedAt: null },
  { id: uid("x"), jobId: J.elPasoPm, crewId: C.south2, assignedAt: at(-DAY - HOUR), releasedAt: null },
  { id: uid("x"), jobId: J.sjCompressor, crewId: C.west1, assignedAt: at(-3 * HOUR), releasedAt: null },
  { id: uid("x"), jobId: J.austinAugPm, crewId: C.lsA, assignedAt: at(-31 * DAY), releasedAt: null },
  { id: uid("x"), jobId: J.houstonAug, crewId: C.gc1, assignedAt: at(-27 * DAY), releasedAt: null },
  { id: uid("x"), jobId: J.elPasoAug, crewId: C.lsB, assignedAt: at(-23 * DAY), releasedAt: null },
  { id: uid("x"), jobId: J.austinJulyPm, crewId: C.lsA, assignedAt: at(-61 * DAY), releasedAt: null },
];

export const month = (offset: number) => {
  const d = new Date(NOW); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10);
  const end = new Date(d); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  return { from, to: end.toISOString().slice(0, 10) };
};
export const ST = { lsAug: "s0000000-0000-0000-0000-000000000001", lsJul: "s0000000-0000-0000-0000-000000000002", lsSep: "s0000000-0000-0000-0000-000000000003", gcAug: "s0000000-0000-0000-0000-000000000004" } as const;
export const settlements: Settlement[] = [
  { id: ST.lsJul, firmId: FIRM_A, regionId: REGION_SOUTH, periodFrom: month(-2).from, periodTo: month(-2).to, totalMinor: "18500", currency: "USD", state: "acknowledged", issuedAt: at(-50 * DAY), acknowledgedAt: at(-47 * DAY), disputedAt: null, disputeReason: null },
  { id: ST.lsAug, firmId: FIRM_A, regionId: REGION_SOUTH, periodFrom: month(-1).from, periodTo: month(-1).to, totalMinor: "108000", currency: "USD", state: "issued", issuedAt: at(-4 * DAY), acknowledgedAt: null, disputedAt: null, disputeReason: null },
  { id: ST.lsSep, firmId: FIRM_A, regionId: REGION_SOUTH, periodFrom: month(0).from, periodTo: month(0).to, totalMinor: "58500", currency: "USD", state: "draft", issuedAt: null, acknowledgedAt: null, disputedAt: null, disputeReason: null },
  { id: ST.gcAug, firmId: FIRM_B, regionId: REGION_SOUTH, periodFrom: month(-1).from, periodTo: month(-1).to, totalMinor: "35400", currency: "USD", state: "issued", issuedAt: at(-4 * DAY), acknowledgedAt: null, disputedAt: null, disputeReason: null },
];
export const rateOf = (firmId: string, code: string) => rateCards.find((r) => r.firmId === firmId && r.serviceCode === code && r.effectiveTo === null)!;
export const settlementLines: W.SettlementLineWire[] = [
  { id: uid("l"), settlementId: ST.lsJul, jobId: J.austinJulyPm, serviceCode: "PM-VISIT", siteName: "Austin — Pool Hall Dehumidifier", rateCardId: rateCards[0]!.id, rateMinor: "18500", quantityMilli: "1000", amountMinor: "18500" },
  { id: uid("l"), settlementId: ST.lsAug, jobId: J.austinAugPm, serviceCode: "PM-VISIT", siteName: "Austin — Rooftop RTUs", rateCardId: rateOf(FIRM_A, "PM-VISIT").id, rateMinor: "19500", quantityMilli: "3000", amountMinor: "58500" },
  { id: uid("l"), settlementId: ST.lsAug, jobId: J.elPasoAug, serviceCode: "HVAC-REPAIR", siteName: "El Paso — Main Floor", rateCardId: rateOf(FIRM_A, "HVAC-REPAIR").id, rateMinor: "12500", quantityMilli: "3960", amountMinor: "49500" },
  { id: uid("l"), settlementId: ST.lsSep, jobId: J.austinPm, serviceCode: "PM-VISIT", siteName: "Austin — Rooftop RTUs", rateCardId: rateOf(FIRM_A, "PM-VISIT").id, rateMinor: "19500", quantityMilli: "3000", amountMinor: "58500" },
  { id: uid("l"), settlementId: ST.gcAug, jobId: J.houstonAug, serviceCode: "HVAC-REPAIR", siteName: "Houston — Clinic Main", rateCardId: rateOf(FIRM_B, "HVAC-REPAIR").id, rateMinor: "11800", quantityMilli: "3000", amountMinor: "35400" },
];

export const equipment: (Omit<W.EquipmentWire, "lastServicedAt" | "lastServicedJobId" | "lastServicedServiceCode" | "jobCount">)[] = [
  { id: E.austinRtu1, siteId: S.austinRoof, kind: "rtu", label: "RTU-1 (studio A)", manufacturer: "Carrier", model: "48FC-D08", serial: "4719G20331", installedOn: "2019-05-14", tonnageMilli: "7500", active: true },
  { id: E.austinRtu2, siteId: S.austinRoof, kind: "rtu", label: "RTU-2 (weights floor)", manufacturer: "Carrier", model: "48FC-D12", serial: "4719G20332", installedOn: "2019-05-14", tonnageMilli: "10000", active: true },
  { id: E.austinRtu3, siteId: S.austinRoof, kind: "rtu", label: "RTU-3 (lobby)", manufacturer: "Trane", model: "YSC060", serial: "21081NP7Y", installedOn: "2021-03-02", tonnageMilli: "5000", active: true },
  { id: E.austinDehu, siteId: S.austinPool, kind: "package", label: "Pool dehumidifier", manufacturer: "Desert Aire", model: "LV35", serial: "DA-88120", installedOn: "2020-08-19", tonnageMilli: null, active: true },
  { id: E.elPasoSplit, siteId: S.elPasoFloor, kind: "split", label: "Main floor split", manufacturer: "Lennox", model: "XC21-060", serial: "5818K04421", installedOn: "2018-06-01", tonnageMilli: "5000", active: true },
  { id: E.boulderRtu, siteId: N.boulderRoof, kind: "rtu", label: "RTU-A", manufacturer: "Carrier", model: "50XC-A10", serial: "0920V11209", installedOn: "2020-10-11", tonnageMilli: "8500", active: true },
  { id: E.sjRtu, siteId: N.sanJoseRoof, kind: "rtu", label: "RTU-North", manufacturer: "Daikin", model: "DPS015", serial: "FBOU210300441", installedOn: "2021-01-20", tonnageMilli: "15000", active: true },
  { id: E.houstonRtu, siteId: S.cedarHoustonMain, kind: "rtu", label: "Clinic RTU", manufacturer: "York", model: "ZF090", serial: "N1K8120339", installedOn: "2017-04-22", tonnageMilli: "7500", active: true },
];

export const contacts: W.ContactWire[] = [
  { id: uid("k"), accountId: N.austin, accountName: "Amped Austin", accountTier: "location", role: "site_manager", name: "Priya Castellanos", phone: "512-555-0142", email: "austin.gm@ampedfitness.example", note: "Roof access through the loading dock; call ahead.", isPrimary: true, active: true },
  { id: uid("k"), accountId: S.austinRoof, accountName: "Austin — Rooftop RTUs", accountTier: "site", role: "security", name: "Front desk", phone: "512-555-0100", email: null, note: "Badge in at the desk before 6am.", isPrimary: false, active: true },
  { id: uid("k"), accountId: N.south, accountName: "Amped / South", accountTier: "region", role: "facilities", name: "Marcus Oyelaran", phone: "214-555-0199", email: "facilities.south@ampedfitness.example", note: null, isPrimary: true, active: true },
  { id: uid("k"), accountId: N.elPaso, accountName: "Amped El Paso", accountTier: "location", role: "site_manager", name: "Tomás Villareal", phone: "915-555-0107", email: "elpaso.gm@ampedfitness.example", note: null, isPrimary: true, active: true },
];

export const invoices: W.InvoiceWire[] = [
  {
    id: "i0000000-0000-0000-0000-000000000001", billToTier: "parent", billToId: AMPED, contractId: MSA, billingPath: "enterprise_sla",
    periodStart: month(-1).from, periodEnd: month(-1).to, totalMinor: "412600", currency: "USD", issuedAt: at(-3 * DAY), dueAt: at(42 * DAY),
    status: "open", paidMinor: "0", voidedAt: null, voidReason: null,
    lines: [
      { id: uid("n"), locationId: N.austin, jobId: J.austinAugPm, description: "Preventive maintenance — 3 rooftop units", quantityMilli: "3000", unitPriceMinor: "29000", amountMinor: "87000" },
      { id: uid("n"), locationId: N.elPaso, jobId: J.elPasoAug, description: "Repair — main floor split, labor", quantityMilli: "3960", unitPriceMinor: "14500", amountMinor: "57420" },
    ],
    subtotalMinor: "0",
  },
];

// A month of billing across the regions, so leadership's money figures read like a working company.
export const bill = (id: string, orgId: string, contractId: string, issuedDaysAgo: number, dueInDays: number, lines: [string, string, number][], paid = 0): W.InvoiceWire => {
  const ls = lines.map(([locationId, description, amount]) => ({ id: uid("n"), locationId, jobId: null, description, quantityMilli: "1000", unitPriceMinor: String(amount), amountMinor: String(amount) }));
  const total = String(ls.reduce((t, l) => t + Number(l.amountMinor), 0));
  return { id, billToTier: "parent", billToId: orgId, contractId, billingPath: "enterprise_sla", periodStart: month(-1).from, periodEnd: month(-1).to, totalMinor: total, currency: "USD", issuedAt: at(-issuedDaysAgo * DAY), dueAt: at((dueInDays - issuedDaysAgo) * DAY),
    status: invoiceStatusOf({ issuedAt: "issued", voidedAt: null, totalMinor: total, paidMinor: String(paid) }), paidMinor: String(paid), voidedAt: null, voidReason: null,
    lines: ls, subtotalMinor: total };
};
// 0030: what was received against the demo's paid and part-paid invoices, as the office recorded it.
export const payments: W.PaymentWire[] = [];
export const received = (invoiceId: string, amountMinor: string, method: W.PaymentMethod, reference: string | null, daysAgo: number, returned?: { daysAgo: number; reason: string }) =>
  payments.push({ id: uid("p"), invoiceId, amountMinor, currency: "USD", method, reference, state: returned ? "returned" : "succeeded",
    receivedAt: at(-daysAgo * DAY), returnedAt: returned ? at(-returned.daysAgo * DAY) : null, returnReason: returned?.reason ?? null });
invoices.push(
  bill("i0000000-0000-0000-0000-000000000002", AMPED, MSA, 6, 45, [[N.sanJose, "Enterprise SLA — San Jose, monthly", 1840000], [N.reno, "Enterprise SLA — Reno, monthly", 1215000], [N.sanJose, "Compressor replacement, RTU-North", 2960000]]),
  bill("i0000000-0000-0000-0000-000000000003", AMPED, MSA, 12, 45, [[N.boulder, "Enterprise SLA — Boulder, monthly", 1390000], [N.boulder, "PM visit x2, roof units", 780000]], 2170000),
  bill("i0000000-0000-0000-0000-000000000004", AMPED, MSA, 9, 45, [[N.austin, "Enterprise SLA — Austin, monthly", 2410000], [N.elPaso, "Enterprise SLA — El Paso, monthly", 1650000]], 2000000),
  bill("i0000000-0000-0000-0000-000000000005", CEDAR, CEDAR_MSA, 38, 30, [[S.cedarHouston, "Clinic HVAC program, monthly", 985000], [S.cedarHouston, "Emergency call-out, after hours", 312000]]),
  bill("i0000000-0000-0000-0000-000000000006", CEDAR, CEDAR_MSA, 8, 30, [[S.cedarHouston, "Clinic HVAC program, monthly", 985000]]),
);
received("i0000000-0000-0000-0000-000000000003", "2170000", "ach", "ACH 0091-2217", 2);
received("i0000000-0000-0000-0000-000000000004", "2000000", "check", "CHK 10442", 4);
received("i0000000-0000-0000-0000-000000000004", "650000", "check", "CHK 10418", 6, { daysAgo: 3, reason: "Returned unpaid — account closed" });

export const devices: W.DeviceWire[] = [
  { id: "v0000000-0000-0000-0000-000000000001", hardwareId: "RK-TAB-0042", kind: "web_fallback", firmId: null, active: true, orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH },
];

export const serviceRequests: Mutable<W.ServiceRequestWire>[] = [
  { id: uid("q"), siteId: S.austinRoof, siteName: "Austin — Rooftop RTUs", priority: "emergency", description: "Water coming through the ceiling tiles under RTU-2 on the weights floor. Towels down, area coned off.", requestedBy: "Priya Castellanos", createdAt: at(-25 * MIN), jobId: J.austinLeak, jobState: "created", orgId: AMPED, regionId: REGION_SOUTH, customerSegment: "commercial", photos: [], waitingOnTerm: null },
  { id: uid("q"), siteId: S.elPasoFloor, siteName: "El Paso — Main Floor", priority: "urgent", description: "Main floor is 81°F at 2pm and climbing. Split is running but blowing warm.", requestedBy: "Tomás Villareal", createdAt: at(-2 * HOUR), jobId: J.elPasoNoCool, jobState: "created", orgId: AMPED, regionId: REGION_SOUTH, customerSegment: "commercial", photos: [], waitingOnTerm: null },
  { id: uid("q"), siteId: S.austinPool, siteName: "Austin — Pool Hall Dehumidifier", priority: "routine", description: "Condensation on the pool hall windows most mornings. Could the next PM check the dehumidifier setpoint?", requestedBy: "Priya Castellanos", createdAt: at(-3 * DAY), jobId: J.austinPoolPm, jobState: "en_route", orgId: AMPED, regionId: REGION_SOUTH, customerSegment: "commercial", photos: [], waitingOnTerm: null },
];

export const photoData = new Map<string, { contentType: W.PhotoContentType; image: string; requestId: string }>();

// Leads and calls from the past month, so S4's growth figures have a history before anyone uses S1.
export const leads: { id: string; submissionId: string; name: string; metro: string | null; source: string; at: string }[] =
  ([[-2, "web_form", "Austin"], [-4, "web_form", "Dallas"], [-6, "call_button", "Houston"], [-9, "web_form", "Reno"], [-11, "referral", "Boulder"],
    [-15, "web_form", "San Antonio"], [-18, "call_button", "El Paso"], [-22, "web_form", "Austin"], [-27, "web_form", "Denver"]] as const)
    .map(([d, source, metro], i) => ({ id: uid("L"), submissionId: uid("S"), name: `Prospect ${i + 1}`, metro, source, at: at(d * DAY) }));
export const callRecords: { id: string; leadId: string | null; at: string }[] = [-1, -3, -6, -8, -13, -18, -24].map((d) => ({ id: uid("R"), leadId: null, at: at(d * DAY) }));
// The latest working-capital position per region, minor units.
export const workingCapital: Record<string, { receivable: number; payable: number }> = {
  [REGION_SOUTH]: { receivable: 14460000, payable: 1974000 }, [REGION_WEST]: { receivable: 6210000, payable: 0 }, [REGION_MOUNTAIN]: { receivable: 2385000, payable: 0 },
};

// ---------------------------------------------------------------------------
// People. One password for everyone, printed on the demo's own sign-in help.
// ---------------------------------------------------------------------------
export const DEMO_PASSWORD = "demo";
export const P = (p: Partial<Omit<Principal, "sessionId">> & Pick<Principal, "namespace" | "subjectId" | "orgId" | "regionId" | "scopeTier" | "scopeId" | "roles">): Omit<Principal, "sessionId"> =>
  ({ firmId: null, deviceId: null, shiftId: null, tierClaim: null, ...p });
export const users: User[] = [
  { id: verifiedBy, email: "office@rankine.demo", password: DEMO_PASSWORD, name: "Office manager", surfaces: ["S2"],
    principal: P({ namespace: "internal", subjectId: verifiedBy, orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: INTERNAL_ORG_ID, roles: ["office_manager", "account_owner"] }) },
  { id: "u0000000-0000-0000-0000-00000000000a", email: "ceo@rankine.demo", password: DEMO_PASSWORD, name: "Chief executive", surfaces: ["S4"],
    principal: P({ namespace: "internal", subjectId: "u0000000-0000-0000-0000-00000000000a", orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: INTERNAL_ORG_ID, roles: ["principal"] }) },
  { id: "u0000000-0000-0000-0000-00000000000b", email: "cfo@rankine.demo", password: DEMO_PASSWORD, name: "Finance lead (read only)", surfaces: ["S4"],
    principal: P({ namespace: "internal", subjectId: "u0000000-0000-0000-0000-00000000000b", orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: INTERNAL_ORG_ID, roles: ["readonly"] }) },
  { id: "u0000000-0000-0000-0000-0000000000c1", email: "orders@coolair.demo", password: DEMO_PASSWORD, name: "Coolair Supply order desk", surfaces: ["S7"],
    principal: P({ namespace: "vendor", subjectId: "u0000000-0000-0000-0000-0000000000c1", orgId: "v0000000-0000-0000-0000-000000000001", regionId: REGION_SOUTH, scopeTier: "parent", scopeId: "v0000000-0000-0000-0000-000000000001", roles: [] }) },
  { id: "u0000000-0000-0000-0000-0000000000c2", email: "sales@lonestarparts.demo", password: DEMO_PASSWORD, name: "Lone Star Parts Depot", surfaces: ["S7"],
    principal: P({ namespace: "vendor", subjectId: "u0000000-0000-0000-0000-0000000000c2", orgId: "v0000000-0000-0000-0000-000000000002", regionId: REGION_SOUTH, scopeTier: "parent", scopeId: "v0000000-0000-0000-0000-000000000002", roles: [] }) },
  { id: "u0000000-0000-0000-0000-000000000002", email: "dispatch.south@rankine.demo", password: DEMO_PASSWORD, name: "South dispatcher", surfaces: ["S3"],
    principal: P({ namespace: "internal", subjectId: "u0000000-0000-0000-0000-000000000002", orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "region", scopeId: REGION_SOUTH, roles: ["dispatcher"] }) },
  { id: "u0000000-0000-0000-0000-000000000003", email: "dispatch.west@rankine.demo", password: DEMO_PASSWORD, name: "West dispatcher", surfaces: ["S3"],
    principal: P({ namespace: "internal", subjectId: "u0000000-0000-0000-0000-000000000003", orgId: INTERNAL_ORG_ID, regionId: REGION_WEST, scopeTier: "region", scopeId: REGION_WEST, roles: ["dispatcher"] }) },
  { id: "u0000000-0000-0000-0000-000000000004", email: "tech.south1@rankine.demo", password: DEMO_PASSWORD, name: "Technician, South Crew 1", surfaces: ["S5"], crewId: C.south1,
    principal: P({ namespace: "device", subjectId: "u0000000-0000-0000-0000-000000000004", orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "region", scopeId: REGION_SOUTH, roles: ["technician"], deviceId: devices[0]!.id, shiftId: "g0000000-0000-0000-0000-000000000001" }) },
  { id: "u0000000-0000-0000-0000-000000000005", email: "exec@amped.demo", password: DEMO_PASSWORD, name: "Amped VP Facilities", surfaces: ["S6"],
    principal: P({ namespace: "customer", subjectId: "u0000000-0000-0000-0000-000000000005", orgId: AMPED, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: AMPED, roles: ["account_owner"], tierClaim: "parent" }) },
  { id: "u0000000-0000-0000-0000-000000000006", email: "austin@amped.demo", password: DEMO_PASSWORD, name: "Amped Austin manager", surfaces: ["S6"],
    principal: P({ namespace: "customer", subjectId: "u0000000-0000-0000-0000-000000000006", orgId: AMPED, regionId: REGION_SOUTH, scopeTier: "location", scopeId: N.austin, roles: ["office_manager"], tierClaim: "location" }) },
  { id: "u0000000-0000-0000-0000-000000000007", email: "houston@cedarlane.demo", password: DEMO_PASSWORD, name: "Cedar Lane Houston manager", surfaces: ["S6"],
    principal: P({ namespace: "customer", subjectId: "u0000000-0000-0000-0000-000000000007", orgId: CEDAR, regionId: REGION_SOUTH, scopeTier: "location", scopeId: S.cedarHouston, roles: ["office_manager"], tierClaim: "location" }) },
  { id: "u0000000-0000-0000-0000-000000000008", email: "coord@lonestar.demo", password: DEMO_PASSWORD, name: "Lone Star coordinator", surfaces: ["S8"],
    principal: P({ namespace: "subcontractor", subjectId: "u0000000-0000-0000-0000-000000000008", orgId: FIRM_A, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: FIRM_A, roles: ["office_manager"], firmId: FIRM_A }) },
  { id: "u0000000-0000-0000-0000-000000000009", email: "coord@gulfcoast.demo", password: DEMO_PASSWORD, name: "Gulf Coast coordinator", surfaces: ["S8"],
    principal: P({ namespace: "subcontractor", subjectId: "u0000000-0000-0000-0000-000000000009", orgId: FIRM_B, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: FIRM_B, roles: ["office_manager"], firmId: FIRM_B }) },
];
export const PERSONAS = users.map((u) => ({ surface: u.surfaces[0]!, email: u.email, name: u.name, ...(u.surfaces[0] === "S5" ? { hardwareId: devices[0]!.hardwareId } : {}) }));

// ---------------------------------------------------------------------------
// Sessions. The browser surfaces hold a cookie session; the demo keeps one
// per surface, pre-signed-in as the first persona so every surface opens on
// its working screen. S5 is bearer-only, as it is in the product.
// ---------------------------------------------------------------------------
export type Session = { id: string; user: User; token: string };
export const cookieSessions = new Map<SurfaceId, Session>();
export const bearerSessions = new Map<string, Session>();
/** S5's signed-in device, whose stream the launcher feeds; the last device login wins, as on one tablet. */
export const liveSession = { device: null as Session | null, anonCookieExpires: 0 };
/**
 * S1's anonymous sessions and when each expires: S1's bearer operations need one, as at the real gateway —
 * by bearer token, or (the browser's way, which S1 uses) by the session cookie, kept here per surface.
 */
export const anonTokens = new Map<string, number>();
export type Profile = { presence: W.Presence; statusNote: string | null; avatar: W.MyAccountWire["avatar"]; passwordChangedAt: string | null };
export const profiles = new Map<string, Profile>();
export const profileOf = (u: User): Profile => {
  let p = profiles.get(u.id);
  if (!p) profiles.set(u.id, (p = { presence: "available", statusNote: null, avatar: null, passwordChangedAt: null }));
  return p;
};
export const accountOf = (u: User): W.MyAccountWire => ({ userId: u.id, email: u.email, displayName: u.name, ...profileOf(u) });
/** AC Services employees only. The device session is the employed technician. A customer, a vendor, a firm coordinator, and a person on a firm's crew are not. */
export const employee = (u: User): boolean => {
  if (u.principal.firmId) return false;
  const crew = u.crewId ? crews.find((c) => c.id === u.crewId) : undefined;
  if (crew?.firmId) return false;
  return u.principal.namespace === "internal" || (u.surfaces.includes("S5") && u.principal.namespace === "device");
};
export type StaffRow = { id: string; senderId: string; audience: W.StaffAudience; recipientId: string | null; body: string; at: string; recipients: Set<string>; dismissed: Set<string> };
export const staffMessages: StaffRow[] = [];
export const lastEveryone = new Map<string, number>();
export const staffWire = (m: StaffRow, me: string): W.StaffMessageWire => ({
  messageId: m.id,
  senderId: m.senderId,
  senderName: users.find((u) => u.id === m.senderId)?.name ?? "Someone",
  audience: m.audience,
  recipientId: m.recipientId,
  recipientName: m.recipientId ? users.find((u) => u.id === m.recipientId)?.name ?? null : null,
  body: m.body,
  sentAt: m.at,
  direction: m.senderId === me ? "sent" : "received",
  dismissed: m.dismissed.has(me),
});
export const principalOf = (s: Session): Principal => ({ ...s.user.principal, sessionId: s.id });
export const mint = (user: User): Session => ({ id: uid("z"), user, token: `demo.${uid("t")}` });
for (const sid of ["S2", "S3", "S4", "S6", "S7", "S8"] as SurfaceId[]) cookieSessions.set(sid, mint(users.find((u) => u.surfaces.includes(sid))!));

export const reader: HierarchyReader = {
  organization: async (id) => { const o = orgs.find((x) => x.id === id); return o ? { id: o.id, name: o.name } : null; },
  region: async (id) => { const r = REGIONS.find((x) => x.id === id); return r ? { id: r.id, code: r.code, name: r.name } : null; },
  account: async (id) => { const a = accounts.find((x) => x.id === id); return a ? { id: a.id, tier: a.tier, name: a.name, parentId: a.parentId, regionId: a.regionId, orgId: a.orgId, customerGroup: a.customerGroup } : null; },
  regionNodesOf: async (orgId) => orgId === INTERNAL_ORG_ID
    ? REGIONS.map((r) => ({ id: r.id, name: r.name, regionId: r.id }))
    : accounts.filter((a) => a.orgId === orgId && a.tier === "region").map((a) => ({ id: a.id, name: a.name, regionId: a.regionId })),
};

// ---------------------------------------------------------------------------
// Events. Every write publishes an envelope to every open stream, the way the
// relay fans NOTIFY out over SSE; the shell filters by topic.
// ---------------------------------------------------------------------------
export type Listener = { surface: SurfaceId; push: (e: EventEnvelope) => void };
export const listeners = new Set<Listener>();
export type ActivityEntry = { at: string; surface: SurfaceId; op: string; status: number; note: string; kind: "read" | "write" | "refused" | "event" | "offline" };
export const activity: ((a: ActivityEntry) => void)[] = [];
export const onActivity = (cb: (a: ActivityEntry) => void) => { activity.push(cb); };
export const log = (a: Omit<ActivityEntry, "at">) => { const e = { ...a, at: new Date().toISOString() }; for (const cb of activity) cb(e); };

export const publish = (surface: SurfaceId, topic: Topic, entity: string, entityId: string, orgId: string, regionId: string): string => {
  const eventId = uid("ev");
  const env: EventEnvelope = { eventId, topic, entity, entityId, regionId, orgId, occurredAt: new Date().toISOString() };
  for (const l of listeners) { const e = eventFor(l.surface, env); if (e) l.push(e); }
  log({ surface, op: topic, status: 0, note: `${entity} ${entityId.slice(0, 8)}`, kind: "event" });
  return eventId;
};

// ---------------------------------------------------------------------------
// Visibility — the demo's imitation of RLS.
// ---------------------------------------------------------------------------
export const descendantsOf = (id: string): Set<string> => {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const a of accounts) if (a.parentId && out.has(a.parentId) && !out.has(a.id)) { out.add(a.id); grew = true; } }
  return out;
};
export const ancestorsOf = (id: string): Set<string> => {
  const out = new Set<string>();
  let cur = accounts.find((a) => a.id === id);
  while (cur) { out.add(cur.id); cur = cur.parentId ? accounts.find((a) => a.id === cur!.parentId) : undefined; }
  return out;
};
export const everAssignedTo = (jobId: string, firmId: string) =>
  assignments.some((a) => a.jobId === jobId && crews.find((c) => c.id === a.crewId)?.firmId === firmId);

export const visibleAccounts = (p: Principal): Account[] => {
  if (p.namespace === "internal") return accounts;
  if (p.namespace === "customer") {
    const mine = accounts.filter((a) => a.orgId === p.orgId);
    if (p.scopeTier === "parent") return mine;
    const down = descendantsOf(p.scopeId), up = ancestorsOf(p.scopeId);
    return mine.filter((a) => down.has(a.id) || up.has(a.id));
  }
  if (p.namespace === "subcontractor") {
    const sites = new Set(jobs.filter((j) => everAssignedTo(j.id, p.firmId!)).map((j) => j.siteId));
    return accounts.filter((a) => sites.has(a.id));
  }
  return [];
};
export const siteVisibleToCustomer = (p: Principal, siteId: string) => {
  const site = accounts.find((a) => a.id === siteId);
  if (!site || site.orgId !== p.orgId) return false;
  return p.scopeTier === "parent" || descendantsOf(p.scopeId).has(siteId);
};
export const visibleJobs = (p: Principal, surface: SurfaceId): Job[] => {
  if (p.namespace === "internal") return surface === "S3" ? jobs.filter((j) => j.regionId === p.regionId) : jobs;
  if (p.namespace === "customer") return jobs.filter((j) => siteVisibleToCustomer(p, j.siteId));
  if (p.namespace === "subcontractor") return jobs.filter((j) => everAssignedTo(j.id, p.firmId!));
  return [];
};
export const visibleCrews = (p: Principal): Crew[] =>
  p.namespace === "internal" ? crews : p.namespace === "subcontractor" ? crews.filter((c) => c.firmId === p.firmId) : [];

// ---------------------------------------------------------------------------
// Wire shaping.
// ---------------------------------------------------------------------------
export const liveAssignment = (jobId: string) => assignments.filter((a) => a.jobId === jobId && a.releasedAt === null).at(-1) ?? null;
export const latestNoteOf = (j: Job): { body: string; at: string } | null => {
  const n = j.notes.filter((x) => x.kind === "note").at(-1);
  return n ? { body: n.body, at: n.at } : null;
};
export const jobWire = (j: Job, p: Principal): W.JobWire => {
  const site = accounts.find((a) => a.id === j.siteId)!;
  let a = liveAssignment(j.id);
  // A customer sees no crew (0006); a firm sees only its own crew on the row (0007).
  if (p.namespace === "customer") a = null;
  if (a && p.namespace === "subcontractor" && crews.find((c) => c.id === a!.crewId)?.firmId !== p.firmId) a = null;
  const crew = a ? crews.find((c) => c.id === a!.crewId) ?? null : null;
  const open = j.slaDueAt !== null && j.slaSatisfiedAt === null;
  return {
    id: j.id, siteId: j.siteId, siteName: site.name, siteAddress: site.address, contractId: j.contractId, projectId: null, serviceCode: j.serviceCode, priority: j.priority, state: j.state, workClass: "service",
    serviceWindowStart: j.serviceWindowStart, serviceWindowEnd: j.serviceWindowEnd, version: j.version, openedAt: j.openedAt, stateChangedAt: j.stateChangedAt, regionId: j.regionId, orgId: j.orgId, customerSegment: "commercial",
    currentCrewId: crew?.id ?? null, currentCrewLabel: crew?.label ?? null, currentAssignmentId: a?.id ?? null,
    slaDueAt: open ? j.slaDueAt : null, slaEscalationStage: open ? j.slaEscalationStage : null, slaSatisfiedAt: j.slaSatisfiedAt,
    // Notes are the office's (0015): nobody outside the internal namespace reads one.
    returnTrip: j.returnTrip, latestNote: p.namespace === "internal" ? latestNoteOf(j) : null,
  };
};
export const docSummary = (crew: Crew): W.CrewDocumentSummary => {
  const t = today();
  const required = REQUIRED[crew.employmentType];
  const mine = credentials.filter((c) => c.crewId === crew.id);
  const satisfied: string[] = [], unverified: string[] = [], expired: string[] = [], missing: string[] = [];
  let earliest: string | null = null;
  for (const kind of required) {
    const held = mine.filter((c) => c.kind === kind);
    const verified = held.filter((c) => c.verifiedAt !== null);
    const covering = verified.filter((c) => c.validFrom <= t && c.validTo >= t);
    if (held.length === 0) missing.push(kind);
    else if (verified.length === 0) unverified.push(kind);
    else if (covering.length === 0) expired.push(kind);
    else {
      satisfied.push(kind);
      const e = covering.map((c) => c.validTo).sort().at(-1)!;
      if (earliest === null || e < earliest) earliest = e;
    }
  }
  return { required, satisfied, unverified, expired, missing, earliestExpiry: earliest };
};
export const crewWire = (c: Crew): W.CrewWire => ({ ...c, documents: docSummary(c) });
export const firmWire = (f: Firm): W.FirmWire => ({ ...f, crewCount: crews.filter((c) => c.firmId === f.id).length, activeCrewCount: crews.filter((c) => c.firmId === f.id && c.active).length });
export const accountWire = (a: Account): W.AccountWire => ({
  id: a.id, tier: a.tier, name: a.name, parentId: a.parentId, regionId: a.regionId, customerGroup: a.customerGroup, externalRef: a.externalRef,
  timezone: a.timezone, active: a.active, path: [...ancestorsOf(a.id)].reverse(), address: a.address,
});
export const settlementWire = (s: Settlement): W.SettlementWire => ({ ...s, lineCount: settlementLines.filter((l) => l.settlementId === s.id).length });

export const pathOf = (orgId: string) => (tier: Tier, id: string): ScopePath => {
  const org = orgs.find((o) => o.id === orgId);
  if (tier === "parent") return [{ tier: "parent", id: orgId, name: org?.name ?? "" }];
  const a = accounts.find((x) => x.id === id && x.orgId === orgId);
  if (!a || a.tier !== tier) throw input422(`no ${tier} node ${id} in org ${orgId}`, "unknown_scope");
  const chain = [...ancestorsOf(id)].reverse().map((nid) => { const n = accounts.find((x) => x.id === nid)!; return { tier: n.tier as Tier, id: n.id, name: n.name }; });
  return [{ tier: "parent", id: orgId, name: org?.name ?? "" }, ...chain];
};

export const need = (cond: unknown, message: string, code: string) => { if (!cond) throw input422(message, code); };
export const bad = (message: string) => new Refused(400, "BadInput", message);

// ---------------------------------------------------------------------------
// Handlers — one per operation the surfaces call. `p` is null for S1.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// S4 — the rollup's figures, the same definitions as apps/worker/src/rollup.ts,
// evaluated over this gateway's rows. Past days are not stored in the demo, so
// the trend behind a figure is a steady synthetic history ending at today's value.
// ---------------------------------------------------------------------------
export const hqRegions = (): W.HqRegionWire[] => [
  ...REGIONS.map((r) => ({ id: r.id, code: r.code, name: r.name, active: r.active, placed: true })),
  { id: UNASSIGNED_REGION_ID, code: "UNASSIGNED", name: "Unassigned (pre-account)", active: true, placed: false },
];
export const CLOSED: readonly string[] = [...WORK_DONE_STATES, "cancelled", "aborted"];
export const hqFigures = (regionId: string, now: number): Record<HqMetricKey, number> => {
  const in30 = (iso: string | null | undefined) => !!iso && Date.parse(iso) > now - 30 * DAY && Date.parse(iso) <= now;
  const t = new Date(now).toISOString().slice(0, 10);
  const rj = jobs.filter((j) => j.regionId === regionId);
  const open = rj.filter((j) => !CLOSED.includes(j.state));
  const clocks = rj.filter((j) => j.slaDueAt && in30(j.openedAt));
  const closed = clocks.filter((j) => j.slaSatisfiedAt || Date.parse(j.slaDueAt!) < now);
  const met = clocks.filter((j) => j.slaSatisfiedAt && j.slaSatisfiedAt <= j.slaDueAt!);
  const rc = crews.filter((c) => c.homeRegionId === regionId && c.active);
  const rcIds = new Set(rc.map((c) => c.id));
  const rcreds = credentials.filter((c) => rcIds.has(c.crewId));
  const rs = settlements.filter((s) => s.regionId === regionId && ["issued", "acknowledged", "disputed"].includes(s.state));
  const locIds = new Set(accounts.filter((a) => a.regionId === regionId && a.tier === "location").map((a) => a.id));
  const inv = regionId === UNASSIGNED_REGION_ID ? [] : invoices.flatMap((i) => i.lines.filter((l) => locIds.has(l.locationId)).map((l) => ({ ...i, amount: Number(l.amountMinor) })));
  const customerOrgs = new Set(accounts.filter((a) => a.regionId === regionId && a.active && orgs.find((o) => o.id === a.orgId)?.kind === "customer").map((a) => a.orgId));
  const rl = regionId === UNASSIGNED_REGION_ID ? leads.filter((l) => in30(l.at)) : [];
  const wc = workingCapital[regionId];
  return {
    jobs_opened_30d: rj.filter((j) => in30(j.openedAt)).length,
    jobs_completed_30d: rj.filter((j) => in30(j.openedAt) && WORK_DONE_STATES.includes(j.state)).length,
    jobs_open_now: open.length,
    jobs_unassigned_now: open.filter((j) => !liveAssignment(j.id)).length,
    jobs_at_risk_now: open.filter((j) => j.slaDueAt && !j.slaSatisfiedAt && ((j.slaEscalationStage ?? 0) > 0 || Date.parse(j.slaDueAt) <= now + HOUR)).length,
    sla_closed_30d: closed.length,
    sla_met_30d: met.length,
    sla_breached_30d: closed.length - met.length,
    sla_escalated_30d: clocks.filter((j) => (j.slaEscalationStage ?? 0) > 0).length,
    invoiced_minor_30d: inv.filter((i) => in30(i.issuedAt) && !i.voidedAt).reduce((s, i) => s + i.amount, 0),
    // What is still owed on each past-due line: its share of the invoice's unpaid remainder.
    invoices_past_due_minor: Math.round(inv.filter((i) => (i.status === "open" || i.status === "partially_paid") && i.dueAt && Date.parse(i.dueAt) < now)
      .reduce((s, i) => s + i.amount * (1 - Number(i.paidMinor) / Number(i.totalMinor)), 0)),
    receivable_minor: wc?.receivable ?? 0,
    subcontractor_payable_minor: wc?.payable ?? 0,
    settlements_open_minor: rs.reduce((s, x) => s + Number(x.totalMinor), 0),
    settlements_overdue: rs.filter((x) => x.issuedAt && Date.parse(x.issuedAt) + (firms.find((f) => f.id === x.firmId)?.settlementTermsDays ?? 30) * DAY < now).length,
    settlements_disputed: rs.filter((x) => x.state === "disputed").length,
    crews_active: rc.length,
    crews_subcontracted_active: rc.filter((c) => c.employmentType === "subcontracted").length,
    crews_cleared_now: rc.filter((c) => { const d = docSummary(c); return d.satisfied.length === d.required.length; }).length,
    min_crew_density: REGIONS.find((r) => r.id === regionId)?.minCrewDensity ?? 0,
    locations_active: accounts.filter((a) => a.regionId === regionId && a.tier === "location" && a.active).length,
    firms_active: firms.filter((f) => f.regionId === regionId && f.status === "active").length,
    firms_onboarding: firms.filter((f) => f.regionId === regionId && f.status === "onboarding").length,
    credentials_unverified: rcreds.filter((c) => !c.verifiedAt).length,
    credentials_expiring_30d: rcreds.filter((c) => c.verifiedAt && c.validTo >= t && c.validTo <= day(30)).length,
    leads_30d: rl.length,
    leads_web_form_30d: rl.filter((l) => l.source === "web_form").length,
    leads_call_button_30d: rl.filter((l) => l.source === "call_button").length,
    leads_referral_30d: rl.filter((l) => l.source === "referral").length,
    calls_inbound_30d: regionId === UNASSIGNED_REGION_ID ? callRecords.filter((c) => in30(c.at)).length : 0,
    service_requests_30d: serviceRequests.filter((r) => r.regionId === regionId && in30(r.createdAt)).length,
    customers_active: customerOrgs.size,
    customers_new_30d: [...customerOrgs].filter((id) => in30(orgs.find((o) => o.id === id)?.createdAt)).length,
    sites_active: accounts.filter((a) => a.regionId === regionId && a.tier === "site" && a.active).length,
    // Company-wide distinct figures live on the unplaced row alone, as in the rollup.
    customers_total: regionId === UNASSIGNED_REGION_ID ? new Set(accounts.filter((a) => a.active && orgs.find((o) => o.id === a.orgId)?.kind === "customer").map((a) => a.orgId)).size : 0,
    customers_new_total_30d: regionId === UNASSIGNED_REGION_ID ? orgs.filter((o) => o.kind === "customer" && in30(o.createdAt)).length : 0,
    // Platform health — demo has no real outbox/session tables; zeros keep the register complete.
    outbox_pending_now: 0,
    outbox_oldest_age_seconds: 0,
    sessions_active_now: regionId === UNASSIGNED_REGION_ID ? users.length : 0,
    devices_active_now: 0,
    sync_mutations_pending_now: 0,
    gateway_requests_30d: 0,
    gateway_refusals_30d: 0,
  };
};
/** A deterministic wobble around today's value, older days a little lower for flows (30d) and near-flat for states (now). */
export const pastValue = (metric: HqMetricKey, regionId: string, today: number, daysAgo: number): number => {
  let h = 0;
  for (const ch of metric + regionId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const wave = Math.sin(daysAgo / 3.5 + (h % 17)) * 0.12 + Math.sin(daysAgo / 1.3 + (h % 5)) * 0.05;
  const drift = HQ_METRICS[metric].window === "30d" ? -daysAgo * 0.006 : 0;
  return Math.max(0, Math.round(today * (1 + wave + drift)));
};

// ---------------------------------------------------------------------------
// Item 11 — procurement: the office's purchasing (S2) and the vendor's side
// (S7). Same wire shapes as apps/gateway/src/handlers/procurement.ts; the
// three-way match is the real domain function. A vendor sees its own rows,
// and an order only once issued — 0011's rules, imitated here by hand.
// ---------------------------------------------------------------------------
export const VND = { coolair: "v0000000-0000-0000-0000-000000000001", lonestar: "v0000000-0000-0000-0000-000000000002" } as const;
export type Vendor = Mutable<W.VendorWire>;
export const vendorRows: Vendor[] = [
  { id: VND.coolair, legalName: "Coolair Supply Co.", status: "active", regionId: REGION_SOUTH, paymentTermsDays: 30, contactEmail: "orders@coolair.demo" },
  { id: VND.lonestar, legalName: "Lone Star Parts Depot", status: "active", regionId: REGION_SOUTH, paymentTermsDays: 45, contactEmail: "sales@lonestarparts.demo" },
];
for (const v of vendorRows) orgs.push({ id: v.id, name: v.legalName, kind: "vendor", externalRef: null, active: true });
export const RP = { south: "w0000000-0000-0000-0000-000000000001", west: "w0000000-0000-0000-0000-000000000002", mtn: "w0000000-0000-0000-0000-000000000003", dc: "w0000000-0000-0000-0000-000000000004" } as const;
export const receivingPointRows: W.ReceivingPointWire[] = [
  { id: RP.south, code: "SOUTH-HUB", tier: "regional_hub", regionId: REGION_SOUTH, address: { line1: "4410 Industrial Oaks Blvd", city: "Austin", state: "TX", postal: "78735" }, active: true },
  { id: RP.west, code: "WEST-HUB", tier: "regional_hub", regionId: REGION_WEST, address: { line1: "955 Spice Islands Dr", city: "Sparks", state: "NV", postal: "89431" }, active: true },
  { id: RP.mtn, code: "MTN-LS-02", tier: "location_stock", regionId: REGION_MOUNTAIN, address: { line1: "6100 Longbow Dr, Unit 4", city: "Boulder", state: "CO", postal: "80301" }, active: true },
  { id: RP.dc, code: "NATIONAL-DC", tier: "national", regionId: REGION_SOUTH, address: { line1: "2201 Great Southwest Pkwy", city: "Grand Prairie", state: "TX", postal: "75050" }, active: true },
];
export type Item = Omit<W.CatalogItemWire, "current" | "proposals">;
export const itemRows: Item[] = [];
export const priceRows: Mutable<W.CatalogPriceWire>[] = [];
export const addItem = (vendorId: string, sku: string, description: string, priceMinor: string, uom = "each"): string => {
  const id = uid("ci");
  itemRows.push({ id, vendorId, vendorSku: sku, description, uom, active: true });
  priceRows.push({ id: uid("cp"), itemId: id, vendorId, priceMinor, currency: "USD", effectiveFrom: day(-120), effectiveTo: null, state: "accepted", proposedAt: at(-125 * DAY), decidedAt: at(-121 * DAY), decisionNote: null });
  return id;
};
export const IT = {
  cap: addItem(VND.coolair, "CAP-45-5-440", "Run capacitor 45/5 µF 440V", "1850"),
  contactor: addItem(VND.coolair, "CNT-2P-40A", "Contactor, 2-pole 40A 24V coil", "3275"),
  motor: addItem(VND.coolair, "MTR-CF-1/4", "Condenser fan motor 1/4 HP 1075 RPM", "14900"),
  filter: addItem(VND.coolair, "FLT-20x25x2-M8", "Pleated filter 20x25x2 MERV 8", "640"),
  r410: addItem(VND.lonestar, "R410A-25", "Refrigerant R-410A, 25 lb cylinder", "18900", "cylinder"),
  belt: addItem(VND.lonestar, "BLT-A42", "V-belt A42", "1125"),
  tstat: addItem(VND.lonestar, "TST-PRO-7", "Programmable thermostat, commercial", "11600"),
};
priceRows.push({ id: uid("cp"), itemId: IT.motor, vendorId: VND.coolair, priceMinor: "15650", currency: "USD", effectiveFrom: day(10), effectiveTo: null, state: "proposed", proposedAt: at(-2 * DAY), decidedAt: null, decisionNote: null });
export type Po = Mutable<Omit<W.PurchaseOrderWire, "vendorName" | "receivingPointCode" | "receivingTier">> & { lines: { id: string; lineNo: number; itemId: string; quantityMilli: string; unitPriceMinor: string }[] };
export const poRows: Po[] = [];
export const shipmentRows: (W.ShipmentWire & { poId: string })[] = [];
export const receiptRows: (W.ReceiptWire & { poId: string })[] = [];
export const vinvRows: W.VendorInvoiceWire[] = [];
export const rmaRows: Mutable<W.RmaWire>[] = [];
export const accepted = (itemId: string) => priceRows.find((p) => p.itemId === itemId && p.state === "accepted" && p.effectiveFrom <= day(0) && (p.effectiveTo === null || p.effectiveTo > day(0)));
export const amount = (q: bigint, p: bigint) => (q * p + 500n) / 1000n;
export const seedPo = (vendorId: string, rp: string, state: W.PoState, daysAgo: number, lines: [string, number][]): Po => {
  const id = uid("po");
  const ls = lines.map(([itemId, q], i) => ({ id: uid("pl"), lineNo: i + 1, itemId, quantityMilli: String(q * 1000), unitPriceMinor: accepted(itemId)!.priceMinor }));
  const total = ls.reduce((t, l) => t + amount(BigInt(l.quantityMilli), BigInt(l.unitPriceMinor)), 0n);
  const po: Po = { id, number: `PO-${day(-daysAgo).replace(/-/g, "")}-${4100 + poRows.length}`, vendorId, receivingPointId: rp, regionId: receivingPointRows.find((r) => r.id === rp)!.regionId, state, currency: "USD", totalMinor: total.toString(),
    issuedAt: state === "draft" ? null : at(-daysAgo * DAY + HOUR), acknowledgedAt: ["acknowledged", "received"].includes(state) ? at(-daysAgo * DAY + 5 * HOUR) : null, promisedShipOn: ["acknowledged", "received"].includes(state) ? day(-daysAgo + 3) : null, createdAt: at(-daysAgo * DAY), lines: ls };
  poRows.push(po);
  return po;
};
{
  const done = seedPo(VND.coolair, RP.south, "received", 21, [[IT.cap, 24], [IT.contactor, 10], [IT.filter, 48]]);
  shipmentRows.push({ id: uid("sh"), poId: done.id, shippedOn: day(-18), carrier: "UPS Freight", tracking: "1Z9W4R870312", lines: done.lines.map((l) => ({ poLineId: l.id, quantityMilli: l.quantityMilli })) });
  for (const l of done.lines) receiptRows.push({ id: uid("rc"), poId: done.id, poLineId: l.id, quantityMilli: l.quantityMilli, receivedAt: at(-16 * DAY) });
  vinvRows.push({ id: uid("vi"), poId: done.id, poNumber: done.number, vendorId: VND.coolair, invoiceNumber: "CS-100482", invoiceDate: day(-15), totalMinor: done.totalMinor, currency: "USD", matchState: "matched", matchNotes: [], createdAt: at(-15 * DAY),
    lines: done.lines.map((l) => ({ poLineId: l.id, quantityMilli: l.quantityMilli, unitPriceMinor: l.unitPriceMinor, amountMinor: amount(BigInt(l.quantityMilli), BigInt(l.unitPriceMinor)).toString() })) });
  rmaRows.push({ id: uid("rm"), poId: done.id, poNumber: done.number, poLineId: done.lines[0]!.id, vendorId: VND.coolair, quantityMilli: "2000", reason: "Two capacitors arrived with bulged casings.", state: "requested", rmaNumber: null, vendorNote: null, createdAt: at(-3 * DAY), respondedAt: null });
  const part = seedPo(VND.coolair, RP.west, "acknowledged", 6, [[IT.motor, 6], [IT.cap, 12]]);
  shipmentRows.push({ id: uid("sh"), poId: part.id, shippedOn: day(-3), carrier: "FedEx Ground", tracking: "7749 0012 4431", lines: [{ poLineId: part.lines[0]!.id, quantityMilli: "4000" }, { poLineId: part.lines[1]!.id, quantityMilli: "12000" }] });
  receiptRows.push({ id: uid("rc"), poId: part.id, poLineId: part.lines[0]!.id, quantityMilli: "4000", receivedAt: at(-1 * DAY) }, { id: uid("rc"), poId: part.id, poLineId: part.lines[1]!.id, quantityMilli: "12000", receivedAt: at(-1 * DAY) });
  vinvRows.push({ id: uid("vi"), poId: part.id, poNumber: part.number, vendorId: VND.coolair, invoiceNumber: "CS-100511", invoiceDate: day(-1), totalMinor: "111600", currency: "USD", matchState: "held", createdAt: at(-1 * DAY),
    matchNotes: [{ poLineId: part.lines[0]!.id, code: "over_received", message: "line 1: 6 billed in all, 4 received" }],
    lines: [{ poLineId: part.lines[0]!.id, quantityMilli: "6000", unitPriceMinor: "14900", amountMinor: "89400" }, { poLineId: part.lines[1]!.id, quantityMilli: "12000", unitPriceMinor: "1850", amountMinor: "22200" }] });
  seedPo(VND.coolair, RP.mtn, "issued", 1, [[IT.filter, 96], [IT.contactor, 4]]);
  seedPo(VND.lonestar, RP.south, "issued", 0, [[IT.r410, 8], [IT.belt, 20]]);
  seedPo(VND.lonestar, RP.dc, "acknowledged", 9, [[IT.tstat, 15]]);
  seedPo(VND.coolair, RP.south, "draft", 0, [[IT.motor, 2]]);
}
export const vendorOf = (p: Principal) => (p.namespace === "vendor" ? p.orgId : null);
export const seesPo = (p: Principal, po: Po) => p.namespace === "internal" || (po.vendorId === vendorOf(p) && po.state !== "draft");
export const poWire = (po: Po): W.PurchaseOrderWire => {
  const rp = receivingPointRows.find((r) => r.id === po.receivingPointId);
  const { lines: _l, ...rest } = po; void _l;
  return { ...rest, vendorName: vendorRows.find((v) => v.id === po.vendorId)?.legalName ?? null, receivingPointCode: rp?.code ?? null, receivingTier: rp?.tier ?? null };
};
export const sumBy = <T extends { quantityMilli: string }>(rows: readonly T[]) => rows.reduce((t, r) => t + BigInt(r.quantityMilli), 0n);
export const lineStats = (po: Po) => po.lines.map((l) => {
  const item = itemRows.find((i) => i.id === l.itemId)!;
  const shipped = sumBy(shipmentRows.filter((s) => s.poId === po.id).flatMap((s) => s.lines.filter((x) => x.poLineId === l.id)));
  const received = sumBy(receiptRows.filter((r) => r.poLineId === l.id));
  const invoiced = sumBy(vinvRows.filter((v) => v.poId === po.id && v.matchState === "matched").flatMap((v) => v.lines.filter((x) => x.poLineId === l.id)));
  const returned = sumBy(rmaRows.filter((r) => r.poLineId === l.id && r.state !== "rejected"));
  return { id: l.id, lineNo: l.lineNo, itemId: l.itemId, vendorSku: item.vendorSku, description: item.description, uom: item.uom, quantityMilli: l.quantityMilli, shippedMilli: shipped.toString(), receivedMilli: received.toString(),
    invoicedMilli: invoiced.toString(), returnedMilli: returned.toString(), unitPriceMinor: l.unitPriceMinor, amountMinor: amount(BigInt(l.quantityMilli), BigInt(l.unitPriceMinor)).toString() } satisfies W.PoLineWire;
});
export const findPo = (p: Principal, id: string): Po => { const po = poRows.find((x) => x.id === id && seesPo(p, x)); need(po, `no purchase order ${id} visible in this scope`, "unknown_po"); return po!; };
export const digits = (v: unknown, field: string, positive = false): bigint => { if (typeof v !== "string" || !/^\d+$/.test(v)) throw bad(`${field} must be a string of digits`); const n = BigInt(v); if (positive && n === 0n) throw bad(`${field} must be more than zero`); return n; };

/**
 * What a surface's stream hears of an event, by the rule the real gateway's
 * events.stream applies: an org-wide internal login hears every region, anyone
 * else only their own; a customer only its own org; and outside the internal
 * namespace the envelope is blind — no entity, no org, just enough to refetch.
 * S1 has no stream. Read at push time, so a persona switch takes effect at once.
 */
export const eventFor = (surface: SurfaceId, env: EventEnvelope): EventEnvelope | null => {
  const s = surface === "S5" ? liveSession.device : cookieSessions.get(surface);
  if (!s) return null;
  const p = s.user.principal;
  const orgScoped = p.namespace === "internal" && p.scopeTier === "parent";
  if (!(orgScoped || p.regionId === env.regionId)) return null;
  if (p.namespace === "customer" && p.orgId !== env.orgId) return null;
  if (p.namespace === "internal") return env;
  return { eventId: env.eventId, topic: env.topic, regionId: env.regionId, occurredAt: env.occurredAt } as EventEnvelope;
};
