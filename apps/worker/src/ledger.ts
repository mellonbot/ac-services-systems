import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { RelayTx } from "./relay.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../../packages/schema/src/tenancy.ts";

/**
 * THE QUICKBOOKS MIRROR (0018). QuickBooks Online is the ledger of record:
 * invoices are written there and paid through its pay link. Every few
 * minutes this asks QuickBooks for every Invoice and Payment changed since
 * the cursor and writes them into ledger_invoices / ledger_payments.
 *
 * Two transactions, on purpose. Intuit rotates the refresh token when it is
 * used, so the new one is committed BEFORE anything is fetched: a fetch that
 * fails must not roll back the only token that still works.
 *
 * Polling, not webhooks: a webhook carries entity ids and nothing else, so
 * the worker would fetch either way, and five minutes is fresh enough for a
 * dashboard. Not mirrored: a payment DELETED in QuickBooks (the query API
 * does not return deleted entities). A voided invoice is mirrored — QuickBooks
 * zeroes it.
 */

export type LedgerConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly realmId: string;
  /** Used until a rotated token is stored, and again if the stored one is refused. */
  readonly bootstrapRefreshToken: string;
  /** 32 bytes, base64 — encrypts the refresh token at rest. */
  readonly tokenKey: Buffer;
  readonly apiBase: string;
};

const API_BASE = { sandbox: "https://sandbox-quickbooks.api.intuit.com", production: "https://quickbooks.api.intuit.com" } as const;
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const MINOR_VERSION = 75;
const PAGE = 1000;
/** How far back the first sync reaches. */
const BACKFILL_DAYS = 400;

/** All six or none: a half-configured ledger is not configured. */
export const ledgerConfigFromEnv = (env: Readonly<Record<string, string | undefined>>): LedgerConfig | null => {
  const { AC_QBO_CLIENT_ID, AC_QBO_CLIENT_SECRET, AC_QBO_REALM_ID, AC_QBO_REFRESH_TOKEN, AC_QBO_TOKEN_KEY, AC_QBO_ENV } = env;
  if (!AC_QBO_CLIENT_ID || !AC_QBO_CLIENT_SECRET || !AC_QBO_REALM_ID || !AC_QBO_REFRESH_TOKEN || !AC_QBO_TOKEN_KEY || !AC_QBO_ENV) return null;
  if (AC_QBO_ENV !== "sandbox" && AC_QBO_ENV !== "production") throw new Error("AC_QBO_ENV must be 'sandbox' or 'production'");
  const tokenKey = Buffer.from(AC_QBO_TOKEN_KEY, "base64");
  if (tokenKey.length !== 32) throw new Error("AC_QBO_TOKEN_KEY must be 32 bytes, base64");
  return {
    clientId: AC_QBO_CLIENT_ID, clientSecret: AC_QBO_CLIENT_SECRET, realmId: AC_QBO_REALM_ID,
    bootstrapRefreshToken: AC_QBO_REFRESH_TOKEN, tokenKey, apiBase: API_BASE[AC_QBO_ENV],
  };
};

/** AES-256-GCM: iv.tag.ciphertext, base64url each. */
export const sealToken = (key: Buffer, token: string): string => {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
};
export const openToken = (key: Buffer, sealed: string): string => {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key, iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString("utf8");
};

// ---------------------------------------------------------------------------
// QuickBooks' shapes — only the fields read here.
// ---------------------------------------------------------------------------
type Ref = { readonly value?: string; readonly name?: string };
export type QboInvoice = {
  readonly Id: string; readonly DocNumber?: string; readonly TxnDate: string; readonly DueDate?: string;
  readonly TotalAmt: number; readonly Balance: number; readonly CustomerRef?: Ref; readonly CurrencyRef?: Ref;
  readonly CustomerMemo?: { readonly value?: string }; readonly PrivateNote?: string;
  readonly MetaData: { readonly LastUpdatedTime: string };
};
export type QboPayment = {
  readonly Id: string; readonly TxnDate: string; readonly CurrencyRef?: Ref;
  readonly Line?: readonly { readonly Amount: number; readonly LinkedTxn?: readonly { readonly TxnId: string; readonly TxnType: string }[] }[];
  readonly MetaData: { readonly LastUpdatedTime: string };
};

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** Amounts arrive as decimal dollars; the database holds integer minor units. */
export const toMinor = (amount: number): bigint => BigInt(Math.round(amount * 100));

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Every job id a memo names, in order; the office writes the job in the invoice's memo. */
export const jobIdsInMemo = (memo: string | null): string[] => [...new Set((memo ?? "").match(UUID)?.map((m) => m.toLowerCase()) ?? [])];

/** Both of QuickBooks' memo fields — the one printed on the invoice and the internal one — as one text. */
export const memoOf = (i: QboInvoice): string | null => [i.CustomerMemo?.value, i.PrivateNote].filter((m) => m?.trim()).join("\n") || null;

/** A payment's lines that pay invoices: one row per invoice, amounts summed if a payment names one twice. */
export const paymentLines = (p: QboPayment): { invoiceQboId: string; amountMinor: bigint }[] => {
  const by = new Map<string, bigint>();
  for (const line of p.Line ?? []) {
    for (const t of line.LinkedTxn ?? []) if (t.TxnType === "Invoice") by.set(t.TxnId, (by.get(t.TxnId) ?? 0n) + toMinor(line.Amount));
  }
  return [...by].map(([invoiceQboId, amountMinor]) => ({ invoiceQboId, amountMinor }));
};

// ---------------------------------------------------------------------------
// QuickBooks' API.
// ---------------------------------------------------------------------------
const failed = async (what: string, r: { status: number; text(): Promise<string> }) =>
  new Error(`quickbooks ${what}: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);

export const refreshAccess = async (cfg: LedgerConfig, refreshToken: string, fetch: Fetch): Promise<{ accessToken: string; refreshToken: string }> => {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded", accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });
  if (!r.ok) throw await failed("token refresh", r);
  const body = await r.json() as { access_token?: string; refresh_token?: string };
  if (!body.access_token || !body.refresh_token) throw new Error("quickbooks token refresh: no token in the answer");
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
};

/** "2026-10-20T13:45:12+00:00" — QuickBooks' query language takes an offset, not milliseconds. */
const qboTime = (d: Date) => `${d.toISOString().slice(0, 19)}+00:00`;

export const changedSince = async <T>(cfg: LedgerConfig, accessToken: string, entity: "Invoice" | "Payment", since: Date, fetch: Fetch): Promise<T[]> => {
  const out: T[] = [];
  for (let start = 1; ; start += PAGE) {
    const q = `SELECT * FROM ${entity} WHERE MetaData.LastUpdatedTime >= '${qboTime(since)}' ORDERBY MetaData.LastUpdatedTime STARTPOSITION ${start} MAXRESULTS ${PAGE}`;
    const r = await fetch(`${cfg.apiBase}/v3/company/${encodeURIComponent(cfg.realmId)}/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, {
      method: "GET", headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!r.ok) throw await failed(`${entity} query`, r);
    const page = ((await r.json()) as { QueryResponse?: Record<string, T[] | undefined> }).QueryResponse?.[entity] ?? [];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
};

// ---------------------------------------------------------------------------
// The sweep.
// ---------------------------------------------------------------------------
export type LedgerSweep = { invoices: number; payments: number; matched: number; skipped: number };

/**
 * `bound` opens one transaction as the worker, bound as the worker — the
 * sweep needs two of them (see the header).
 */
export const sweepLedger = async (bound: () => Promise<RelayTx>, cfg: LedgerConfig, fetch: Fetch, now: Date): Promise<LedgerSweep> => {
  // 1. Renew access and commit the rotated refresh token before anything else can fail.
  let accessToken: string, cursor: Date | null;
  {
    const tx = await bound();
    try {
      await tx.query(
        `INSERT INTO ledger_sync_state (org_id, region_id, realm_id) VALUES ($1, $2, $3) ON CONFLICT (realm_id) DO NOTHING`,
        [INTERNAL_ORG_ID, UNASSIGNED_REGION_ID, cfg.realmId]);
      const [state] = await tx.query<{ cursor: string | null; refresh_token_enc: string | null }>(
        "SELECT cursor, refresh_token_enc FROM ledger_sync_state WHERE realm_id = $1 FOR UPDATE", [cfg.realmId]);
      const stored = state?.refresh_token_enc ? openToken(cfg.tokenKey, state.refresh_token_enc) : null;
      let fresh;
      try { fresh = await refreshAccess(cfg, stored ?? cfg.bootstrapRefreshToken, fetch); }
      catch (e) {
        // A stored token that is refused is retried once with the configured one — how an operator reconnects.
        if (!stored || stored === cfg.bootstrapRefreshToken) throw e;
        fresh = await refreshAccess(cfg, cfg.bootstrapRefreshToken, fetch);
      }
      await tx.query("UPDATE ledger_sync_state SET refresh_token_enc = $2 WHERE realm_id = $1", [cfg.realmId, sealToken(cfg.tokenKey, fresh.refreshToken)]);
      await tx.commit();
      accessToken = fresh.accessToken;
      cursor = state?.cursor ? new Date(state.cursor) : null;
    } catch (e) { await tx.rollback().catch(() => {}); throw e; }
  }

  // 2. Fetch, outside any transaction.
  const since = cursor ?? new Date(now.getTime() - BACKFILL_DAYS * 86_400_000);
  const invoices = await changedSince<QboInvoice>(cfg, accessToken, "Invoice", since, fetch);
  const payments = await changedSince<QboPayment>(cfg, accessToken, "Payment", since, fetch);

  // 3. Mirror.
  const tx = await bound();
  try {
    const currencies = new Set((await tx.query<{ code: string }>("SELECT code FROM currencies")).map((c) => c.code));
    const currencyOf = (ref?: Ref) => ref?.value ?? "USD";
    const out: LedgerSweep = { invoices: 0, payments: 0, matched: 0, skipped: 0 };
    let newest = cursor?.getTime() ?? 0;
    const seen = (t: string) => { newest = Math.max(newest, Date.parse(t)); };

    for (const i of invoices) {
      seen(i.MetaData.LastUpdatedTime);
      if (!currencies.has(currencyOf(i.CurrencyRef))) { out.skipped++; continue; }
      const memo = memoOf(i);
      const ids = jobIdsInMemo(memo);
      const [job] = ids.length
        ? await tx.query<{ id: string; org_id: string; region_id: string }>("SELECT id, org_id, region_id FROM jobs WHERE id = ANY($1::uuid[]) LIMIT 1", [ids])
        : [];
      if (job) out.matched++;
      await tx.query(
        `INSERT INTO ledger_invoices (org_id, region_id, realm_id, qbo_id, doc_number, customer_name, memo, job_id, txn_date, due_date,
                                      total_minor, balance_minor, currency, qbo_updated_at, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (realm_id, qbo_id) DO UPDATE SET
           org_id = EXCLUDED.org_id, region_id = EXCLUDED.region_id, doc_number = EXCLUDED.doc_number, customer_name = EXCLUDED.customer_name,
           memo = EXCLUDED.memo, job_id = EXCLUDED.job_id, txn_date = EXCLUDED.txn_date, due_date = EXCLUDED.due_date,
           total_minor = EXCLUDED.total_minor, balance_minor = EXCLUDED.balance_minor, currency = EXCLUDED.currency,
           qbo_updated_at = EXCLUDED.qbo_updated_at, synced_at = EXCLUDED.synced_at`,
        [job?.org_id ?? INTERNAL_ORG_ID, job?.region_id ?? UNASSIGNED_REGION_ID, cfg.realmId, i.Id, i.DocNumber ?? null, i.CustomerRef?.name ?? null,
         memo, job?.id ?? null, i.TxnDate, i.DueDate ?? null, toMinor(i.TotalAmt).toString(), toMinor(i.Balance).toString(),
         currencyOf(i.CurrencyRef), i.MetaData.LastUpdatedTime, now.toISOString()]);
      out.invoices++;
    }

    for (const p of payments) {
      seen(p.MetaData.LastUpdatedTime);
      if (!currencies.has(currencyOf(p.CurrencyRef))) { out.skipped++; continue; }
      // A changed payment's lines are QuickBooks' new ones. Nothing is deleted (no runtime role may delete): a line
      // QuickBooks dropped goes to zero, and the lines it still has are written over it.
      await tx.query("UPDATE ledger_payments SET amount_minor = 0, qbo_updated_at = $3, synced_at = $4 WHERE realm_id = $1 AND qbo_id = $2",
        [cfg.realmId, p.Id, p.MetaData.LastUpdatedTime, now.toISOString()]);
      for (const line of paymentLines(p)) {
        await tx.query(
          `INSERT INTO ledger_payments (org_id, region_id, realm_id, qbo_id, invoice_qbo_id, amount_minor, currency, received_on, qbo_updated_at, synced_at)
           SELECT COALESCE(i.org_id, $1), COALESCE(i.region_id, $2), $3, $4, $5, $6, $7, $8, $9, $10
             FROM (SELECT 1) one LEFT JOIN ledger_invoices i ON i.realm_id = $3 AND i.qbo_id = $5
           ON CONFLICT (realm_id, qbo_id, invoice_qbo_id) DO UPDATE SET
             org_id = EXCLUDED.org_id, region_id = EXCLUDED.region_id, amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
             received_on = EXCLUDED.received_on, qbo_updated_at = EXCLUDED.qbo_updated_at, synced_at = EXCLUDED.synced_at`,
          [INTERNAL_ORG_ID, UNASSIGNED_REGION_ID, cfg.realmId, p.Id, line.invoiceQboId, line.amountMinor.toString(),
           currencyOf(p.CurrencyRef), p.TxnDate, p.MetaData.LastUpdatedTime, now.toISOString()]);
        out.payments++;
      }
    }

    // A payment synced before its invoice, or an invoice whose memo now names a job, moves its payments with it.
    await tx.query(
      `UPDATE ledger_payments p SET org_id = i.org_id, region_id = i.region_id
         FROM ledger_invoices i
        WHERE p.realm_id = $1 AND i.realm_id = p.realm_id AND i.qbo_id = p.invoice_qbo_id
          AND (p.org_id, p.region_id) IS DISTINCT FROM (i.org_id, i.region_id)`, [cfg.realmId]);
    await tx.query("UPDATE ledger_sync_state SET cursor = $2, synced_at = $3 WHERE realm_id = $1",
      [cfg.realmId, newest ? new Date(newest).toISOString() : null, now.toISOString()]);
    await tx.commit();
    return out;
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
};
