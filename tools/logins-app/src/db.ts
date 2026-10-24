import { createPool, beginTx, bindSystem, type Pool } from "../../../apps/gateway/src/pg-tx.ts";
import type { ScopeBinding, Role } from "../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";
import type { CustomerSegment } from "../../../packages/contracts/src/operations.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../../packages/schema/src/tenancy.ts";
import type { UserRecord } from "./kinds.ts";
import { buildUserRow, checkPassword, checkRoles, internalScope, accessChanged, LoginInputError } from "./rows.ts";
import type { NewLogin, Access, UsersRow } from "./rows.ts";
import { hashPassword } from "../../../apps/gateway/src/auth.ts";
import { summarizeDocuments } from "../../../apps/gateway/src/handlers/network.ts";
import type { CredentialWire } from "../../../packages/contracts/src/operations.ts";
import { randomUUID } from "node:crypto";
import { isTopic, type Topic } from "../../../packages/contracts/src/events.ts";
import { buildCrewRow, buildFirmRows, documentsLabel, normaliseName } from "./companies.ts";
import type { NewCompany } from "./companies.ts";

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
export type Crew = { id: string; label: string; homeRegionId: string; employmentType: "employed" | "subcontracted"; firmName: string | null };
export type Firm = { id: string; legalName: string; regionId: string; status: "onboarding" | "active" | "suspended" | "terminated" };
export type Company = Crew & { regionCode: string; active: boolean; firmId: string | null; firmStatus: Firm["status"] | null; technicians: number; documents: string };
export type CustomerOrg = { id: string; name: string; segment: CustomerSegment };
export type AccountNode = { id: string; tier: "region" | "location" | "site"; name: string; parentId: string | null; regionId: string };
export type LoginEdit = {
  readonly displayName: string;
  readonly roles?: readonly Role[];
  readonly scope?: { readonly tier: Tier; readonly scopeId: string; readonly regionId: string };
  readonly crew?: { readonly id: string; readonly homeRegionId: string };
};

export type LoginsDb = {
  ping(): Promise<void>;
  listUsers(opts: { includeInactive: boolean }): Promise<readonly UserRecord[]>;
  listRegions(): Promise<readonly Region[]>;
  listCrews(): Promise<readonly Crew[]>;
  listFirms(): Promise<readonly Firm[]>;
  listCompanies(opts: { includeInactive: boolean }): Promise<readonly Company[]>;
  addCompany(n: NewCompany): Promise<{ id: string; firmId: string | null }>;
  removeCompany(id: string): Promise<void>;
  reactivateCompany(id: string): Promise<void>;
  listCustomerOrgs(): Promise<readonly CustomerOrg[]>;
  listAccountTree(orgId: string): Promise<readonly AccountNode[]>;
  addLogin(n: NewLogin): Promise<{ id: string }>;
  resetPassword(userId: string, password: string): Promise<{ revokedSessions: number }>;
  editLogin(userId: string, edit: LoginEdit): Promise<{ revokedSessions: number }>;
  deactivate(userId: string): Promise<{ revokedSessions: number }>;
  reactivate(userId: string): Promise<void>;
  close(): Promise<void>;
};

const REVOKE_SESSIONS = `UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND ((principal_kind = 'user' AND principal_id = $1) OR (principal_kind = 'device_grant' AND principal_id IN (SELECT id FROM device_grants WHERE technician_id = $1)))`;

type UserRow = {
  id: string; email: string; display_name: string; namespace: UserRecord["namespace"]; roles: string[];
  org_id: string; org_name: string; org_segment: CustomerSegment | null; region_id: string; region_code: string;
  scope_tier: Tier; scope_id: string; scope_name: string | null;
  firm_id: string | null; firm_name: string | null;
  crew_id: string | null; crew_label: string | null; crew_employment: "employed" | "subcontracted" | null;
  active: boolean;
};

const toRecord = (r: UserRow): UserRecord => ({
  id: r.id, email: r.email, displayName: r.display_name, namespace: r.namespace, roles: r.roles,
  orgId: r.org_id, orgName: r.org_name, orgSegment: r.org_segment, regionId: r.region_id, regionCode: r.region_code,
  scopeTier: r.scope_tier, scopeId: r.scope_id, scopeName: r.scope_name,
  firmId: r.firm_id, firmName: r.firm_name,
  crewId: r.crew_id, crewLabel: r.crew_label, crewEmployment: r.crew_employment,
  active: r.active,
});

const LOST = "Lost the connection to the database.";
const GONE = "That login no longer exists";
const COMPANY_GONE = "That company no longer exists";
const NO_REGION = "That region is not available";
const removedMessage = (label: string): string => `${label} has been removed — choose another company`;
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
  const emit = async (q: Q, c: Change): Promise<void> => {
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

  /** A technician may only stand under an active company; the share lock keeps removeCompany from slipping in before the users write commits. */
  const requireActiveCompany = async (q: Q, crewId: string): Promise<void> => {
    const [c] = await q<{ label: string; active: boolean }>(`SELECT label, active FROM crews WHERE id = $1 FOR SHARE`, [crewId]);
    if (!c) throw new LoginInputError(COMPANY_GONE);
    if (!c.active) throw new LoginInputError(removedMessage(c.label));
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
    (await q<{ id: string }>(`${REVOKE_SESSIONS} RETURNING id`, [userId])).length;

  const db: LoginsDb = {
    ping: async () => { await read("SELECT 1"); },

    listUsers: async ({ includeInactive }) => (await read<UserRow>(
      `SELECT u.id, u.email, u.display_name, u.namespace, u.roles, u.org_id, o.name AS org_name, o.segment AS org_segment,
              u.region_id, r.code AS region_code, u.scope_tier, u.scope_id,
              CASE WHEN u.scope_tier <> 'parent' THEN a.name END AS scope_name,
              u.firm_id, f.legal_name AS firm_name,
              u.crew_id, c.label AS crew_label, c.employment_type AS crew_employment, u.active
         FROM users u
         JOIN organizations o ON o.id = u.org_id
         JOIN regions r ON r.id = u.region_id
         LEFT JOIN crews c ON c.id = u.crew_id
         LEFT JOIN subcontractor_firms f ON f.id = u.firm_id
         LEFT JOIN accounts a ON a.id = u.scope_id AND u.scope_tier <> 'parent'
        WHERE $1 OR u.active
        ORDER BY u.email`, [includeInactive])).map(toRecord),

    listRegions: () => read<Region>(`SELECT id, code, name FROM regions WHERE active AND id <> $1 ORDER BY code`, [UNASSIGNED_REGION_ID]),

    listCrews: async () => (await read<{ id: string; label: string; home_region_id: string; employment_type: Crew["employmentType"]; firm_name: string | null }>(
      `SELECT c.id, c.label, c.home_region_id, c.employment_type, f.legal_name AS firm_name
         FROM crews c LEFT JOIN subcontractor_firms f ON f.id = c.firm_id
        WHERE c.active ORDER BY c.employment_type, c.label`))
      .map((c) => ({ id: c.id, label: c.label, homeRegionId: c.home_region_id, employmentType: c.employment_type, firmName: c.firm_name })),

    listFirms: async () => (await read<{ id: string; legal_name: string; region_id: string; status: Firm["status"] }>(
      `SELECT id, legal_name, region_id, status FROM subcontractor_firms WHERE status <> 'terminated' ORDER BY legal_name`))
      .map((f) => ({ id: f.id, legalName: f.legal_name, regionId: f.region_id, status: f.status })),

    listCompanies: async ({ includeInactive }) => {
      const crews = await read<{
        id: string; label: string; home_region_id: string; region_code: string; employment_type: Crew["employmentType"]; active: boolean;
        firm_id: string | null; firm_name: string | null; firm_status: Firm["status"] | null; technicians: number;
      }>(
        `SELECT c.id, c.label, c.home_region_id, r.code AS region_code, c.employment_type, c.active,
                c.firm_id, f.legal_name AS firm_name, f.status AS firm_status,
                (SELECT count(*)::int FROM users u WHERE u.crew_id = c.id AND u.active) AS technicians
           FROM crews c
           JOIN regions r ON r.id = c.home_region_id
           LEFT JOIN subcontractor_firms f ON f.id = c.firm_id
          WHERE $1 OR c.active
          ORDER BY c.employment_type, c.label`, [includeInactive]);
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
        id: c.id, label: c.label, homeRegionId: c.home_region_id, employmentType: c.employment_type, firmName: c.firm_name,
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
          crew = buildCrewRow(name, n);
        } else if (firmRows) {
          await requireRegion(q, firmRows.firm.region_id);
          if ((await q(`SELECT 1 FROM subcontractor_firms WHERE ${NORMALISED("legal_name")} = lower($1)`, [firmRows.firm.legal_name])).length > 0) {
            throw new LoginInputError(`A firm named ${firmRows.firm.legal_name} already exists`);
          }
          crew = buildCrewRow(name, { type: "contractor", firmId: firmRows.firm.id, firmOrgId: firmRows.firm.id, firmRegionId: firmRows.firm.region_id });
        } else {
          const existing = (n.firm as { existing: string }).existing;
          const [f] = await q<{ id: string; org_id: string; region_id: string; status: Firm["status"]; legal_name: string }>(
            `SELECT id, org_id, region_id, status, legal_name FROM subcontractor_firms WHERE id = $1 FOR SHARE`, [existing]);
          if (!f) throw new LoginInputError("That firm no longer exists");
          if (f.status === "terminated") throw new LoginInputError(terminatedMessage(f.legal_name));
          crew = buildCrewRow(name, { type: "contractor", firmId: f.id, firmOrgId: f.org_id, firmRegionId: f.region_id });
        }
        if ((await q(`SELECT 1 FROM crews WHERE active AND ${NORMALISED("label")} = lower($1)`, [crew.label])).length > 0) {
          throw new LoginInputError(`A company named ${crew.label} already exists`);
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
        const [made] = await q<{ id: string }>(
          `INSERT INTO crews (org_id, region_id, label, employment_type, firm_id, home_region_id, active) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
          [crew.org_id, crew.region_id, crew.label, crew.employment_type, crew.firm_id, crew.home_region_id]);
        await crewChanged(q, made!.id, "crew.created", "crew.create");
        return { id: made!.id, firmId: crew.firm_id };
      });
    },

    removeCompany: (id) => writeAsOffice(async (q) => {
      const [c] = await q<{ id: string }>(`SELECT id FROM crews WHERE id = $1 FOR UPDATE`, [id]);
      if (!c) throw new LoginInputError(COMPANY_GONE);
      const [{ n: techs }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE crew_id = $1 AND active`, [id]) as [{ n: number }];
      if (techs > 0) throw new LoginInputError(`Move its ${plural(techs, "technician", "technicians")} to another company first`);
      const [{ n: jobs }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM assignments WHERE crew_id = $1 AND released_at IS NULL`, [id]) as [{ n: number }];
      if (jobs > 0) throw new LoginInputError(`It has ${plural(jobs, "job", "jobs")} assigned — release them in Dispatch first`);
      await q(`UPDATE crews SET active = false WHERE id = $1`, [id]);
      await crewChanged(q, id, "crew.updated", "crew.retire");
    }),

    reactivateCompany: (id) => writeAsOffice(async (q) => {
      const [c] = await q<{ label: string; firm_status: Firm["status"] | null; legal_name: string | null }>(
        `SELECT c.label, f.status AS firm_status, f.legal_name FROM crews c LEFT JOIN subcontractor_firms f ON f.id = c.firm_id WHERE c.id = $1 FOR UPDATE OF c`, [id]);
      if (!c) throw new LoginInputError(COMPANY_GONE);
      if (c.firm_status === "terminated") throw new LoginInputError(terminatedMessage(c.legal_name!));
      if ((await q(`SELECT 1 FROM crews WHERE active AND id <> $1 AND ${NORMALISED("label")} = lower($2)`, [id, normaliseName(c.label)])).length > 0) {
        throw new LoginInputError(`A company named ${normaliseName(c.label)} already exists`);
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
      const row = buildUserRow(n);
      return (n.kind === "technician" ? writeAsOffice : write)(async (q) => {
        if (n.kind === "technician") await requireActiveCompany(q, n.crewId);
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
      return (edit.crew ? writeAsOffice : write)(async (q) => {
        if (edit.crew) await requireActiveCompany(q, edit.crew.id);
        const [cur] = await q<{ namespace: UsersRow["namespace"]; roles: Role[]; region_id: string; scope_tier: Tier; scope_id: string; org_id: string; crew_id: string | null }>(
          `SELECT namespace, roles, region_id, scope_tier, scope_id, org_id, crew_id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
        if (!cur) throw new LoginInputError(GONE);
        // The same checks addLogin makes: the window's edit is input, not a trusted row.
        if (edit.roles) checkRoles(cur.namespace, edit.roles);
        if (edit.crew && cur.crew_id === null) throw new LoginInputError("Only a technician belongs to a company.");
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
        if (edit.crew) after = { ...after, crewId: edit.crew.id, regionId: edit.crew.homeRegionId, scopeTier: "region", scopeId: edit.crew.homeRegionId };
        await q(
          `UPDATE users SET display_name = $2, roles = $3::jsonb, region_id = $4, scope_tier = $5, scope_id = $6, crew_id = $7 WHERE id = $1`,
          [userId, edit.displayName, JSON.stringify(after.roles), after.regionId, after.scopeTier, after.scopeId, after.crewId]);
        await userChanged(q, userId, "user.updated", "user.edit");
        return { revokedSessions: accessChanged(before, after) ? await revoke(q, userId) : 0 };
      });
    },

    deactivate: (userId) => write(async (q) => {
      const hit = await q(`UPDATE users SET active = false WHERE id = $1 RETURNING id`, [userId]);
      if (hit.length === 0) throw new LoginInputError(GONE);
      await userChanged(q, userId, "user.updated", "user.deactivate");
      return { revokedSessions: await revoke(q, userId) };
    }),

    reactivate: async (userId) => {
      const [who] = await read<{ crew_id: string | null }>(`SELECT crew_id FROM users WHERE id = $1`, [userId]);
      if (!who) throw new LoginInputError(GONE);
      const crewId = who.crew_id;
      return (crewId ? writeAsOffice : write)(async (q) => {
        if (crewId) await requireActiveCompany(q, crewId);
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
