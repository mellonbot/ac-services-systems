import { createPool, beginTx, type Pool } from "../../../apps/gateway/src/pg-tx.ts";
import type { ScopeBinding, Role } from "../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../../packages/schema/src/tenancy.ts";
import type { UserRecord } from "./kinds.ts";
import { buildUserRow, checkPassword, accessChanged, LoginInputError } from "./rows.ts";
import type { NewLogin, Access } from "./rows.ts";
import { hashPassword } from "../../../apps/gateway/src/auth.ts";

/** Reads run as internal at the parent tier, so one query can join users to crew, firm, org and scope names. */
export const INTERNAL_READ_BINDING: Readonly<Record<string, string>> = {
  "ac.namespace": "internal", "ac.org_id": INTERNAL_ORG_ID, "ac.scope_tier": "parent", "ac.scope_id": INTERNAL_ORG_ID,
  "ac.region_id": "", "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": "", "ac.surface_id": "logins-app",
};

export class LoginsDbError extends Error {}

export type Region = { id: string; code: string; name: string };
export type Crew = { id: string; label: string; homeRegionId: string };
export type Firm = { id: string; legalName: string; regionId: string };
export type CustomerOrg = { id: string; name: string };
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
  org_id: string; org_name: string; region_id: string; region_code: string;
  scope_tier: Tier; scope_id: string; scope_name: string | null;
  firm_id: string | null; firm_name: string | null;
  crew_id: string | null; crew_label: string | null; crew_employment: "employed" | "subcontracted" | null;
  active: boolean;
};

const toRecord = (r: UserRow): UserRecord => ({
  id: r.id, email: r.email, displayName: r.display_name, namespace: r.namespace, roles: r.roles,
  orgId: r.org_id, orgName: r.org_name, regionId: r.region_id, regionCode: r.region_code,
  scopeTier: r.scope_tier, scopeId: r.scope_id, scopeName: r.scope_name,
  firmId: r.firm_id, firmName: r.firm_name,
  crewId: r.crew_id, crewLabel: r.crew_label, crewEmployment: r.crew_employment,
  active: r.active,
});

const failure = (e: unknown): Error => {
  if (e instanceof LoginInputError || e instanceof LoginsDbError) return e;
  return new LoginsDbError(e instanceof Error ? e.message : String(e));
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
    const tx = await beginTx(pool, "ac_gateway");
    try {
      await tx.setLocal(INTERNAL_READ_BINDING as ScopeBinding);
      return await tx.query<T>(sql, params);
    } finally {
      await tx.rollback();
    }
  });

  const write = <T>(f: (q: <R>(sql: string, params?: readonly unknown[]) => Promise<readonly R[]>) => Promise<T>): Promise<T> => attempt(async () => {
    const tx = await beginTx(pool, "ac_gateway");
    try {
      const out = await f((sql, params) => tx.query(sql, params));
      await tx.commit();
      return out;
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  });

  const revoke = async (q: <R>(sql: string, params?: readonly unknown[]) => Promise<readonly R[]>, userId: string): Promise<number> =>
    (await q<{ id: string }>(`${REVOKE_SESSIONS} RETURNING id`, [userId])).length;

  const db: LoginsDb = {
    ping: async () => { await read("SELECT 1"); },

    listUsers: async ({ includeInactive }) => (await read<UserRow>(
      `SELECT u.id, u.email, u.display_name, u.namespace, u.roles, u.org_id, o.name AS org_name,
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

    listCrews: async () => (await read<{ id: string; label: string; home_region_id: string }>(
      `SELECT id, label, home_region_id FROM crews WHERE active AND employment_type = 'employed' ORDER BY label`))
      .map((c) => ({ id: c.id, label: c.label, homeRegionId: c.home_region_id })),

    listFirms: async () => (await read<{ id: string; legal_name: string; region_id: string }>(
      `SELECT id, legal_name, region_id FROM subcontractor_firms ORDER BY legal_name`))
      .map((f) => ({ id: f.id, legalName: f.legal_name, regionId: f.region_id })),

    listCustomerOrgs: () => read<CustomerOrg>(`SELECT id, name FROM organizations WHERE kind = 'customer' AND active ORDER BY name`),

    listAccountTree: async (orgId) => (await read<{ id: string; tier: AccountNode["tier"]; name: string; parent_id: string | null; region_id: string }>(
      `SELECT id, tier, name, parent_id, region_id FROM accounts WHERE org_id = $1 AND active ORDER BY name`, [orgId]))
      .map((n) => ({ id: n.id, tier: n.tier, name: n.name, parentId: n.parent_id, regionId: n.region_id })),

    addLogin: (n) => write(async (q) => {
      const row = buildUserRow(n);
      try {
        const [made] = await q<{ id: string }>(
          `INSERT INTO users (org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, firm_id, crew_id, password_hash)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) RETURNING id`,
          [row.org_id, row.region_id, row.namespace, row.email, row.display_name, JSON.stringify(row.roles), row.scope_tier, row.scope_id, row.firm_id, row.crew_id, row.password_hash]);
        return { id: made!.id };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new LoginInputError("A login with that email already exists");
        throw e;
      }
    }),

    resetPassword: (userId, password) => write(async (q) => {
      checkPassword(password);
      await q(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hashPassword(password)]);
      return { revokedSessions: await revoke(q, userId) };
    }),

    editLogin: (userId, edit) => write(async (q) => {
      const [cur] = await q<{ roles: Role[]; region_id: string; scope_tier: Tier; scope_id: string; org_id: string; crew_id: string | null }>(
        `SELECT roles, region_id, scope_tier, scope_id, org_id, crew_id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      if (!cur) throw new LoginInputError("That login no longer exists");
      const before: Access = { roles: cur.roles, regionId: cur.region_id, scopeTier: cur.scope_tier, scopeId: cur.scope_id, orgId: cur.org_id, crewId: cur.crew_id };
      let after: Access = { ...before, roles: edit.roles ?? before.roles };
      if (edit.scope) after = { ...after, scopeTier: edit.scope.tier, scopeId: edit.scope.scopeId, regionId: edit.scope.regionId };
      if (edit.crew) after = { ...after, crewId: edit.crew.id, regionId: edit.crew.homeRegionId, scopeTier: "region", scopeId: edit.crew.homeRegionId };
      await q(
        `UPDATE users SET display_name = $2, roles = $3::jsonb, region_id = $4, scope_tier = $5, scope_id = $6, crew_id = $7 WHERE id = $1`,
        [userId, edit.displayName, JSON.stringify(after.roles), after.regionId, after.scopeTier, after.scopeId, after.crewId]);
      return { revokedSessions: accessChanged(before, after) ? await revoke(q, userId) : 0 };
    }),

    deactivate: (userId) => write(async (q) => {
      await q(`UPDATE users SET active = false WHERE id = $1`, [userId]);
      return { revokedSessions: await revoke(q, userId) };
    }),

    reactivate: (userId) => write(async (q) => { await q(`UPDATE users SET active = true WHERE id = $1`, [userId]); }),

    close: () => pool.end(),
  };

  await db.ping();
  return db;
};
