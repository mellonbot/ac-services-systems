import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  ledgerConfigFromEnv, sealToken, openToken, toMinor, jobIdsInMemo, memoOf, paymentLines, refreshAccess, changedSince,
  type Fetch, type LedgerConfig, type QboInvoice,
} from "./ledger.ts";

/**
 * The QuickBooks mirror's pure parts and its two HTTP calls, against a
 * scripted fetch. The sweep itself — two transactions, the token committed
 * before the fetch, the rows under RLS — is test/integration/ledger.test.ts.
 */
const KEY = randomBytes(32);
const cfg: LedgerConfig = {
  clientId: "cid", clientSecret: "secret", realmId: "9130", bootstrapRefreshToken: "rt-0", tokenKey: KEY, apiBase: "https://sandbox-quickbooks.api.intuit.com",
};
const JOB = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

test("config: all six AC_QBO_* or none; the key must be 32 bytes and the environment named", () => {
  const env = { AC_QBO_CLIENT_ID: "c", AC_QBO_CLIENT_SECRET: "s", AC_QBO_REALM_ID: "1", AC_QBO_REFRESH_TOKEN: "r", AC_QBO_TOKEN_KEY: KEY.toString("base64"), AC_QBO_ENV: "sandbox" };
  assert.equal(ledgerConfigFromEnv({}), null);
  assert.equal(ledgerConfigFromEnv({ ...env, AC_QBO_REALM_ID: undefined }), null, "half-configured is not configured");
  assert.equal(ledgerConfigFromEnv(env)!.apiBase, "https://sandbox-quickbooks.api.intuit.com");
  assert.equal(ledgerConfigFromEnv({ ...env, AC_QBO_ENV: "production" })!.apiBase, "https://quickbooks.api.intuit.com");
  assert.throws(() => ledgerConfigFromEnv({ ...env, AC_QBO_ENV: "live" }));
  assert.throws(() => ledgerConfigFromEnv({ ...env, AC_QBO_TOKEN_KEY: randomBytes(16).toString("base64") }));
});

test("the refresh token is sealed at rest: it round-trips, a different key or a flipped byte is refused", () => {
  const sealed = sealToken(KEY, "AB11-refresh");
  assert.doesNotMatch(sealed, /AB11/);
  assert.notEqual(sealToken(KEY, "AB11-refresh"), sealed, "a fresh IV each time");
  assert.equal(openToken(KEY, sealed), "AB11-refresh");
  assert.throws(() => openToken(randomBytes(32), sealed));
  const [iv, tag, body] = sealed.split(".");
  const flipped = Buffer.from(body!, "base64url"); flipped[0]! ^= 1;
  assert.throws(() => openToken(KEY, [iv, tag, flipped.toString("base64url")].join(".")));
});

test("money: decimal dollars to integer cents, rounding the float, never truncating", () => {
  assert.equal(toMinor(1250.5), 125050n);
  assert.equal(toMinor(0.29), 29n, "0.29 * 100 is 28.999… in a float");
  assert.equal(toMinor(0), 0n);
});

test("the job is the id in the memo — either memo field, any case, each id once", () => {
  const inv = (customer?: string, internal?: string) => ({ Id: "1", TxnDate: "2026-10-01", TotalAmt: 1, Balance: 1, MetaData: { LastUpdatedTime: "" },
    ...(customer ? { CustomerMemo: { value: customer } } : {}), ...(internal ? { PrivateNote: internal } : {}) }) as QboInvoice;
  assert.equal(memoOf(inv()), null);
  assert.equal(memoOf(inv("  ")), null);
  assert.equal(memoOf(inv("Thanks!", `Job ${JOB}`)), `Thanks!\nJob ${JOB}`);
  assert.deepEqual(jobIdsInMemo(`Job ${JOB.toUpperCase()} — see also ${JOB}`), [JOB]);
  assert.deepEqual(jobIdsInMemo("Job 33187801"), [], "a number that is not one of our job ids names no job");
  assert.deepEqual(jobIdsInMemo(null), []);
});

test("a payment's lines: one row per invoice it pays, a deposit or credit line names none", () => {
  assert.deepEqual(paymentLines({
    Id: "p1", TxnDate: "2026-10-05", MetaData: { LastUpdatedTime: "" },
    Line: [
      { Amount: 100.25, LinkedTxn: [{ TxnId: "i1", TxnType: "Invoice" }] },
      { Amount: 50, LinkedTxn: [{ TxnId: "i2", TxnType: "Invoice" }] },
      { Amount: 10, LinkedTxn: [{ TxnId: "i1", TxnType: "Invoice" }] },
      { Amount: 5, LinkedTxn: [{ TxnId: "c9", TxnType: "CreditMemo" }] },
      { Amount: 7 },
    ],
  }), [{ invoiceQboId: "i1", amountMinor: 11025n }, { invoiceQboId: "i2", amountMinor: 5000n }]);
});

const scripted = (answers: ((url: string) => { status: number; body: unknown }) ) => {
  const calls: { url: string; init: Parameters<Fetch>[1] }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const a = answers(url);
    return { ok: a.status < 300, status: a.status, json: async () => a.body, text: async () => JSON.stringify(a.body) };
  };
  return { fetch, calls };
};

test("token refresh: Basic client credentials, the refresh grant, and both tokens back — an error says the status, not the secret", async () => {
  const ok = scripted(() => ({ status: 200, body: { access_token: "at-1", refresh_token: "rt-1" } }));
  assert.deepEqual(await refreshAccess(cfg, "rt-0", ok.fetch), { accessToken: "at-1", refreshToken: "rt-1" });
  const call = ok.calls[0]!;
  assert.equal(call.url, "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
  assert.equal(call.init.headers.authorization, `Basic ${Buffer.from("cid:secret").toString("base64")}`);
  assert.equal(call.init.body, "grant_type=refresh_token&refresh_token=rt-0");
  const refused = scripted(() => ({ status: 400, body: { error: "invalid_grant" } }));
  await assert.rejects(refreshAccess(cfg, "rt-0", refused.fetch), (e: Error) => /HTTP 400/.test(e.message) && !/secret/.test(e.message));
});

test("changed since: the query names the entity and the cursor, pages by 1000, and stops on a short page", async () => {
  const full = Array.from({ length: 1000 }, (_, n) => ({ Id: String(n) }));
  const s = scripted((url) => ({ status: 200, body: { QueryResponse: { Invoice: url.includes("STARTPOSITION%201%20") ? full : [{ Id: "1000" }] } } }));
  const rows = await changedSince<{ Id: string }>(cfg, "at-1", "Invoice", new Date("2026-10-20T13:45:12.345Z"), s.fetch);
  assert.equal(rows.length, 1001);
  assert.equal(s.calls.length, 2);
  const q = decodeURIComponent(new URL(s.calls[0]!.url).searchParams.get("query")!);
  assert.equal(q, "SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime >= '2026-10-20T13:45:12+00:00' ORDERBY MetaData.LastUpdatedTime STARTPOSITION 1 MAXRESULTS 1000");
  assert.match(s.calls[0]!.url, /^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/9130\/query\?/);
  assert.equal(s.calls[0]!.init.headers.authorization, "Bearer at-1");
  const none = scripted(() => ({ status: 200, body: { QueryResponse: {} } }));
  assert.deepEqual(await changedSince(cfg, "at-1", "Payment", new Date(), none.fetch), [], "QuickBooks omits the key when nothing changed");
});
