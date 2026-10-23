/**
 * RESIDENTIAL CUSTOMERS, OVER THE WIRE — S2 and S6 through the shell, against a
 * spawned gateway and a live PostgreSQL.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What the residential split (scope 2026-10-21; partner answers R1, R6) makes
 * true, each a test below:
 *   - one step makes a home: a residential organization, the region node it is
 *     served from, the household as its location and the home as its site at
 *     the address, the homeowner as the primary contact;
 *   - a commercial customer is still made the old way, and is commercial;
 *   - a customer's segment never changes, and only a customer has one;
 *   - a lead S1 captured becomes a home once, and the second try names it;
 *   - in a household, who pays is not who asks — and one person is both.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { RESIDENTIAL_STANDARD_TERMS } from "../../packages/contracts/src/terms.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — residential customers were not verified over the wire";
if (!URL_) test("residential over the wire", { skip }, () => {});

const PORT = 27080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const USER_OWNER = "d2a00000-0000-0000-0000-000000000001";
const PASSWORD = "correct horse battery staple";
const RUN = `d2a-${Date.now().toString(36)}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-residential-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d2a@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hashPassword(PASSWORD)]);
  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  gateway.stdout!.on("data", (d) => { log += String(d); });
  gateway.stderr!.on("data", (d) => { log += String(d); });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`gateway did not come up on :${PORT}\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
});

after(async () => {
  gateway?.kill("SIGTERM");
  await pool?.end();
});

const shell = (surfaceId: "S2" | "S6", email: string) => connectShell({ surfaceId, baseUrl: BASE, fetch, credentials: { email, password: PASSWORD } });
const refusal = async (s: ConnectedShell, p: Promise<unknown>) => {
  try { await p; } catch (e) { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return r!; }
  return assert.fail("admitted, and should not have been");
};
const address = { line1: "905 Hidden Creek Pkwy", city: "Burleson", state: "TX", postal: "76028", country: "US" };

let s2: ConnectedShell;
let home = { orgId: "", regionNodeId: "", locationId: "", siteId: "", contractId: "" };

test("one step makes a home: a residential org, its region node, the household and the home at the address, the homeowner as primary contact", { skip }, async () => {
  s2 = await shell("S2", "owner.d2a@ac.test");
  const out = await s2.gateway.createResidentialCustomer({
    name: `Turner residence ${RUN}`, regionId: REGION_SOUTH, address, contact: { name: "Pat Turner", phone: "(817) 555-0142" },
  });
  home = out;
  const org = (await s2.gateway.listOrganizations({ kind: "customer" })).organizations.find((o) => o.id === out.orgId)!;
  assert.equal(org.segment, "residential");
  const nodes = (await s2.gateway.listAccounts({ orgId: out.orgId })).nodes;
  assert.deepEqual(nodes.map((n) => [n.tier, n.name]).sort(), [["location", address.line1], ["region", `Turner residence ${RUN}`], ["site", "Home"]].sort());
  const site = nodes.find((n) => n.id === out.siteId)!;
  assert.equal(site.parentId, out.locationId);
  assert.equal(site.regionId, REGION_SOUTH, "served from the region the office chose, by derivation");
  assert.equal(site.address?.postal, "76028");
  const contacts = (await s2.gateway.listContacts({ accountId: out.siteId })).contacts;
  assert.ok(contacts.some((c) => c.name === "Pat Turner" && c.isPrimary && c.phone === "(817) 555-0142"), "the homeowner, where a crew calling ahead finds them");
});

test("a home is on the standard home agreement from the day it is made — active, every term stated — so its first call opens a job", { skip }, async () => {
  const contracts = (await s2.gateway.listContracts({ orgId: home.orgId })).contracts;
  assert.equal(contracts.length, 1);
  const msa = contracts[0]!;
  assert.deepEqual([msa.kind, msa.state, msa.billingPath, msa.scopeId, msa.diagnosticDataRightsReserved], ["msa", "active", "one_time", home.orgId, true]);
  const terms = await s2.gateway.resolvedTerms({ orgId: home.orgId, nodeId: home.siteId });
  for (const [k, v] of Object.entries(RESIDENTIAL_STANDARD_TERMS)) assert.deepEqual(terms.resolved[k]?.value, v, k);
  const job = await s2.gateway.createJob({ siteId: home.siteId, serviceCode: "repairs",
    serviceWindowStart: new Date(Date.now() + 86_400_000).toISOString(), serviceWindowEnd: new Date(Date.now() + 100_800_000).toISOString() });
  assert.equal(job.responseTerm, "same_day", "the home's response time, not a refusal");
});

test("a commercial customer is made the old way and is commercial; only a customer has a segment, and it never changes", { skip }, async () => {
  const c = await s2.gateway.createOrganization({ name: `Shipman Co ${RUN}`, firstRegionNode: { regionId: REGION_SOUTH, name: "Shipman / South" } });
  const org = (await s2.gateway.listOrganizations({ kind: "customer" })).organizations.find((o) => o.id === c.orgId)!;
  assert.equal(org.segment, "commercial");
  assert.equal(s2.context?.segment, null, "our own people carry no segment");
  await assert.rejects(admin(`UPDATE organizations SET segment = 'commercial' WHERE id = $1`, [home.orgId]),
    (e: { code?: string; message: string }) => e.code === "AC422" && /segment does not change/.test(e.message));
  await assert.rejects(admin(`INSERT INTO organizations (id, name, kind) VALUES ($1, $2, 'customer')`, [randomUUID(), `No segment ${RUN}`]),
    (e: { code?: string }) => e.code === "23514", "a customer without a segment is refused");
  await assert.rejects(admin(`INSERT INTO organizations (id, name, kind, segment) VALUES ($1, $2, 'vendor', 'residential')`, [randomUUID(), `Vendor ${RUN}`]),
    (e: { code?: string }) => e.code === "23514", "a vendor with a segment is refused");
});

test("a lead becomes a home once: listed while waiting, converted with its contact, gone from waiting, and a second try names the home", { skip }, async () => {
  const leadId = randomUUID();
  await admin(`INSERT INTO leads (id, org_id, region_id, source, contact, requested_metro, submission_id) VALUES ($1, $2, $3, 'web_form', $4::jsonb, 'DFW', $5)`,
    [leadId, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, JSON.stringify({ name: `Lee ${RUN}`, email: `lee.${RUN}@example.test`, note: "Upstairs is warm" }), randomUUID()]);
  assert.ok((await s2.gateway.listLeads({})).leads.some((l) => l.id === leadId));
  const out = await s2.gateway.convertLead({ leadId, regionId: REGION_SOUTH, address: { ...address, line1: "17 Elm St" } });
  assert.equal(out.leadId, leadId);
  const org = (await s2.gateway.listOrganizations({ kind: "customer" })).organizations.find((o) => o.id === out.orgId)!;
  assert.equal(org.segment, "residential");
  assert.equal(org.name, `Lee ${RUN}`, "named for the person who asked");
  assert.equal((await admin(`SELECT converted_account_id FROM leads WHERE id = $1`, [leadId]))[0]!.converted_account_id, out.siteId);
  assert.ok((await s2.gateway.listContacts({ accountId: out.siteId })).contacts.some((c) => c.email === `lee.${RUN}@example.test` && c.isPrimary));
  assert.ok(!(await s2.gateway.listLeads({})).leads.some((l) => l.id === leadId), "no longer waiting");
  assert.ok((await s2.gateway.listLeads({ include: "all" })).leads.some((l) => l.id === leadId && l.convertedAccountId === out.siteId));
  const r = await refusal(s2, s2.gateway.convertLead({ leadId, regionId: REGION_SOUTH, address }));
  assert.equal("code" in r ? r.code : null, "already_converted");
  assert.match(r.message, new RegExp(out.siteId));
  const audit = await admin(`SELECT action FROM audit_log WHERE entity_id = $1`, [leadId]);
  assert.ok(audit.some((a) => a.action === "lead.convert"));
});

test("in a household, who pays is not who asks: a payer-only login cannot request service, a requester can, and one person holding both can", { skip }, async () => {
  const login = async (who: string, roles: readonly string[]) => {
    await admin(`INSERT INTO users (org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ($1, $2, 'customer', $3, $4, $5::jsonb, 'parent', $1, $6, true)`,
      [home.orgId, REGION_SOUTH, `${who}.${RUN}@turner.test`, who, JSON.stringify(roles), hashPassword(PASSWORD)]);
    return shell("S6", `${who}.${RUN}@turner.test`);
  };
  const payer = await login("payer", ["payer"]);
  assert.equal(payer.context?.segment, "residential", "the home view is chosen from the context the gateway resolved at login");
  const requester = await login("requester", ["requester"]);
  const both = await login("both", ["payer", "requester"]);
  const ask = (s: ConnectedShell) => s.gateway.createServiceRequest({ siteId: home.siteId, description: "No cooling upstairs." });
  const r = await refusal(payer, ask(payer));
  assert.equal(r.kind, "scope", "403 — refused at the gateway, not hidden in a bundle");
  assert.match(r.message, /written by \[requester\]/);
  await ask(requester);
  await ask(both);
  const seen = (await payer.gateway.listServiceRequests({})).requests.filter((q) => q.siteId === home.siteId);
  assert.equal(seen.length, 2, "everyone in the household reads the home's requests");
  assert.ok(seen.every((q) => q.customerSegment === "residential"));
  const office = (await s2.gateway.listServiceRequests({})).requests.filter((q) => q.siteId === home.siteId);
  assert.ok(office.length === 2 && office.every((q) => q.customerSegment === "residential"), "the office reads the mark off the same rows");
});
