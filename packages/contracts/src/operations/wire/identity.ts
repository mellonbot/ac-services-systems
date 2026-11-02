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

export type LoginInput = { readonly email: string; readonly password: string; readonly surface: SurfaceId };
export type LoginOutput = {
  /** Also set as the httpOnly `ac_session` cookie. A browser surface ignores this field; devices and tests use it as a bearer. */
  readonly token: string;
  readonly expiresAt: string;
  readonly context: Pick<HierarchyContext, "path" | "parent" | "regions" | "activeRegionId" | "segment">;
};
export type LogoutOutput = { readonly ok: true; readonly sessionId: string };

/**
 * S1, THE FRONT DOOR. One form for everyone; the gateway decides where the
 * person belongs. `hardwareId` makes it a field-device sign-in (S5, the same
 * check as `auth.deviceLogin`). `surface` answers a `choose`: the same
 * credentials again, naming one of the surfaces offered.
 */
export type SignInInput = {
  readonly email: string;
  readonly password: string;
  readonly hardwareId?: string;
  readonly surface?: SurfaceId;
};
export type SignInDestination = { readonly surface: SurfaceId; readonly name: string; readonly path: string };
export type SignInOutput =
  /** A session was minted for `surface` and set as the httpOnly cookie. The browser goes to `path`. */
  | { readonly kind: "signed_in"; readonly surface: SurfaceId; readonly path: string; readonly token: string; readonly expiresAt: string }
  /** This login opens more than one live surface. No session yet: sign in again with one of these as `surface`. */
  | { readonly kind: "choose"; readonly choices: readonly SignInDestination[] };

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
export type DeviceLoginInput = { readonly hardwareId: string; readonly email: string; readonly password: string };
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
