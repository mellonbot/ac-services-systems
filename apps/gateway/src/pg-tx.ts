import pg from "pg";
import type { ScopeBinding } from "../../../packages/contracts/src/scope.ts";
import type { Tx } from "./unit-of-work.ts";
import type { HierarchyReader } from "./context.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";
import type { CustomerSegment } from "../../../packages/contracts/src/operations.ts";
import { forNodePg } from "./pg-url.ts";

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

export const createPool = (connectionString: string, applicationName = "ac-gateway"): Pool => {
  // A bounded wait for a connection: an exhausted pool is a refusal, not a hang.
  const pool = new pg.Pool({ connectionString: forNodePg(connectionString), application_name: applicationName, max: 10, connectionTimeoutMillis: 10_000 });
  // An idle client dropped by the server (restart, failover) emits 'error' on
  // the pool. Unlistened, that event kills the process; the pool already
  // discards the client, so logging it is the whole of the handling.
  pool.on("error", (e) => console.error(`${applicationName}: idle connection lost: ${e.message}`));
  return pool;
};

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
export const beginTx = async (pool: Pool, role?: "ac_gateway" | "ac_worker" | "ac_readonly" | "ac_logins"): Promise<Tx> => {
  const client = await pool.connect();
  let done = false;
  // A connection whose COMMIT or ROLLBACK failed is destroyed rather than
  // returned: its state is unknown, and the next request must not inherit it.
  const release = (err?: Error) => {
    if (!done) {
      done = true;
      client.release(err);
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
      if (done) throw new Error("transaction already ended");
      try {
        await client.query("COMMIT");
      } catch (e) {
        release(e as Error);
        throw e;
      }
      release();
    },
    // Once ended, a rollback is a no-op: the client may already belong to
    // another request, and a ROLLBACK sent on it would end THEIR transaction.
    async rollback() {
      if (done) return;
      try {
        await client.query("ROLLBACK");
      } catch (e) {
        release(e as Error);
        throw e;
      }
      release();
    },
  };
};

/**
 * The gateway acting as itself, before there is a principal: login,
 * the session check, the sign-in screen's theme. Named, because since 0021 a
 * transaction that names nobody reads nothing — a forgotten binding is a
 * refusal, not every tenant's rows.
 */
export const bindSystem = async (tx: Tx): Promise<void> => {
  await tx.query("SELECT set_config('ac.namespace', 'system', true)");
};

/** HierarchyReader over a Tx (so context resolution runs under the same scope binding). */
export const hierarchyReader = (tx: Tx): HierarchyReader => ({
  async organization(id) {
    const r = await tx.query<{ id: string; name: string; segment: CustomerSegment | null }>("SELECT id, name, segment FROM organizations WHERE id = $1 AND active", [id]);
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
  let client: pg.Client | null = null;
  let stopped = false;
  let delay = 1000;
  const open = async (): Promise<void> => {
    const c = new pg.Client({ connectionString: forNodePg(connectionString), application_name: "ac-gateway-listen", connectionTimeoutMillis: 10_000 });
    // A dropped LISTEN connection is reopened with backoff. Without this the
    // 'error' event kills the gateway, and without the reconnect every SSE
    // subscriber goes quiet until a restart.
    c.on("error", (e) => console.error(`gateway: event listener lost: ${e.message}`));
    c.on("end", () => {
      if (stopped || client !== c) return;
      client = null;
      setTimeout(() => { void open().catch(() => {}); }, delay);
      delay = Math.min(delay * 2, 30_000);
    });
    c.on("notification", (n) => { if (n.payload) onEnvelope(n.payload); });
    client = c;
    try {
      await c.connect();
      await c.query("LISTEN ac_events");
      delay = 1000;
    } catch (e) {
      // Unreachable at boot as on a reconnect: retry with the same backoff and
      // never throw. A throw here at boot took the gateway down before it
      // listened, so neither /healthz nor /readyz could say the database was gone.
      console.error(`gateway: event listener could not connect: ${(e as Error).message}`);
      client = null;
      await c.end().catch(() => {});
      if (!stopped) setTimeout(() => { void open(); }, delay);
      delay = Math.min(delay * 2, 30_000);
    }
  };
  await open();
  return async () => { stopped = true; await client?.end(); };
};
