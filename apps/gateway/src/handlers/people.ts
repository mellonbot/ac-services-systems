import { randomInt } from "node:crypto";
import { WriteRoleDenied, type UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { hashPasswordAsync } from "../auth.ts";
import { revokeUserSessions } from "../sessions.ts";
import { iso } from "../sql.ts";
import { createCrew } from "./network.ts";
import { requireUuid } from "./jobs.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../../../packages/schema/src/tenancy.ts";
import { ROLES, type Principal } from "../../../../packages/contracts/src/scope.ts";
import type { SurfaceId } from "../../../../packages/contracts/src/surfaces.ts";
import {
  DISPLAY_NAME_MAX,
  type PersonWire, type ListPeopleOutput, type CreateStaffInput, type CreateTechnicianInput, type CreatePersonOutput,
  type UpdatePersonInput, type UpdatePersonOutput, type SetPersonActiveInput, type SetPersonActiveOutput,
  type ResetPasswordInput, type ResetPasswordOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * 0038 — PEOPLE. The company's own logins, made and kept by a principal in S2.
 *
 * AC Logins wrote these rows straight to Postgres; this is the same work
 * through the unit of work — every write audited, every write a `user` the
 * registry lets S2 write and only a principal (S2's writeRoles). The role is
 * also checked here, first, so a refusal arrives before a technician's unit
 * is made rather than by rolling it back.
 *
 *   - A PASSWORD IS NEVER CHOSEN FOR SOMEONE. A new login and a reset both get
 *     a temporary password the gateway generates: returned once, stored as a
 *     hash, and replaced by the person at their next sign-in
 *     (must_change_password; auth.login and auth.deviceLogin mint nothing
 *     until it is). Neither the password nor its hash enters an audit row.
 *   - A TECHNICIAN IS MADE WITH THEIR UNIT. One service crew of one, under
 *     whoever employs them, by crews.create's own rules — as AC Logins does
 *     it (0024). Their roles and region follow the unit and are not edited.
 *   - THERE IS ALWAYS A PRINCIPAL. No edit or removal may leave the company
 *     without an active, company-wide principal — the only login that can
 *     make another.
 */
type Row = {
  id: string; org_id: string; namespace: string; email: string; display_name: string; roles: string[];
  region_id: string; scope_tier: string; scope_id: string; crew_id: string | null; active: boolean;
};
const COLUMNS = "id, org_id, namespace, email, display_name, roles, region_id, scope_tier, scope_id, crew_id, active";

export const mayManagePeople = (p: Pick<Principal, "roles">): boolean => p.roles.includes("principal");

const requirePrincipal = (p: Principal, surfaceId: SurfaceId): void => {
  if (!mayManagePeople(p)) throw new WriteRoleDenied(surfaceId, "user", ["principal"], p.roles);
};

/** Sixteen characters from an alphabet with no look-alikes (0/O, 1/l/I), in groups of four. ~80 bits. */
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const temporaryPassword = (): string =>
  Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join("")).join("-");

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const requireEmail = (v: unknown): string => {
  if (typeof v !== "string") throw new BadInput("email is required");
  const email = v.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new InputRefused(`"${v}" is not an email address`, "bad_email");
  return email;
};
const requireName = (v: unknown): string => {
  if (typeof v !== "string") throw new BadInput("displayName is required");
  const name = v.replace(/\s+/g, " ").trim();
  if (!name) throw new InputRefused("a name cannot be blank", "blank_name");
  if (name.length > DISPLAY_NAME_MAX) throw new InputRefused(`a name is at most ${DISPLAY_NAME_MAX} characters`, "too_long");
  return name;
};
const requireStaffRoles = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length === 0) throw new InputRefused("a staff login holds at least one role", "bad_roles");
  for (const r of v) {
    if (!(ROLES as readonly unknown[]).includes(r)) throw new InputRefused(`"${String(r)}" is not a staff role — one of ${ROLES.join(", ")}`, "bad_roles");
    if (r === "technician") throw new InputRefused("a technician's login is made with their own service unit — use New technician", "bad_roles");
  }
  return [...new Set(v as string[])];
};
const requireScope = (v: unknown): "org" | "region" => {
  if (v !== "org" && v !== "region") throw new BadInput("scope is org or region");
  return v;
};
const activeRegion = async (uow: UnitOfWork, v: unknown): Promise<{ id: string; code: string }> => {
  const id = requireUuid(v, "regionId");
  const r = (await uow.tx.query<{ id: string; code: string; active: boolean }>("SELECT id, code, active FROM regions WHERE id = $1", [id]))[0];
  if (!r || !r.active || r.id === UNASSIGNED_REGION_ID) throw new InputRefused(`no active service region ${id}`, "unknown_region");
  return r;
};
const emailFree = async (uow: UnitOfWork, email: string, except: string | null): Promise<void> => {
  const hit = await uow.tx.query("SELECT 1 FROM users WHERE lower(email) = $1 AND ($2::uuid IS NULL OR id <> $2)", [email, except]);
  if (hit.length > 0) throw new InputRefused(`a login with the email ${email} already exists`, "email_taken");
};
const scopeOf = (scope: "org" | "region", regionId: string) =>
  scope === "org" ? { tier: "parent", id: INTERNAL_ORG_ID } : { tier: "region", id: regionId };

const load = async (uow: UnitOfWork, v: unknown): Promise<Row> => {
  const id = requireUuid(v, "userId");
  const r = (await uow.tx.query<Row>(`SELECT ${COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [id]))[0];
  if (!r) throw new InputRefused(`no login ${id}`, "unknown_person");
  if (r.namespace !== "internal") throw new InputRefused("this login is a customer's, a firm's or a vendor's — AC Logins keeps those", "not_staff");
  return r;
};

/** Holds S2: an active, company-wide principal. */
const holdsTheCompany = (r: Pick<Row, "active" | "roles" | "scope_tier">): boolean =>
  r.active && r.roles.includes("principal") && r.scope_tier === "parent";

/** Serialised: two principals removing each other at once would each see the other still there. */
const keepAPrincipal = async (uow: UnitOfWork, before: Row, after: Pick<Row, "active" | "roles" | "scope_tier">): Promise<void> => {
  if (!holdsTheCompany(before) || holdsTheCompany(after)) return;
  await uow.tx.query("SELECT pg_advisory_xact_lock(hashtext('ac-people:principals'))");
  const others = await uow.tx.query(
    `SELECT 1 FROM users WHERE id <> $1 AND active AND namespace = 'internal' AND scope_tier = 'parent' AND roles @> '["principal"]'::jsonb`, [before.id]);
  if (others.length === 0) {
    throw new InputRefused(`${before.display_name} is the last active company-wide principal — make another principal before removing or demoting this one`, "last_principal");
  }
};

type ListRow = {
  id: string; email: string; display_name: string; roles: string[]; scope_tier: string; region_id: string; region_code: string;
  crew_id: string | null; crew_label: string | null; firm_id: string | null; firm_name: string | null;
  active: boolean; must_change_password: boolean; password_changed_at: string | null;
};

export const listPeople = async (uow: UnitOfWork, p: Principal, surfaceId: SurfaceId): Promise<ListPeopleOutput> => {
  requirePrincipal(p, surfaceId);
  const rows = await uow.tx.query<ListRow>(
    `SELECT u.id, u.email, u.display_name, u.roles, u.scope_tier, u.region_id, r.code AS region_code,
            u.crew_id, c.label AS crew_label, c.firm_id, f.legal_name AS firm_name,
            u.active, u.must_change_password, ${iso("u.password_changed_at")} AS password_changed_at
       FROM users u
       JOIN regions r ON r.id = u.region_id
       LEFT JOIN crews c ON c.id = u.crew_id
       LEFT JOIN subcontractor_firms f ON f.id = c.firm_id
      WHERE u.namespace = 'internal'
      ORDER BY u.active DESC, lower(u.display_name), u.email`);
  return {
    people: rows.map((r): PersonWire => ({
      userId: r.id, email: r.email, displayName: r.display_name, kind: r.crew_id ? "technician" : "staff", roles: r.roles,
      scope: r.scope_tier === "parent" ? "org" : "region", regionId: r.region_id, regionCode: r.region_code,
      crewId: r.crew_id, crewLabel: r.crew_label, firmId: r.firm_id, firmName: r.firm_name,
      active: r.active, mustChangePassword: r.must_change_password, passwordChangedAt: r.password_changed_at,
    })),
  };
};

type NewLogin = { email: string; displayName: string; roles: string[]; regionId: string; scope: "org" | "region"; crewId: string | null; kind: "staff" | "technician" };

const insertLogin = async (uow: UnitOfWork, n: NewLogin, newId: () => string): Promise<{ userId: string; temporaryPassword: string; eventId: string }> => {
  const temp = temporaryPassword();
  const hash = await hashPasswordAsync(temp);
  const userId = newId();
  const scope = scopeOf(n.scope, n.regionId);
  const eventId = await uow.apply(
    {
      entity: "user", entityId: userId, action: "user.create", topic: "user.created",
      before: null,
      after: { id: userId, email: n.email, displayName: n.displayName, kind: n.kind, roles: n.roles, scope: n.scope, regionId: n.regionId, crewId: n.crewId, active: true, temporaryPassword: "issued" },
      orgId: INTERNAL_ORG_ID, regionId: n.regionId,
      payload: { kind: n.kind },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, crew_id, password_hash, must_change_password, active)
         VALUES ($1, $2, $3, 'internal', $4, $5, $6::jsonb, $7, $8, $9, $10, true, true)`,
        [userId, INTERNAL_ORG_ID, n.regionId, n.email, n.displayName, JSON.stringify(n.roles), scope.tier, scope.id, n.crewId, hash],
      );
    },
  );
  return { userId, temporaryPassword: temp, eventId };
};

export const createStaffLogin = async (uow: UnitOfWork, p: Principal, surfaceId: SurfaceId, input: CreateStaffInput, newId: () => string): Promise<CreatePersonOutput> => {
  requirePrincipal(p, surfaceId);
  const email = requireEmail(input.email);
  const displayName = requireName(input.displayName);
  const roles = requireStaffRoles(input.roles);
  const scope = requireScope(input.scope);
  const region = await activeRegion(uow, input.regionId);
  await emailFree(uow, email, null);
  const out = await insertLogin(uow, { email, displayName, roles, regionId: region.id, scope, crewId: null, kind: "staff" }, newId);
  return { ...out, crewId: null };
};

/** AC Logins' makeUnit + addLogin, in one unit of work: the unit by crews.create's rules, then the login on it. */
export const createTechnicianLogin = async (uow: UnitOfWork, p: Principal, surfaceId: SurfaceId, input: CreateTechnicianInput, newId: () => string): Promise<CreatePersonOutput> => {
  requirePrincipal(p, surfaceId);
  const email = requireEmail(input.email);
  const displayName = requireName(input.displayName);
  await emailFree(uow, email, null);
  const unit = await createCrew(uow, {
    label: displayName, kind: "service", homeRegionId: requireUuid(input.homeRegionId, "homeRegionId"),
    ...(input.firmId === undefined ? { employmentType: "employed" as const } : { employmentType: "subcontracted" as const, firmId: input.firmId }),
  }, newId);
  const out = await insertLogin(uow, { email, displayName, roles: ["technician"], regionId: unit.regionId, scope: "region", crewId: unit.id, kind: "technician" }, newId);
  return { ...out, crewId: unit.id };
};

const sameRoles = (a: readonly string[], b: readonly string[]): boolean => [...a].sort().join("\0") === [...b].sort().join("\0");

export const updatePerson = async (uow: UnitOfWork, p: Principal, surfaceId: SurfaceId, input: UpdatePersonInput): Promise<UpdatePersonOutput> => {
  requirePrincipal(p, surfaceId);
  const cur = await load(uow, input.userId);
  const technician = cur.crew_id !== null;
  if (technician && (input.roles !== undefined || input.scope !== undefined || input.regionId !== undefined)) {
    throw new InputRefused(`${cur.display_name} is a technician — their role and region follow their service unit`, "follows_unit");
  }
  const next = { email: cur.email, display_name: cur.display_name, roles: cur.roles, region_id: cur.region_id, scope_tier: cur.scope_tier, scope_id: cur.scope_id };
  if (input.email !== undefined) {
    next.email = requireEmail(input.email);
    if (next.email !== cur.email) await emailFree(uow, next.email, cur.id);
  }
  if (input.displayName !== undefined) next.display_name = requireName(input.displayName);
  if (input.roles !== undefined) next.roles = requireStaffRoles(input.roles);
  if (input.scope !== undefined || input.regionId !== undefined) {
    const scope = input.scope === undefined ? (cur.scope_tier === "parent" ? "org" : "region") : requireScope(input.scope);
    const region = input.regionId === undefined ? { id: cur.region_id } : await activeRegion(uow, input.regionId);
    const s = scopeOf(scope, region.id);
    next.region_id = region.id; next.scope_tier = s.tier; next.scope_id = s.id;
  }
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => k === "roles" ? !sameRoles(next.roles, cur.roles) : next[k] !== cur[k]);
  if (changed.length === 0) throw new InputRefused("nothing changed", "no_change");
  await keepAPrincipal(uow, cur, { active: cur.active, roles: next.roles, scope_tier: next.scope_tier });

  // The session check refuses a token whose roles or scope the row no longer
  // agrees with; ending the sessions as well says so in the row, as AC Logins does.
  const accessChanged = changed.some((k) => k === "roles" || k === "region_id" || k === "scope_tier" || k === "scope_id");
  let endedSessions = 0;
  const pick = (r: typeof next) => Object.fromEntries(changed.map((k) => [k, r[k]]));
  const eventId = await uow.apply(
    {
      entity: "user", entityId: cur.id, action: "user.edit", topic: "user.updated",
      before: pick(cur), after: pick(next), orgId: cur.org_id, regionId: next.region_id,
      payload: { fields: changed },
    },
    async (tx) => {
      await tx.query(
        `UPDATE users SET email = $2, display_name = $3, roles = $4::jsonb, region_id = $5, scope_tier = $6, scope_id = $7 WHERE id = $1`,
        [cur.id, next.email, next.display_name, JSON.stringify(next.roles), next.region_id, next.scope_tier, next.scope_id]);
      if (accessChanged) endedSessions = await revokeUserSessions((sql, params) => tx.query(sql, params ?? []), cur.id, null);
    },
  );
  return { userId: cur.id, endedSessions, eventId };
};

type UnitRow = { id: string; org_id: string; region_id: string; label: string; kind: string; active: boolean; firm_status: string | null; legal_name: string | null };

export const setPersonActive = async (uow: UnitOfWork, p: Principal, surfaceId: SurfaceId, input: SetPersonActiveInput): Promise<SetPersonActiveOutput> => {
  requirePrincipal(p, surfaceId);
  if (typeof input.active !== "boolean") throw new BadInput("active must be true or false");
  const cur = await load(uow, input.userId);
  if (cur.active === input.active) throw new InputRefused(`${cur.display_name}'s login is already ${cur.active ? "active" : "removed"}`, "no_change");
  if (!input.active) await keepAPrincipal(uow, cur, { active: false, roles: cur.roles, scope_tier: cur.scope_tier });

  const unit = cur.crew_id
    ? (await uow.tx.query<UnitRow>(
        `SELECT c.id, c.org_id, c.region_id, c.label, c.kind, c.active, f.status AS firm_status, f.legal_name
           FROM crews c LEFT JOIN subcontractor_firms f ON f.id = c.firm_id WHERE c.id = $1 FOR UPDATE OF c`, [cur.crew_id]))[0] ?? null
    : null;
  // A technician's own unit comes back with them (and only when nobody else has
  // taken it up); a firm that has been terminated fields nobody.
  if (input.active && unit && !unit.active) {
    if (unit.firm_status === "terminated") throw new InputRefused(`${unit.legal_name} is terminated — its technician's unit cannot come back`, "firm_ended");
    const others = await uow.tx.query("SELECT 1 FROM users WHERE crew_id = $1 AND active AND id <> $2", [unit.id, cur.id]);
    if (unit.kind !== "service" || others.length > 0) throw new InputRefused(`${unit.label} is not ${cur.display_name}'s own unit to bring back — AC Logins moves them to their own`, "unknown_crew");
    await uow.apply(
      { entity: "crew", entityId: unit.id, action: "crew.reactivate", topic: "crew.updated", before: { active: false }, after: { active: true }, orgId: unit.org_id, regionId: unit.region_id },
      async (tx) => { await tx.query("UPDATE crews SET active = true WHERE id = $1", [unit.id]); },
    );
  }

  let endedSessions = 0;
  const eventId = await uow.apply(
    {
      entity: "user", entityId: cur.id, action: input.active ? "user.reactivate" : "user.deactivate", topic: "user.updated",
      before: { active: cur.active }, after: { active: input.active }, orgId: cur.org_id, regionId: cur.region_id,
      payload: { fields: ["active"] },
    },
    async (tx) => {
      await tx.query("UPDATE users SET active = $2 WHERE id = $1", [cur.id, input.active]);
      if (!input.active) endedSessions = await revokeUserSessions((sql, params) => tx.query(sql, params ?? []), cur.id, null);
    },
  );

  // …and leaves with them — unless it still holds work, which Dispatch must release first.
  if (!input.active && unit?.active && unit.kind === "service") {
    const free = await uow.tx.query(
      `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM users WHERE crew_id = $1 AND active)
                  AND NOT EXISTS (SELECT 1 FROM assignments WHERE crew_id = $1 AND released_at IS NULL)`, [unit.id]);
    if (free.length > 0) {
      await uow.apply(
        { entity: "crew", entityId: unit.id, action: "crew.retire", topic: "crew.updated", before: { active: true }, after: { active: false }, orgId: unit.org_id, regionId: unit.region_id },
        async (tx) => { await tx.query("UPDATE crews SET active = false WHERE id = $1", [unit.id]); },
      );
    }
  }
  return { userId: cur.id, active: input.active, endedSessions, eventId };
};

export const resetPersonPassword = async (uow: UnitOfWork, p: Principal, surfaceId: SurfaceId, input: ResetPasswordInput): Promise<ResetPasswordOutput> => {
  requirePrincipal(p, surfaceId);
  const cur = await load(uow, input.userId);
  if (cur.id === p.subjectId) throw new InputRefused("change your own password from the Account button", "use_account");
  if (!cur.active) throw new InputRefused(`${cur.display_name}'s login is removed — bring it back before resetting its password`, "person_inactive");
  const temp = temporaryPassword();
  const hash = await hashPasswordAsync(temp);
  let endedSessions = 0;
  const eventId = await uow.apply(
    {
      entity: "user", entityId: cur.id, action: "user.reset_password", topic: "user.updated",
      before: null, after: { temporaryPassword: "issued", mustChangePassword: true }, orgId: cur.org_id, regionId: cur.region_id,
      payload: { fields: ["password"] },
    },
    async (tx) => {
      await tx.query("UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1", [cur.id, hash]);
      endedSessions = await revokeUserSessions((sql, params) => tx.query(sql, params ?? []), cur.id, null);
    },
  );
  return { userId: cur.id, temporaryPassword: temp, endedSessions, eventId };
};
