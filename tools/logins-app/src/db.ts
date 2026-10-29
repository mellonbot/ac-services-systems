import { createPool, beginTx, bindSystem, type Pool } from "../../../apps/gateway/src/pg-tx.ts";
import type { ScopeBinding, Role } from "../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";
import type { CustomerSegment, CrewKind } from "../../../packages/contracts/src/operations.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../../packages/schema/src/tenancy.ts";
import type { UserRecord } from "./kinds.ts";
import { buildUserRow, checkPassword, checkRoles, internalScope, accessChanged, LoginInputError } from "./rows.ts";
import type { NewLogin, Access, UsersRow, Employer, Unit } from "./rows.ts";
import { hashPassword } from "../../../apps/gateway/src/auth.ts";
import { summarizeDocuments } from "../../../apps/gateway/src/handlers/network.ts";
import type { CredentialWire, DeviceKind } from "../../../packages/contracts/src/operations.ts";
import { registerDevice, grantDeviceShift, type DeviceWriter } from "../../../apps/gateway/src/handlers/devices.ts";
import { revokeUserSessions } from "../../../apps/gateway/src/sessions.ts";
import { randomUUID } from "node:crypto";
import { isTopic, type Topic } from "../../../packages/contracts/src/events.ts";
import { buildCrewRow, buildFirmRows, documentsLabel, normaliseName } from "./companies.ts";
import type { NewCompany, CrewRow } from "./companies.ts";

/**
 * The app's actor in audit_log and outbox. Like the worker (WORKER_ACTOR), it
 * has no principal; its surface is "logins-app". Writing both rows in the same
 * transaction is what lets the relay push the change to every open page.
 */
export const LOGINS_APP_ACTOR = "00000000-0000-0000-0000-00000000aa02";

/** Reads run as internal at the parent tier, so one query can join users to crew, firm, org and scope names. */
export const INTERNAL_READ_BINDING: Readonly<Record<string, string>> = {
  "ac.namespace": "internal", "ac.org_id": INTERNAL_ORG_ID, "ac.scope_tier": "parent", "ac.scope_id": INTERNAL_ORG_ID,
  "ac.region_id": "", "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": LOGINS_APP_ACTOR, "ac.surface_id": "logins-app",
};


export class LoginsDbError extends Error {}

export type Region = { id: string; code: string; name: string };
export type Firm = { id: string; legalName: string; regionId: string; status: "onboarding" | "active" | "suspended" | "terminated" };
/** A crew (0024): a technician's own service unit, or an install crew. */
export type Company = {
  id: string; label: string; homeRegionId: string; employmentType: "employed" | "subcontracted"; kind: CrewKind; firmName: string | null;
  regionCode: string; active: boolean; firmId: string | null; firmStatus: Firm["status"] | null; technicians: number; documents: string;
};
export type CustomerOrg = { id: string; name: string; segment: CustomerSegment };
export type AccountNode = { id: string; tier: "region" | "location" | "site"; name: string; parentId: string | null; regionId: string };
/** Hardware a technician signs in to S5 with (D-2a). */
export type Device = { id: string; hardwareId: string; kind: DeviceKind; active: boolean };
/** A technician's shift on a device: an existing one, or one registered in the same transaction under the technician's employer. */
export type NewShift = {
  readonly userId: string;
  readonly device: { readonly id: string } | { readonly hardwareId: string; readonly kind: DeviceKind };
  /** ISO instants; the window is [start, end). */
  readonly windowStart: string; readonly windowEnd: string;
};
export type LoginEdit = {
  readonly displayName: string;
  readonly roles?: readonly Role[];
  readonly scope?: { readonly tier: Tier; readonly scopeId: string; readonly regionId: string };
  /** Give a technician on a shared or install crew (made before 0024) their own service unit, under the same employer. */
  readonly ownUnit?: true;
};

export type LoginsDb = {
  ping(): Promise<void>;
  listUsers(opts: { includeInactive: boolean }): Promise<readonly UserRecord[]>;
  listRegions(): Promise<readonly Region[]>;
  listFirms(): Promise<readonly Firm[]>;
  listCompanies(opts: { includeInactive: boolean }): Promise<readonly Company[]>;
  addCompany(n: NewCompany): Promise<{ id: string; firmId: string | null }>;
  removeCompany(id: string): Promise<void>;
  reactivateCompany(id: string): Promise<void>;
  listCustomerOrgs(): Promise<readonly CustomerOrg[]>;
  listAccountTree(orgId: string): Promise<readonly AccountNode[]>;
  addLogin(n: NewLogin): Promise<{ id: string }>;
  listDevices(): Promise<readonly Device[]>;
  grantShift(n: NewShift): Promise<{ grantId: string; deviceId: string }>;
  resetPassword(userId: string, password: string): Promise<{ revokedSessions: number }>;
  editLogin(userId: string, edit: LoginEdit): Promise<{ revokedSessions: number }>;
  deactivate(userId: string): Promise<{ revokedSessions: number }>;
  reactivate(userId: string): Promise<void>;
  close(): Promise<void>;
};

type UserRow = {
  id: string; email: string; display_name: string; namespace: UserRecord["namespace"]; roles: string[];
  org_id: string; org_name: string; org_segment: CustomerSegment | null; region_id: string; region_code: string;
  scope_tier: Tier; scope_id: string; scope_name: string | null;
  firm_id: string | null; firm_name: string | null;
  crew_id: string | null; crew_label: string | null; crew_employment: "employed" | "subcontracted" | null;
  crew_kind: CrewKind | null; crew_firm_name: string | null; own_unit: boolean;
  active: boolean;
};

const toRecord = (r: UserRow): UserRecord => ({
  id: r.id, email: r.email, displayName: r.display_name, namespace: r.namespace, roles: r.roles,
  orgId: r.org_id, orgName: r.org_name, orgSegment: r.org_segment, regionId: r.region_id, regionCode: r.region_code,
  scopeTier: r.scope_tier, scopeId: r.scope_id, scopeName: r.scope_name,
  firmId: r.firm_id, firmName: r.firm_name,
  crewId: r.crew_id, crewLabel: r.crew_label, crewEmployment: r.crew_employment,
  crewKind: r.crew_kind, crewFirmName: r.crew_firm_name, ownUnit: r.own_unit,
  active: r.active,
});

const LOST = "Lost the connection to the database.";
const GONE = "That login no longer exists";
const COMPANY_GONE = "That company no longer exists";
const NO_REGION = "That region is not available";
const removedMessage = (label: string): string => `${label} has been removed`;
const terminatedMessage = (legalName: string): string => `${legalName} is terminated — it can't take a new company`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const NOT_THIS_CUSTOMER = "That site or location doesn't belong to the chosen customer";

/** Never an empty message: a refused connect (autoSelectFamily) is an AggregateError whose own message is "". */
export const failure = (e: unknown): Error => {
  if (e instanceof LoginInputError || e instanceof LoginsDbError) return e;
  if (!(e instanceof Error)) return new LoginsDbError(String(e) || LOST);
  const inner = e instanceof AggregateError ? e.errors.map((x: unknown) => (x instanceof Error ? x.message : String(x))).filter(Boolean).join("; ") : "";
  return new LoginsDbError(e.message || inner || (e as { code?: string }).code || LOST);
};

/** pg emits 'error' on the pool when the server drops an idle connection; unhandled, that kills the process. pg discards the client and the next query opens a fresh one. */
export const attachIdleErrorHandler = (pool: Pool): void => { pool.on("error", () => {}); };

export const openDb = async (connectionString: string): Promise<LoginsDb> => {
  const pool: Pool = createPool(connectionString, "ac-logins-app");
  attachIdleErrorHandler(pool);

  const attempt = async <T>(f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) { throw failure(e); }
  };

  const read = <T>(sql: string, params: readonly unknown[] = []): Promise<readonly T[]> => attempt(async () => {
    const tx = await beginTx(pool, "ac_logins");
    try {
      await tx.setLocal(INTERNAL_READ_BINDING as ScopeBinding);
      return await tx.query<T>(sql, params);
    } finally {
      await tx.rollback();
    }
  });

  const write = <T>(f: (q: <R>(sql: string, params?: readonly unknown[]) => Promise<readonly R[]>) => Promise<T>): Promise<T> => attempt(async () => {
    const tx = await beginTx(pool, "ac_logins");
    try {
      await bindSystem(tx);
      const out = await f((sql, params) => tx.query(sql, params));
      await tx.commit();
      return out;
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  });

  type Q = <R>(sql: string, params?: readonly unknown[]) => Promise<readonly R[]>;

  type Change = { topic: Topic; action: string; entity: string; entityId: string; orgId: string; regionId: string; after: unknown };
  const emit = async (q: Q, c: Change): Promise<string> => {
    if (!isTopic(c.topic)) throw new LoginsDbError(`"${c.topic}" is not in the event catalogue`);
    const eventId = randomUUID();
    await q(
      `INSERT INTO audit_log (event_id, actor_id, surface_id, action, entity, entity_id, after, region_id, org_id)
       VALUES ($1,$2,'logins-app',$3,$4,$5,$6::jsonb,$7,$8)`,
      [eventId, LOGINS_APP_ACTOR, c.action, c.entity, c.entityId, JSON.stringify(c.after), c.regionId, c.orgId]);
    await q(
      `INSERT INTO outbox (event_id, topic, entity, entity_id, payload, actor_id, surface_id, region_id, org_id)
       VALUES ($1,$2,$3,$4,'{}'::jsonb,$5,'logins-app',$6,$7)`,
      [eventId, c.topic, c.entity, c.entityId, LOGINS_APP_ACTOR, c.regionId, c.orgId]);
    return eventId;
  };
  /** Every user write ends here: one event, so S3's team list refetches. */
  const userChanged = async (q: Q, userId: string, topic: "user.created" | "user.updated", action: string): Promise<void> => {
    const [u] = await q<{ org_id: string; region_id: string; active: boolean }>(`SELECT org_id, region_id, active FROM users WHERE id = $1`, [userId]);
    await emit(q, { topic, action, entity: "user", entityId: userId, orgId: u!.org_id, regionId: u!.region_id, after: { active: u!.active } });
  };
  const crewChanged = async (q: Q, crewId: string, topic: "crew.created" | "crew.updated", action: string): Promise<void> => {
    const [c] = await q<{ org_id: string; region_id: string; label: string; active: boolean }>(`SELECT org_id, region_id, label, active FROM crews WHERE id = $1`, [crewId]);
    await emit(q, { topic, action, entity: "crew", entityId: crewId, orgId: c!.org_id, regionId: c!.region_id, after: { label: c!.label, active: c!.active } });
  };

  /** Company writes — and technician writes, which must share a transaction with the company-row lock — run as the office: internal, bound, one commit. */
  const writeAsOffice = <T>(f: (q: Q) => Promise<T>): Promise<T> => attempt(async () => {
    const tx = await beginTx(pool, "ac_logins");
    try {
      await tx.setLocal(INTERNAL_READ_BINDING as ScopeBinding);
      const out = await f((sql, params) => tx.query(sql, params));
      await tx.commit();
      return out;
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  });

  /** A technician may only stand on an active crew; the share lock keeps removeCompany from slipping in before the users write commits. */
  const requireActiveCompany = async (q: Q, crewId: string): Promise<void> => {
    const [c] = await q<{ label: string; active: boolean }>(`SELECT label, active FROM crews WHERE id = $1 FOR SHARE`, [crewId]);
    if (!c) throw new LoginInputError(COMPANY_GONE);
    if (!c.active) throw new LoginInputError(removedMessage(c.label));
  };

  /** A contractor firm that can still take a crew; the share lock holds its status until the crew is written. */
  const requireFirm = async (q: Q, firmId: string): Promise<{ id: string; org_id: string; region_id: string }> => {
    const [f] = await q<{ id: string; org_id: string; region_id: string; status: Firm["status"]; legal_name: string }>(
      `SELECT id, org_id, region_id, status, legal_name FROM subcontractor_firms WHERE id = $1 FOR SHARE`, [firmId]);
    if (!f) throw new LoginInputError("That firm no longer exists");
    if (f.status === "terminated") throw new LoginInputError(terminatedMessage(f.legal_name));
    return f;
  };

  const insertCrew = async (q: Q, crew: CrewRow): Promise<string> => {
    const [made] = await q<{ id: string }>(
      `INSERT INTO crews (org_id, region_id, label, employment_type, firm_id, home_region_id, active, kind) VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING id`,
      [crew.org_id, crew.region_id, crew.label, crew.employment_type, crew.firm_id, crew.home_region_id, crew.kind]);
    await crewChanged(q, made!.id, "crew.created", "crew.create");
    return made!.id;
  };

  /** 0024: a technician's dispatch unit is a service crew of one, named for them, under whoever employs them. */
  const makeUnit = async (q: Q, name: string, employer: Employer): Promise<Unit> => {
    let crew: CrewRow;
    if (employer?.type === "ours") {
      await requireRegion(q, employer.regionId);
      crew = buildCrewRow(name, { type: "ours", regionId: employer.regionId }, "service");
    } else if (employer?.type === "contractor") {
      const f = await requireFirm(q, employer.firmId);
      crew = buildCrewRow(name, { type: "contractor", firmId: f.id, firmOrgId: f.org_id, firmRegionId: f.region_id }, "service");
    } else {
      throw new LoginInputError("Choose who employs the technician.");
    }
    return { id: await insertCrew(q, crew), homeRegionId: crew.home_region_id };
  };

  /** A technician's own unit leaves with them — unless it still holds work, which Dispatch must release first. */
  const retireOwnUnit = async (q: Q, crewId: string): Promise<void> => {
    const hit = await q(
      `UPDATE crews SET active = false WHERE id = $1 AND active AND kind = 'service'
          AND NOT EXISTS (SELECT 1 FROM users WHERE crew_id = $1 AND active)
          AND NOT EXISTS (SELECT 1 FROM assignments WHERE crew_id = $1 AND released_at IS NULL) RETURNING id`, [crewId]);
    if (hit.length > 0) await crewChanged(q, crewId, "crew.updated", "crew.retire");
  };

  /** …and comes back with them, when nobody else has taken it up. */
  const restoreOwnUnit = async (q: Q, crewId: string): Promise<void> => {
    const [c] = await q<{ active: boolean; kind: CrewKind; firm_status: Firm["status"] | null; legal_name: string | null; others: number }>(
      `SELECT c.active, c.kind, f.status AS firm_status, f.legal_name,
              (SELECT count(*)::int FROM users u WHERE u.crew_id = c.id AND u.active) AS others
         FROM crews c LEFT JOIN subcontractor_firms f ON f.id = c.firm_id WHERE c.id = $1 FOR UPDATE OF c`, [crewId]);
    if (!c || c.active || c.kind !== "service" || c.others > 0) return;
    if (c.firm_status === "terminated") throw new LoginInputError(terminatedMessage(c.legal_name!));
    await q(`UPDATE crews SET active = true WHERE id = $1`, [crewId]);
    await crewChanged(q, crewId, "crew.updated", "crew.reactivate");
  };

  const requireRegion = async (q: Q, regionId: string): Promise<void> => {
    if ((await q(`SELECT 1 FROM regions WHERE id = $1 AND active AND id <> $2`, [regionId, UNASSIGNED_REGION_ID])).length === 0) throw new LoginInputError(NO_REGION);
  };

  /** Same normalisation as sameName, in SQL: trimmed, whitespace collapsed, case-folded. */
  const NORMALISED = (col: string): string => `lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`;

  /** A customer's scope node must be its own org's (whole company: the org itself). Read bound — unbound cannot see accounts. */
  const checkCustomerScope = async (orgId: string, tier: Tier, scopeId: string): Promise<void> => {
    const ok = tier === "parent"
      ? scopeId === orgId
      : (await read(`SELECT 1 FROM accounts WHERE id = $1 AND org_id = $2 AND tier = $3`, [scopeId, orgId, tier])).length > 0;
    if (!ok) throw new LoginInputError(NOT_THIS_CUSTOMER);
  };

  const revoke = async (q: <R>(sql: string, params?: readonly unknown[]) => Promise<readonly R[]>, userId: string): Promise<number> =>
    revokeUserSessions(q, userId, null);

  const db: LoginsDb = {
    ping: async () => { await read("SELECT 1"); },

    listUsers: async ({ includeInactive }) => (await read<UserRow>(
      `SELECT u.id, u.email, u.display_name, u.namespace, u.roles, u.org_id, o.name AS org_name, o.segment AS org_segment,
              u.region_id, r.code AS region_code, u.scope_tier, u.scope_id,
              CASE WHEN u.scope_tier <> 'parent' THEN a.name END AS scope_name,
              u.firm_id, f.legal_name AS firm_name,
              u.crew_id, c.label AS crew_label, c.employment_type AS crew_employment,
              c.kind AS crew_kind, cf.legal_name AS crew_firm_name,
              (c.kind = 'service' AND NOT EXISTS (SELECT 1 FROM users o2 WHERE o2.crew_id = u.crew_id AND o2.id <> u.id AND o2.active)) IS TRUE AS own_unit,
              u.active
         FROM users u
         JOIN organizations o ON o.id = u.org_id
         JOIN regions r ON r.id = u.region_id
         LEFT JOIN crews c ON c.id = u.crew_id
         LEFT JOIN subcontractor_firms cf ON cf.id = c.firm_id
         LEFT JOIN subcontractor_firms f ON f.id = u.firm_id
         LEFT JOIN accounts a ON a.id = u.scope_id AND u.scope_tier <> 'parent'
        WHERE $1 OR u.active
        ORDER BY u.email`, [includeInactive])).map(toRecord),

    listRegions: () => read<Region>(`SELECT id, code, name FROM regions WHERE active AND id <> $1 ORDER BY code`, [UNASSIGNED_REGION_ID]),

    listFirms: async () => (await read<{ id: string; legal_name: string; region_id: string; status: Firm["status"] }>(
      `SELECT id, legal_name, region_id, status FROM subcontractor_firms WHERE status <> 'terminated' ORDER BY legal_name`))
      .map((f) => ({ id: f.id, legalName: f.legal_name, regionId: f.region_id, status: f.status })),

    listCompanies: async ({ includeInactive }) => {
      const crews = await read<{
        id: string; label: string; home_region_id: string; region_code: string; employment_type: Company["employmentType"]; kind: CrewKind; active: boolean;
        firm_id: string | null; firm_name: string | null; firm_status: Firm["status"] | null; technicians: number;
      }>(
        `SELECT c.id, c.label, c.home_region_id, r.code AS region_code, c.employment_type, c.kind, c.active,
                c.firm_id, f.legal_name AS firm_name, f.status AS firm_status,
                (SELECT count(*)::int FROM users u WHERE u.crew_id = c.id AND u.active) AS technicians
           FROM crews c
           JOIN regions r ON r.id = c.home_region_id
           LEFT JOIN subcontractor_firms f ON f.id = c.firm_id
          WHERE $1 OR c.active
          ORDER BY c.kind, c.employment_type, c.label`, [includeInactive]);
      const creds = crews.length === 0 ? [] : await read<{ crew_id: string; kind: CredentialWire["kind"]; valid_from: string; valid_to: string; verified_at: string | null }>(
        `SELECT crew_id, kind, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, to_char(valid_to, 'YYYY-MM-DD') AS valid_to,
                to_char(verified_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS verified_at
           FROM crew_credentials WHERE crew_id = ANY($1::uuid[])`, [crews.map((c) => c.id)]);
      const byCrew = new Map<string, CredentialWire[]>();
      for (const d of creds) {
        const wire = { crewId: d.crew_id, kind: d.kind, validFrom: d.valid_from, validTo: d.valid_to, verifiedAt: d.verified_at } as CredentialWire;
        byCrew.set(d.crew_id, [...(byCrew.get(d.crew_id) ?? []), wire]);
      }
      const today = new Date().toISOString().slice(0, 10);
      return crews.map((c) => ({
        id: c.id, label: c.label, homeRegionId: c.home_region_id, employmentType: c.employment_type, kind: c.kind, firmName: c.firm_name,
        regionCode: c.region_code, active: c.active, firmId: c.firm_id, firmStatus: c.firm_status, technicians: c.technicians,
        documents: documentsLabel(summarizeDocuments(c.employment_type, byCrew.get(c.id) ?? [], today)),
      }));
    },

    addCompany: async (n) => {
      // Rows are built (and validated) before any connection is taken; the checks that need the database run in the same transaction as the inserts.
      const newFirm = n.type === "contractor" && !("existing" in n.firm) ? n.firm : null;
      const firmRows = newFirm ? buildFirmRows(randomUUID(), newFirm) : null;
      const name = normaliseName(n.name);
      if (name === "") throw new LoginInputError("The name cannot be empty.");
      return writeAsOffice(async (q) => {
        // The duplicate checks below read, then insert. Two saves at once (a
        // double-click, two operators) would both read nothing; company
        // creation is serialised so the second reads the first's row.
        await q("SELECT pg_advisory_xact_lock(hashtext('ac-logins:add-company'))");
        let crew;
        if (n.type === "ours") {
          await requireRegion(q, n.regionId);
          crew = buildCrewRow(name, n, "install");
        } else if (firmRows) {
          await requireRegion(q, firmRows.firm.region_id);
          if ((await q(`SELECT 1 FROM subcontractor_firms WHERE ${NORMALISED("legal_name")} = lower($1)`, [firmRows.firm.legal_name])).length > 0) {
            throw new LoginInputError(`A firm named ${firmRows.firm.legal_name} already exists`);
          }
          crew = buildCrewRow(name, { type: "contractor", firmId: firmRows.firm.id, firmOrgId: firmRows.firm.id, firmRegionId: firmRows.firm.region_id }, "install");
        } else {
          const f = await requireFirm(q, (n.firm as { existing: string }).existing);
          crew = buildCrewRow(name, { type: "contractor", firmId: f.id, firmOrgId: f.org_id, firmRegionId: f.region_id }, "install");
        }
        // Install crews are named by hand and must not collide; a service unit carries its technician's name, which two people can share.
        if ((await q(`SELECT 1 FROM crews WHERE active AND kind = 'install' AND ${NORMALISED("label")} = lower($1)`, [crew.label])).length > 0) {
          throw new LoginInputError(`An install crew named ${crew.label} already exists`);
        }
        if (firmRows) {
          await q(`INSERT INTO organizations (id, name, kind) VALUES ($1, $2, 'subcontractor')`, [firmRows.organization.id, firmRows.organization.name]);
          const f = firmRows.firm;
          await q(
            `INSERT INTO subcontractor_firms (id, org_id, region_id, legal_name, status, settlement_terms_days, msa_signed_at, diagnostic_data_rights_reserved)
             VALUES ($1, $1, $2, $3, 'onboarding', $4, $5::date, $6)`,
            [f.id, f.region_id, f.legal_name, f.settlement_terms_days, f.msa_signed_at, f.diagnostic_data_rights_reserved]);
          await emit(q, { topic: "firm.created", action: "firm.create", entity: "firm", entityId: f.id, orgId: f.id, regionId: f.region_id, after: { legalName: f.legal_name, status: "onboarding" } });
        }
        return { id: await insertCrew(q, crew), firmId: crew.firm_id };
      });
    },

    removeCompany: (id) => writeAsOffice(async (q) => {
      const [c] = await q<{ kind: CrewKind }>(`SELECT kind FROM crews WHERE id = $1 FOR UPDATE`, [id]);
      if (!c) throw new LoginInputError(COMPANY_GONE);
      const [{ n: techs }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE crew_id = $1 AND active`, [id]) as [{ n: number }];
      if (techs === 1 && c.kind === "service") throw new LoginInputError("This is a technician's own service unit — remove their login and the unit goes with it");
      if (techs > 0) throw new LoginInputError(`Give its ${plural(techs, "technician", "technicians")} their own service units first (Edit → Move to their own service unit)`);
      const [{ n: jobs }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM assignments WHERE crew_id = $1 AND released_at IS NULL`, [id]) as [{ n: number }];
      if (jobs > 0) throw new LoginInputError(`It has ${plural(jobs, "job", "jobs")} assigned — release them in Dispatch first`);
      await q(`UPDATE crews SET active = false WHERE id = $1`, [id]);
      await crewChanged(q, id, "crew.updated", "crew.retire");
    }),

    reactivateCompany: (id) => writeAsOffice(async (q) => {
      const [c] = await q<{ label: string; kind: CrewKind; firm_status: Firm["status"] | null; legal_name: string | null }>(
        `SELECT c.label, c.kind, f.status AS firm_status, f.legal_name FROM crews c LEFT JOIN subcontractor_firms f ON f.id = c.firm_id WHERE c.id = $1 FOR UPDATE OF c`, [id]);
      if (!c) throw new LoginInputError(COMPANY_GONE);
      // Reactivated alone, a service unit would be an empty row on the dispatch board.
      if (c.kind === "service") throw new LoginInputError("A service unit comes back with its technician — reactivate their login");
      if (c.firm_status === "terminated") throw new LoginInputError(terminatedMessage(c.legal_name!));
      if ((await q(`SELECT 1 FROM crews WHERE active AND kind = 'install' AND id <> $1 AND ${NORMALISED("label")} = lower($2)`, [id, normaliseName(c.label)])).length > 0) {
        throw new LoginInputError(`An install crew named ${normaliseName(c.label)} already exists`);
      }
      await q(`UPDATE crews SET active = true WHERE id = $1`, [id]);
      await crewChanged(q, id, "crew.updated", "crew.reactivate");
    }),

    listCustomerOrgs: () => read<CustomerOrg>(`SELECT id, name, segment FROM organizations WHERE kind = 'customer' AND active ORDER BY name`),

    listAccountTree: async (orgId) => (await read<{ id: string; tier: AccountNode["tier"]; name: string; parent_id: string | null; region_id: string }>(
      `SELECT id, tier, name, parent_id, region_id FROM accounts WHERE org_id = $1 AND active ORDER BY name`, [orgId]))
      .map((n) => ({ id: n.id, tier: n.tier, name: n.name, parentId: n.parent_id, regionId: n.region_id })),

    addLogin: async (n) => {
      if (n.kind === "customer") await checkCustomerScope(n.orgId, n.tier, n.nodeId);
      // A technician's row waits for their unit, made in the same transaction; the password is checked before either.
      if (n.kind === "technician") checkPassword(n.password);
      const ready = n.kind === "technician" ? null : buildUserRow(n);
      return (n.kind === "technician" ? writeAsOffice : write)(async (q) => {
        const row = ready ?? buildUserRow(n, await makeUnit(q, n.displayName, (n as Extract<NewLogin, { kind: "technician" }>).employer));
        try {
          const [made] = await q<{ id: string }>(
            `INSERT INTO users (org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, firm_id, crew_id, password_hash)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) RETURNING id`,
            [row.org_id, row.region_id, row.namespace, row.email, row.display_name, JSON.stringify(row.roles), row.scope_tier, row.scope_id, row.firm_id, row.crew_id, row.password_hash]);
          await userChanged(q, made!.id, "user.created", "user.create");
          return { id: made!.id };
        } catch (e) {
          if ((e as { code?: string }).code === "23505") throw new LoginInputError("A login with that email already exists");
          throw e;
        }
      });
    },

    resetPassword: (userId, password) => write(async (q) => {
      checkPassword(password);
      const hit = await q(`UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id`, [userId, hashPassword(password)]);
      if (hit.length === 0) throw new LoginInputError(GONE);
      return { revokedSessions: await revoke(q, userId) };
    }),

    editLogin: async (userId, edit) => {
      if (edit.scope) {
        const [who] = await read<{ namespace: string; org_id: string }>(`SELECT namespace, org_id FROM users WHERE id = $1`, [userId]);
        if (who?.namespace === "customer") await checkCustomerScope(who.org_id, edit.scope.tier, edit.scope.scopeId);
      }
      return (edit.ownUnit ? writeAsOffice : write)(async (q) => {
        const [cur] = await q<{ namespace: UsersRow["namespace"]; roles: Role[]; region_id: string; scope_tier: Tier; scope_id: string; org_id: string; crew_id: string | null }>(
          `SELECT namespace, roles, region_id, scope_tier, scope_id, org_id, crew_id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
        if (!cur) throw new LoginInputError(GONE);
        // The same checks addLogin makes: the window's edit is input, not a trusted row.
        if (edit.roles) checkRoles(cur.namespace, edit.roles);
        if (edit.ownUnit && cur.crew_id === null) throw new LoginInputError("Only a technician has a service unit.");
        if (edit.scope) {
          if (cur.namespace === "subcontractor" || cur.crew_id !== null) throw new LoginInputError("This login's scope follows its company — it cannot be set by hand.");
          if (cur.namespace === "internal") {
            const want = edit.scope.tier === "parent" || edit.scope.tier === "region" ? internalScope(edit.scope.tier === "parent" ? "org" : "region", edit.scope.regionId) : null;
            if (!want || want.scope_tier !== edit.scope.tier || want.scope_id !== edit.scope.scopeId) throw new LoginInputError("A staff login sees the whole company or one region.");
          }
          await requireRegion(q, edit.scope.regionId);
        }
        const before: Access = { roles: cur.roles, regionId: cur.region_id, scopeTier: cur.scope_tier, scopeId: cur.scope_id, orgId: cur.org_id, crewId: cur.crew_id };
        let after: Access = { ...before, roles: edit.roles ?? before.roles };
        if (edit.scope) after = { ...after, scopeTier: edit.scope.tier, scopeId: edit.scope.scopeId, regionId: edit.scope.regionId };
        if (edit.ownUnit) {
          const [c] = await q<{ kind: CrewKind; employment_type: Company["employmentType"]; firm_id: string | null; home_region_id: string; others: number }>(
            `SELECT kind, employment_type, firm_id, home_region_id,
                    (SELECT count(*)::int FROM users u WHERE u.crew_id = crews.id AND u.active AND u.id <> $2) AS others
               FROM crews WHERE id = $1 FOR SHARE`, [cur.crew_id, userId]);
          if (!c) throw new LoginInputError(COMPANY_GONE);
          if (c.kind === "service" && c.others === 0) throw new LoginInputError("This technician already has their own service unit.");
          const employer: Employer = c.employment_type === "employed" ? { type: "ours", regionId: c.home_region_id } : { type: "contractor", firmId: c.firm_id! };
          const unit = await makeUnit(q, edit.displayName, employer);
          after = { ...after, crewId: unit.id, regionId: unit.homeRegionId, scopeTier: "region", scopeId: unit.homeRegionId };
        }
        await q(
          `UPDATE users SET display_name = $2, roles = $3::jsonb, region_id = $4, scope_tier = $5, scope_id = $6, crew_id = $7 WHERE id = $1`,
          [userId, edit.displayName, JSON.stringify(after.roles), after.regionId, after.scopeTier, after.scopeId, after.crewId]);
        await userChanged(q, userId, "user.updated", "user.edit");
        return { revokedSessions: accessChanged(before, after) ? await revoke(q, userId) : 0 };
      });
    },

    listDevices: async () => (await read<{ id: string; hardware_id: string; kind: DeviceKind; active: boolean }>(
      `SELECT id, hardware_id, kind, active FROM devices ORDER BY hardware_id`)).map((d) => ({ id: d.id, hardwareId: d.hardware_id, kind: d.kind, active: d.active })),

    // The checks are the gateway's own (devices.register, devices.grantShift), run in this
    // transaction: one rule for who may hold which device when, whichever tool asks.
    grantShift: (n) => attempt(async () => {
      const tx = await beginTx(pool, "ac_logins");
      try {
        await tx.setLocal(INTERNAL_READ_BINDING as ScopeBinding);
        const q: Q = (sql, params) => tx.query(sql, params);
        const writer: DeviceWriter = {
          tx,
          apply: async (m, w) => {
            await w(tx);
            return emit(q, { topic: m.topic, action: m.action, entity: m.entity, entityId: m.entityId, orgId: m.orgId, regionId: m.regionId, after: m.after });
          },
        };
        const [u] = await q<{ crew_id: string | null; active: boolean; home_region_id: string | null; firm_id: string | null }>(
          `SELECT u.crew_id, u.active, c.home_region_id, c.firm_id FROM users u LEFT JOIN crews c ON c.id = u.crew_id WHERE u.id = $1`, [n.userId]);
        if (!u) throw new LoginInputError(GONE);
        if (!u.active) throw new LoginInputError("This login is removed. Reactivate it first.");
        if (!u.crew_id || !u.home_region_id) throw new LoginInputError("Only a technician signs in on a device.");
        let deviceId: string;
        if ("id" in n.device) {
          deviceId = n.device.id;
        } else {
          const taken = await q(`SELECT 1 FROM devices WHERE hardware_id = $1`, [n.device.hardwareId.trim()]);
          if (taken.length > 0) throw new LoginInputError(`A device ${n.device.hardwareId.trim()} is already registered. Choose it from the list.`);
          // A contractor's technician signs in on the firm's own hardware, as S2 records it.
          deviceId = (await registerDevice(writer, { hardwareId: n.device.hardwareId, kind: n.device.kind, regionId: u.home_region_id, ...(u.firm_id ? { firmId: u.firm_id } : {}) }, randomUUID)).id;
        }
        const out = await grantDeviceShift(writer, LOGINS_APP_ACTOR, { deviceId, crewId: u.crew_id, technicianId: n.userId, windowStart: n.windowStart, windowEnd: n.windowEnd }, randomUUID);
        await tx.commit();
        return { grantId: out.id, deviceId };
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    }),

    deactivate: async (userId) => {
      const [who] = await read<{ crew_id: string | null }>(`SELECT crew_id FROM users WHERE id = $1`, [userId]);
      if (!who) throw new LoginInputError(GONE);
      const crewId = who.crew_id;
      return (crewId ? writeAsOffice : write)(async (q) => {
        const hit = await q(`UPDATE users SET active = false WHERE id = $1 RETURNING id`, [userId]);
        if (hit.length === 0) throw new LoginInputError(GONE);
        await userChanged(q, userId, "user.updated", "user.deactivate");
        const revokedSessions = await revoke(q, userId);
        if (crewId) await retireOwnUnit(q, crewId);
        return { revokedSessions };
      });
    },

    reactivate: async (userId) => {
      const [who] = await read<{ crew_id: string | null }>(`SELECT crew_id FROM users WHERE id = $1`, [userId]);
      if (!who) throw new LoginInputError(GONE);
      const crewId = who.crew_id;
      return (crewId ? writeAsOffice : write)(async (q) => {
        if (crewId) {
          await restoreOwnUnit(q, crewId);
          await requireActiveCompany(q, crewId);
        }
        const hit = await q(`UPDATE users SET active = true WHERE id = $1 RETURNING id`, [userId]);
        if (hit.length === 0) throw new LoginInputError(GONE);
        await userChanged(q, userId, "user.updated", "user.reactivate");
      });
    },

    close: () => pool.end(),
  };

  await db.ping();
  return db;
};
