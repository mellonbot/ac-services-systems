import type { BillingPath } from "./agreements.ts";
import type { LeadContact } from "./work.ts";

// ---- C1 wire shapes ----
export type RegionWire = { readonly id: string; readonly code: string; readonly name: string; readonly timezone: string; readonly minCrewDensity: number; readonly active: boolean };
export type ListRegionsOutput = { readonly regions: readonly RegionWire[] };

export type OrganizationKind = "customer" | "subcontractor";
export type ListOrganizationsInput = { readonly kind?: OrganizationKind };
/** Residential or commercial (R1: fixed once set). Customers only — null for every other kind of organization. */
export type CustomerSegment = "residential" | "commercial";
export type OrganizationWire = { readonly id: string; readonly name: string; readonly kind: OrganizationKind; readonly segment: CustomerSegment | null; readonly externalRef: string | null; readonly active: boolean; readonly regionNodeCount: number };
export type ListOrganizationsOutput = { readonly organizations: readonly OrganizationWire[] };

export type CreateOrganizationInput = {
  readonly name: string;
  readonly kind?: OrganizationKind;
  /** Defaults to commercial — this is the multi-node door. A home goes through customers.createResidential. */
  readonly segment?: CustomerSegment;
  readonly externalRef?: string;
  /** The first region node — created in the same unit of work. A parent never exists without a place we serve it from. */
  readonly firstRegionNode: { readonly regionId: string; readonly name: string };
};
export type CreateOrganizationOutput = { readonly orgId: string; readonly regionNodeId: string; readonly eventId: string };

export type CreateResidentialInput = {
  /** The household's name, e.g. "Turner residence". */
  readonly name: string;
  /** OUR service region the home is dispatched from. */
  readonly regionId: string;
  /** Where the home is. line1 is required — it names the household. */
  readonly address: AddressWire;
  readonly externalRef?: string;
  /** The homeowner, recorded as the household's primary contact. */
  readonly contact?: { readonly name: string; readonly phone?: string; readonly email?: string };
};
export type CreateResidentialOutput = {
  readonly orgId: string; readonly regionNodeId: string; readonly locationId: string; readonly siteId: string;
  /** The standard home agreement the home is on from today, already active. */
  readonly contractId: string;
  readonly eventId: string;
  /** D14's caveats from opening the household's location, if any. */
  readonly caveats: readonly string[];
};
export type LeadWire = {
  readonly id: string; readonly source: string; readonly contact: LeadContact; readonly requestedMetro: string | null;
  readonly createdAt: string;
  /** The home (site) this lead became, once converted. */
  readonly convertedAccountId: string | null;
};
export type ListLeadsInput = { readonly include?: "waiting" | "all" };
export type ListLeadsOutput = { readonly leads: readonly LeadWire[] };
export type ConvertLeadInput = {
  readonly leadId: string;
  readonly regionId: string;
  readonly address: AddressWire;
  /** Defaults to the name the visitor gave. */
  readonly name?: string;
};
export type ConvertLeadOutput = CreateResidentialOutput & { readonly leadId: string };

export type AccountTierWire = "region" | "location" | "site";
export type AccountWire = {
  readonly id: string; readonly tier: AccountTierWire; readonly name: string; readonly parentId: string | null; readonly regionId: string;
  readonly customerGroup: string | null; readonly externalRef: string | null; readonly timezone: string | null; readonly active: boolean;
  /** Ancestor ids, region node first, this node last. */
  readonly path: readonly string[];
  /** Item 9: the node's address as recorded, or null. See AddressWire. */
  readonly address: AddressWire | null;
};
export type ListAccountsInput = { readonly orgId: string };
export type ListAccountsOutput = { readonly nodes: readonly AccountWire[] };

export type CreateAccountInput = {
  readonly orgId: string;
  readonly tier: AccountTierWire;
  /** Absent for a region node (its parent is the organization); required below. */
  readonly parentId?: string;
  /** OUR region — for tier "region" only, where it is the binding. Below that it derives from the parent edge and is refused as an input. */
  readonly regionId?: string;
  readonly name: string;
  readonly customerGroup?: string;
  readonly externalRef?: string;
  readonly address?: Readonly<Record<string, unknown>>;
  readonly timezone?: string;
};
export type CreateAccountOutput = {
  readonly id: string; readonly regionId: string; readonly eventId: string;
  /** Admitted with a caveat rather than refused — "D14 rule not set for <region>". S2 renders these as a banner, not a modal. */
  readonly caveats: readonly string[];
};

export type MoveAccountInput = { readonly accountId: string; readonly newParentId: string };
export type MoveAccountOutput = { readonly id: string; readonly regionId: string; readonly movedDescendants: number; readonly eventId: string };

export type UpdateAccountInput = {
  readonly accountId: string;
  readonly name?: string; readonly customerGroup?: string | null; readonly externalRef?: string | null;
  readonly address?: Readonly<Record<string, unknown>> | null; readonly timezone?: string | null; readonly active?: boolean;
};
export type UpdateAccountOutput = { readonly id: string; readonly eventId: string };

// ---- item 9: the site record ----
/**
 * The shape `accounts.address` carries when it carries one. Every field is
 * optional because an address arrives as a customer wrote it on a contract;
 * `lat`/`lng` are what the imagery and any routing need, and are absent until
 * someone records them (accounts.update takes the whole object).
 */
export type AddressWire = {
  readonly line1?: string; readonly line2?: string; readonly city?: string; readonly state?: string; readonly postal?: string; readonly country?: string;
  readonly lat?: number; readonly lng?: number;
};
export type EquipmentKind = "rtu" | "split" | "package" | "ahu" | "chiller" | "boiler" | "heat_pump" | "mini_split" | "vrf" | "exhaust" | "mau" | "controls" | "other";
export type EquipmentWire = {
  readonly id: string; readonly siteId: string; readonly kind: EquipmentKind; readonly label: string | null;
  readonly manufacturer: string | null; readonly model: string; readonly serial: string | null;
  readonly installedOn: string | null;
  /** Integer thousandths of a ton, as a string on the wire — the rule every `*_milli` and `*_minor` column follows. Null when unknown. */
  readonly tonnageMilli: string | null; readonly active: boolean;
  /** The latest completed/invoiced job that named this unit, by its window end. Null when none has. Derived, never stored. */
  readonly lastServicedAt: string | null; readonly lastServicedJobId: string | null; readonly lastServicedServiceCode: string | null;
  /** How many jobs have named this unit, any state. */
  readonly jobCount: number;
};
export type ListEquipmentInput = { readonly siteId: string };
export type ListEquipmentOutput = { readonly equipment: readonly EquipmentWire[] };
export type RegisterEquipmentInput = {
  readonly siteId: string; readonly kind: EquipmentKind; readonly model: string;
  readonly label?: string; readonly manufacturer?: string; readonly serial?: string; readonly installedOn?: string;
  /** Integer thousandths of a ton, as a string ("7500" is 7.5 tons). */
  readonly tonnageMilli?: string;
};
export type RegisterEquipmentOutput = { readonly id: string; readonly eventId: string };

export type ContactRole = "site_manager" | "facilities" | "accounts_payable" | "security" | "other";
export type ContactWire = {
  readonly id: string;
  /** The node the contact is recorded at — the site itself, or an ancestor it inherits from. */
  readonly accountId: string; readonly accountName: string; readonly accountTier: AccountTierWire;
  readonly role: ContactRole; readonly name: string; readonly phone: string | null; readonly email: string | null; readonly note: string | null;
  readonly isPrimary: boolean; readonly active: boolean;
};
export type ListContactsInput = { readonly accountId: string };
export type ListContactsOutput = { readonly contacts: readonly ContactWire[] };
export type SetContactInput = {
  readonly accountId: string; readonly role?: ContactRole; readonly name: string;
  readonly phone?: string; readonly email?: string; readonly note?: string; readonly isPrimary?: boolean;
  /** Replace this contact rather than add one. */
  readonly contactId?: string; readonly active?: boolean;
};
export type SetContactOutput = { readonly id: string; readonly eventId: string };

export type InvoiceLineWire = {
  readonly id: string; readonly locationId: string; readonly jobId: string | null; readonly description: string;
  /** Integer thousandths, as a string on the wire. */
  readonly quantityMilli: string;
  /** Integer minor units, as strings on the wire (money is never a float). */
  readonly unitPriceMinor: string; readonly amountMinor: string;
};
export type InvoiceWire = {
  readonly id: string; readonly billToTier: "parent" | "region" | "location" | "site"; readonly billToId: string; readonly contractId: string;
  readonly billingPath: BillingPath; readonly periodStart: string | null; readonly periodEnd: string | null;
  /** The whole invoice's total — the consolidated header — as minor units. */
  readonly totalMinor: string; readonly currency: string; readonly issuedAt: string | null; readonly dueAt: string | null;
  /** 0030, derived from the invoice's payments: never stored. Past due is `open` or `partially_paid` with `dueAt` behind now — a reading, not a status. */
  readonly status: InvoiceStatus;
  /** Succeeded payments against the WHOLE invoice, minor units — set beside `totalMinor`, not `subtotalMinor`. */
  readonly paidMinor: string;
  readonly voidedAt: string | null; readonly voidReason: string | null;
  /** The lines this principal may see on it, at the node asked for. */
  readonly lines: readonly InvoiceLineWire[];
  /** Sum of `lines` — what the node asked for was billed on this invoice. */
  readonly subtotalMinor: string;
};
export type InvoiceStatus = "draft" | "open" | "partially_paid" | "paid" | "void";
export const invoiceStatusOf = (r: { readonly issuedAt: string | null; readonly voidedAt: string | null; readonly totalMinor: string; readonly paidMinor: string }): InvoiceStatus =>
  r.voidedAt ? "void"
    : !r.issuedAt ? "draft"
    : BigInt(r.paidMinor) >= BigInt(r.totalMinor) ? "paid"
    : BigInt(r.paidMinor) > 0n ? "partially_paid"
    : "open";
export const PAYMENT_METHODS = ["ach", "wire", "check", "card", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentState = "pending" | "succeeded" | "failed" | "returned" | "refunded";
export type PaymentWire = {
  readonly id: string; readonly invoiceId: string; readonly amountMinor: string; readonly currency: string;
  readonly method: PaymentMethod; readonly reference: string | null; readonly state: PaymentState;
  readonly receivedAt: string; readonly returnedAt: string | null; readonly returnReason: string | null;
};
export type ListPaymentsInput = { readonly invoiceId: string };
export type ListPaymentsOutput = { readonly payments: readonly PaymentWire[] };
export type PaymentWebhookInput = {
  readonly invoiceId: string; readonly amountMinor: string; readonly method: PaymentMethod;
  readonly reference?: string; readonly receivedAt?: string;
};
export type RecordPaymentInput = {
  readonly invoiceId: string; readonly amountMinor: string; readonly method: PaymentMethod;
  readonly reference?: string; readonly receivedAt?: string;
};
export type ReturnPaymentInput = { readonly paymentId: string; readonly reason: string; readonly as?: "returned" | "refunded" };
/** What a payment write left the invoice at, so the caller need not refetch to know. */
export type PaymentOutput = { readonly payment: PaymentWire; readonly invoiceStatus: InvoiceStatus; readonly paidMinor: string; readonly eventId: string };
export type VoidInvoiceInput = { readonly invoiceId: string; readonly reason: string };
export type VoidInvoiceOutput = { readonly invoiceId: string; readonly voidedAt: string; readonly eventId: string };
export type ListInvoicesInput = { readonly siteId?: string; readonly locationId?: string };
export type ListInvoicesOutput = { readonly invoices: readonly InvoiceWire[] };

export type SiteImageryInput = { readonly siteId: string };
export type SiteImageryOutput = {
  readonly siteId: string;
  readonly lat: number | null; readonly lng: number | null;
  /** A data: URL the card can draw, or null with `unavailable` saying why. */
  readonly image: string | null;
  readonly attribution: string | null;
  readonly unavailable: "not_configured" | "no_coordinates" | "provider_unreachable" | null;
};
/** The zooms sites.mapTile serves, and how many tiles either side of the site's own tile it will reach at each. The surface clamps its pan to the same box. */
export const MAP_ZOOM_MIN = 10, MAP_ZOOM_MAX = 19, MAP_TILE_REACH = 4;
/** Web-mercator tile coordinates of a point at zoom z, fractional — floor them for the tile, keep the fraction for where in it. */
export const tileOf = (lat: number, lng: number, z: number): { readonly x: number; readonly y: number } => {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};
export type LocateSiteInput = { readonly siteId: string };
export type LocateSiteOutput = {
  readonly siteId: string;
  readonly lat: number | null; readonly lng: number | null;
  /** recorded: it already had coordinates; located: the geocoder found it and they were written. Otherwise why there is no pin. */
  readonly outcome: "recorded" | "located" | "not_configured" | "no_address" | "not_found" | "provider_unreachable";
  readonly eventId: string | null;
};
export type SiteMapTileInput = { readonly siteId: string; readonly z: number; readonly x: number; readonly y: number };
export type SiteMapTileOutput = {
  readonly z: number; readonly x: number; readonly y: number;
  /** A data: URL of the tile, or null with `unavailable` saying why. */
  readonly image: string | null;
  readonly attribution: string | null;
  readonly unavailable: "not_configured" | "no_coordinates" | "provider_unreachable" | null;
};

