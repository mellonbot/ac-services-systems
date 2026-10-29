import type { AddressWire } from "./hierarchy.ts";

// ---- C4 wire shapes ----
export type FirmStatus = "onboarding" | "active" | "suspended" | "terminated";
export type FirmWire = {
  /** The firm's id IS its organization's id — one tenant root, one operational row, created together. */
  readonly id: string;
  readonly legalName: string;
  readonly status: FirmStatus;
  /** OUR region the firm is dispatched from — its crews' home by default and the shard its rows live in. */
  readonly regionId: string;
  /** D13. Measured from day one. */
  readonly settlementTermsDays: number;
  readonly msaSignedAt: string | null;
  /** OQ5, firm side. Always stated — the row does not exist otherwise. */
  readonly diagnosticDataRightsReserved: boolean;
  readonly w9DocumentKey: string | null;
  readonly crewCount: number;
  readonly activeCrewCount: number;
};
export type ListFirmsInput = { readonly status?: FirmStatus };
export type ListFirmsOutput = { readonly firms: readonly FirmWire[] };

export type CreateFirmInput = {
  readonly legalName: string;
  /** OUR region — the one the firm is dispatched from. An input here, because a firm is a root and has no edge to derive it from. */
  readonly regionId: string;
  readonly settlementTermsDays: number;
  /** OQ5, firm side. No default: absent or non-boolean is a 400 — no position was stated. */
  readonly diagnosticDataRightsReserved: boolean;
  readonly msaSignedAt?: string;
  readonly w9DocumentKey?: string;
  readonly externalRef?: string;
};
export type CreateFirmOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };

export type UpdateFirmInput = {
  readonly firmId: string;
  readonly legalName?: string;
  readonly settlementTermsDays?: number;
  readonly msaSignedAt?: string | null;
  readonly w9DocumentKey?: string | null;
  /** A step on the ladder. Refused by name when it is not an edge from the current status. */
  readonly status?: Exclude<FirmStatus, "onboarding">;
};
export type UpdateFirmOutput = { readonly id: string; readonly status: FirmStatus; readonly eventId: string };

export type EmploymentType = "employed" | "subcontracted";
/**
 * 0024. A technician is never on a crew: their dispatch unit is a `service`
 * crew of one technician. An `install` crew is installers only. Mirrors
 * CREW_KINDS in packages/schema (the column's CHECK); a test holds them equal.
 */
export const CREW_KINDS = ["service", "install"] as const;
export type CrewKind = (typeof CREW_KINDS)[number];
/** 0024. Install work goes to an install crew; service and commissioning go to a technician. Mirrors JOB_WORK_CLASSES in packages/schema. */
export const JOB_WORK_CLASSES = ["service", "install", "commissioning"] as const;
export type JobWorkClass = (typeof JOB_WORK_CLASSES)[number];
/** The one place the work decides the crew. Read by jobs.create, dispatch.candidates and dispatch.assign; 0024's trigger says the same in SQL. */
export const crewKindFor = (work: JobWorkClass): CrewKind => (work === "install" ? "install" : "service");

/**
 * 0027 — an emergency job is settled at the rate × its card's multiplier,
 * stored as basis points so the money path carries no float. The wire says it
 * as the decimal a person types.
 */
export const EMERGENCY_MULTIPLIER_DEFAULT = "1.5";
/** "1.5" → 15000; null for anything that is not a multiplier of at least 1 with at most two places. */
export const multiplierBp = (v: string): number | null => {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 10_000 + Number((m[2] ?? "").padEnd(2, "0")) * 100;
  return bp >= 10_000 ? bp : null;
};
/** 15000 → "1.5", 20000 → "2", 12500 → "1.25". */
export const multiplierOf = (bp: number): string => {
  const whole = Math.floor(bp / 10_000), frac = String(bp % 10_000).padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
};
/**
 * 0025 — THE SERVICE CATALOGUE. What a job may be opened for, and which kind
 * of work each one is: the work class of a job is its code's, never typed
 * beside it. Mirrored into `service_codes` (tools/ci/emit-schema.ts), which
 * jobs.service_code references. Adding a code is a reviewed diff here.
 */
export const SERVICE_CATALOG = [
  { code: "DIAGNOSTIC", label: "Diagnostic", workClass: "service" },
  { code: "HVAC-REPAIR", label: "Repair", workClass: "service" },
  { code: "PM-VISIT", label: "Preventive maintenance", workClass: "service" },
  { code: "WARRANTY-CALLBACK", label: "Warranty callback", workClass: "service" },
  // 0034: what a technician's "Quote needed" opens. Service class, so it needs no project: once the customer approves, sales opens the install under one.
  { code: "QUOTE", label: "Quote", workClass: "service" },
  { code: "EQUIPMENT-CHANGEOUT", label: "Equipment changeout", workClass: "install" },
  { code: "NEW-INSTALL", label: "New installation", workClass: "install" },
  { code: "DUCTWORK", label: "Ductwork", workClass: "install" },
  { code: "STARTUP-COMMISSIONING", label: "Startup & commissioning", workClass: "commissioning" },
] as const satisfies readonly { readonly code: string; readonly label: string; readonly workClass: JobWorkClass }[];
export type ServiceCode = (typeof SERVICE_CATALOG)[number]["code"];
export type ServiceEntry = (typeof SERVICE_CATALOG)[number];
/** The catalogue entry for a code, or undefined for one that is not in it (a job opened before 0025). */
export const serviceOf = (code: string): ServiceEntry | undefined => SERVICE_CATALOG.find((s) => s.code === code);
/** A code's words, falling back to the code itself for a job opened before the catalogue. */
export const serviceLabel = (code: string): string => serviceOf(code)?.label ?? code.replace(/_/g, " ");

/** One set of words for the three, read by every surface that shows them. */
export const CREW_KIND_LABEL: Readonly<Record<CrewKind, string>> = { service: "Technician's unit", install: "Install crew" };
export const JOB_WORK_CLASS_LABEL: Readonly<Record<JobWorkClass, string>> = { service: "Service", install: "Install", commissioning: "Commissioning" };
/** What the gate would say about this crew's documents today — not a clearance, a summary S2 reads. */
export type CrewDocumentSummary = {
  /** The kinds the gate requires for this employment shape (domain/compliance/gate.ts REQUIRED). */
  readonly required: readonly string[];
  /** Required kinds with a VERIFIED document on file whose window includes today. */
  readonly satisfied: readonly string[];
  /** Required kinds with a document on file but none verified. */
  readonly unverified: readonly string[];
  /** Required kinds with a verified document on file, none of which covers today. */
  readonly expired: readonly string[];
  /** Required kinds with nothing on file at all. */
  readonly missing: readonly string[];
  /** Earliest valid_to among the verified documents that satisfy a required kind, ISO date, or null. */
  readonly earliestExpiry: string | null;
};
export type CrewWire = {
  readonly id: string;
  readonly label: string;
  readonly employmentType: EmploymentType;
  readonly kind: CrewKind;
  readonly firmId: string | null;
  readonly homeRegionId: string;
  readonly active: boolean;
  readonly documents: CrewDocumentSummary;
};
export type ListCrewsInput = { readonly firmId?: string; readonly regionId?: string };
export type ListCrewsOutput = { readonly crews: readonly CrewWire[] };

export type CreateCrewInput = {
  readonly label: string;
  readonly employmentType: EmploymentType;
  /** Omitted: `service` — one technician's unit. */
  readonly kind?: CrewKind;
  /** Required for a subcontracted crew; refused for an employed one. */
  readonly firmId?: string;
  /** OUR region the crew is normally dispatched from. Its tenancy region on insert. */
  readonly homeRegionId: string;
};
export type CreateCrewOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };
export type UpdateCrewInput = { readonly crewId: string; readonly label?: string; readonly active?: boolean };
export type UpdateCrewOutput = { readonly id: string; readonly eventId: string };

/** 0020: the office roles that read and write a technician's home address. Every other role reads it as restricted. One list, read by the gateway, S2 and the demo. */
export const TECHNICIAN_ADDRESS_ROLES = ["account_owner", "principal"] as const;
export const mayReadTechnicianAddress = (roles: readonly string[]): boolean => roles.some((r) => (TECHNICIAN_ADDRESS_ROLES as readonly string[]).includes(r));

/**
 * 0020. Mirrors TECHNICIAN_SPECIALTIES in packages/schema (the column's CHECK); a test holds them equal.
 * The kinds of equipment a person is qualified on. Since 0025, never the kind of work they do — that is
 * their role (TECHNICIAN_ROLES): "install" and "ductwork" left this list for it.
 */
export const TECHNICIAN_SPECIALTIES = ["residential_hvac", "light_commercial", "commercial_rtu", "refrigeration", "chillers_boilers", "controls_bas"] as const;
export type TechnicianSpecialty = (typeof TECHNICIAN_SPECIALTIES)[number];
/** 0024. `technician` goes on a service unit (alone); the others on an install crew. Mirrors TECHNICIAN_ROLES in packages/schema. */
export const TECHNICIAN_ROLES = ["technician", "lead_installer", "installer", "helper"] as const;
export type TechnicianRole = (typeof TECHNICIAN_ROLES)[number];
/** The crew kind a role belongs on. */
export const crewKindForRole = (role: TechnicianRole): CrewKind => (role === "technician" ? "service" : "install");
export const TECHNICIAN_ROLE_LABEL: Readonly<Record<TechnicianRole, string>> = { technician: "Technician", lead_installer: "Lead installer", installer: "Installer", helper: "Helper" };
export type TechnicianWire = {
  readonly id: string;
  /** Null: one of ours. */
  readonly firmId: string | null;
  readonly crewId: string | null;
  readonly name: string;
  readonly phone: string | null;
  /** Null when none is recorded OR when this principal may not read it — `addressRestricted` says which. */
  readonly homeAddress: AddressWire | null;
  /** True for every role outside TECHNICIAN_ADDRESS_ROLES: the address exists or not, and this reader is not told. */
  readonly addressRestricted: boolean;
  readonly role: TechnicianRole;
  readonly specialties: readonly TechnicianSpecialty[];
  readonly homeRegionId: string;
  readonly active: boolean;
};
export type ListTechniciansInput = { readonly firmId?: string };
export type ListTechniciansOutput = { readonly technicians: readonly TechnicianWire[] };
export type RecordTechnicianInput = {
  readonly name: string;
  /** Omit for one of ours. */
  readonly firmId?: string;
  readonly crewId?: string;
  readonly phone?: string;
  /** Account owners and principals only. */
  readonly homeAddress?: AddressWire;
  /** Omitted: `technician`. */
  readonly role?: TechnicianRole;
  readonly specialties: readonly TechnicianSpecialty[];
  /** OUR region they work from; the row's tenancy region. */
  readonly homeRegionId: string;
};
export type RecordTechnicianOutput = { readonly id: string; readonly regionId: string; readonly eventId: string };
export type UpdateTechnicianInput = {
  readonly technicianId: string;
  readonly name?: string;
  /** Empty string clears it. */
  readonly phone?: string;
  /** Account owners and principals only. Null clears it. */
  readonly homeAddress?: AddressWire | null;
  readonly role?: TechnicianRole;
  readonly specialties?: readonly TechnicianSpecialty[];
  /** Null takes them off their crew. */
  readonly crewId?: string | null;
  readonly active?: boolean;
};
export type UpdateTechnicianOutput = { readonly id: string; readonly eventId: string };

export type CredentialKind = "insurance" | "license" | "certification" | "background_check";
export type CredentialWire = {
  readonly id: string;
  readonly crewId: string;
  readonly kind: CredentialKind;
  readonly identifier: string;
  /** ISO dates, both inclusive — the gate covers the whole service window with them. */
  readonly validFrom: string;
  readonly validTo: string;
  readonly documentKey: string | null;
  readonly verifiedAt: string | null;
  readonly verifiedBy: string | null;
};
export type ListCredentialsInput = { readonly crewId?: string; readonly firmId?: string };
export type ListCredentialsOutput = { readonly credentials: readonly CredentialWire[] };
export type RecordCredentialInput = {
  readonly crewId: string;
  readonly kind: CredentialKind;
  readonly identifier: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly documentKey?: string;
};
export type RecordCredentialOutput = { readonly id: string; readonly eventId: string };
export type VerifyCredentialInput = { readonly credentialId: string };
export type VerifyCredentialOutput = { readonly id: string; readonly verifiedAt: string; readonly verifiedBy: string; readonly eventId: string };

export type RateCardWire = {
  readonly id: string;
  readonly firmId: string;
  readonly serviceCode: string;
  /** Integer minor units as a STRING. A JSON number is a double. */
  readonly rateMinor: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  /** Exclusive; null = open. */
  readonly effectiveTo: string | null;
  /** 0027: what an emergency job is settled at, as a decimal string of the rate — "1.5" is time and a half. */
  readonly emergencyMultiplier: string;
  /** The rate × the multiplier, integer minor units as a string — what one unit of emergency work is settled at. */
  readonly emergencyRateMinor: string;
};
export type ListRateCardsInput = { readonly firmId: string; readonly serviceCode?: string };
export type ListRateCardsOutput = { readonly rateCards: readonly RateCardWire[] };
export type SetRateCardInput = {
  readonly firmId: string;
  readonly serviceCode: string;
  /** Integer minor units as a string of digits. */
  readonly rateMinor: string;
  readonly currency: string;
  /** ISO date the new rate takes effect. The row in effect that day is closed at it. */
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  /** 0027: a decimal string, at least "1" and at most two places — "1.5", "2", "1.25". Omitted: "1.5". */
  readonly emergencyMultiplier?: string;
};
export type SetRateCardOutput = { readonly id: string; readonly closedId: string | null; readonly eventId: string };

// ---- item 7 wire shapes: the firm's own writes, and the statement ----
export type SubmitCredentialInput = {
  readonly crewId: string;
  readonly kind: CredentialKind;
  readonly identifier: string;
  readonly validFrom: string;
  readonly validTo: string;
  /** The stored file's key, from the upload path. Optional in Phase 1: a document may be identified before it is scanned. */
  readonly documentKey?: string;
};
export type SubmitCredentialOutput = { readonly id: string; readonly crewId: string; readonly eventId: string };
/** No employmentType, no firmId, no homeRegionId: each is the principal's, derived. */
export type EnrollCrewInput = {
  readonly label: string;
  /** 0024. Omitted: `service` — one technician's unit. */
  readonly kind?: CrewKind;
};
export type EnrollCrewOutput = { readonly id: string; readonly firmId: string; readonly regionId: string; readonly eventId: string };
export type RetireCrewInput = { readonly crewId: string; readonly label?: string; readonly active?: boolean };
export type RetireCrewOutput = { readonly id: string; readonly eventId: string };

export type SettlementState = "draft" | "issued" | "acknowledged" | "disputed" | "paid";
export type SettlementWire = {
  readonly id: string;
  readonly firmId: string;
  readonly regionId: string;
  /** ISO dates: the period's first day, and its last day inclusive. */
  readonly periodFrom: string;
  readonly periodTo: string;
  /** Integer minor units as a STRING. A JSON number is a double. */
  readonly totalMinor: string;
  readonly currency: string;
  readonly state: SettlementState;
  readonly issuedAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly disputedAt: string | null;
  readonly disputeReason: string | null;
  readonly lineCount: number;
};
export type ListSettlementsInput = { readonly firmId?: string; readonly state?: SettlementState };
export type ListSettlementsOutput = { readonly settlements: readonly SettlementWire[] };
export type SettlementLineWire = {
  readonly id: string;
  readonly settlementId: string;
  readonly jobId: string;
  readonly serviceCode: string | null;
  readonly siteName: string | null;
  readonly rateCardId: string;
  /** Integer minor units as a string. */
  readonly rateMinor: string | null;
  /** Integer thousandths as a string. */
  readonly quantityMilli: string;
  readonly amountMinor: string;
};
export type ListSettlementLinesInput = { readonly settlementId: string };
export type ListSettlementLinesOutput = { readonly settlementId: string; readonly lines: readonly SettlementLineWire[] };
export type IssueSettlementInput = { readonly settlementId: string };
export type IssueSettlementOutput = { readonly id: string; readonly state: "issued"; readonly issuedAt: string; readonly eventId: string };
export type AcknowledgeSettlementInput = { readonly settlementId: string };
export type AcknowledgeSettlementOutput = { readonly id: string; readonly state: "acknowledged"; readonly acknowledgedAt: string; readonly eventId: string };
export type DisputeSettlementInput = { readonly settlementId: string; readonly reason: string };
export type DisputeSettlementOutput = { readonly id: string; readonly state: "disputed"; readonly disputedAt: string; readonly eventId: string };

