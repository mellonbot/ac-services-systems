import type { SurfaceId } from "../../surfaces.ts";
import type { AddressWire, CustomerSegment } from "./hierarchy.ts";
import type { EmploymentType, JobWorkClass } from "./network.ts";

// ---- item 4 wire shapes: the job, dispatch's dry run and release, the device shift grant ----
export type JobPriority = "emergency" | "urgent" | "routine" | "pm";
export type JobStateWire =
  | "created" | "assigned" | "reassigned" | "en_route" | "on_site" | "in_progress" | "awaiting_parts"
  | "complete" | "reopened" | "invoiced" | "cancelled" | "aborted"
  | "quote_requested" | "quote_submitted" | "awaiting_customer"
  | "needs_pricing" | "awaiting_po" | "awaiting_pictures" | "invoice_trouble";

/**
 * The work is done: every state between a technician finishing and the
 * invoice standing. A job here is not open field work — the board, the HQ
 * rollup and "last serviced" all read it as finished — whatever is still
 * blocking the bill. One list, because six copies of "complete or invoiced"
 * each missed the states 0014 added.
 */
export const WORK_DONE_STATES: readonly JobStateWire[] = Object.freeze(["complete", "needs_pricing", "awaiting_po", "awaiting_pictures", "invoiced", "invoice_trouble"]);

/**
 * The moves the office makes by hand (`jobs.transition`, S3) — the job
 * waiting on the customer or coming back from it, and closing out a job the
 * crew finished. Apart from closing out, a subset of packages/domain's
 * JOB_TRANSITIONS (the domain test holds it there), kept
 * here because a surface reads it to offer the buttons and a surface may not
 * import the domain. Before dispatch the wait is a quote: requested,
 * submitted, then approved back to `created` or declined to `cancelled`.
 * Mid-job it is `awaiting_customer` — an approval, or access — and back to
 * `in_progress`. After the work, whatever blocks the invoice (pricing, a PO,
 * pictures) and back to `complete`; an invoice kicked back and re-sent.
 * Assignment, release and the field's own moves keep their own doors.
 *
 * Closing out: a dispatched job the crew finished without moving it on a
 * device — a paper ticket, a phoned-in finish, a dead tablet — the office
 * moves to `complete` from any field state (OFFICE_CLOSE_OUT_FROM). Except
 * in_progress → complete, these are the office's edges alone and deliberately
 * NOT in the domain's JOB_TRANSITIONS, which is what a device may take: a
 * technician still walks en route → on site → in progress → complete.
 *
 * Cancelling after dispatch: before the crew is on site (`assigned`,
 * `en_route`) the office may cancel the job outright; the gateway releases the
 * crew in the same unit of work. Once the crew is on site, stopping is an
 * abort — the field's, with what it bills — not a cancellation.
 */
export const OFFICE_JOB_TRANSITIONS: Readonly<Partial<Record<JobStateWire, readonly JobStateWire[]>>> = Object.freeze({
  created: ["quote_requested"],
  quote_requested: ["quote_submitted", "cancelled"],
  quote_submitted: ["created", "cancelled"],
  // Closing out a dispatched job (OFFICE_CLOSE_OUT_FROM), or cancelling it before the crew is on site.
  assigned: ["complete", "cancelled"],
  en_route: ["complete", "cancelled"],
  on_site: ["awaiting_customer", "complete"],
  in_progress: ["awaiting_customer", "complete"],
  awaiting_parts: ["complete"],
  awaiting_customer: ["in_progress", "complete"],
  // After the work: what blocks the invoice, and back to ready-to-invoice.
  complete: ["needs_pricing", "awaiting_po", "awaiting_pictures"],
  needs_pricing: ["complete"],
  awaiting_po: ["complete"],
  awaiting_pictures: ["complete"],
  invoiced: ["invoice_trouble"],
  invoice_trouble: ["invoiced"],
});

/** What drops off a crew's list (`jobs.mine`): the work is done, cancelled or aborted. The assignment stays live on finished work, so the device's late time, parts and photos still apply. */
export const FIELD_CLOSED_STATES: readonly JobStateWire[] = Object.freeze([...WORK_DONE_STATES, "cancelled", "aborted"]);

/** The field states the office may close a dispatched job out of — each has `complete` in OFFICE_JOB_TRANSITIONS. */
export const OFFICE_CLOSE_OUT_FROM: readonly JobStateWire[] = Object.freeze(["assigned", "en_route", "on_site", "in_progress", "awaiting_parts", "awaiting_customer"]);

/** 0024: what an install was sold under. `foremanId` is the person who sold it — an active internal user holding `foreman`. */
export type ProjectState = "planned" | "active" | "closed" | "cancelled";
export type ProjectWire = {
  readonly id: string; readonly orgId: string; readonly regionId: string; readonly contractId: string;
  readonly customer: string; readonly name: string;
  readonly foremanId: string | null; readonly foremanName: string | null;
  /** ISO datetimes; end exclusive. */
  readonly serviceWindowStart: string; readonly serviceWindowEnd: string;
  readonly state: ProjectState;
  readonly installJobs: number;
};
/** A person a project may be sold by: an active internal user holding `foreman`. */
export type ForemanWire = { readonly id: string; readonly name: string };
export type ListProjectsInput = { readonly orgId?: string };
export type ListProjectsOutput = { readonly projects: readonly ProjectWire[]; readonly foremen: readonly ForemanWire[] };
export type CreateProjectInput = {
  readonly contractId: string;
  readonly name: string;
  /** Who sold it. */
  readonly foremanId: string;
  readonly serviceWindowStart: string;
  readonly serviceWindowEnd: string;
};
export type CreateProjectOutput = { readonly id: string; readonly orgId: string; readonly regionId: string; readonly eventId: string };

export type CreateJobInput = {
  readonly siteId: string;
  /** 0025: a code in SERVICE_CATALOG. Its work class is the job's — install is never an emergency and names its project. */
  readonly serviceCode: string;
  readonly priority?: JobPriority;
  /** ISO datetime, inclusive. */
  readonly serviceWindowStart: string;
  /** ISO datetime, exclusive. */
  readonly serviceWindowEnd: string;
  readonly contractId?: string;
  /** 0024: required when the service code is install work — the project it was sold under, whose foreman sold it. */
  readonly projectId?: string;
  /** Item 9: the units at the site this job is about. Each must be equipment at `siteId`; the row lands in job_equipment in the same unit of work. */
  readonly equipmentIds?: readonly string[];
};
export type CreateJobOutput = {
  readonly id: string; readonly orgId: string; readonly regionId: string;
  /** The timer this job opened, derived from the site's resolved sla_response — never typed in. */
  readonly slaTimerId: string; readonly dueAt: string; readonly responseTerm: string;
  readonly eventId: string;
};

/** What a job carries on a board, in the middle of its life. Same shape for S2 (any state) and S3 (region-locked by RLS). */
export type JobWire = {
  readonly id: string; readonly siteId: string;
  /** The site's name as RLS lets this principal see the row — null when the account row is not visible to it (item 7: a firm sees the site it was sent to). */
  readonly siteName: string | null;
  /** The site's address as recorded (accounts.address), or null — same RLS as the name. */
  readonly siteAddress: AddressWire | null;
  readonly contractId: string | null; readonly projectId: string | null;
  readonly serviceCode: string; readonly priority: JobPriority; readonly state: JobStateWire;
  /** 0024: which kind of crew this job is dispatched to (`crewKindFor`). */
  readonly workClass: JobWorkClass;
  readonly serviceWindowStart: string; readonly serviceWindowEnd: string; readonly version: number; readonly openedAt: string;
  /** When the job entered its current state: the latest job_state_events row into it, or openedAt when none has been written (a job still "created"). */
  readonly stateChangedAt: string;
  readonly regionId: string; readonly orgId: string;
  /** The customer's segment (0019) — null where the organization row is not visible to this principal (a firm). */
  readonly customerSegment: CustomerSegment | null;
  /** The crew currently holding this job, unreleased — null once dispatched-and-released or never assigned. */
  readonly currentCrewId: string | null; readonly currentCrewLabel: string | null;
  /** The open assignment's own id — what `dispatch.release` names. Null exactly when currentCrewId is null. */
  readonly currentAssignmentId: string | null;
  /** The open (unsatisfied) SLA timer, if this job still has one. */
  readonly slaDueAt: string | null; readonly slaEscalationStage: number | null; readonly slaSatisfiedAt: string | null;
  /** 0015: a second visit is owed. The office's flag, set by hand. */
  readonly returnTrip: boolean;
  /** 0015: the newest job_notes row — null when there is none, and always null outside the office (RLS: notes are internal). */
  readonly latestNote: { readonly body: string; readonly at: string } | null;
};
// ---- item 6: service requests ----
export type ServiceRequestPriority = "emergency" | "urgent" | "routine";
export type CreateServiceRequestInput = {
  readonly siteId: string;
  readonly priority?: ServiceRequestPriority;
  readonly description: string;
};
export type CreateServiceRequestOutput = { readonly id: string; readonly orgId: string; readonly regionId: string; readonly eventId: string };
export type ServiceRequestWire = {
  readonly id: string; readonly siteId: string; readonly siteName: string;
  readonly priority: ServiceRequestPriority; readonly description: string;
  readonly requestedBy: string; readonly createdAt: string;
  /** The job the office opened against this request, if one has been. */
  readonly jobId: string | null; readonly jobState: JobStateWire | null;
  readonly orgId: string; readonly regionId: string;
  /** The customer's segment (0019), so the office can tell a homeowner from a building. */
  readonly customerSegment: CustomerSegment | null;
  /** Oldest first. Fetch each with `media.get`. */
  readonly photos: readonly RequestPhotoWire[];
  /**
   * For a waiting request read by the office (S2, S3): the no-default term the
   * site's agreement is missing today, so a job cannot be opened until
   * Contracts sets it. Derived on every read, never stored — it clears itself
   * the moment the term exists. Null otherwise, and always null for S6.
   */
  readonly waitingOnTerm: string | null;
};
/** A photo sent with a request: what it is, never where it is stored. */
export type RequestPhotoWire = { readonly id: string; readonly contentType: PhotoContentType; readonly bytes: number };
export type PhotoContentType = "image/jpeg" | "image/png" | "image/heic";
/** 10 MiB: a phone photo, not a video. Checked by the gateway on the decoded bytes, and by S6 before it sends. */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTOS_PER_REQUEST = 6;
const HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
/**
 * What the bytes are, by their own signature — never the file name or the
 * type a browser claims. Null for anything that is not a photo we take. The
 * gateway decides with it; S6 asks it first so a refusal arrives before the upload.
 */
export const sniffPhoto = (b: Uint8Array): PhotoContentType | null => {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.subarray(4, 8)) === "ftyp" && HEIF_BRANDS.includes(String.fromCharCode(...b.subarray(8, 12)))) return "image/heic";
  return null;
};
export type AttachPhotoInput = { readonly requestId: string; readonly dataBase64: string };
export type AttachPhotoOutput = { readonly id: string; readonly requestId: string; readonly contentType: PhotoContentType; readonly bytes: number; readonly eventId: string };
/** The site comes from the request, never from the input; priority defaults to the one the customer declared. */
export type OpenRequestJobInput = {
  readonly requestId: string;
  readonly serviceCode: string;
  readonly priority?: JobPriority;
  readonly serviceWindowStart: string;
  readonly serviceWindowEnd: string;
};
export type OpenRequestJobOutput = CreateJobOutput & { readonly requestId: string };
export type GetMediaInput = { readonly id: string };
export type GetMediaOutput = { readonly id: string; readonly contentType: PhotoContentType; readonly image: string };
export type ListServiceRequestsInput = { readonly siteId?: string };
export type ListServiceRequestsOutput = { readonly requests: readonly ServiceRequestWire[] };

/** One site a dispatcher may open a job at, and the customer it belongs to. */
export type SiteWire = {
  readonly id: string; readonly name: string; readonly orgId: string; readonly orgName: string; readonly regionId: string;
  readonly address: AddressWire | null;
};
export type ListSitesOutput = { readonly sites: readonly SiteWire[] };

export type ListJobsInput = { readonly state?: string };
export type ListJobsOutput = { readonly jobs: readonly JobWire[] };

/** Who may read manager.overview: leadership, at parent scope — the only binding under which every table it reads is org-wide. */
export const MANAGER_ROLES = ["principal", "ops_leadership"] as const;
export const seesManagerOverview = (p: { readonly roles: readonly string[]; readonly scopeTier: string }): boolean =>
  p.scopeTier === "parent" && p.roles.some((r) => (MANAGER_ROLES as readonly string[]).includes(r));

export type ManagerWaitStep = "request_to_scheduled" | "scheduled_to_on_site" | "on_site_to_finished" | "finished_to_invoiced";
export type CredentialStanding = "ok" | "at_risk" | "breached";
export type ManagerOverviewOutput = {
  readonly asOf: string;
  /** Month to date, and the same span of last month. Money is minor units as text, per currency. */
  readonly billed: readonly { readonly currency: string; readonly minor: string; readonly priorMinor: string }[];
  readonly completed: { readonly now: number; readonly prior: number };
  /** Of the jobs completed this month, those with one visit and no return trip owed. */
  readonly fixedFirstVisit: number;
  /** Average days for the jobs that finished each step in the last 30 days; null when none did. */
  readonly waits: readonly { readonly step: ManagerWaitStep; readonly avgDays: number | null; readonly jobs: number }[];
  /** Labour logged by active employed crews over the last 7 days, and how many such crews there are. */
  readonly labor: { readonly hours: number; readonly techs: number };
  /** Finished, not invoiced — counts by state. */
  readonly unbilled: { readonly complete: number; readonly needsPricing: number; readonly awaitingPo: number; readonly awaitingPictures: number; readonly invoiceTrouble: number };
  readonly urgentUnassigned: readonly { readonly regionId: string; readonly count: number }[];
  /** Active crews whose soonest current credential has lapsed, or lapses within 30 days. */
  readonly credentials: { readonly expired: number; readonly expiring: number };
  /** Active employed crews at 36 hours or more since Monday. */
  readonly nearOvertime: number;
  readonly weeks: readonly { readonly weekStart: string; readonly completed: number; readonly invoiced: number }[];
  readonly branches: readonly { readonly regionId: string; readonly name: string; readonly techs: number; readonly laborHours: number; readonly unbilled: number }[];
  readonly team: readonly {
    readonly userId: string; readonly name: string; readonly roles: readonly string[]; readonly branch: string;
    readonly onJob: boolean; readonly hoursThisWeek: number | null; readonly credential: CredentialStanding | null;
  }[];
};

/** S5's own read. No employment shape, no compliance detail — the field layer never sees either (09 §3.10, non-negotiable #9). */
/** The site as a crew needs it at the curb: what it is called, where it is, and who answers the phone there. */
export type FieldSiteWire = {
  readonly name: string; readonly address: AddressWire | null;
  /** The site's primary active contact, else its oldest active one; null when the site has none. */
  readonly contact: { readonly name: string; readonly phone: string | null } | null;
};
export type FieldJobWire = {
  /** Null only if row security hides the site from the device — the job stays on the list either way. */
  readonly id: string; readonly jobNo: string | null; readonly siteId: string; readonly site: FieldSiteWire | null;
  readonly serviceCode: string; readonly priority: JobPriority; readonly state: JobStateWire;
  readonly serviceWindowStart: string; readonly serviceWindowEnd: string; readonly version: number;
  /** The checklist item keys the server holds as done — what a device shows ticked before anything of its own is queued. */
  readonly checklistDone: readonly string[];
};
export type MyJobsOutput = { readonly jobs: readonly FieldJobWire[] };
export type MyPunchesInput = { readonly from: string; readonly to: string };

// ---- 0034: wrapping up a visit ----
/** Photos an ordinary completion needs (a before and an after), and what Quote needed needs. Partner answers, 2026-10-27. */
export const WRAP_UP_MIN_PHOTOS = 2;
export const QUOTE_MIN_PHOTOS = 10;
/** The most media one job carries — photos and the signature together. */
export const JOB_MEDIA_MAX = 40;
export const RTU_VOLTAGES = ["208-230/1", "208-230/3", "460/3", "575/3"] as const;
export const RTU_FUELS = ["gas", "electric", "heat_pump"] as const;
/** The fixed RTU set Quote needed requires, every field (partner, 2026-10-27). Dimensions in whole inches. */
export type WrapUpMeasurementsWire = {
  readonly tonnage: number; readonly voltage: (typeof RTU_VOLTAGES)[number]; readonly fuel: (typeof RTU_FUELS)[number];
  readonly unitLengthIn: number; readonly unitWidthIn: number; readonly unitHeightIn: number;
  readonly curbLengthIn: number; readonly curbWidthIn: number;
  readonly oldModel: string; readonly oldSerial: string;
};
const DIMENSIONS = { unitLengthIn: "unit length", unitWidthIn: "unit width", unitHeightIn: "unit height", curbLengthIn: "curb length", curbWidthIn: "curb width" } as const;
/**
 * What is wrong with a measurement set, in a technician's words, or null when
 * it is whole. One function, so the device's Submit and the gateway's refusal
 * name the same missing field the same way.
 */
export const measurementsFault = (m: unknown): string | null => {
  if (!m || typeof m !== "object") return "the measurements are missing";
  const r = m as Record<string, unknown>;
  if (typeof r.tonnage !== "number" || !(r.tonnage >= 1 && r.tonnage <= 150) || Math.round(r.tonnage * 2) !== r.tonnage * 2) return "tonnage (1 to 150 tons, in halves)";
  if (!RTU_VOLTAGES.includes(r.voltage as never)) return "voltage / phase";
  if (!RTU_FUELS.includes(r.fuel as never)) return "fuel";
  for (const [k, label] of Object.entries(DIMENSIONS)) if (typeof r[k] !== "number" || !Number.isInteger(r[k]) || (r[k] as number) < 1 || (r[k] as number) > 600) return `${label} in whole inches`;
  if (typeof r.oldModel !== "string" || r.oldModel.trim().length === 0 || r.oldModel.length > 80) return "the old unit's model";
  if (typeof r.oldSerial !== "string" || r.oldSerial.trim().length === 0 || r.oldSerial.length > 80) return "the old unit's serial";
  return null;
};
export type JobMediaKind = "photo" | "signature";
export type AttachJobMediaInput = {
  readonly jobId: string; readonly mutationId: string; readonly kind: JobMediaKind;
  readonly dataBase64: string; readonly capturedAt: string;
};
export type AttachJobMediaOutput = { readonly id: string; readonly jobId: string; readonly duplicate: boolean };
export type WrapUpOutcome = "complete" | "quote_needed";
export type WrapUpInput = {
  readonly jobId: string; readonly wrapUpId: string; readonly outcome: WrapUpOutcome; readonly submittedAt: string;
  readonly notes?: string; readonly measurements?: WrapUpMeasurementsWire;
  /** The mutationIds the photos were uploaded under (jobs.attachMedia). */
  readonly photoMutationIds: readonly string[];
  /** Exactly one of these two. */
  readonly signatureMutationId?: string; readonly customerAbsentReason?: string;
};
export type WrapUpOutput = { readonly jobId: string; readonly wrapUpId: string; readonly state: "complete"; readonly duplicate: boolean };
/** One tap of the shift clock (0033). `at` is the device's clock at the tap. */
export type ShiftPunchWire = { readonly id: string; readonly kind: "in" | "out"; readonly at: string };
export type MyPunchesOutput = { readonly punches: readonly ShiftPunchWire[] };

export type ComplianceRefusalWireItem = { readonly reason: "missing" | "expired_in_window" | "unverified" | "crew_inactive"; readonly credentialKind: string; readonly detail: string };
/** 0024: only crews of the kind the job's work needs are candidates (`crewKindFor`). */
export type CandidateCrewWire = {
  readonly crewId: string; readonly label: string; readonly employmentType: EmploymentType;
  readonly cleared: boolean;
  /** Present exactly when `cleared` is false — the same verdict `dispatch.assign` would return. */
  readonly refusal: ComplianceRefusalWireItem | null;
};
export type CandidateCrewsInput = { readonly jobId: string; readonly orgId: string; readonly regionId: string };
export type CandidateCrewsOutput = { readonly jobId: string; readonly candidates: readonly CandidateCrewWire[] };

export type ReleaseAssignmentInput = { readonly assignmentId: string; readonly orgId: string; readonly regionId: string; readonly reason?: string };
export type ReleaseAssignmentOutput = { readonly jobId: string; readonly eventId: string };
export type TransitionJobInput = { readonly jobId: string; readonly orgId: string; readonly regionId: string; readonly to: JobStateWire };
export type TransitionJobOutput = { readonly jobId: string; readonly state: JobStateWire; readonly version: number; readonly eventId: string };
export type JobNoteKind = "note" | "standing";
export type AddJobNoteInput = { readonly jobId: string; readonly orgId: string; readonly regionId: string; readonly body: string; readonly kind?: JobNoteKind };
export type AddJobNoteOutput = { readonly id: string; readonly jobId: string; readonly eventId: string };
export type SetReturnTripInput = { readonly jobId: string; readonly orgId: string; readonly regionId: string; readonly returnTrip: boolean };
export type SetReturnTripOutput = { readonly jobId: string; readonly returnTrip: boolean; readonly eventId: string };

// ---- 0016: job detail and customer communication ----
/** One visit: an assignment of a crew to the job, with the span its time entries cover inside it. */
export type JobVisitWire = {
  readonly id: string; readonly crewId: string; readonly crewLabel: string | null;
  readonly assignedAt: string; readonly releasedAt: string | null;
  /** First and last instant the crew logged time on this job during the assignment — null until it logs any. */
  readonly workStart: string | null; readonly workEnd: string | null;
};
export type JobMediaWire = { readonly id: string; readonly kind: string; readonly storageKey: string; readonly label: string | null; readonly capturedAt: string };
export type JobNoteWire = { readonly id: string; readonly body: string; readonly kind: JobNoteKind; readonly at: string; readonly authorName: string | null };
export type JobUpdateState = "draft" | "published";
export type JobUpdateWire = {
  readonly id: string; readonly sourceNoteId: string | null; readonly body: string; readonly state: JobUpdateState;
  readonly updatedAt: string; readonly publishedAt: string | null; readonly publishedByName: string | null;
};
/** The writer's name is null where the reader may not see the writer (a customer does not see office users). */
export type JobMessageWire = { readonly id: string; readonly authorKind: "customer" | "office"; readonly authorName: string | null; readonly body: string; readonly at: string };
export type JobContactWire = { readonly name: string; readonly phone: string | null; readonly email: string | null };
export type JobDetailInput = { readonly jobId: string };
export type JobDetailOutput = {
  readonly job: JobWire;
  /** The site's contact, or the nearest ancestor's — what a crew calls ahead. */
  readonly contact: JobContactWire | null;
  readonly visits: readonly JobVisitWire[];
  readonly media: readonly JobMediaWire[];
  readonly notes: readonly JobNoteWire[];
  readonly updates: readonly JobUpdateWire[];
  readonly messages: readonly JobMessageWire[];
  /** How the field closed the visit (0034), or null until it has. */
  readonly wrapUp: JobWrapUpWire | null;
};
/** A wrap-up as the office reads it: what the technician sent, and the quote job the worker opened from it. */
export type JobWrapUpWire = {
  readonly outcome: WrapUpOutcome; readonly submittedAt: string; readonly submittedByName: string | null; readonly crewLabel: string | null;
  readonly notes: string | null; readonly measurements: WrapUpMeasurementsWire | null;
  /** A job_media id, readable through media.get. */
  readonly signatureMediaId: string | null; readonly customerAbsentReason: string | null;
  readonly quoteJobId: string | null; readonly quoteJobNo: string | null;
  /** Why the worker has not opened the quote job yet; it keeps trying. */
  readonly quoteError: string | null;
};
export type JobConversationInput = { readonly jobId: string };
export type JobConversationOutput = { readonly jobId: string; readonly updates: readonly JobUpdateWire[]; readonly messages: readonly JobMessageWire[] };
export type SaveJobUpdateInput = {
  readonly jobId: string; readonly orgId: string; readonly regionId: string; readonly body: string;
  /** Present: edit that draft. Absent: a new draft. */
  readonly updateId?: string;
  /** The internal note the update was written from, if any. */
  readonly sourceNoteId?: string;
};
export type SaveJobUpdateOutput = { readonly id: string; readonly state: "draft"; readonly eventId: string };
export type PublishJobUpdateInput = { readonly updateId: string };
export type PublishJobUpdateOutput = { readonly id: string; readonly publishedAt: string; readonly eventId: string };
export type PostJobMessageInput = { readonly jobId: string; readonly body: string };
export type PostJobMessageOutput = { readonly id: string; readonly authorKind: "customer" | "office"; readonly eventId: string };

export type DeviceKind = "android_pilot" | "yocto_tablet" | "web_fallback";
export type DeviceWire = {
  readonly id: string; readonly hardwareId: string; readonly kind: DeviceKind;
  readonly firmId: string | null; readonly active: boolean; readonly orgId: string; readonly regionId: string;
};
export type ListDevicesInput = { readonly firmId?: string };
export type ListDevicesOutput = { readonly devices: readonly DeviceWire[] };
export type RegisterDeviceInput = {
  readonly hardwareId: string; readonly kind: DeviceKind;
  /**
   * The device-held public key a future challenge-response login would verify against. Base64. Not yet checked at login — see claude/19_S3_S5_Dispatch_and_Field.md.
   * Required for hardware; optional for `web_fallback`, a browser that holds no key of its own (stored empty).
   */
  readonly publicKey?: string;
  /** Where this hardware is provisioned. Required — a device is an operational row and region_id is never null. */
  readonly regionId: string;
  /** Hardware the firm already owns (D-2a). Absent: the device is ours. */
  readonly firmId?: string;
};
export type RegisterDeviceOutput = { readonly id: string; readonly orgId: string; readonly regionId: string; readonly eventId: string };

export type GrantShiftInput = {
  readonly deviceId: string; readonly crewId: string;
  /**
   * The technician's login (users.id). Absent: the one active login on the crew — since 0024 a
   * technician's unit is their own, so the unit names the person. Refused `not_crew_member` when
   * the crew has no active login or more than one (a shared crew made before 0024).
   */
  readonly technicianId?: string;
  /** ISO datetime, inclusive. */
  readonly windowStart: string;
  /** ISO datetime, exclusive. */
  readonly windowEnd: string;
};
export type GrantShiftOutput = { readonly id: string; readonly orgId: string; readonly regionId: string; readonly eventId: string };
/** 0038: where a grant stands now. Ended is past its window; revoked was ended early by the office. */
export type GrantState = "upcoming" | "open" | "ended" | "revoked";
export type GrantWire = {
  readonly id: string; readonly deviceId: string; readonly hardwareId: string;
  readonly crewId: string; readonly crewLabel: string;
  readonly technicianId: string; readonly technicianName: string;
  readonly windowStart: string; readonly windowEnd: string;
  readonly revokedAt: string | null;
  readonly state: GrantState;
};
/** Grants still to come, open now, or ended in the last day. */
export type ListGrantsInput = { readonly deviceId?: string };
export type ListGrantsOutput = { readonly grants: readonly GrantWire[] };
/** Move the end later. The device's session in hand keeps its own expiry; signing in again picks up the new end. */
export type ExtendShiftInput = { readonly grantId: string; readonly windowEnd: string };
export type ExtendShiftOutput = { readonly id: string; readonly windowEnd: string; readonly eventId: string };
/** End it now. The device's token is refused on its next request; no grace period. */
export type RevokeShiftInput = { readonly grantId: string };
export type RevokeShiftOutput = { readonly id: string; readonly revokedAt: string; readonly endedSessions: number; readonly eventId: string };

export type AssignInput = { readonly jobId: string; readonly crewId: string; readonly orgId: string; readonly regionId: string };
export type ComplianceRefusalWire = {
  readonly ok: false;
  readonly reason: "missing" | "expired_in_window" | "unverified" | "crew_inactive";
  readonly credentialKind: string;
  readonly detail: string;
};
export type AssignOutput =
  | { readonly ok: true; readonly assignmentId: string; readonly clearanceId: string; readonly eventId: string }
  | { readonly ok: false; readonly refusal: ComplianceRefusalWire; readonly eventId: string };

export type SyncMutationWire = {
  readonly mutationId: string;
  readonly deviceId: string;
  readonly deviceSeq: number;
  readonly entityTable: string;
  readonly entityId: string;
  readonly op: "insert" | "update" | "transition";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly clientObservedVersion: number | null;
  readonly deviceAt: string;
};
export type SyncReplayInput = { readonly orgId: string; readonly regionId: string; readonly mutations: readonly SyncMutationWire[] };
export type ServerStateWire = { readonly version: number; readonly state?: string; readonly fields: Readonly<Record<string, unknown>> };
export type SyncOutcomeWire =
  | { readonly outcome: "applied"; readonly mutationId: string; readonly newVersion: number }
  | { readonly outcome: "duplicate"; readonly mutationId: string }
  | { readonly outcome: "superseded"; readonly mutationId: string; readonly note: string; readonly serverState: ServerStateWire | null }
  | { readonly outcome: "queued_for_human"; readonly mutationId: string; readonly note: string; readonly serverState: ServerStateWire | null }
  | { readonly outcome: "rejected"; readonly mutationId: string; readonly note: string };
export type SyncReplayOutput = { readonly outcomes: readonly SyncOutcomeWire[] };

// ---- item 10 wire shapes: the HQ rollup ----
export type HqMetricsInput = { readonly day?: string };
export type HqRegionWire = {
  readonly id: string; readonly code: string; readonly name: string; readonly active: boolean;
  /** False for UNASSIGNED — where leads wait before the office places them. */
  readonly placed: boolean;
};
export type HqValueWire = {
  readonly regionId: string; readonly metric: string;
  /** A count or integer minor units, as a string: bigint on the wire, like every *_minor. */
  readonly value: string;
};
export type HqMetricsOutput = {
  /** The UTC day the values close, or null when no rollup has ever run. */
  readonly day: string | null;
  /** When the worker computed them. The one thing S4's degraded line promises to show. */
  readonly asOf: string | null;
  readonly refreshMinutes: number;
  readonly regions: readonly HqRegionWire[];
  readonly values: readonly HqValueWire[];
};
export type HqHistoryInput = { readonly metric: string; readonly days?: number };
export type HqHistoryPointWire = { readonly day: string; readonly regionId: string; readonly value: string };
export type HqHistoryOutput = { readonly metric: string; readonly days: number; readonly points: readonly HqHistoryPointWire[] };

// ---- item 11 wire shapes: procurement ----
export type VendorStatus = "active" | "suspended" | "terminated";
export type VendorWire = { readonly id: string; readonly legalName: string; readonly status: VendorStatus; readonly regionId: string; readonly paymentTermsDays: number; readonly contactEmail: string | null };
export type ListVendorsOutput = { readonly vendors: readonly VendorWire[] };
export type CreateVendorInput = { readonly legalName: string; readonly regionId: string; readonly paymentTermsDays?: number; readonly contactEmail?: string };
export type CreateVendorOutput = { readonly id: string; readonly eventId: string };

export type ReceivingTier = "location_stock" | "regional_hub" | "national";
export type ReceivingPointWire = { readonly id: string; readonly code: string; readonly tier: ReceivingTier; readonly regionId: string; readonly address: AddressWire; readonly active: boolean };
export type ListReceivingPointsOutput = { readonly receivingPoints: readonly ReceivingPointWire[] };
export type CreateReceivingPointInput = { readonly code: string; readonly tier: ReceivingTier; readonly regionId: string; readonly address: AddressWire };
export type CreateReceivingPointOutput = { readonly id: string; readonly eventId: string };

export type PriceState = "proposed" | "accepted" | "rejected" | "withdrawn";
export type CatalogPriceWire = {
  readonly id: string; readonly itemId: string; readonly vendorId: string;
  /** Integer minor units as a string. */
  readonly priceMinor: string; readonly currency: string;
  readonly effectiveFrom: string; readonly effectiveTo: string | null;
  readonly state: PriceState; readonly proposedAt: string; readonly decidedAt: string | null; readonly decisionNote: string | null;
};
export type CatalogItemWire = {
  readonly id: string; readonly vendorId: string; readonly vendorSku: string; readonly description: string; readonly uom: string; readonly active: boolean;
  /** The accepted price whose window includes today, or null. What a new purchase order line takes. */
  readonly current: CatalogPriceWire | null;
  /** Every proposal waiting on the office, oldest first. */
  readonly proposals: readonly CatalogPriceWire[];
};
export type ListCatalogInput = { readonly vendorId?: string };
export type ListCatalogOutput = { readonly items: readonly CatalogItemWire[] };
export type AddCatalogItemInput = { readonly vendorId: string; readonly vendorSku: string; readonly description: string; readonly uom?: string };
export type AddCatalogItemOutput = { readonly id: string; readonly eventId: string };
export type ProposePriceInput = { readonly itemId: string; readonly priceMinor: string; readonly currency: string; readonly effectiveFrom: string };
export type ProposePriceOutput = { readonly id: string; readonly eventId: string };
export type WithdrawPriceInput = { readonly priceId: string };
export type WithdrawPriceOutput = { readonly id: string; readonly eventId: string };
export type DecidePriceInput = { readonly priceId: string; readonly decision: "accepted" | "rejected"; readonly note?: string };
export type DecidePriceOutput = { readonly id: string; readonly state: PriceState; readonly closedId: string | null; readonly eventId: string };

export type PoState = "draft" | "issued" | "acknowledged" | "received" | "cancelled";
export type PurchaseOrderWire = {
  readonly id: string; readonly number: string; readonly vendorId: string; readonly vendorName: string | null;
  readonly receivingPointId: string; readonly receivingPointCode: string | null; readonly receivingTier: ReceivingTier | null; readonly regionId: string;
  readonly state: PoState; readonly currency: string; readonly totalMinor: string;
  readonly issuedAt: string | null; readonly acknowledgedAt: string | null; readonly promisedShipOn: string | null; readonly createdAt: string;
};
export type ListPurchaseOrdersInput = { readonly state?: PoState };
export type ListPurchaseOrdersOutput = { readonly orders: readonly PurchaseOrderWire[] };
export type PoLineWire = {
  readonly id: string; readonly lineNo: number; readonly itemId: string; readonly vendorSku: string; readonly description: string; readonly uom: string;
  /** Integer thousandths as strings. */
  /** invoicedMilli counts MATCHED invoices only — a held invoice does not use up the receipt. */
  readonly quantityMilli: string; readonly shippedMilli: string; readonly receivedMilli: string; readonly invoicedMilli: string; readonly returnedMilli: string;
  readonly unitPriceMinor: string; readonly amountMinor: string;
};
export type ShipmentWire = { readonly id: string; readonly shippedOn: string; readonly carrier: string; readonly tracking: string | null; readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string }[] };
export type ReceiptWire = { readonly id: string; readonly poLineId: string; readonly quantityMilli: string; readonly receivedAt: string };
export type MatchNoteWire = { readonly poLineId: string | null; readonly code: string; readonly message: string };
export type VendorInvoiceWire = {
  readonly id: string; readonly poId: string; readonly poNumber: string | null; readonly vendorId: string; readonly invoiceNumber: string; readonly invoiceDate: string;
  readonly totalMinor: string; readonly currency: string; readonly matchState: "matched" | "held"; readonly matchNotes: readonly MatchNoteWire[]; readonly createdAt: string;
  readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string; readonly unitPriceMinor: string; readonly amountMinor: string }[];
};
export type RmaState = "requested" | "authorized" | "rejected";
export type RmaWire = {
  readonly id: string; readonly poId: string; readonly poNumber: string | null; readonly poLineId: string; readonly vendorId: string; readonly quantityMilli: string; readonly reason: string;
  readonly state: RmaState; readonly rmaNumber: string | null; readonly vendorNote: string | null; readonly createdAt: string; readonly respondedAt: string | null;
};
export type PurchaseOrderDetailInput = { readonly poId: string };
export type PurchaseOrderDetailOutput = {
  readonly order: PurchaseOrderWire; readonly receivingPoint: ReceivingPointWire | null; readonly lines: readonly PoLineWire[];
  readonly shipments: readonly ShipmentWire[]; readonly receipts: readonly ReceiptWire[]; readonly invoices: readonly VendorInvoiceWire[]; readonly returns: readonly RmaWire[];
};
export type CreatePurchaseOrderInput = { readonly vendorId: string; readonly receivingPointId: string; readonly lines: readonly { readonly itemId: string; readonly quantityMilli: string }[] };
export type CreatePurchaseOrderOutput = { readonly id: string; readonly number: string; readonly totalMinor: string; readonly eventId: string };
export type PoIdInput = { readonly poId: string };
export type CancelPurchaseOrderInput = { readonly poId: string; readonly reason?: string };
export type PoTransitionOutput = { readonly id: string; readonly state: PoState; readonly eventId: string };
export type AcknowledgePurchaseOrderInput = { readonly poId: string; readonly promisedShipOn: string };
export type RecordShipmentInput = { readonly poId: string; readonly shippedOn: string; readonly carrier: string; readonly tracking?: string; readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string }[] };
export type RecordShipmentOutput = { readonly id: string; readonly eventId: string };
export type RecordReceiptInput = { readonly poId: string; readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string }[] };
export type RecordReceiptOutput = { readonly ids: readonly string[]; readonly state: PoState; readonly eventId: string };
export type SubmitVendorInvoiceInput = { readonly poId: string; readonly invoiceNumber: string; readonly invoiceDate: string; readonly documentKey?: string; readonly lines: readonly { readonly poLineId: string; readonly quantityMilli: string; readonly unitPriceMinor: string }[] };
export type SubmitVendorInvoiceOutput = { readonly id: string; readonly matchState: "matched" | "held"; readonly matchNotes: readonly MatchNoteWire[]; readonly totalMinor: string; readonly eventId: string };
export type ListVendorInvoicesInput = { readonly poId?: string };
export type ListVendorInvoicesOutput = { readonly invoices: readonly VendorInvoiceWire[] };
export type RequestReturnInput = { readonly poId: string; readonly poLineId: string; readonly quantityMilli: string; readonly reason: string };
export type RequestReturnOutput = { readonly id: string; readonly eventId: string };
export type RespondToReturnInput = { readonly rmaId: string; readonly decision: "authorized" | "rejected"; readonly rmaNumber?: string; readonly note?: string };
export type RespondToReturnOutput = { readonly id: string; readonly state: RmaState; readonly eventId: string };
export type ListReturnsInput = { readonly poId?: string };
export type ListReturnsOutput = { readonly returns: readonly RmaWire[] };

export type HealthOutput = { readonly ok: true; readonly surfaces: readonly SurfaceId[] };

/**
 * A TENANT'S THEME, on the wire.
 *
 * `overrides` is the accent slots and nothing else — packages/tokens
 * BRAND_OVERRIDABLE is the list, and the gateway refuses a key outside it with
 * the reason. The structural tokens, the focus ring and the state ramp are not
 * here because a themeable focus ring is an accessibility regression shipped
 * under someone else's logo, and a themeable state ramp is an instrument a
 * tenant re-keyed.
 *
 * `host` is the key, not the org id: the browser asking for a theme has not
 * authenticated yet and cannot be trusted to name an org. It names where it is,
 * and the gateway decides whose that is.
 */
export type BrandThemeInput = {
  readonly host: string;
  readonly orgId: string;
  readonly regionId: string;
  /** The tenant's brand colour, gated separately from the slots — see `admission`. */
  readonly accent: string;
  readonly overrides: Readonly<Record<string, string>>;
};

/** Where an accent may be painted. Narrower than "admitted": the gate refuses the slot, never the tenant. */
export type AccentAdmissionWire = {
  readonly stateSurfaces: boolean;
  readonly achromatic: boolean;
  readonly minSeparation: number;
  readonly nearestState: string;
  readonly tiers: Readonly<Record<string, { readonly text: boolean; readonly fill: boolean }>>;
  readonly notes: readonly string[];
};

export type BrandThemeOutput = {
  readonly host: string;
  readonly eventId: string;
  readonly admission: AccentAdmissionWire;
};

/**
 * What the shell installs. `css` is already scoped by packages/tokens
 * TENANT_SCOPE, so it cannot reach the field frame whatever a surface does
 * with it, and `tenant` is false for a host with no theme — which is a plain
 * answer, not a 404, so this route says nothing about which tenants exist.
 */
export type BrandStylesheetInput = { readonly host?: string };
export type BrandStylesheetOutput = {
  readonly tenant: boolean;
  readonly css: string;
  readonly admission: AccentAdmissionWire | null;
};

/**
 * ITEM 8 — S1's wire shapes.
 *
 * `CoverageMetro` is two fields on purpose. Every other read in this file
 * widens as the surface needs it; this one is the public claim, and the
 * narrowest thing that answers "are you in my city" is a name.
 */
export type CoverageMetro = { readonly code: string; readonly name: string };
export type CoverageOutput = { readonly metros: readonly CoverageMetro[] };

export type AnonymousSessionOutput = {
  /** Also set as the httpOnly `ac_session` cookie. Short-lived; a visitor is not a session to resume. */
  readonly token: string;
  readonly expiresAt: string;
};

/**
 * WHERE THE LEAD CAME FROM, as data. A source typed into a handler is a
 * funnel nobody can count; adding one is a diff here and a diff on 0008's
 * check constraint, which is exactly as hard as it should be.
 */
export const LEAD_SOURCES = ["web_form", "call_button", "referral"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * What a stranger hands us. No account, no site, no equipment — those are
 * things a customer has, and this is the surface for people who are not one
 * yet. `requestedMetro` is free text and stays free text: it is what they
 * typed, not a resolved region, and resolving it is S2's job when the lead is
 * worked (`converted_account_id`).
 */
export type LeadContact = {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly note?: string;
};
export type SubmitLeadInput = {
  /**
   * Minted by the browser ONCE, when the visitor presses the button, and
   * replayed unchanged until the gateway answers. The unique index behind it
   * (migration 0008) is what makes S1's durable buffer safe to retry: a
   * replay that already landed loses to the constraint and comes back as
   * `leads_submission_id_key`, which the buffer reads as "done" rather than
   * as a failure. Without it, "queue and replay" means phoning the same
   * person once per reconnection.
   */
  readonly submissionId: string;
  readonly source: LeadSource;
  readonly contact: LeadContact;
  readonly requestedMetro?: string;
};
export type SubmitLeadOutput = { readonly id: string; readonly eventId: string };

export type RecordCallInput = {
  readonly leadId?: string;
  readonly direction: "inbound" | "outbound";
  readonly occurredAt: string;
};
export type RecordCallOutput = { readonly id: string; readonly eventId: string };
