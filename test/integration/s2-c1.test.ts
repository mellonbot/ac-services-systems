/**
 * C1 OVER THE WIRE — the hierarchy S2 authors, through the shell, against a
 * spawned gateway and a live PostgreSQL (09 §6 item 4).
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * The check 09 named: create a parent WITH its first region node in one unit
 * of work; add a location; move it; watch region_id follow. Plus the refusals
 * that make this the one door: a site under a region node (the trigger, in its
 * own words, as 422 structural), region_id typed below the region tier, D14
 * with the rule unset (caveat) and set (422 commercial), and the catalogue
 * serving `regions.list` to S3 while `organizations.create` stays S2's.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — C1 was not verified over the wire";
if (!URL_) test("c1 over the wire", { skip }, () => {});

const PORT = 19080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `c1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_DISP_SOUTH = U(2);
const PASSWORD = "correct horse battery staple";
const RUN = `c1-${Date.now().toString(36)}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-c1-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'MOUNTAIN','Mountain'), ($3,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH]);
  // The D14 rule is 0 on every region unless a test sets it; reset so the run is repeatable.
  await admin(`UPDATE regions SET min_crew_density = 0 WHERE id IN ($1,$2,$3)`, [REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.c1@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.south.c1@ac.test','Dispatcher South','["dispatcher"]','region',$3,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_DISP_SOUTH]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test" }, stdio: ["ignore", "pipe", "pipe"],
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

const owner = () => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.c1@ac.test", password: PASSWORD } });
const dispatcher = () => connectShell({ surfaceId: "S3", baseUrl: BASE, fetch, credentials: { email: "disp.south.c1@ac.test", password: PASSWORD } });

const refusal = (s: ConnectedShell, e: unknown) => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return r!; };

// Shared across the tests below, in order. node:test runs them serially.
let s2: ConnectedShell;
let orgId = "", southNode = "", westNode = "", austin = "", rooftop = "";

test("regions.list serves S2 and S3 alike; organizations.create is S2's alone", { skip }, async () => {
  s2 = await owner();
  const s3 = await dispatcher();
  const [a, b] = await Promise.all([s2.gateway.listRegions(), s3.gateway.listRegions()]);
  assert.ok(a.regions.some((r) => r.code === "SOUTH"));
  assert.deepEqual(a.regions.map((r) => r.code), b.regions.map((r) => r.code), "same list from either surface");
  await assert.rejects(
    s3.gateway.createOrganization({ name: `Nope ${RUN}`, firstRegionNode: { regionId: REGION_SOUTH, name: "Nope / South" } }),
    (e: unknown) => refusal(s3, e).kind === "scope",
  );
});

test("a customer parent is created WITH its first region node, in one unit of work — no orphan parent", { skip }, async () => {
  const out = await s2.gateway.createOrganization({ name: `Amped Two ${RUN}`, externalRef: RUN, firstRegionNode: { regionId: REGION_SOUTH, name: `Amped Two / South` } });
  orgId = out.orgId; southNode = out.regionNodeId;
  assert.ok(orgId && southNode && out.eventId);

  // Two audit rows and two outbox rows, one request id, both carrying the real region.
  const rows = await admin(`SELECT action, region_id, request_id FROM audit_log WHERE entity_id IN ($1, $2) ORDER BY occurred_at, action`, [orgId, southNode]);
  assert.deepEqual(rows.map((r) => r.action).sort(), ["account.create", "organization.create"]);
  assert.ok(rows.every((r) => r.region_id === REGION_SOUTH), "the parent's audit row carries the region it is served from");
  assert.equal(new Set(rows.map((r) => r.request_id)).size, 1, "one request");
  assert.equal(String((await admin(`SELECT count(*) FROM outbox WHERE entity_id IN ($1,$2)`, [orgId, southNode]))[0]!.count), "2");

  const listed = await s2.gateway.listOrganizations({ kind: "customer" });
  const mine = listed.organizations.find((o) => o.id === orgId);
  assert.equal(mine?.regionNodeCount, 1);
  const tree = await s2.gateway.listAccounts({ orgId });
  assert.deepEqual(tree.nodes.map((n) => [n.tier, n.regionId, n.parentId]), [["region", REGION_SOUTH, null]]);
  assert.deepEqual(tree.nodes[0]!.path, [southNode], "the region node's path is itself");
});

test("a parent is refused whole when its first region node cannot exist — the organization row is not left behind", { skip }, async () => {
  await assert.rejects(
    s2.gateway.createOrganization({ name: `Orphan ${RUN}`, firstRegionNode: { regionId: "00000000-0000-0000-0000-00000000dead", name: "Orphan / Nowhere" } }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "unknown_region"; },
  );
  assert.equal(String((await admin(`SELECT count(*) FROM organizations WHERE name = $1`, [`Orphan ${RUN}`]))[0]!.count), "0");
  assert.equal(s2.isDegraded(), false);
});

test("a location under the region node: region_id derives from the edge, and D14 with the rule unset is a caveat, not a refusal", { skip }, async () => {
  const out = await s2.gateway.createAccount({ orgId, tier: "location", parentId: southNode, name: `Amped Two Austin`, customerGroup: "Texas", timezone: "America/Chicago" });
  austin = out.id;
  assert.equal(out.regionId, REGION_SOUTH, "derived, not typed");
  assert.deepEqual(out.caveats, ["D14 rule not set for South"]);
  const row = (await admin(`SELECT region_id, path, customer_group FROM accounts WHERE id = $1`, [austin]))[0]!;
  assert.equal(row.region_id, REGION_SOUTH);
  assert.deepEqual(row.path, [southNode, austin]);
  assert.equal(row.customer_group, "Texas", "the customer's grouping is an attribute");
});

test("region_id typed below the region tier is refused by the handler — the edge decides (D2 part 3)", { skip }, async () => {
  await assert.rejects(
    s2.gateway.createAccount({ orgId, tier: "location", parentId: southNode, regionId: REGION_WEST, name: "Wrongly typed" }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "region_not_an_input" && r.axis === "structural"; },
  );
});

test("the tier ladder is the trigger's: a site hung off a region node comes back 422 structural, in the trigger's own words, and the surface stays up", { skip }, async () => {
  await assert.rejects(
    s2.gateway.createAccount({ orgId, tier: "site", parentId: southNode, name: "Impossible" }),
    (e: unknown) => {
      const r = refusal(s2, e);
      assert.equal(r.kind, "admission", JSON.stringify(r));
      if (r.kind !== "admission") return false;
      assert.equal(r.code, "ac_accounts_derive_region", "the code is the trigger's name — the shell maps it to structural");
      assert.equal(r.axis, "structural");
      assert.match(r.message, /a site must hang off a location, not a region/);
      return true;
    },
  );
  assert.equal(s2.isDegraded(), false, "a refused row is not an outage");
});

test("a site under the location, then a second region node — the tree S2 will render", { skip }, async () => {
  const site = await s2.gateway.createAccount({ orgId, tier: "site", parentId: austin, name: "Rooftop units" });
  rooftop = site.id;
  assert.deepEqual(site.caveats, [], "D14 is asked of a location, not a site");
  const west = await s2.gateway.createAccount({ orgId, tier: "region", regionId: REGION_WEST, name: "Amped Two / West" });
  westNode = west.id;
  assert.equal(west.regionId, REGION_WEST);
  const tree = await s2.gateway.listAccounts({ orgId });
  assert.equal(tree.nodes.length, 4);
  assert.deepEqual(tree.nodes.find((n) => n.id === rooftop)!.path, [southNode, austin, rooftop]);
});

test("MOVE: Austin goes from South to West — region_id follows the edge, the site follows Austin, and the output counts it", { skip }, async () => {
  const before = (await admin(`SELECT region_id FROM accounts WHERE id = $1`, [rooftop]))[0]!;
  assert.equal(before.region_id, REGION_SOUTH);

  const moved = await s2.gateway.moveAccount({ accountId: austin, newParentId: westNode });
  assert.equal(moved.regionId, REGION_WEST, "the shard key came back from the trigger");
  assert.equal(moved.movedDescendants, 1, "Rooftop units came with it");

  const rows = await admin(`SELECT id, region_id, path FROM accounts WHERE id IN ($1, $2)`, [austin, rooftop]);
  const a = rows.find((r) => r.id === austin)!, s = rows.find((r) => r.id === rooftop)!;
  assert.equal(a.region_id, REGION_WEST);
  assert.equal(s.region_id, REGION_WEST, "the descendant's region_id followed — ac_accounts_cascade");
  assert.deepEqual(a.path, [westNode, austin]);
  assert.deepEqual(s.path, [westNode, austin, rooftop]);

  // The audit row records the move as a before/after on the edge and carries the DESTINATION region.
  const audit = (await admin(`SELECT before, after, region_id FROM audit_log WHERE event_id = $1`, [moved.eventId]))[0]!;
  assert.equal(audit.before.regionId, REGION_SOUTH);
  assert.equal(audit.after.parentId, westNode);
  assert.equal(audit.region_id, REGION_WEST);
});

test("MOVE refusals: under a region node of the wrong tier (trigger), under itself (handler), a region node at all (handler)", { skip }, async () => {
  // A site directly under a region node — the ladder, refused by the trigger on UPDATE.
  await assert.rejects(s2.gateway.moveAccount({ accountId: rooftop, newParentId: southNode }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "ac_accounts_derive_region"; });
  await assert.rejects(s2.gateway.moveAccount({ accountId: austin, newParentId: rooftop }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "cycle"; });
  await assert.rejects(s2.gateway.moveAccount({ accountId: westNode, newParentId: southNode }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "region_node_not_movable"; });
  // Nothing moved.
  assert.equal((await admin(`SELECT region_id FROM accounts WHERE id = $1`, [rooftop]))[0]!.region_id, REGION_WEST);
});

test("D14 with the rule SET: a location in a region below its crew density is 422 COMMERCIAL — someone has to staff it or price it", { skip }, async () => {
  await admin(`UPDATE regions SET min_crew_density = 3 WHERE id = $1`, [REGION_MOUNTAIN]);
  try {
    const mountain = await s2.gateway.createAccount({ orgId, tier: "region", regionId: REGION_MOUNTAIN, name: "Amped Two / Mountain" });
    await assert.rejects(
      s2.gateway.createAccount({ orgId, tier: "location", parentId: mountain.id, name: "Amped Two Boulder" }),
      (e: unknown) => {
        const r = refusal(s2, e);
        if (r.kind !== "admission") return false;
        assert.equal(r.code, "supply_below_density");
        assert.equal(r.axis, "commercial");
        assert.match(r.message, /Mountain has 0 active crews; the D14 rule for the region is 3/);
        return true;
      },
    );
    assert.equal(String((await admin(`SELECT count(*) FROM accounts WHERE org_id = $1 AND name = 'Amped Two Boulder'`, [orgId]))[0]!.count), "0");
  } finally {
    await admin(`UPDATE regions SET min_crew_density = 0 WHERE id = $1`, [REGION_MOUNTAIN]);
  }
});

test("update never touches structure; deactivation is its own event", { skip }, async () => {
  const u = await s2.gateway.updateAccount({ accountId: rooftop, name: "Rooftop units (2)", active: false });
  const ev = (await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [u.eventId]))[0]!;
  assert.equal(ev.topic, "account.deactivated");
  await assert.rejects(
    s2.gateway.updateAccount({ accountId: rooftop, parentId: southNode } as never),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "structure_is_not_an_attribute"; },
  );
  const bad = await fetch(`${BASE}/s2/accounts/update`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s2.token()}`, "x-ac-surface": "S2" }, body: JSON.stringify({ accountId: rooftop }) });
  assert.equal(bad.status, 400, "nothing to update is a bad request, not a refusal on the merits");
});

test("terms.resolved takes termKeys — the trace panel asks for one term and gets one", { skip }, async () => {
  const r = await s2.gateway.resolvedTerms({ orgId, tier: "location", nodeId: austin, termKeys: "billing_rollup_tier" });
  assert.deepEqual(Object.keys(r.resolved), ["billing_rollup_tier"]);
  assert.equal(r.resolved.billing_rollup_tier?.value, "parent", "the register's fallback — no contract on this org yet");
  await assert.rejects(s2.gateway.resolvedTerms({ orgId, tier: "location", nodeId: austin, termKeys: "not_a_term" }),
    (e: unknown) => { const r2 = refusal(s2, e); return r2.kind === "admission" && r2.code === "unknown_term"; });
});
