import pg from "pg";
import type { ScopeBinding } from "../../../packages/contracts/src/scope.ts";
import type { Tx } from "./unit-of-work.ts";
import type { HierarchyReader } from "./context.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";

/**
 * THE ONLY FILE IN THE REPOSITORY THAT IMPORTS A DATABASE DRIVER.
 *
 * `.npmrc` isolation makes `pg` unresolvable from a surface; the import guard
 * and lint rule refuse it anywhere outside apps/gateway and apps/worker. This
 * file is the door.
 *
 * Every transaction starts with SET LOCAL of the scope binding, so RLS has
 * its inputs before the first statement. SET LOCAL dies with the transaction,
 * so a pooled connection cannot carry one principal's scope into the next
 * request. That property is the whole reason it is SET LOCAL and not SET.
 */
export type Pool = pg.Pool;

export const createPool = (connectionString: string, applicationName = "ac-gateway"): Pool =>
  new pg.Pool({ connectionString, application_name: applicationName, max: 10 });

const ident = (s: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`unsafe identifier "${s}"`);
  return `"${s}"`;
};

/**
 * @param role  The Postgres role the transaction runs as. In production the
 *              pool's login role IS a member of ac_gateway and nothing else, so
 *              this is belt-and-braces; in tests and tooling it is what makes
 *              RLS apply at all (a superuser bypasses row security). Runs as
 *              SET LOCAL ROLE, so it dies with the transaction.
 */
export const beginTx = async (pool: Pool, role?: "ac_gateway" | "ac_worker" | "ac_readonly"): Promise<Tx> => {
  const client = await pool.connect();
  let done = false;
  const release = () => {
    if (!done) {
      done = true;
      client.release();
    }
  };
  try {
    await client.query("BEGIN");
    if (role) await client.query(`SET LOCAL ROLE ${role}`);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection may be gone */ }
    release();
    throw e;
  }
  return {
    async setLocal(binding: ScopeBinding) {
      // set_config(name, value, is_local=true) is SET LOCAL with parameters.
      for (const [k, v] of Object.entries(binding)) {
        await client.query("SELECT set_config($1, $2, true)", [k, v]);
      }
    },
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const r = await client.query(sql, [...params]);
      return r.rows as T[];
    },
    async insert(table: string, row: Record<string, unknown>) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => {
        const v = row[c];
        // jsonb columns receive JSON text; pg serialises objects itself but
        // bigint must be a string and undefined must be null.
        if (typeof v === "bigint") return v.toString();
        if (v === undefined) return null;
        if (v !== null && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)) return JSON.stringify(v);
        return v;
      });
      await client.query(
        `INSERT INTO ${ident(table)} (${cols.map(ident).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        vals,
      );
    },
    async commit() {
      try {
        await client.query("COMMIT");
      } finally {
        release();
      }
    },
    async rollback() {
      try {
        await client.query("ROLLBACK");
      } finally {
        release();
      }
    },
  };
};

/** HierarchyReader over a Tx (so context resolution runs under the same scope binding). */
export const hierarchyReader = (tx: Tx): HierarchyReader => ({
  async organization(id) {
    const r = await tx.query<{ id: string; name: string }>("SELECT id, name FROM organizations WHERE id = $1 AND active", [id]);
    return r[0] ?? null;
  },
  async region(id) {
    const r = await tx.query<{ id: string; code: string; name: string }>("SELECT id, code, name FROM regions WHERE id = $1 AND active", [id]);
    return r[0] ?? null;
  },
  async account(id) {
    const r = await tx.query<{ id: string; tier: Tier; name: string; parent_id: string | null; region_id: string; org_id: string; customer_group: string | null }>(
      "SELECT id, tier, name, parent_id, region_id, org_id, customer_group FROM accounts WHERE id = $1", [id],
    );
    const a = r[0];
    return a ? { id: a.id, tier: a.tier, name: a.name, parentId: a.parent_id, regionId: a.region_id, orgId: a.org_id, customerGroup: a.customer_group } : null;
  },
  async regionNodesOf(orgId) {
    const r = await tx.query<{ id: string; name: string; region_id: string }>(
      "SELECT id, name, region_id FROM accounts WHERE org_id = $1 AND tier = 'region' AND active ORDER BY name", [orgId],
    );
    return r.map((x) => ({ id: x.id, name: x.name, regionId: x.region_id }));
  },
});

/**
 * LISTEN on the event channel. The one long-lived connection in the gateway,
 * used to fan the relay's NOTIFY out to SSE subscribers. Also behind the door.
 */
export const listenEvents = async (connectionString: string, onEnvelope: (payload: string) => void): Promise<() => Promise<void>> => {
  const client = new pg.Client({ connectionString, application_name: "ac-gateway-listen" });
  await client.connect();
  await client.query("LISTEN ac_events");
  client.on("notification", (n) => { if (n.payload) onEnvelope(n.payload); });
  return () => client.end();
};
