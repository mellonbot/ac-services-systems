import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { requireUuid, requireText } from "./jobs.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import {
  TECHNICIAN_SPECIALTIES,
  type AddressWire, type TechnicianSpecialty, type TechnicianWire,
  type ListTechniciansInput, type ListTechniciansOutput, type RecordTechnicianInput, type RecordTechnicianOutput,
  type UpdateTechnicianInput, type UpdateTechnicianOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * 0020 — THE TECHNICIAN ROSTER. The person the office calls, routes and staffs
 * by specialty, ours or a firm's, whether or not they ever sign in.
 *
 *   - THE EMPLOYER IS FIXED. firmId omitted is one of ours (INTERNAL_ORG);
 *     named, the firm's row and a firm that can still field crews. A technician
 *     who changes firm is a new row, the same rule a crew follows.
 *   - A CREW NAMED BELONGS TO THE SAME EMPLOYER. Said here by name; 0020's
 *     ac_technician_crew_is_the_employers says it for every other path.
 *   - THE HOME ADDRESS IS AN ACCOUNT OWNER'S. Every other office role reads it
 *     as restricted (the row says so; whether one exists is not disclosed) and
 *     may not write it. Address values never enter the audit row or the event
 *     payload — the audit records that the field changed, not to what.
 */
const ADDRESS_KEYS = ["line1", "line2", "city", "state", "postal", "country"] as const;

export const mayReadAddress = (p: Pick<Principal, "roles">): boolean => p.roles.includes("account_owner");

const optionalPhone = (v: unknown): string | null => {
  if (v === undefined || v === "") return null;
  if (typeof v !== "string" || v.trim().length > 40) throw new BadInput("phone must be text of at most 40 characters");
  return v.trim() || null;
};

const requireAddress = (v: unknown): AddressWire => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new BadInput("homeAddress must be an object");
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!(ADDRESS_KEYS as readonly string[]).includes(k)) throw new BadInput(`homeAddress.${k} is not an address field — use ${ADDRESS_KEYS.join(", ")}`);
    if (typeof val !== "string") throw new BadInput(`homeAddress.${k} must be text`);
    if (val.trim()) out[k] = val.trim();
  }
  if (!out.line1) throw new BadInput("homeAddress.line1 is required");
  return out;
};

const requireSpecialties = (v: unknown): TechnicianSpecialty[] => {
  if (!Array.isArray(v)) throw new BadInput("specialties must be a list");
  for (const s of v) {
    if (!(TECHNICIAN_SPECIALTIES as readonly unknown[]).includes(s)) throw new BadInput(`specialties: "${String(s)}" is not one of ${TECHNICIAN_SPECIALTIES.join(", ")}`);
  }
  return [...new Set(v as TechnicianSpecialty[])];
};

const addressRefused = () =>
  new InputRefused("home addresses are recorded and read by account owners only — leave the address for an account owner to enter", "address_restricted");

type TechRow = {
  id: string; org_id: string; region_id: string; firm_id: string | null; crew_id: string | null; name: string; phone: string | null;
  home_address: AddressWire | null; specialties: TechnicianSpecialty[]; active: boolean;
};
const TECH_COLUMNS = "id, org_id, region_id, firm_id, crew_id, name, phone, home_address, specialties, active";

const toWire = (r: TechRow, seesAddress: boolean): TechnicianWire => ({
  id: r.id, firmId: r.firm_id, crewId: r.crew_id, name: r.name, phone: r.phone,
  homeAddress: seesAddress ? r.home_address : null, addressRestricted: !seesAddress,
  specialties: r.specialties, homeRegionId: r.region_id, active: r.active,
});

export const listTechnicians = async (uow: UnitOfWork, input: ListTechniciansInput, principal: Principal): Promise<ListTechniciansOutput> => {
  const firmId = input.firmId === undefined || input.firmId === "" ? null : requireUuid(input.firmId, "firmId");
  const rows = await uow.tx.query<TechRow>(
    `SELECT ${TECH_COLUMNS} FROM technicians WHERE ($1::uuid IS NULL OR firm_id = $1) ORDER BY active DESC, name`,
    [firmId],
  );
  const sees = mayReadAddress(principal);
  return { technicians: rows.map((r) => toWire(r, sees)) };
};

const crewFor = async (uow: UnitOfWork, crewId: string, firmId: string | null, name: string): Promise<string> => {
  const crew = (await uow.tx.query<{ id: string; firm_id: string | null; label: string }>("SELECT id, firm_id, label FROM crews WHERE id = $1", [crewId]))[0];
  if (!crew) throw new InputRefused(`no crew ${crewId} visible in this scope`, "unknown_crew");
  if (crew.firm_id !== firmId) {
    throw new InputRefused(`${name} works for ${firmId ? "a firm" : "us"}, and crew ${crew.label} is ${crew.firm_id ? "another firm's" : "ours"} — put a technician on a crew of the employer they work for`, "crew_employer_mismatch");
  }
  return crew.id;
};

export const recordTechnician = async (uow: UnitOfWork, input: RecordTechnicianInput, principal: Principal, newId: () => string): Promise<RecordTechnicianOutput> => {
  const name = requireText(input.name, "name");
  const phone = optionalPhone(input.phone);
  const specialties = requireSpecialties(input.specialties);
  const homeAddress = input.homeAddress === undefined ? null : requireAddress(input.homeAddress);
  if (homeAddress && !mayReadAddress(principal)) throw addressRefused();
  const region = (await uow.tx.query<{ id: string; active: boolean; name: string }>("SELECT id, active, name FROM regions WHERE id = $1", [requireUuid(input.homeRegionId, "homeRegionId")]))[0];
  if (!region?.active) throw new InputRefused(`no active service region ${input.homeRegionId}`, "unknown_region");

  let firmId: string | null = null;
  let orgId = INTERNAL_ORG_ID;
  if (input.firmId !== undefined) {
    const firm = (await uow.tx.query<{ id: string; org_id: string; legal_name: string; status: string }>(
      "SELECT id, org_id, legal_name, status FROM subcontractor_firms WHERE id = $1", [requireUuid(input.firmId, "firmId")]))[0];
    if (!firm) throw new InputRefused(`no firm ${input.firmId} visible in this scope`, "unknown_firm");
    if (firm.status === "terminated") throw new InputRefused(`firm ${firm.legal_name} is terminated — it fields no technicians for us`, "firm_ended");
    firmId = firm.id; orgId = firm.org_id;
  }
  const crewId = input.crewId === undefined ? null : await crewFor(uow, requireUuid(input.crewId, "crewId"), firmId, name);

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "technician", entityId: id, action: "technician.record", topic: "technician.recorded",
      before: null,
      after: { id, name, phone, specialties, firmId, crewId, homeRegionId: region.id, homeAddress: homeAddress ? "recorded" : null, active: true },
      orgId, regionId: region.id,
      payload: { firmId },
    },
    async (tx) => {
      await tx.query(
        "INSERT INTO technicians (id, org_id, region_id, firm_id, crew_id, name, phone, home_address, specialties, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, true)",
        [id, orgId, region.id, firmId, crewId, name, phone, homeAddress ? JSON.stringify(homeAddress) : null, JSON.stringify(specialties)],
      );
    },
  );
  return { id, regionId: region.id, eventId };
};

export const updateTechnician = async (uow: UnitOfWork, input: UpdateTechnicianInput, principal: Principal): Promise<UpdateTechnicianOutput> => {
  const technicianId = requireUuid(input.technicianId, "technicianId");
  const current = (await uow.tx.query<TechRow>(`SELECT ${TECH_COLUMNS} FROM technicians WHERE id = $1`, [technicianId]))[0];
  if (!current) throw new InputRefused(`no technician ${technicianId} visible in this scope`, "unknown_technician");
  const sets: string[] = []; const params: unknown[] = [technicianId];
  const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
  const set = (column: string, field: string, value: unknown, was: unknown, cast = "") => {
    params.push(value); sets.push(`${column} = $${params.length}${cast}`); before[field] = was; after[field] = value;
  };
  if (input.name !== undefined) set("name", "name", requireText(input.name, "name"), current.name);
  if (input.phone !== undefined) set("phone", "phone", optionalPhone(input.phone), current.phone);
  if (input.specialties !== undefined) {
    const s = requireSpecialties(input.specialties);
    set("specialties", "specialties", JSON.stringify(s), current.specialties, "::jsonb"); after.specialties = s;
  }
  if (input.crewId !== undefined) {
    const crewId = input.crewId === null ? null : await crewFor(uow, requireUuid(input.crewId, "crewId"), current.firm_id, current.name);
    set("crew_id", "crewId", crewId, current.crew_id);
  }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw new BadInput("active must be true or false");
    set("active", "active", input.active, current.active);
  }
  if (input.homeAddress !== undefined) {
    if (!mayReadAddress(principal)) throw addressRefused();
    const a = input.homeAddress === null ? null : requireAddress(input.homeAddress);
    set("home_address", "homeAddress", a === null ? null : JSON.stringify(a), null, "::jsonb");
    before.homeAddress = current.home_address ? "recorded" : null; after.homeAddress = a ? "changed" : null;
  }
  if (sets.length === 0) throw new BadInput("nothing to update — name, phone, specialties, crewId, active or homeAddress");
  const eventId = await uow.apply(
    {
      entity: "technician", entityId: technicianId, action: "technician.update", topic: "technician.updated",
      before, after, orgId: current.org_id, regionId: current.region_id, payload: { fields: Object.keys(after) },
    },
    async (tx) => { await tx.query(`UPDATE technicians SET ${sets.join(", ")} WHERE id = $1`, params); },
  );
  return { id: technicianId, eventId };
};
