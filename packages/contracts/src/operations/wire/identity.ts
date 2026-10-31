import type { SurfaceId } from "../../surfaces.ts";
import type { Tier } from "../../tiers.ts";
import type { TermPolicy } from "../../terms.ts";
import type { HierarchyContext } from "../../context.ts";

// Wire shapes. Declared beside the catalogue so the generated client is typed
// without a type-checker in the generator: `OperationIO[id]["input"]` is a
// type reference the emitter writes as text.
//
// These mirror the gateway handlers' inputs and outputs structurally. The
// domain's own types (Mutation, SyncOutcome, Refusal, Resolution) live below
// contracts in the dependency order and are not imported here; the
// integration suite is what holds the two shapes together.

export type LoginInput = {
  readonly email: string; readonly password: string; readonly surface: SurfaceId;
  /**
   * 0038: only read when the login holds a temporary password a principal issued. Absent then, the sign-in is
   * refused `password_change_required` and no token is minted; present, it is set (ACCOUNT_PASSWORD_MIN..MAX,
   * not the temporary one) in the same transaction that mints the session.
   */
  readonly newPassword?: string;
};
/** 0038: the refusal code a sign-in with a temporary password gets until it carries `newPassword`. */
export const PASSWORD_CHANGE_REQUIRED = "password_change_required";
export type LoginOutput = {
  /** Also set as the httpOnly `ac_session` cookie. A browser surface ignores this field; devices and tests use it as a bearer. */
  readonly token: string;
  readonly expiresAt: string;
  readonly context: Pick<HierarchyContext, "path" | "parent" | "regions" | "activeRegionId" | "segment">;
};
export type LogoutOutput = { readonly ok: true; readonly sessionId: string };

/**
 * 0033 — THE ACCOUNT BUTTON. What a person sets about themselves. Presence is
 * what they say, never a state the system derived, so a surface draws it as a
 * word and never in a state ink.
 */
export const PRESENCES = ["available", "busy", "away", "off"] as const;
export type Presence = (typeof PRESENCES)[number];
export const PRESENCE_LABEL: Readonly<Record<Presence, string>> = { available: "Available", busy: "Busy", away: "Away", off: "Off shift" };
export const STATUS_NOTE_MAX = 80;
export const DISPLAY_NAME_MAX = 80;
/** A thumbnail, not a photo: the browser scales the picture to a small square before sending it. */
export const AVATAR_MAX_BYTES = 64 * 1024;
export const ACCOUNT_PASSWORD_MIN = 12;
export const ACCOUNT_PASSWORD_MAX = 256;
export type AvatarContentType = "image/jpeg" | "image/png";
export type MyAccountWire = {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly presence: Presence;
  readonly statusNote: string | null;
  /** Base64 bytes and their type, or null for no picture. */
  readonly avatar: { readonly contentType: AvatarContentType; readonly image: string } | null;
  readonly passwordChangedAt: string | null;
};
export type UpdateMyAccountInput = { readonly displayName?: string; readonly presence?: Presence; readonly statusNote?: string | null };
export type SetAvatarInput = { readonly dataBase64: string | null };
export type ChangePasswordInput = { readonly currentPassword: string; readonly newPassword: string };
export type ChangePasswordOutput = { readonly ok: true; readonly passwordChangedAt: string; readonly endedSessions: number };

/**
 * 0035 — messages between AC Services employees. A customer, a subcontractor
 * and a vendor are not in the directory and cannot be a recipient. "Everyone"
 * is every other active employee at the moment of the send.
 */
export const STAFF_MESSAGE_MAX = 2000;
export const STAFF_EVERYONE_GAP_SECONDS = 30;
export type StaffAudience = "direct" | "everyone";
export type StaffColleagueWire = {
  readonly userId: string;
  readonly displayName: string;
  readonly presence: Presence;
  readonly roles: readonly string[];
};
export type StaffDirectoryOutput = { readonly people: readonly StaffColleagueWire[] };
export type StaffMessageWire = {
  readonly messageId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly audience: StaffAudience;
  readonly recipientId: string | null;
  readonly recipientName: string | null;
  readonly body: string;
  readonly sentAt: string;
  readonly direction: "sent" | "received";
  readonly dismissed: boolean;
};
export type StaffPendingOutput = { readonly messages: readonly StaffMessageWire[] };
export type StaffRecentOutput = { readonly messages: readonly StaffMessageWire[] };
/** Name one person, or everyone. Not both. */
export type SendStaffMessageInput = { readonly body: string; readonly toUserId?: string; readonly everyone?: boolean };
export type SendStaffMessageOutput = { readonly messageId: string; readonly sentAt: string; readonly recipients: number };
export type DismissStaffMessageInput = { readonly messageId: string };
export type DismissStaffMessageOutput = { readonly ok: true };

/**
 * A technician's own credential plus the hardware in their hands. Unlike
 * `auth.login`, the surface is not a caller's choice among several — S5 is
 * the only one this mints for — so there is no `surface` field to lie about.
 */
export type DeviceLoginInput = {
  readonly hardwareId: string; readonly email: string; readonly password: string;
  /** 0038: as on `LoginInput` — a temporary password is replaced at the device's sign-in, not after it. */
  readonly newPassword?: string;
};
export type DeviceLoginOutput = {
  readonly token: string;
  readonly expiresAt: string;
  readonly crewId: string;
  readonly crewLabel: string;
  readonly context: Pick<HierarchyContext, "path" | "parent" | "regions" | "activeRegionId" | "segment">;
};

export type AuthorOverrideInput = {
  readonly contractId: string;
  readonly scopeTier: Tier;
  readonly scopeId: string;
  readonly termKey: string;
  /** Money is a string of integer minor units. A JSON number is a double and is refused. */
  readonly termValue: unknown;
  /** ISO date, inclusive. */
  readonly effectiveFrom: string;
  /** ISO date, exclusive; null or absent = open-ended. */
  readonly effectiveTo?: string | null;
  readonly orgId: string;
  readonly regionId: string;
};
export type AuthorOverrideOutput = { readonly id: string; readonly eventId: string };

export type ResolvedTermsInput = {
  /** Defaults to the principal's org. */
  readonly orgId?: string;
  /** Defaults to `site`. */
  readonly tier?: Tier;
  readonly nodeId: string;
  /** ISO date. Defaults to the gateway's today. A disputed February job reprices against February by saying "February" here. */
  readonly asOf?: string;
  /** Comma-separated on the query string. Absent = every registered term; the trace panel asks for one. */
  readonly termKeys?: string;
};
export type TraceStepWire = {
  readonly tier: Tier; readonly id: string;
  readonly outcome: "no_override" | "candidate" | "won" | "not_walked";
  readonly value?: unknown; readonly overrideId?: string; readonly note?: string;
};
export type ResolutionWire = {
  readonly termKey: string;
  readonly value: unknown;
  readonly wonAt: { readonly tier: Tier; readonly id: string } | "fallback";
  readonly policy: TermPolicy;
  readonly trace: readonly TraceStepWire[];
  readonly asOf: string;
};
export type ResolvedTermsOutput = {
  readonly resolved: Readonly<Record<string, ResolutionWire>>;
  readonly refused: Readonly<Record<string, { readonly code: string; readonly message: string }>>;
};

/**
 * 0038 — PEOPLE. The company's own logins, managed in S2 by a principal: staff,
 * and technicians, each made with their own service unit (0024). Customer,
 * firm and vendor logins are not here. A temporary password is in the output
 * of the call that made it and nowhere else — the gateway keeps its hash.
 */
export type PersonKind = "staff" | "technician";
export type PersonWire = {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly kind: PersonKind;
  readonly roles: readonly string[];
  /** org: company-wide (S2, S4); region: one region (S3). A technician's follows their unit. */
  readonly scope: "org" | "region";
  readonly regionId: string;
  readonly regionCode: string;
  /** A technician's own service unit; null for staff. */
  readonly crewId: string | null;
  readonly crewLabel: string | null;
  /** Who employs a technician: null is us. */
  readonly firmId: string | null;
  readonly firmName: string | null;
  readonly active: boolean;
  /** A temporary password is outstanding: the person sets their own at their next sign-in. */
  readonly mustChangePassword: boolean;
  readonly passwordChangedAt: string | null;
};
export type ListPeopleOutput = { readonly people: readonly PersonWire[] };
export type CreateStaffInput = {
  readonly email: string; readonly displayName: string;
  /** From ROLES, at least one. `technician` is not a staff role here — a technician is made with their unit (people.createTechnician). */
  readonly roles: readonly string[];
  readonly scope: "org" | "region";
  /** The login's home region; with scope `region`, the one region it sees. */
  readonly regionId: string;
};
export type CreateTechnicianInput = {
  readonly email: string; readonly displayName: string;
  /** Their unit's home region — where they are dispatched. */
  readonly homeRegionId: string;
  /** A subcontractor firm that employs them. Absent: they are ours. */
  readonly firmId?: string;
};
export type CreatePersonOutput = {
  readonly userId: string;
  /** The technician's own service unit; null for staff. */
  readonly crewId: string | null;
  /** Shown once. The person must replace it at their first sign-in. */
  readonly temporaryPassword: string;
  readonly eventId: string;
};
/** Fields left out are left as they are. A technician's roles and region follow their unit and are refused here. */
export type UpdatePersonInput = {
  readonly userId: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly roles?: readonly string[];
  readonly scope?: "org" | "region";
  readonly regionId?: string;
};
export type UpdatePersonOutput = { readonly userId: string; readonly endedSessions: number; readonly eventId: string };
export type SetPersonActiveInput = { readonly userId: string; readonly active: boolean };
export type SetPersonActiveOutput = { readonly userId: string; readonly active: boolean; readonly endedSessions: number; readonly eventId: string };
export type ResetPasswordInput = { readonly userId: string };
export type ResetPasswordOutput = { readonly userId: string; readonly temporaryPassword: string; readonly endedSessions: number; readonly eventId: string };
