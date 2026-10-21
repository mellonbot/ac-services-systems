/**
 * THE QUICKBOOKS MIRROR (0018) against a live PostgreSQL and a scripted
 * QuickBooks. Scratch database, the way s4.test.ts and manager.test.ts run:
 * the mirror is company-wide, so the rows asserted are exactly the ones the
 * scripted QuickBooks hands over.
 *
 * What it holds:
 *   - an invoice whose memo names a job carries that job's tenancy; one that
 *     names none is INTERNAL / UNASSIGNED; a payment carries its invoice's,
 *     and follows it when the invoice arrives or moves later;
 *   - a payment QuickBooks changes takes its new lines, a line it dropped goes
 *     to zero (nothing is deleted), and a second sync of the same rows changes
 *     nothing;
 *   - the rotated refresh token is committed sealed BEFORE the fetch, so a
 *     failed fetch keeps it; a refused stored token falls back to the
 *     configured one;
 *   - the office reads the mirror and when it last ran, never the token; a
 *     customer reads none of it; the gateway role writes none of it.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createPool, beginTx, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { workerScope } from "../../apps/worker/src/sweeps.ts";
import { sweepLedger, openToken, type Fetch, type LedgerConfig } from "../../apps/worker/src/ledger.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const GIVEN = process.env.DATABASE_URL;
const skip = GIVEN ? false : "DATABASE_URL not set — the QuickBooks mirror was not verified against PostgreSQL";
const RUN = `ledger-${Date.now().toString(36)}`;
const SCRATCH = `ac_${RUN.replace(/-/g, "_")}`;
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const URL_ = GIVEN ? withDb(GIVEN, SCRATCH) : undefined;
const U = (n: number) => `d7000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), RNODE = U(2), LOC = U(3), SITE = U(4), JOB = U(5), JOB_LATE = U(6);
const REALM = "9130-ledger";

const cfg: LedgerConfig = {
  clientId: "cid", clientSecret: "secret", realmId: REALM, bootstrapRefreshToken: "rt-0",
  tokenKey: randomBytes(32), apiBase: "https://sandbox-quickbooks.api.intuit.com",
};

let maintenance: Pool;
let pool: Pool;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
const bound = async () => { const tx = await beginTx(pool, "ac_worker"); await tx.setLocal(workerScope()); return tx; };
const asGateway = async (namespace: string, sql: string) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN"); await c.query("SET LOCAL ROLE ac_gateway");
    for (const [k, v] of Object.entries({ "ac.namespace": namespace, "ac.org_id": namespace === "internal" ? INTERNAL_ORG_ID : ORG, "ac.region_id": REGION_SOUTH,
      "ac.scope_tier": "parent", "ac.scope_id": namespace === "internal" ? INTERNAL_ORG_ID : ORG, "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": U(9), "ac.surface_id": "S3" })) {
      await c.query("SELECT set_config($1, $2, true)", [k, v]);
    }
    return (await c.query(sql)).rows;
  } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
};

/** A scripted QuickBooks: the token endpoint and the query endpoint, each answering from what the test set. */
const qbo = {
  tokens: new Map<string, string>(), // refresh token accepted → the one handed back
  invoices: [] as unknown[], payments: [] as unknown[],
  failQuery: false,
  seenRefresh: [] as string[], seenSince: [] as string[],
};
const fetch: Fetch = async (url, init) => {
  const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.startsWith("https://oauth.platform.intuit.com/")) {
    const rt = new URLSearchParams(init.body).get("refresh_token")!;
    qbo.seenRefresh.push(rt);
    const next = qbo.tokens.get(rt);
    return next ? answer(200, { access_token: `at-for-${rt}`, refresh_token: next }) : answer(400, { error: "invalid_grant" });
  }
  if (qbo.failQuery) return answer(503, { fault: "unavailable" });
  const q = new URL(url).searchParams.get("query")!;
  qbo.seenSince.push(/>= '([^']+)'/.exec(q)![1]!);
  const entity = /FROM (\w+)/.exec(q)![1]!;
  return answer(200, { QueryResponse: { [entity]: entity === "Invoice" ? qbo.invoices : qbo.payments } });
};
const invoice = (id: string, memo: string | null, total: number, balance: number, updated: string) => ({
  Id: id, DocNumber: `10${id}`, TxnDate: "2026-10-01", DueDate: "2026-10-31", TotalAmt: total, Balance: balance,
  CustomerRef: { value: "58", name: "Manager Customer" }, ...(memo ? { CustomerMemo: { value: memo } } : {}), MetaData: { LastUpdatedTime: updated },
});
const payment = (id: string, lines: [string, number][], updated: string) => ({
  Id: id, TxnDate: "2026-10-06", Line: lines.map(([inv, amount]) => ({ Amount: amount, LinkedTxn: [{ TxnId: inv, TxnType: "Invoice" }] })), MetaData: { LastUpdatedTime: updated },
});

before(async () => {
  if (!GIVEN || !URL_) return;
  const given = new URL(GIVEN).pathname.replace(/^\//, "");
  maintenance = createPool(withDb(GIVEN, given === "postgres" ? "template1" : "postgres"), "ac-ledger-test-admin");
  { const c = await maintenance.connect(); try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); } }
  const mig = spawn(process.execPath, [fileURLToPath(new URL("../../tools/ci/migrate.ts", import.meta.url))], { env: { ...process.env, DATABASE_URL: URL_ }, stdio: ["ignore", "pipe", "pipe"] });
  let mlog = "";
  mig.stdout!.on("data", (d) => { mlog += String(d); });
  mig.stderr!.on("data", (d) => { mlog += String(d); });
  if (await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1))) !== 0) throw new Error(`migrate failed on ${SCRATCH}:\n${mlog}`);
  pool = createPool(URL_, "ac-ledger-test");
  pool.on("error", () => {});

  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  await admin(`INSERT INTO organizations (id, name, kind) VALUES ($1,'Ledger Customer','customer')`, [ORG]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'region',NULL,'L / South')`, [RNODE, ORG, REGION_SOUTH]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'location',$4,'L location')`, [LOC, ORG, REGION_SOUTH, RNODE]);
  await admin(`INSERT INTO accounts (id, org_id, region_id, tier, parent_id, name) VALUES ($1,$2,$3,'site',$4,'L site')`, [SITE, ORG, REGION_SOUTH, LOC]);
  for (const id of [JOB, JOB_LATE]) {
    await admin(`INSERT INTO jobs (id, org_id, region_id, site_id, service_code, service_window, state)
      VALUES ($1,$2,$3,$4,'HVAC-REPAIR', tstzrange(now(), now() + interval '2 hours', '[)'), 'invoiced')`, [id, ORG, REGION_SOUTH, SITE]);
  }
});

after(async () => {
  await pool?.end();
  if (maintenance) {
    const c = await maintenance.connect().catch(() => null);
    if (c) { try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } finally { c.release(); } }
    await maintenance.end().catch(() => {});
  }
});

const invoices = () => admin("SELECT qbo_id, job_id, org_id, region_id, total_minor::text, balance_minor::text, memo FROM ledger_invoices ORDER BY qbo_id");
const payments = () => admin("SELECT qbo_id, invoice_qbo_id, amount_minor::text, org_id, region_id FROM ledger_payments ORDER BY qbo_id, invoice_qbo_id");
const state = async () => (await admin("SELECT cursor, refresh_token_enc, synced_at FROM ledger_sync_state WHERE realm_id = $1", [REALM]))[0]!;

test("first sync: the memo's job gives the invoice its tenancy; no job is INTERNAL / UNASSIGNED; a payment carries its invoice's", { skip }, async () => {
  qbo.tokens.set("rt-0", "rt-1");
  qbo.invoices = [invoice("1", `Job ${JOB}`, 1000, 0, "2026-10-06T10:00:00-07:00"), invoice("2", null, 500.5, 500.5, "2026-10-02T09:00:00-07:00")];
  qbo.payments = [payment("p1", [["1", 1000]], "2026-10-06T11:00:00-07:00"), payment("p2", [["3", 200]], "2026-10-07T08:00:00-07:00")];
  const out = await sweepLedger(bound, cfg, fetch, new Date("2026-10-07T16:00:00Z"));
  assert.deepEqual(out, { invoices: 2, payments: 2, matched: 1, skipped: 0 });

  assert.deepEqual((await invoices()).map((r) => [r.qbo_id, r.job_id, r.org_id, r.region_id, r.total_minor, r.balance_minor]), [
    ["1", JOB, ORG, REGION_SOUTH, "100000", "0"],
    ["2", null, INTERNAL_ORG_ID, UNASSIGNED_REGION_ID, "50050", "50050"],
  ]);
  assert.deepEqual((await payments()).map((r) => [r.qbo_id, r.invoice_qbo_id, r.amount_minor, r.org_id, r.region_id]), [
    ["p1", "1", "100000", ORG, REGION_SOUTH],
    ["p2", "3", "20000", INTERNAL_ORG_ID, UNASSIGNED_REGION_ID],
  ], "a payment for an invoice not yet mirrored waits in UNASSIGNED");

  const s = await state();
  assert.equal(openToken(cfg.tokenKey, s.refresh_token_enc), "rt-1", "the rotated token is stored, sealed");
  assert.doesNotMatch(s.refresh_token_enc, /rt-1/);
  assert.equal(new Date(s.cursor).toISOString(), "2026-10-07T15:00:00.000Z", "the cursor is the newest LastUpdatedTime seen");
  assert.ok(qbo.seenSince[0]!.startsWith("2025-"), "the first sync reaches back 400 days");
});

test("next sync: from the cursor, with the stored token; a moved payment's dropped line goes to zero, and payments follow their invoice", { skip }, async () => {
  qbo.tokens.set("rt-1", "rt-2");
  qbo.seenSince.length = 0;
  qbo.invoices = [invoice("3", `job: ${JOB_LATE.toUpperCase()}`, 200, 0, "2026-10-08T09:00:00-07:00")];
  qbo.payments = [payment("p1", [["2", 1000]], "2026-10-08T10:00:00-07:00")];
  await sweepLedger(bound, cfg, fetch, new Date("2026-10-08T18:00:00Z"));
  assert.equal(qbo.seenRefresh.at(-1), "rt-1", "the stored token, not the configured one");
  assert.deepEqual(qbo.seenSince, ["2026-10-07T15:00:00+00:00", "2026-10-07T15:00:00+00:00"]);
  assert.deepEqual((await payments()).map((r) => [r.qbo_id, r.invoice_qbo_id, r.amount_minor, r.org_id]), [
    ["p1", "1", "0", ORG],
    ["p1", "2", "100000", INTERNAL_ORG_ID],
    ["p2", "3", "20000", ORG],
  ], "p1 now pays invoice 2, its old line to invoice 1 is zero; p2 moved to the tenancy of invoice 3 when it arrived");

  // The same rows again change nothing.
  qbo.tokens.set("rt-2", "rt-3");
  const before = JSON.stringify([await invoices(), await payments()]);
  await sweepLedger(bound, cfg, fetch, new Date("2026-10-08T18:05:00Z"));
  assert.equal(JSON.stringify([await invoices(), await payments()]), before);
});

test("a fetch that fails keeps the token it rotated; a refused stored token falls back to the configured one", { skip }, async () => {
  qbo.tokens.set("rt-3", "rt-4");
  qbo.failQuery = true;
  const cursor = (await state()).cursor;
  await assert.rejects(sweepLedger(bound, cfg, fetch, new Date("2026-10-08T18:10:00Z")), /HTTP 503/);
  assert.equal(openToken(cfg.tokenKey, (await state()).refresh_token_enc), "rt-4", "committed before the fetch");
  assert.deepEqual((await state()).cursor, cursor, "nothing mirrored, so the cursor did not move");
  qbo.failQuery = false;

  qbo.tokens.delete("rt-4"); // revoked at Intuit
  qbo.tokens.set("rt-0", "rt-5"); // the operator reconnected and set AC_QBO_REFRESH_TOKEN
  await sweepLedger(bound, cfg, fetch, new Date("2026-10-08T18:15:00Z"));
  assert.deepEqual(qbo.seenRefresh.slice(-2), ["rt-4", "rt-0"]);
  assert.equal(openToken(cfg.tokenKey, (await state()).refresh_token_enc), "rt-5");
});

test("the office reads the mirror and when it ran, never the token; a customer reads none; the gateway role writes none", { skip }, async () => {
  assert.equal((await asGateway("internal", "SELECT count(*)::int AS n FROM ledger_invoices"))[0]!.n, 3);
  assert.ok((await asGateway("internal", "SELECT synced_at FROM ledger_sync_state"))[0]!.synced_at);
  await assert.rejects(asGateway("internal", "SELECT refresh_token_enc FROM ledger_sync_state"), /permission denied/);
  assert.equal((await asGateway("customer", "SELECT count(*)::int AS n FROM ledger_invoices"))[0]!.n, 0);
  assert.equal((await asGateway("customer", "SELECT count(*)::int AS n FROM ledger_payments"))[0]!.n, 0);
  await assert.rejects(asGateway("internal", `INSERT INTO ledger_invoices (org_id, region_id, realm_id, qbo_id, txn_date, total_minor, balance_minor, currency, qbo_updated_at, synced_at)
    VALUES ('${INTERNAL_ORG_ID}', '${UNASSIGNED_REGION_ID}', 'x', 'x', current_date, 1, 1, 'USD', now(), now())`), /permission denied/);
});
