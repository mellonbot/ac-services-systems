import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { REQUIRED } from "../../../../packages/domain/src/compliance/gate.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";
import type {
  FirmWire, FirmStatus, ListFirmsInput, ListFirmsOutput, CreateFirmInput, CreateFirmOutput, UpdateFirmInput, UpdateFirmOutput,
  EmploymentType, CrewDocumentSummary, ListCrewsInput, ListCrewsOutput, CreateCrewInput, CreateCrewOutput, UpdateCrewInput, UpdateCrewOutput,
  CredentialWire, CredentialKind, ListCredentialsInput, ListCredentialsOutput, RecordCredentialInput, RecordCredentialOutput, VerifyCredentialInput, VerifyCredentialOutput,
  RateCardWire, ListRateCardsInput, ListRateCardsOutput, SetRateCardInput, SetRateCardOutput,
  SubmitCredentialInput, SubmitCredentialOutput, EnrollCrewInput, EnrollCrewOutput, RetireCrewInput, RetireCrewOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * C4 — THE SUBCONTRACTOR NETWORK S2 RECORDS: the firm, the crew, the document
 * and the price. Arc 5 of the actor map runs S8 → S2 → S3 → S5 → S8, and this
 * file is the S2 leg — the one place a firm becomes a crew we can legally send.
 *
 * What these handlers decide, and what they leave below:
 *
 *   - THE FIRM IS A ROOT. A subcontractor firm is a tenant (organizations row,
 *     kind subcontractor) AND an operational row (subcontractor_firms) whose id
 *     is the same uuid, because the fixture and every RLS policy already say
 *     so. `createFirm` writes both in one unit of work — no firm without an
 *     organization to settle with and a region to dispatch it from, the same
 *     move C1 made for a customer parent. `organizations.create` now refuses
 *     kind subcontractor and points here.
 *   - THE LADDER: onboarding → active ⇄ suspended → terminated. Activation
 *     needs a signed MSA (`msa_unsigned`): a firm we can legally send has a
 *     contract with us before it has a crew on a customer's roof.
 *   - A CREW'S TENANCY FOLLOWS ITS EMPLOYMENT. Employed → ours (INTERNAL_ORG),
 *     no firm named; subcontracted → the firm's row, firm required. The CHECK
 *     constraint says the same thing in a sentence nobody would read, so the
 *     handler says it first. A crew under a terminated firm is refused: nobody
 *     can dispatch it.
 *   - A DOCUMENT ARRIVES UNVERIFIED. `recordCredential` has no verified field
 *     to accept; `verifyCredential` sets it, once, to now and to the acting
 *     principal. Whether ANY path can do otherwise is the trigger's — 0005
 *     `ac_credential_verification_is_earned` refuses a verified INSERT, a
 *     verification by anyone but S2, and any change to a verified document.
 *     The handler adds `already_verified` so a second click is a refusal with
 *     a name rather than an AC403 from the database.
 *   - A RATE IS SET FROM A DAY FORWARD. The row in effect that day is closed
 *     at it (audited as its own mutation) and the new row inserted. Whether the
 *     new row OVERLAPS anything else is the EXCLUDE constraint's to refuse —
 *     `rate_cards_no_overlap`, mapped structural — not a second copy here.
 *     One case the handler does say: a rate that begins on the same day as the
 *     row in effect would leave an empty range behind, so it is refused by name.
 *
 * Money is a string of integer minor units on the wire and a bigint here.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS = /^\d+$/;

const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const requireText = (v: unknown, field: string): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new BadInput(`${field} is required`);
  return v.trim();
};
const requireDate = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !ISO_DATE.test(v)) throw new BadInput(`${field} must be an ISO date (YYYY-MM-DD)`);
  return v;
};
const requireInt = (v: unknown, field: string, min: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new BadInput(`${field} must be an integer ≥ ${min}`);
  return v;
};
const requireOneOf = <T extends string>(v: unknown, field: string, legal: readonly T[]): T => {
  if (typeof v !== "string" || !(legal as readonly string[]).includes(v)) {
    throw new BadInput(`${field} must be one of ${legal.join(", ")}`);
  }
  return v as T;
};

const FIRM_STATUSES: readonly FirmStatus[] = ["onboarding", "active", "suspended", "terminated"];
const EMPLOYMENT: readonly EmploymentType[] = ["employed", "subcontracted"];
const CREDENTIAL_KINDS: readonly CredentialKind[] = ["insurance", "license", "certification", "background_check"];

/** The ladder, as data. Suspension is reversible; termination is not. */
export const NEXT_FIRM_STATES: Readonly<Record<FirmStatus, readonly FirmStatus[]>> = Object.freeze({
  onboarding: ["active", "terminated"],
  active: ["suspended", "terminated"],
  suspended: ["active", "terminated"],
  terminated: [],
});

// ---------------------------------------------------------------------------
// Firms
// ---------------------------------------------------------------------------
type FirmRow = {
  id: string; org_id: string; region_id: string; legal_name: string; status: FirmStatus; settlement_terms_days: number;
  msa_signed_at: string | null; diagnostic_data_rights_reserved: boolean; w9_document_key: string | null;
  crew_count: string; active_crew_count: string;
};
const FIRM_COLUMNS = `f.id, f.org_id, f.region_id, f.legal_name, f.status, f.settlement_terms_days,
        to_char(f.msa_signed_at, 'YYYY-MM-DD') AS msa_signed_at,
        f.diagnostic_data_rights_reserved, f.w9_document_key,
        (SELECT count(*) FROM crews c WHERE c.firm_id = f.id) AS crew_count,
        (SELECT count(*) FROM crews c WHERE c.firm_id = f.id AND c.active) AS active_crew_count`;

const firmToWire = (f: FirmRow): FirmWire => ({
  id: f.id, legalName: f.legal_name, status: f.status, regionId: f.region_id, settlementTermsDays: f.settlement_terms_days,
  msaSignedAt: f.msa_signed_at, diagnosticDataRightsReserved: f.diagnostic_data_rights_reserved, w9DocumentKey: f.w9_document_key,
  crewCount: Number(f.crew_count), activeCrewCount: Number(f.active_crew_count),
});

export const listFirms = async (uow: UnitOfWork, input: ListFirmsInput): Promise<ListFirmsOutput> => {
  const status = input.status === undefined ? null : requireOneOf(input.status, "status", FIRM_STATUSES);
  const rows = await uow.tx.query<FirmRow>(
    `SELECT ${FIRM_COLUMNS} FROM subcontractor_firms f WHERE ($1::text IS NULL OR f.status = $1) ORDER BY f.legal_name`,
    [status],
  );
  return { firms: rows.map(firmToWire) };
};

const loadFirm = async (uow: UnitOfWork, id: string): Promise<FirmRow> => {
  const row = (await uow.tx.query<FirmRow>(`SELECT ${FIRM_COLUMNS} FROM subcontractor_firms f WHERE f.id = $1`, [id]))[0];
  if (!row) throw new InputRefused(`no firm ${id} visible in this scope`, "unknown_firm");
  return row;
};

const activeRegion = async (uow: UnitOfWork, regionId: string): Promise<{ id: string; code: string; name: string }> => {
  const r = (await uow.tx.query<{ id: string; code: string; name: string; active: boolean }>("SELECT id, code, name, active FROM regions WHERE id = $1", [regionId]))[0];
  if (!r) throw new InputRefused(`no service region ${regionId}`, "unknown_region");
  if (!r.active) throw new InputRefused(`service region ${r.name} (${r.code}) is not active — nothing is dispatched from a region we no longer serve`, "unknown_region");
  return r;
};

/**
 * One door for a firm: the tenant root and the operational row, one id, one
 * unit of work. If the region is refused, no organization is left behind.
 */
export const createFirm = async (uow: UnitOfWork, input: CreateFirmInput, newId: () => string): Promise<CreateFirmOutput> => {
  const legalName = requireText(input.legalName, "legalName");
  const region = await activeRegion(uow, requireUuid(input.regionId, "regionId"));
  const settlementTermsDays = requireInt(input.settlementTermsDays, "settlementTermsDays", 0);
  // OQ5, firm side. A 400: no position was stated, so nothing was judged.
  if (typeof input.diagnosticDataRightsReserved !== "boolean") {
    throw new BadInput("diagnosticDataRightsReserved must be stated as true or false — OQ5 is answered in the MSA, per firm, and there is no default to fall back to");
  }
  const msaSignedAt = input.msaSignedAt === undefined ? null : requireDate(input.msaSignedAt, "msaSignedAt");
  const w9 = input.w9DocumentKey === undefined ? null : requireText(input.w9DocumentKey, "w9DocumentKey");

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "subcontractor_firm", entityId: id, action: "firm.create", topic: "firm.created",
      before: null,
      after: { id, legalName, status: "onboarding", regionId: region.id, settlementTermsDays, msaSignedAt, diagnosticDataRightsReserved: input.diagnosticDataRightsReserved, w9DocumentKey: w9 },
      orgId: id, regionId: region.id,
      payload: { legalName, status: "onboarding", regionCode: region.code, diagnosticDataRightsReserved: input.diagnosticDataRightsReserved },
    },
    async (tx) => {
      await tx.query("INSERT INTO organizations (id, name, kind, external_ref) VALUES ($1, $2, 'subcontractor', $3)", [id, legalName, input.externalRef ?? null]);
      await tx.query(
        `INSERT INTO subcontractor_firms (id, org_id, region_id, legal_name, status, settlement_terms_days, msa_signed_at, diagnostic_data_rights_reserved, w9_document_key)
         VALUES ($1, $1, $2, $3, 'onboarding', $4, $5::date, $6, $7)`,
        [id, region.id, legalName, settlementTermsDays, msaSignedAt, input.diagnosticDataRightsReserved, w9],
      );
    },
  );
  return { id, regionId: region.id, eventId };
};

export const updateFirm = async (uow: UnitOfWork, input: UpdateFirmInput): Promise<UpdateFirmOutput> => {
  const firmId = requireUuid(input.firmId, "firmId");
  const current = await loadFirm(uow, firmId);

  const sets: string[] = [];
  const params: unknown[] = [firmId];
  const after: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const set = (col: string, key: string, value: unknown, was: unknown) => {
    params.push(value); sets.push(`${col} = $${params.length}`); after[key] = value; before[key] = was;
  };
  if (input.legalName !== undefined) set("legal_name", "legalName", requireText(input.legalName, "legalName"), current.legal_name);
  if (input.settlementTermsDays !== undefined) set("settlement_terms_days", "settlementTermsDays", requireInt(input.settlementTermsDays, "settlementTermsDays", 0), current.settlement_terms_days);
  if (input.msaSignedAt !== undefined) set("msa_signed_at", "msaSignedAt", input.msaSignedAt === null ? null : requireDate(input.msaSignedAt, "msaSignedAt"), current.msa_signed_at);
  if (input.w9DocumentKey !== undefined) set("w9_document_key", "w9DocumentKey", input.w9DocumentKey === null ? null : requireText(input.w9DocumentKey, "w9DocumentKey"), current.w9_document_key);

  let status: FirmStatus = current.status;
  if (input.status !== undefined) {
    const to = requireOneOf(input.status, "status", ["active", "suspended", "terminated"] as const);
    const legal = NEXT_FIRM_STATES[current.status];
    if (!legal.includes(to)) {
      throw new InputRefused(
        legal.length === 0
          ? `firm ${current.legal_name} is terminated; a terminated firm does not move again`
          : `firm ${current.legal_name} is ${current.status} and can only become ${legal.join(" or ")}, not ${to}`,
        "illegal_transition",
      );
    }
    // The MSA may be signed in the same call; read the value as it will be.
    const msa = input.msaSignedAt !== undefined ? input.msaSignedAt : current.msa_signed_at;
    if (to === "active" && !msa) {
      throw new InputRefused(
        `firm ${current.legal_name} has no MSA signed — a firm we can legally send has a contract with us before it has a crew on a roof. Record msaSignedAt first, or with this step.`,
        "msa_unsigned",
      );
    }
    status = to;
    set("status", "status", to, current.status);
  }
  if (sets.length === 0) throw new BadInput("nothing to update — name at least one attribute or a status");

  // The org row carries the name too; keep the root and the operational row saying the same thing.
  const eventId = await uow.apply(
    {
      entity: "subcontractor_firm", entityId: firmId, action: status !== current.status ? `firm.${status}` : "firm.update",
      topic: status !== current.status ? "firm.status_changed" : "firm.updated",
      before, after, orgId: current.org_id, regionId: current.region_id,
      payload: status !== current.status ? { from: current.status, to: status, legalName: current.legal_name } : { fields: Object.keys(after) },
    },
    async (tx) => {
      await tx.query(`UPDATE subcontractor_firms SET ${sets.join(", ")} WHERE id = $1`, params);
      if (input.legalName !== undefined) await tx.query("UPDATE organizations SET name = $2 WHERE id = $1", [firmId, after.legalName]);
    },
  );
  return { id: firmId, status, eventId };
};

// ---------------------------------------------------------------------------
// Crews
// ---------------------------------------------------------------------------
type CrewRow = { id: string; org_id: string; region_id: string; label: string; employment_type: EmploymentType; firm_id: string | null; home_region_id: string; active: boolean };
type CredRow = { id: string; crew_id: string; kind: CredentialKind; identifier: string; valid_from: string; valid_to: string; document_key: string | null; verified_at: string | null; verified_by: string | null };
const CRED_COLUMNS = `id, crew_id, kind, identifier, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, to_char(valid_to, 'YYYY-MM-DD') AS valid_to,
        document_key, to_char(verified_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS verified_at, verified_by`;

const credToWire = (c: CredRow): CredentialWire => ({
  id: c.id, crewId: c.crew_id, kind: c.kind, identifier: c.identifier, validFrom: c.valid_from, validTo: c.valid_to,
  documentKey: c.document_key, verifiedAt: c.verified_at, verifiedBy: c.verified_by,
});

/**
 * The gate's question, asked of today rather than of a service window, so S2
 * can see which crews the dispatch board will be able to send. Pure: the
 * REQUIRED set comes from the gate, the instant from the caller.
 */
export const summarizeDocuments = (employmentType: EmploymentType, docs: readonly CredentialWire[], today: string): CrewDocumentSummary => {
  const required = REQUIRED[employmentType];
  const satisfied: string[] = [], unverified: string[] = [], expired: string[] = [], missing: string[] = [];
  let earliest: string | null = null;
  for (const kind of required) {
    const held = docs.filter((d) => d.kind === kind);
    if (held.length === 0) { missing.push(kind); continue; }
    const good = held.filter((d) => d.verifiedAt !== null && d.validFrom <= today && d.validTo >= today);
    if (good.length === 0) { (held.some((d) => d.verifiedAt !== null) ? expired : unverified).push(kind); continue; }
    satisfied.push(kind);
    const soonest = good.reduce((a, b) => (a.validTo <= b.validTo ? a : b)).validTo;
    if (earliest === null || soonest < earliest) earliest = soonest;
  }
  return { required, satisfied, unverified, expired, missing, earliestExpiry: earliest };
};

export const listCrews = async (uow: UnitOfWork, input: ListCrewsInput, today: string): Promise<ListCrewsOutput> => {
  const firmId = input.firmId === undefined ? null : requireUuid(input.firmId, "firmId");
  const regionId = input.regionId === undefined ? null : requireUuid(input.regionId, "regionId");
  const crews = await uow.tx.query<CrewRow>(
    `SELECT id, org_id, region_id, label, employment_type, firm_id, home_region_id, active
       FROM crews WHERE ($1::uuid IS NULL OR firm_id = $1) AND ($2::uuid IS NULL OR home_region_id = $2)
      ORDER BY label`,
    [firmId, regionId],
  );
  if (crews.length === 0) return { crews: [] };
  const docs = await uow.tx.query<CredRow>(`SELECT ${CRED_COLUMNS} FROM crew_credentials WHERE crew_id = ANY($1::uuid[]) ORDER BY valid_to`, [crews.map((c) => c.id)]);
  const byCrew = new Map<string, CredentialWire[]>();
  for (const d of docs) { const w = credToWire(d); (byCrew.get(w.crewId) ?? byCrew.set(w.crewId, []).get(w.crewId)!).push(w); }
  return {
    crews: crews.map((c) => ({
      id: c.id, label: c.label, employmentType: c.employment_type, firmId: c.firm_id, homeRegionId: c.home_region_id, active: c.active,
      documents: summarizeDocuments(c.employment_type, byCrew.get(c.id) ?? [], today),
    })),
  };
};

export const createCrew = async (uow: UnitOfWork, input: CreateCrewInput, newId: () => string): Promise<CreateCrewOutput> => {
  const label = requireText(input.label, "label");
  const employmentType = requireOneOf(input.employmentType, "employmentType", EMPLOYMENT);
  const region = await activeRegion(uow, requireUuid(input.homeRegionId, "homeRegionId"));

  let firmId: string | null = null;
  let orgId: string;
  if (employmentType === "employed") {
    if (input.firmId !== undefined) {
      throw new InputRefused(`an employed crew is ours and names no firm — "${label}" declares firmId. Record it as subcontracted, or drop the firm.`, "firm_not_an_input");
    }
    orgId = INTERNAL_ORG_ID;
  } else {
    if (input.firmId === undefined) {
      throw new InputRefused(`a subcontracted crew belongs to a firm — "${label}" names none. A crew with no employer is a crew nobody settles with.`, "firm_required");
    }
    const firm = await loadFirm(uow, requireUuid(input.firmId, "firmId"));
    if (firm.status === "terminated") {
      throw new InputRefused(`firm ${firm.legal_name} is terminated — a crew rostered under it is a crew nobody can dispatch`, "firm_ended");
    }
    firmId = firm.id;
    orgId = firm.org_id;
  }

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "crew", entityId: id, action: "crew.create", topic: "crew.created",
      before: null, after: { id, label, employmentType, firmId, homeRegionId: region.id, active: true },
      orgId, regionId: region.id,
      payload: { label, firmId, regionCode: region.code },
    },
    async (tx) => {
      await tx.query(
        "INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id, active) VALUES ($1, $2, $3, $4, $5, $6, $3, true)",
        [id, orgId, region.id, label, employmentType, firmId],
      );
    },
  );
  return { id, regionId: region.id, eventId };
};

const loadCrew = async (uow: UnitOfWork, id: string): Promise<CrewRow> => {
  const row = (await uow.tx.query<CrewRow>("SELECT id, org_id, region_id, label, employment_type, firm_id, home_region_id, active FROM crews WHERE id = $1", [id]))[0];
  if (!row) throw new InputRefused(`no crew ${id} visible in this scope`, "unknown_crew");
  return row;
};

export const updateCrew = async (uow: UnitOfWork, input: UpdateCrewInput): Promise<UpdateCrewOutput> => {
  const crewId = requireUuid(input.crewId, "crewId");
  const current = await loadCrew(uow, crewId);
  const sets: string[] = []; const params: unknown[] = [crewId];
  const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
  if (input.label !== undefined) { params.push(requireText(input.label, "label")); sets.push(`label = $${params.length}`); before.label = current.label; after.label = params[params.length - 1]; }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw new BadInput("active must be true or false");
    params.push(input.active); sets.push(`active = $${params.length}`); before.active = current.active; after.active = input.active;
  }
  if (sets.length === 0) throw new BadInput("nothing to update — name label or active");
  const eventId = await uow.apply(
    {
      entity: "crew", entityId: crewId, action: "crew.update", topic: "crew.updated",
      before, after, orgId: current.org_id, regionId: current.region_id, payload: { fields: Object.keys(after) },
    },
    async (tx) => { await tx.query(`UPDATE crews SET ${sets.join(", ")} WHERE id = $1`, params); },
  );
  return { id: crewId, eventId };
};

// ---------------------------------------------------------------------------
// The roster — S8's leg (item 7). A firm's crew is the firm's row: firm,
// type and region are the PRINCIPAL's, never inputs, and 0007's
// ac_crew_roster_is_the_firms refuses a row that says otherwise from any
// path. The handler's job is the inputs and the refusals a click can produce.
// ---------------------------------------------------------------------------
export const enrollCrew = async (uow: UnitOfWork, input: EnrollCrewInput, firmId: string | null, newId: () => string): Promise<EnrollCrewOutput> => {
  const label = requireText(input.label, "label");
  if (!firmId) throw new InputRefused("this principal carries no firm — a roster belongs to a firm", "no_firm");
  // RLS: a firm principal sees one firm. If the row is not there, the token and the registry disagree, and nothing is rostered.
  const firm = await loadFirm(uow, firmId);
  if (firm.status === "terminated" || firm.status === "suspended") {
    throw new InputRefused(`firm ${firm.legal_name} is ${firm.status} — a crew rostered under it is a crew nobody can dispatch. The office lifts a suspension; a terminated firm does not roster again.`, "firm_ended");
  }
  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "crew_roster", entityId: id, action: "crew.enroll", topic: "crew.created",
      before: null, after: { id, label, employmentType: "subcontracted", firmId: firm.id, homeRegionId: firm.region_id, active: true },
      orgId: firm.org_id, regionId: firm.region_id,
      payload: { label, firmId: firm.id, enrolledBy: "firm" },
    },
    async (tx) => {
      await tx.query(
        "INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id, active) VALUES ($1, $2, $3, $4, 'subcontracted', $5, $3, true)",
        [id, firm.org_id, firm.region_id, label, firm.id],
      );
    },
  );
  return { id, firmId: firm.id, regionId: firm.region_id, eventId };
};

export const retireCrew = async (uow: UnitOfWork, input: RetireCrewInput): Promise<RetireCrewOutput> => {
  const crewId = requireUuid(input.crewId, "crewId");
  const current = await loadCrew(uow, crewId);
  const sets: string[] = []; const params: unknown[] = [crewId];
  const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
  if (input.label !== undefined) { params.push(requireText(input.label, "label")); sets.push(`label = $${params.length}`); before.label = current.label; after.label = params[params.length - 1]; }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw new BadInput("active must be true or false");
    if (input.active === false && current.active) {
      // A crew holding a live assignment is not taken off the roster from a portal: the dispatcher releases it, with a reason, on S3.
      const live = (await uow.tx.query<{ n: string }>("SELECT count(*)::text AS n FROM assignments WHERE crew_id = $1 AND released_at IS NULL", [crewId]))[0]!;
      if (Number(live.n) > 0) {
        throw new InputRefused(`crew ${current.label} holds ${live.n} live assignment${live.n === "1" ? "" : "s"} — ask the office to release the work before retiring the crew`, "crew_assigned");
      }
    }
    params.push(input.active); sets.push(`active = $${params.length}`); before.active = current.active; after.active = input.active;
  }
  if (sets.length === 0) throw new BadInput("nothing to change — name label or active");
  const eventId = await uow.apply(
    {
      entity: "crew_roster", entityId: crewId, action: input.active === false ? "crew.retire" : "crew.roster_update", topic: "crew.updated",
      before, after, orgId: current.org_id, regionId: current.region_id, payload: { fields: Object.keys(after), by: "firm" },
    },
    async (tx) => { await tx.query(`UPDATE crews SET ${sets.join(", ")} WHERE id = $1`, params); },
  );
  return { id: crewId, eventId };
};

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------
export const listCredentials = async (uow: UnitOfWork, input: ListCredentialsInput): Promise<ListCredentialsOutput> => {
  const crewId = input.crewId === undefined ? null : requireUuid(input.crewId, "crewId");
  const firmId = input.firmId === undefined ? null : requireUuid(input.firmId, "firmId");
  if (crewId === null && firmId === null) throw new BadInput("name a crewId or a firmId — the document list is not the whole network");
  const rows = await uow.tx.query<CredRow>(
    `SELECT ${CRED_COLUMNS} FROM crew_credentials
      WHERE ($1::uuid IS NULL OR crew_id = $1)
        AND ($2::uuid IS NULL OR crew_id IN (SELECT id FROM crews WHERE firm_id = $2))
      ORDER BY crew_id, kind, valid_to`,
    [crewId, firmId],
  );
  return { credentials: rows.map(credToWire) };
};

export const recordCredential = async (uow: UnitOfWork, input: RecordCredentialInput, newId: () => string): Promise<RecordCredentialOutput> => {
  const crew = await loadCrew(uow, requireUuid(input.crewId, "crewId"));
  const kind = requireOneOf(input.kind, "kind", CREDENTIAL_KINDS);
  const identifier = requireText(input.identifier, "identifier");
  const validFrom = requireDate(input.validFrom, "validFrom");
  const validTo = requireDate(input.validTo, "validTo");
  if (validTo < validFrom) {
    throw new InputRefused(`${kind} ${identifier} is valid from ${validFrom} to ${validTo} — a window that ends before it starts covers no day at all`, "empty_window");
  }
  const documentKey = input.documentKey === undefined ? null : requireText(input.documentKey, "documentKey");

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "crew_credential", entityId: id, action: "credential.record", topic: "credential.recorded",
      before: null, after: { id, crewId: crew.id, kind, identifier, validFrom, validTo, documentKey, verifiedAt: null, verifiedBy: null },
      orgId: crew.org_id, regionId: crew.region_id,
      payload: { crewId: crew.id, kind, validFrom, validTo },
    },
    async (tx) => {
      // No verified_at, no verified_by. Not "null" — ABSENT: the handler has no
      // way to say them, and the trigger refuses them from anyone who does.
      await tx.query(
        "INSERT INTO crew_credentials (id, org_id, region_id, crew_id, kind, identifier, valid_from, valid_to, document_key) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9)",
        [id, crew.org_id, crew.region_id, crew.id, kind, identifier, validFrom, validTo, documentKey],
      );
    },
  );
  return { id, eventId };
};

/**
 * S8's intake (item 7): the same row `recordCredential` writes, under the
 * firm's own entity. A firm principal's `loadCrew` finds only its own crews
 * (0005), so another firm's crew is `unknown_crew`. The INSERT names no
 * verification — the handler cannot say it, and 0005's trigger refuses it
 * from anyone who does. What the office then does is `credentials.verify`.
 */
export const submitCredential = async (uow: UnitOfWork, input: SubmitCredentialInput, newId: () => string): Promise<SubmitCredentialOutput> => {
  const crew = await loadCrew(uow, requireUuid(input.crewId, "crewId"));
  const kind = requireOneOf(input.kind, "kind", CREDENTIAL_KINDS);
  const identifier = requireText(input.identifier, "identifier");
  const validFrom = requireDate(input.validFrom, "validFrom");
  const validTo = requireDate(input.validTo, "validTo");
  if (validTo < validFrom) {
    throw new InputRefused(`${kind} ${identifier} is valid from ${validFrom} to ${validTo} — a window that ends before it starts covers no day at all`, "empty_window");
  }
  const documentKey = input.documentKey === undefined ? null : requireText(input.documentKey, "documentKey");
  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "compliance_doc", entityId: id, action: "credential.submit", topic: "credential.recorded",
      before: null, after: { id, crewId: crew.id, kind, identifier, validFrom, validTo, documentKey, verifiedAt: null, verifiedBy: null },
      orgId: crew.org_id, regionId: crew.region_id,
      payload: { crewId: crew.id, kind, validFrom, validTo, submittedBy: "firm" },
    },
    async (tx) => {
      await tx.query(
        "INSERT INTO crew_credentials (id, org_id, region_id, crew_id, kind, identifier, valid_from, valid_to, document_key) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9)",
        [id, crew.org_id, crew.region_id, crew.id, kind, identifier, validFrom, validTo, documentKey],
      );
    },
  );
  return { id, crewId: crew.id, eventId };
};

export const verifyCredential = async (uow: UnitOfWork, input: VerifyCredentialInput, actorId: string, now: Date): Promise<VerifyCredentialOutput> => {
  const credentialId = requireUuid(input.credentialId, "credentialId");
  const row = (await uow.tx.query<CredRow & { org_id: string; region_id: string }>(`SELECT ${CRED_COLUMNS}, org_id, region_id FROM crew_credentials WHERE id = $1`, [credentialId]))[0];
  if (!row) throw new InputRefused(`no credential ${credentialId} visible in this scope`, "unknown_credential");
  if (row.verified_at !== null) {
    throw new InputRefused(`${row.kind} ${row.identifier} was verified at ${row.verified_at} by ${row.verified_by} — verification happens once; a correction is a new document`, "already_verified");
  }
  const verifiedAt = now.toISOString();
  const eventId = await uow.apply(
    {
      entity: "crew_credential", entityId: credentialId, action: "credential.verify", topic: "credential.verified",
      before: { verifiedAt: null, verifiedBy: null }, after: { verifiedAt, verifiedBy: actorId },
      orgId: row.org_id, regionId: row.region_id,
      payload: { crewId: row.crew_id, kind: row.kind, validTo: row.valid_to },
    },
    async (tx) => {
      await tx.query("UPDATE crew_credentials SET verified_at = $2::timestamptz, verified_by = $3 WHERE id = $1", [credentialId, verifiedAt, actorId]);
    },
  );
  return { id: credentialId, verifiedAt, verifiedBy: actorId, eventId };
};

// ---------------------------------------------------------------------------
// Rate cards
// ---------------------------------------------------------------------------
type RateRow = { id: string; org_id: string; region_id: string; firm_id: string; service_code: string; rate_minor: string; currency: string; eff_from: string; eff_to: string | null };
const RATE_COLUMNS = `id, org_id, region_id, firm_id, service_code, rate_minor::text AS rate_minor, currency,
        to_char(lower(effective), 'YYYY-MM-DD') AS eff_from,
        CASE WHEN upper_inf(effective) THEN NULL ELSE to_char(upper(effective), 'YYYY-MM-DD') END AS eff_to`;
const rateToWire = (r: RateRow): RateCardWire => ({
  id: r.id, firmId: r.firm_id, serviceCode: r.service_code, rateMinor: r.rate_minor, currency: r.currency, effectiveFrom: r.eff_from, effectiveTo: r.eff_to,
});

export const listRateCards = async (uow: UnitOfWork, input: ListRateCardsInput): Promise<ListRateCardsOutput> => {
  const firmId = requireUuid(input.firmId, "firmId");
  const serviceCode = input.serviceCode === undefined ? null : requireText(input.serviceCode, "serviceCode");
  const rows = await uow.tx.query<RateRow>(
    `SELECT ${RATE_COLUMNS} FROM rate_cards WHERE firm_id = $1 AND ($2::text IS NULL OR service_code = $2) ORDER BY service_code, lower(effective)`,
    [firmId, serviceCode],
  );
  return { rateCards: rows.map(rateToWire) };
};

export const setRateCard = async (uow: UnitOfWork, input: SetRateCardInput, newId: () => string): Promise<SetRateCardOutput> => {
  const firm = await loadFirm(uow, requireUuid(input.firmId, "firmId"));
  const serviceCode = requireText(input.serviceCode, "serviceCode").toUpperCase();
  if (typeof input.rateMinor !== "string" || !DIGITS.test(input.rateMinor)) {
    throw new BadInput("rateMinor must be a string of integer minor units — a JSON number is a double and is not money");
  }
  const rateMinor = BigInt(input.rateMinor);
  const currency = requireText(input.currency, "currency").toUpperCase();
  const effectiveFrom = requireDate(input.effectiveFrom, "effectiveFrom");
  const effectiveTo = input.effectiveTo === undefined || input.effectiveTo === null ? null : requireDate(input.effectiveTo, "effectiveTo");
  if (effectiveTo !== null && effectiveTo <= effectiveFrom) {
    throw new InputRefused(`the rate is effective from ${effectiveFrom} to ${effectiveTo} — a window that ends on or before it starts covers no day at all`, "empty_window");
  }

  // The row in effect on the first day, if any. Closing it is a mutation of its own.
  const open = (await uow.tx.query<RateRow>(
    `SELECT ${RATE_COLUMNS} FROM rate_cards WHERE firm_id = $1 AND service_code = $2 AND effective @> $3::date`,
    [firm.id, serviceCode, effectiveFrom],
  ))[0] ?? null;
  let closedId: string | null = null;
  if (open) {
    if (open.eff_from === effectiveFrom) {
      throw new InputRefused(
        `a ${serviceCode} rate for ${firm.legal_name} already begins on ${effectiveFrom} (${open.rate_minor} ${open.currency}). Closing it at its own first day would leave an empty range; set the new rate from a later day, or correct that row's window.`,
        "rate_begins_same_day",
      );
    }
    await uow.apply(
      {
        entity: "rate_card", entityId: open.id, action: "rate_card.close", topic: "rate_card.changed",
        before: { effectiveTo: open.eff_to }, after: { effectiveTo: effectiveFrom },
        orgId: open.org_id, regionId: open.region_id,
        payload: { firmId: firm.id, serviceCode, closedAt: effectiveFrom },
      },
      async (tx) => {
        await tx.query("UPDATE rate_cards SET effective = daterange(lower(effective), $2::date, '[)') WHERE id = $1", [open.id, effectiveFrom]);
      },
    );
    closedId = open.id;
  }

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "rate_card", entityId: id, action: "rate_card.set", topic: "rate_card.changed",
      before: null, after: { id, firmId: firm.id, serviceCode, rateMinor: rateMinor.toString(), currency, effectiveFrom, effectiveTo },
      orgId: firm.org_id, regionId: firm.region_id,
      payload: { firmId: firm.id, serviceCode, rateMinor: rateMinor.toString(), currency, effectiveFrom, effectiveTo, closedId },
    },
    async (tx) => {
      // Whether this overlaps a FUTURE row is rate_cards_no_overlap's to say.
      await tx.query(
        "INSERT INTO rate_cards (id, org_id, region_id, firm_id, service_code, rate_minor, currency, effective) VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, daterange($8::date, $9::date, '[)'))",
        [id, firm.org_id, firm.region_id, firm.id, serviceCode, rateMinor.toString(), currency, effectiveFrom, effectiveTo],
      );
    },
  );
  return { id, closedId, eventId };
};
