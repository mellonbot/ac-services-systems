import type { CrewDocumentSummary, CrewKind } from "../../../packages/contracts/src/operations.ts";
import { INTERNAL_ORG_ID } from "../../../packages/schema/src/tenancy.ts";
import { LoginInputError } from "./errors.ts";

/** An install crew (0024). A service unit is never added here: it is made with its technician's login. */
export type NewCompany =
  | { readonly type: "ours"; readonly name: string; readonly regionId: string }
  | { readonly type: "contractor"; readonly name: string; readonly firm:
        | { readonly existing: string }
        | { readonly legalName: string; readonly regionId: string; readonly paymentTermsDays: number;
            readonly dataRightsReserved: boolean; readonly msaSignedAt: string | null } };

export type NewFirm = Exclude<Extract<NewCompany, { type: "contractor" }>["firm"], { existing: string }>;

export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

export const normaliseName = (s: string): string => s.trim().replace(/\s+/g, " ");

export const sameName = (a: string, b: string): boolean => normaliseName(a).toLowerCase() === normaliseName(b).toLowerCase();

export type FirmRows = {
  readonly organization: { readonly id: string; readonly name: string };
  readonly firm: {
    readonly id: string; readonly region_id: string; readonly legal_name: string; readonly settlement_terms_days: number;
    readonly msa_signed_at: string | null; readonly diagnostic_data_rights_reserved: boolean;
  };
};

const isRealDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
};

const requireName = (s: string): string => {
  const name = normaliseName(s);
  if (name === "") throw new LoginInputError("The name cannot be empty.");
  return name;
};

export const buildFirmRows = (id: string, f: NewFirm): FirmRows => {
  const legalName = requireName(f.legalName);
  if (!Number.isInteger(f.paymentTermsDays) || f.paymentTermsDays < 0) {
    throw new LoginInputError("The payment terms must be a whole number of days, 0 or more.");
  }
  if (typeof f.dataRightsReserved !== "boolean") {
    throw new LoginInputError("Choose whether diagnostic data rights are reserved (Yes or No).");
  }
  if (f.msaSignedAt !== null && !isRealDate(f.msaSignedAt)) {
    throw new LoginInputError("The MSA signed date must be a real date (YYYY-MM-DD).");
  }
  return {
    organization: { id, name: legalName },
    firm: {
      id, region_id: f.regionId, legal_name: legalName, settlement_terms_days: f.paymentTermsDays,
      msa_signed_at: f.msaSignedAt, diagnostic_data_rights_reserved: f.dataRightsReserved,
    },
  };
};

export type CrewRow = {
  readonly org_id: string; readonly region_id: string; readonly home_region_id: string; readonly label: string;
  readonly employment_type: "employed" | "subcontracted"; readonly firm_id: string | null; readonly kind: CrewKind;
};

export const buildCrewRow = (
  name: string,
  placement: { readonly type: "ours"; readonly regionId: string }
    | { readonly type: "contractor"; readonly firmId: string; readonly firmOrgId: string; readonly firmRegionId: string },
  kind: CrewKind,
): CrewRow => {
  const label = requireName(name);
  return placement.type === "ours"
    ? { org_id: INTERNAL_ORG_ID, region_id: placement.regionId, home_region_id: placement.regionId, label, employment_type: "employed", firm_id: null, kind }
    : { org_id: placement.firmOrgId, region_id: placement.firmRegionId, home_region_id: placement.firmRegionId, label, employment_type: "subcontracted", firm_id: placement.firmId, kind };
};

export const documentsLabel = (s: CrewDocumentSummary): string => {
  if (s.satisfied.length === s.required.length) return "Ready";
  const kinds = (xs: readonly string[]) => xs.map((x) => x.replaceAll("_", " ")).join(", ");
  return ([["Missing", s.missing], ["Unverified", s.unverified], ["Expired", s.expired]] as const)
    .filter(([, xs]) => xs.length > 0)
    .map(([label, xs]) => `${label}: ${kinds(xs)}`)
    .join(" · ");
};
