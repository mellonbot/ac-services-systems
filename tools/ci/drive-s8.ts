/**
 * S8 THROUGH A REAL BROWSER — item 7's DOM layer, the one neither the render
 * tests nor the wire suite can see.
 *
 *   DATABASE_URL=postgres://... node tools/ci/drive-s8.ts
 *
 * test/integration/s8.test.ts proves firm visibility over the wire; the
 * render tests prove the markup. This walks the portal the way two firms do
 * — Firm A, then Firm B, in the same bundle from the same origin — and reads
 * the page: the firm's own row and roster; a crew enrolled with one field
 * and then a document filed for it, reading "Awaiting Rankine"; the work its
 * crew was sent to, with the site's name and no other firm's job; a statement
 * opened, acknowledged, disputed, the position forms gone; a retire refused
 * with the gateway's words while the crew is assigned; sign-out, and Firm B
 * seeing its own statement and none of A's, a deep link to A's refused.
 *
 * Same scratch-database discipline as drive-s2-c4 and drive-s8: create,
 * migrate, drive, drop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { Cdp, findChrome } from "./cdp.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GIVEN_DB = process.env.DATABASE_URL;
const dbName = (url: string): string => new URL(url).pathname.replace(/^\//, "");
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const GATEWAY_PORT = 23600 + Math.floor(Math.random() * 400);
const SITE_PORT = 24100 + Math.floor(Math.random() * 400);
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const RUN = Date.now().toString(36).toUpperCase();
const SCRATCH = process.env.AC_DRIVE_DB ?? `ac_drive8_${RUN.toLowerCase()}`;
const PASSWORD = "correct horse battery staple";
const OWNER = "d8000000-0000-0000-0000-000000000001", DISP = "d8000000-0000-0000-0000-000000000002", COORD_A = "d8000000-0000-0000-0000-000000000003", COORD_B = "d8000000-0000-0000-0000-000000000004";
const OWNER_EMAIL = "owner.drive8@ac.test", A_EMAIL = "coord.drive8@firma.test", B_EMAIL = "coord.drive8@firmb.test";

let passed = 0;
const check = (n: number, what: string) => { passed++; console.log(`  ${String(n).padStart(2)} ✓ ${what}`); };
const must = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json" };
const serveDist = (dir: string): Server => {
  const s = createServer((req, res) => {
    const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^(\.\.[/\\])+/, "");
    let file = join(dir, rel);
    if (!existsSync(file) || rel === "/" || rel.endsWith("/")) file = join(dir, "index.html");
    if (!existsSync(file)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  s.listen(SITE_PORT, "127.0.0.1");
  return s;
};
const waitHealthy = async (log: () => string) => {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try { if ((await fetch(`${GATEWAY}/healthz`)).ok) return; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`gateway did not come up on :${GATEWAY_PORT}\n${log()}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};
const fillAndSubmit = (formId: string, values: Record<string, string>) => `(() => {
  const f = document.getElementById(${JSON.stringify(formId)});
  if (!f) throw new Error("no form ${formId}");
  for (const [name, v] of Object.entries(${JSON.stringify(values)})) {
    const el = f.elements.namedItem(name);
    if (!el) throw new Error("no field " + name + " on ${formId}");
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  return true;
})()`;
const text = `(document.body?.innerText ?? "")`;
/** Case-insensitive: a StatusPill's word is upper-cased by the stylesheet, and innerText reports what is painted. */
const has = (needle: string) => `${text}.toLowerCase().includes(${JSON.stringify(needle.toLowerCase())})`;

async function main(): Promise<void> {
  const maySkip = !process.env.CI || process.env.AC_DRIVE_OPTIONAL === "1";
  if (!GIVEN_DB) {
    if (maySkip) { console.log("drive-s8: DATABASE_URL not set — skipped"); return; }
    throw new Error("DATABASE_URL is not set, and a skip in CI is a check that stopped checking");
  }
  const chrome = findChrome();
  if (!chrome) {
    if (maySkip) { console.log("drive-s8: no chrome found — skipped"); return; }
    throw new Error("no chrome found and this is CI. Set AC_CHROME, or AC_DRIVE_OPTIONAL=1 to accept the gap deliberately");
  }
  console.log(`drive-s8: ${chrome}`);

  const ownScratch = !process.env.AC_DRIVE_DB;
  const maintenance = withDb(GIVEN_DB, dbName(GIVEN_DB) === "postgres" ? "template1" : "postgres");
  const DB = withDb(GIVEN_DB, SCRATCH);
  const admin0 = createPool(maintenance, "ac-drive8-admin");
  admin0.on("error", () => {});
  try {
    if (ownScratch) {
      const c = await admin0.connect();
      try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); }
      console.log(`drive-s8: scratch database ${SCRATCH}`);
      const mig = spawn(process.execPath, [join(ROOT, "tools/ci/migrate.ts")], { env: { ...process.env, DATABASE_URL: DB }, stdio: ["ignore", "pipe", "pipe"] });
      let mlog = "";
      mig.stdout!.on("data", (d) => { mlog += String(d); });
      mig.stderr!.on("data", (d) => { mlog += String(d); });
      const mcode = await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1)));
      must(mcode === 0, `migrate failed on the scratch database:\n${mlog}`);
    }
  } catch (e) { await admin0.end().catch(() => {}); throw e; }

  const pool: Pool = createPool(DB, "ac-drive8");
  pool.on("error", () => {});
  const admin = async (sql: string, params: unknown[] = []) => {
    const c = await pool.connect();
    try { return (await c.query(sql, params)).rows; } finally { c.release(); }
  };

  let gateway: ChildProcess | undefined;
  let site: Server | undefined;
  let cdp: Cdp | undefined;
  let log = "";
  try {
    await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
    const hash = hashPassword(PASSWORD);
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ($1,$2,$3,'internal',$4,'Drive Owner','["account_owner"]','parent',$2,$5,true),
             ($6,$2,$3,'internal','disp.drive8@ac.test','Dispatcher','["dispatcher"]','region',$3,$5,true)`, [OWNER, INTERNAL_ORG_ID, REGION_SOUTH, OWNER_EMAIL, hash, DISP]);

    gateway = spawn(process.execPath, [join(ROOT, "apps/gateway/src/main.ts")], {
      env: { ...process.env, PORT: String(GATEWAY_PORT), DATABASE_URL: DB, AC_DEV_ORIGINS: SITE }, stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout!.on("data", (d) => { log += String(d); });
    gateway.stderr!.on("data", (d) => { log += String(d); });
    await waitHealthy(() => log);

    // The office records the network and the customer through the real operations — the same calls S2's screens make.
    const s2 = await connectShell({ surfaceId: "S2", baseUrl: GATEWAY, fetch, credentials: { email: OWNER_EMAIL, password: PASSWORD } });
    const firmA = (await s2.gateway.createFirm({ legalName: "Firm A LLC", regionId: REGION_SOUTH, settlementTermsDays: 30, diagnosticDataRightsReserved: true, msaSignedAt: "2026-01-10" })).id;
    const firmB = (await s2.gateway.createFirm({ legalName: "Firm B Mechanical", regionId: REGION_SOUTH, settlementTermsDays: 45, diagnosticDataRightsReserved: true, msaSignedAt: "2026-01-12" })).id;
    await s2.gateway.updateFirm({ firmId: firmA, status: "active" });
    await s2.gateway.updateFirm({ firmId: firmB, status: "active" });
    const crewA = (await s2.gateway.createCrew({ label: `Crew A1 ${RUN}`, employmentType: "subcontracted", firmId: firmA, homeRegionId: REGION_SOUTH })).id;
    const crewB = (await s2.gateway.createCrew({ label: `Crew B1 ${RUN}`, employmentType: "subcontracted", firmId: firmB, homeRegionId: REGION_SOUTH })).id;
    for (const crew of [crewA, crewB]) {
      for (const kind of ["insurance", "license", "background_check"] as const) {
        const c = await s2.gateway.recordCredential({ crewId: crew, kind, identifier: `${kind}-${crew.slice(-4)}`, validFrom: "2026-01-01", validTo: "2027-12-31" });
        await s2.gateway.verifyCredential({ credentialId: c.id });
      }
    }
    const rateA = (await s2.gateway.setRateCard({ firmId: firmA, serviceCode: "HVAC-REPAIR", rateMinor: "9500", currency: "USD", effectiveFrom: "2026-01-01" })).id;
    const rateB = (await s2.gateway.setRateCard({ firmId: firmB, serviceCode: "HVAC-REPAIR", rateMinor: "8800", currency: "USD", effectiveFrom: "2026-01-01" })).id;

    const org = await s2.gateway.createOrganization({ name: "Amped Fitness", externalRef: `drive8-${RUN}`, firstRegionNode: { regionId: REGION_SOUTH, name: "Amped / South" } });
    const austin = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "location", parentId: org.regionNodeId, name: "Austin", customerGroup: "Southwest" })).id;
    const austinRoof = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "site", parentId: austin, name: "Austin — Roof" })).id;
    const austinAhu = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "site", parentId: austin, name: "Austin — Basement AHU" })).id;
    const msa = (await s2.gateway.createContract({ orgId: org.orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: org.orgId, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true })).id;
    await s2.gateway.transitionContract({ contractId: msa, to: "active" });
    await s2.gateway.authorTermOverride({ contractId: msa, scopeTier: "parent", scopeId: org.orgId, termKey: "sla_response", termValue: "4_hour", effectiveFrom: "2026-01-01", orgId: org.orgId, regionId: REGION_SOUTH });
    const t = new Date(Date.now() + 24 * 3600_000);
    const ws = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 9)).toISOString();
    const we = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 13)).toISOString();
    const jobA = await s2.gateway.createJob({ siteId: austinRoof, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: ws, serviceWindowEnd: we });
    const jobB = await s2.gateway.createJob({ siteId: austinAhu, serviceCode: "HVAC-REPAIR", priority: "routine", serviceWindowStart: ws, serviceWindowEnd: we });
    const s3 = await connectShell({ surfaceId: "S3", baseUrl: GATEWAY, fetch, credentials: { email: "disp.drive8@ac.test", password: PASSWORD } });
    must((await s3.gateway.assignCrew({ jobId: jobA.id, crewId: crewA, orgId: org.orgId, regionId: REGION_SOUTH })).ok, "crew A should clear the gate");
    must((await s3.gateway.assignCrew({ jobId: jobB.id, crewId: crewB, orgId: org.orgId, regionId: REGION_SOUTH })).ok, "crew B should clear the gate");
    // Statements are WS-E's to issue; until then they are rows.
    const stmtA = randomUUID(), stmtB = randomUUID();
    await admin(`INSERT INTO settlements (id, org_id, region_id, firm_id, period, total_minor, currency, state, issued_at) VALUES
        ($1, $3, $5, $3, daterange('2026-08-01','2026-09-01','[)'), 42750, 'USD', 'issued', now()),
        ($2, $4, $5, $4, daterange('2026-08-01','2026-09-01','[)'), 35200, 'USD', 'issued', now())`, [stmtA, stmtB, firmA, firmB, REGION_SOUTH]);
    await admin(`INSERT INTO settlement_lines (org_id, region_id, settlement_id, job_id, rate_card_id, quantity_milli, amount_minor) VALUES
        ($1, $3, $4, $6, $8, 4500, 42750), ($2, $3, $5, $7, $9, 4000, 35200)`, [firmA, firmB, REGION_SOUTH, stmtA, stmtB, jobA.id, jobB.id, rateA, rateB]);
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, firm_id, password_hash, active)
      VALUES ($1,$2,$3,'subcontractor',$4,'Firm A Coordinator','[]','parent',$2,$2,$5,true), ($6,$7,$3,'subcontractor',$8,'Firm B Coordinator','[]','parent',$7,$7,$5,true)`,
      [COORD_A, firmA, REGION_SOUTH, A_EMAIL, hash, COORD_B, firmB, B_EMAIL]);
    await s2.logout(); await s3.logout();

    // The one build step, with this run's gateway stamped into the frame.
    const build = spawn(process.execPath, [join(ROOT, "tools/ci/build-surface.ts"), "S8"], { env: { ...process.env, AC_GATEWAY: GATEWAY }, stdio: ["ignore", "pipe", "pipe"] });
    let blog = "";
    build.stdout!.on("data", (d) => { blog += String(d); });
    build.stderr!.on("data", (d) => { blog += String(d); });
    must((await new Promise<number>((r) => build.on("exit", (c) => r(c ?? 1)))) === 0, `build-surface S8 failed:\n${blog}`);

    site = serveDist(join(ROOT, "apps/s8-subcontractor-portal/dist"));
    cdp = await Cdp.launch(chrome);
    await cdp.openTab(`${SITE}/login`);
    const shots = process.env.AC_DRIVE_SHOTS;
    if (shots) { mkdirSync(shots, { recursive: true }); await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 860, deviceScaleFactor: 1, mobile: false }); }
    const shot = async (name: string) => {
      if (!shots || !cdp) return;
      const r = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
      writeFileSync(join(shots, `s8-${name}.png`), Buffer.from(r.data, "base64"));
    };
    const clickNav = (label: string) => cdp!.eval(`(() => { const a = [...document.querySelectorAll("a")].find(a => a.textContent.trim() === ${JSON.stringify(label)}); if (!a) throw new Error("no link " + ${JSON.stringify(label)}); a.click(); return true; })()`);

    // ── 1. the portal boots to a login form under Rankine's plate — no tenant slot on this surface
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form");
    must(!(await cdp.eval<boolean>(`!!document.getElementById("ac-brand")`)), "S8 is not white-label: there is no brand slot in its frame");
    await shot("01-login");
    check(1, "S8 boots to a login form under Rankine's plate; no brand slot on a firm's surface");

    // ── 2. Firm A signs in and lands on Your firm: its own row, the ladder in words, the roster counted
    await cdp.eval(fillAndSubmit("login-form", { email: A_EMAIL, password: PASSWORD }));
    await cdp.waitFor(`!document.getElementById("login-form") && ${has("Firm A LLC")}`, "the firm's home");
    await cdp.waitFor(`document.getElementById("crew-summary") && document.getElementById("statement-summary")`, "the summaries to arrive");
    const page2 = await cdp.eval<string>(text);
    must(/Signed 2026-01-10/.test(page2), "the MSA date");
    must(/30 days from statement/.test(page2), "settlement terms");
    // innerText breaks a line at each inline element, so a count and its sentence may sit on two lines.
    must(/1\s*on the roster/.test(page2) && /1 ready to dispatch,/.test(page2), `the roster counted as the gate counts it, got ${JSON.stringify(page2.slice(0, 400))}`);
    must(/1\s*statement waiting for your acknowledgement — 427\.50 USD/.test(page2), "the statement waiting, as money");
    must(!/Firm B/.test(page2), "REGRESSION: another firm's name on the page");
    await shot("02-firm");
    check(2, "Your firm: the one row, Active, the MSA, the terms, one crew ready, one statement waiting — and no Firm B");

    // ── 3. Crews: readiness in words; enroll with one field; the new crew reads "Cannot be sent"
    await clickNav("Crews");
    await cdp.waitFor(has("Ready to dispatch"), "the roster");
    await cdp.eval(fillAndSubmit("enroll-form", { label: `Crew A2 ${RUN}` }));
    await cdp.waitFor(`document.getElementById("roster-outcome")`, "the enroll receipt");
    await cdp.waitFor(has(`Crew A2 ${RUN}`) + ` && ${has("Cannot be sent")}`, "the new crew on the roster, blocked by missing documents");
    const page3 = await cdp.eval<string>(text);
    must(/is on the roster\. File its documents next/.test(page3), "the receipt names what to do next");
    must(/No insurance, licence, background check on file/.test(page3), "the gate's requirement, in the firm's words");
    must(await cdp.eval<boolean>(`document.getElementById("enroll-label").value === ""`), "the form reset after sending");
    await shot("03-crews-enrolled");
    check(3, "Crews: enrolled with one field, the row appears blocked with the three documents it lacks, the form resets");

    // ── 4. Documents for the new crew: file insurance → "Awaiting Rankine"
    const crewA2 = (await admin(`SELECT id FROM crews WHERE label = $1`, [`Crew A2 ${RUN}`]))[0]!.id as string;
    await cdp.navigate(`${SITE}/crews/${crewA2}/documents`);
    await cdp.waitFor(has("Nothing on file for this crew yet"), "the empty document list");
    await cdp.eval(fillAndSubmit("document-form", { kind: "insurance", identifier: `COI-${RUN}`, validFrom: "2026-01-01", validTo: "2026-12-31" }));
    await cdp.waitFor(`document.getElementById("document-outcome")`, "the filing receipt");
    await cdp.waitFor(has("Awaiting Rankine"), "the document listed as unverified");
    const doc = (await admin(`SELECT verified_at, crew_id FROM crew_credentials WHERE identifier = $1`, [`COI-${RUN}`]))[0]!;
    must(doc.verified_at === null && doc.crew_id === crewA2, "the document landed unverified, on the firm's crew");
    must(await cdp.eval<boolean>(has(`Filed — insurance COI-${RUN} is with the office`)), "the receipt");
    await shot("04-documents-filed");
    check(4, "Documents: filed from the portal, listed as Awaiting Rankine, unverified in the row");

    // ── 5. Work: the job crew A was sent to, the site's name, the firm's own crew — and not B's job
    await clickNav("Work");
    await cdp.waitFor(has("Austin — Roof"), "the work list");
    const page5 = await cdp.eval<string>(text);
    must(/Assigned to you/.test(page5), "the state in the firm's words");
    must(new RegExp(`Crew A1 ${RUN}`).test(page5), "the firm's own crew on the row");
    must(!/Austin — Basement AHU/.test(page5) && !new RegExp(`Crew B1 ${RUN}`).test(page5), "REGRESSION: the other firm's job or crew on this firm's board");
    await shot("05-work");
    check(5, "Work: the job the firm's crew was sent to, by site name, with its own crew — and not the other firm's");

    // ── 6. Statements: one row, the money, Waiting on you
    await clickNav("Statements");
    await cdp.waitFor(has("Waiting on you"), "the statements list");
    must(await cdp.eval<boolean>(has("427.50 USD")), "the total as money");
    must(!(await cdp.eval<boolean>(has("352.00 USD"))), "REGRESSION: the other firm's total on this firm's page");
    await shot("06-statements");
    check(6, "Statements: the firm's one issued statement, as money, waiting on the firm");

    // ── 7. Open it: the lines with the rate; acknowledge → Acknowledged, the acknowledge form gone
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Open").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("acknowledge-form") && ${has("95.00 USD")}`, "the statement with its lines");
    must(await cdp.eval<boolean>(has("4.5")), "the quantity in hours, from thousandths");
    await cdp.eval(`(() => { document.getElementById("acknowledge-form").requestSubmit(); return true; })()`);
    await cdp.waitFor(`document.getElementById("statement-outcome")`, "the acknowledgement receipt");
    await cdp.waitFor(`!document.getElementById("acknowledge-form") && ${has("Acknowledged")}`, "the acknowledge form to go and the state to read acknowledged");
    must((await admin(`SELECT state FROM settlements WHERE id = $1`, [stmtA]))[0]!.state === "acknowledged", "the row moved");
    await shot("07-statement-acknowledged");
    check(7, "Statement: lines with the rate applied; acknowledged from the page; the acknowledge form is gone and the pill says so");

    // ── 8. Dispute it, with a reason → In dispute, both forms gone, the reason on the page
    await cdp.eval(fillAndSubmit("dispute-form", { reason: "Line 1 bills 4.5h; the ticket shows 4h." }));
    await cdp.waitFor(`!document.getElementById("dispute-form") && ${has("In dispute")}`, "the dispute to land");
    must(await cdp.eval<boolean>(has("the ticket shows 4h")), "the reason on the statement");
    const row8 = (await admin(`SELECT state, dispute_reason, total_minor::text AS total FROM settlements WHERE id = $1`, [stmtA]))[0]!;
    must(row8.state === "disputed" && /ticket shows 4h/.test(String(row8.dispute_reason)) && row8.total === "42750", "the position on the row, the total untouched");
    await shot("08-statement-disputed");
    check(8, "Statement: disputed with the reason; the position forms are gone; the total is untouched");

    // ── 9. Retire: the new crew goes; the assigned crew is refused with the gateway's words, no console card
    await clickNav("Crews");
    await cdp.waitFor(has(`Crew A2 ${RUN}`), "the roster again");
    await cdp.eval(`(() => { document.querySelector('button[data-retire="${crewA2}"]').click(); return true; })()`);
    await cdp.waitFor(has("is off the roster"), "the retire receipt");
    await cdp.waitFor(has("Retired"), "the row to read Retired");
    await cdp.eval(`(() => { document.querySelector('button[data-retire="${crewA}"]').click(); return true; })()`);
    await cdp.waitFor(`document.querySelector(".s8-refusal")`, "the refusal for an assigned crew");
    const refused = await cdp.eval<string>(`document.querySelector(".s8-refusal").innerText`);
    must(/holds 1 live assignment/.test(refused), `the gateway's sentence, got ${JSON.stringify(refused)}`);
    must(!(await cdp.eval<boolean>(`!!document.querySelector(".ac-refusal")`)), "not the console card");
    must((await admin(`SELECT active FROM crews WHERE id = $1`, [crewA]))[0]!.active === true, "nothing took effect");
    await shot("09-crews-retire-refused");
    check(9, "Crews: the new crew retired; the assigned crew refused with the gateway's words and no console card");

    // ── 10. Sign out; Firm B signs in to the SAME bundle: its own firm, its own statement, its own work
    await cdp.eval(`(() => { document.querySelector(".s8-nav__logout").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form after sign-out");
    await cdp.eval(fillAndSubmit("login-form", { email: B_EMAIL, password: PASSWORD }));
    await cdp.waitFor(`!document.getElementById("login-form") && ${has("Firm B Mechanical")}`, "firm B's home");
    await cdp.waitFor(`document.getElementById("statement-summary")`, "firm B's summaries");
    const page10 = await cdp.eval<string>(text);
    must(/352\.00 USD/.test(page10) && !/427\.50 USD/.test(page10), "B's statement, not A's");
    must(/45 days from statement/.test(page10), "B's own terms");
    await clickNav("Work");
    await cdp.waitFor(has("Austin — Basement AHU"), "B's work");
    must(!(await cdp.eval<boolean>(has("Austin — Roof"))), "REGRESSION: A's job on B's board");
    await shot("10-firm-b");
    check(10, "sign out, then Firm B in the same bundle: its own firm, its own money, its own work — nothing of A's");

    // ── 11. A deep link to A's statement from B's session: not on record, and the lines refused in the gateway's words
    await cdp.navigate(`${SITE}/statements/${stmtA}`);
    await cdp.waitFor(has("is on record for your firm") + ` || document.querySelector(".s8-refusal")`, "the refusal or the empty record");
    const page11 = await cdp.eval<string>(text);
    must(/No statement .* is on record for your firm/.test(page11), "the statement is not there from inside B's scope");
    must(/no statement .* visible in this scope/.test(page11), "the lines request refused in the gateway's words — unknown, not forbidden");
    must(!(await cdp.eval<boolean>(has("427.50")) ), "REGRESSION: A's total reached B's page");
    await shot("11-deep-link-refused");
    check(11, "a deep link to another firm's statement: not on record, the lines unknown in the gateway's words, no total leaked");

    console.log(`\ndrive-s8: ${passed} checks passed`);
  } finally {
    if (cdp) await cdp.close();
    site?.close();
    if (gateway && gateway.exitCode === null) {
      gateway.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((r) => gateway!.once("exit", () => r())),
        new Promise<void>((r) => setTimeout(() => { gateway!.kill("SIGKILL"); r(); }, 5_000)),
      ]);
    }
    await pool.end().catch(() => {});
    if (ownScratch) {
      const c = await admin0.connect().catch(() => null);
      if (c) {
        try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } catch (e) { console.warn(`drive-s8: could not drop ${SCRATCH}: ${String(e)}`); } finally { c.release(); }
      }
    }
    await admin0.end().catch(() => {});
  }
}

main().catch((e) => { console.error(`\ndrive-s8 FAILED after ${passed} checks\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
