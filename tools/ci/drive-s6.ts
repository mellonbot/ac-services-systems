/**
 * S6 THROUGH A REAL BROWSER — item 6's DOM layer, the one neither the render
 * tests nor the wire suite can see.
 *
 *   DATABASE_URL=postgres://... node tools/ci/drive-s6.ts
 *
 * test/integration/s6.test.ts proves tier scoping over the wire; the render
 * tests prove the markup. This walks the portal the way two customers do —
 * a facility manager and then the executive of the same account, in the same
 * bundle from the same origin — and reads the page: the manager's tree stops
 * at their location and the executive's does not; the work list carries the
 * state and no crew; the request form is preselected from the site's link,
 * posts, resets and reports receipt; the terms screen says where a term came
 * from; sign-out returns to the form and the next person signs in clean.
 *
 * Same scratch-database discipline as drive-s2-c4 (which see): create,
 * migrate, drive, drop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { deflateSync } from "node:zlib";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
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
const SCRATCH = process.env.AC_DRIVE_DB ?? `ac_drive6_${RUN.toLowerCase()}`;
const PASSWORD = "correct horse battery staple";
const OWNER = "d6000000-0000-0000-0000-000000000001", FM = "d6000000-0000-0000-0000-000000000003", EXEC = "d6000000-0000-0000-0000-000000000005";
const OWNER_EMAIL = "owner.drive6@ac.test", FM_EMAIL = "fm.austin.drive6@amped.test", EXEC_EMAIL = "exec.drive6@amped.test";

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

/**
 * Item 9: a stand-in for the imagery provider. A real PNG — a muted
 * aerial-ish gradient with a roof rectangle — so the card's <img> path,
 * the gateway's fetch/cache and the data: URL all execute and the
 * screenshot shows a picture, without a provider contract. Written from
 * scratch (node:zlib) because the drive may not depend on an image library.
 */
const stubTile = (w = 640, h = 360): Buffer => {
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "latin1"), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      const roof = x > w * 0.3 && x < w * 0.7 && y > h * 0.25 && y < h * 0.75;
      const lot = !roof && ((x + y) % 40 < 3);
      const g = roof ? 168 : lot ? 120 : 92 + ((x * 7 + y * 13) % 23);
      raw[i] = roof ? g + 8 : g - 20; raw[i + 1] = g; raw[i + 2] = roof ? g - 4 : g - 30;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};

async function main(): Promise<void> {
  const maySkip = !process.env.CI || process.env.AC_DRIVE_OPTIONAL === "1";
  if (!GIVEN_DB) {
    if (maySkip) { console.log("drive-s6: DATABASE_URL not set — skipped"); return; }
    throw new Error("DATABASE_URL is not set, and a skip in CI is a check that stopped checking");
  }
  const chrome = findChrome();
  if (!chrome) {
    if (maySkip) { console.log("drive-s6: no chrome found — skipped"); return; }
    throw new Error("no chrome found and this is CI. Set AC_CHROME, or AC_DRIVE_OPTIONAL=1 to accept the gap deliberately");
  }
  console.log(`drive-s6: ${chrome}`);

  const ownScratch = !process.env.AC_DRIVE_DB;
  const maintenance = withDb(GIVEN_DB, dbName(GIVEN_DB) === "postgres" ? "template1" : "postgres");
  const DB = withDb(GIVEN_DB, SCRATCH);
  const admin0 = createPool(maintenance, "ac-drive6-admin");
  admin0.on("error", () => {});
  try {
    if (ownScratch) {
      const c = await admin0.connect();
      try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); }
      console.log(`drive-s6: scratch database ${SCRATCH}`);
      const mig = spawn(process.execPath, [join(ROOT, "tools/ci/migrate.ts")], { env: { ...process.env, DATABASE_URL: DB }, stdio: ["ignore", "pipe", "pipe"] });
      let mlog = "";
      mig.stdout!.on("data", (d) => { mlog += String(d); });
      mig.stderr!.on("data", (d) => { mlog += String(d); });
      const mcode = await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1)));
      must(mcode === 0, `migrate failed on the scratch database:\n${mlog}`);
    }
  } catch (e) { await admin0.end().catch(() => {}); throw e; }

  const pool: Pool = createPool(DB, "ac-drive6");
  pool.on("error", () => {});
  const admin = async (sql: string, params: unknown[] = []) => {
    const c = await pool.connect();
    try { return (await c.query(sql, params)).rows; } finally { c.release(); }
  };

  let gateway: ChildProcess | undefined;
  let site: Server | undefined;
  let tiles: Server | undefined;
  let cdp: Cdp | undefined;
  let log = "";
  try {
    // Item 9: the imagery provider the gateway is pointed at for this run.
    const TILE_PORT = GATEWAY_PORT + 1000;
    const tilePng = stubTile();
    let tileHits = 0;
    tiles = createServer((_req, res) => { tileHits++; res.writeHead(200, { "content-type": "image/png" }); res.end(tilePng); });
    await new Promise<void>((r) => tiles!.listen(TILE_PORT, "127.0.0.1", r));

    await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
    const hash = hashPassword(PASSWORD);
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ($1,$2,$3,'internal',$4,'Drive Owner','["account_owner"]','parent',$2,$5,true)`, [OWNER, INTERNAL_ORG_ID, REGION_SOUTH, OWNER_EMAIL, hash]);

    gateway = spawn(process.execPath, [join(ROOT, "apps/gateway/src/main.ts")], {
      env: { ...process.env, PORT: String(GATEWAY_PORT), DATABASE_URL: DB, AC_DEV_ORIGINS: SITE,
             AC_IMAGERY_URL: `http://127.0.0.1:${TILE_PORT}/static?c={lat},{lng}&z={zoom}&s={w}x{h}`, AC_IMAGERY_ATTRIBUTION: "Imagery © Stub Tiles (drive)" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout!.on("data", (d) => { log += String(d); });
    gateway.stderr!.on("data", (d) => { log += String(d); });
    await waitHealthy(() => log);

    // The office records the account through the real operations — the same calls S2's screens make.
    const s2 = await connectShell({ surfaceId: "S2", baseUrl: GATEWAY, fetch, credentials: { email: OWNER_EMAIL, password: PASSWORD } });
    const org = await s2.gateway.createOrganization({ name: "Amped Fitness", externalRef: `drive6-${RUN}`, firstRegionNode: { regionId: REGION_SOUTH, name: "Amped / South" } });
    const westNode = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "region", regionId: REGION_WEST, name: "Amped / West" })).id;
    const austin = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "location", parentId: org.regionNodeId, name: "Austin", customerGroup: "Southwest" })).id;
    const austinRoof = (await s2.gateway.createAccount({
      orgId: org.orgId, tier: "site", parentId: austin, name: "Austin — Roof", externalRef: "ATX-01", timezone: "America/Chicago",
      address: { line1: "4500 Burnet Rd", city: "Austin", state: "TX", postal: "78756", lat: 30.3145, lng: -97.7392 },
    })).id;
    const austinAhu = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "site", parentId: austin, name: "Austin — Basement AHU" })).id;
    const reno = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "location", parentId: westNode, name: "Reno" })).id;
    const renoRoof = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "site", parentId: reno, name: "Reno — Roof", address: { line1: "1 Casino Way", city: "Reno", state: "NV" } })).id;
    const msa = (await s2.gateway.createContract({ orgId: org.orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: org.orgId, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true })).id;
    await s2.gateway.transitionContract({ contractId: msa, to: "active" });
    await s2.gateway.authorTermOverride({ contractId: msa, scopeTier: "parent", scopeId: org.orgId, termKey: "sla_response", termValue: "4_hour", effectiveFrom: "2026-01-01", orgId: org.orgId, regionId: REGION_SOUTH });
    await s2.gateway.authorTermOverride({ contractId: msa, scopeTier: "region", scopeId: westNode, termKey: "sla_response", termValue: "2_hour", effectiveFrom: "2026-01-01", orgId: org.orgId, regionId: REGION_WEST });
    const t = new Date(Date.now() + 24 * 3600_000);
    const ws = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 9)).toISOString();
    const we = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 13)).toISOString();
    // Item 9: the site's record — units, the people at it, and a PM visit that named the units and is done.
    const rtu1 = (await s2.gateway.registerEquipment({ siteId: austinRoof, kind: "rtu", label: "RTU-1", manufacturer: "Carrier", model: "48TC-D08", serial: "4819U10231", installedOn: "2019-05-14", tonnageMilli: "7500" })).id;
    const rtu2 = (await s2.gateway.registerEquipment({ siteId: austinRoof, kind: "rtu", label: "RTU-2", manufacturer: "Carrier", model: "48TC-D08", serial: "4819U10232", installedOn: "2019-05-14", tonnageMilli: "7500" })).id;
    await s2.gateway.registerEquipment({ siteId: austinRoof, kind: "exhaust", label: "EF-1", model: "Greenheck G-120" });
    await s2.gateway.registerEquipment({ siteId: renoRoof, kind: "package", label: "PU-1", manufacturer: "Trane", model: "Precedent", serial: "T-88213" });
    await s2.gateway.setContact({ accountId: austinRoof, role: "site_manager", name: "Dana Ortiz", phone: "(512) 555-0100", email: "dana.ortiz@amped.example", note: "On site 6a–3p", isPrimary: true });
    await s2.gateway.setContact({ accountId: austin, role: "security", name: "Front desk", phone: "(512) 555-0199" });
    const past = new Date(Date.now() - 100 * 24 * 3600_000);
    const pws = new Date(Date.UTC(past.getUTCFullYear(), past.getUTCMonth(), past.getUTCDate(), 9)).toISOString();
    const pwe = new Date(Date.UTC(past.getUTCFullYear(), past.getUTCMonth(), past.getUTCDate(), 13)).toISOString();
    const pm = await s2.gateway.createJob({ siteId: austinRoof, serviceCode: "PM-Q2", priority: "pm", serviceWindowStart: pws, serviceWindowEnd: pwe, equipmentIds: [rtu1, rtu2] });
    await admin(`UPDATE jobs SET state = 'complete' WHERE id = $1`, [pm.id]);
    const inv = (await admin(`INSERT INTO invoices (org_id, region_id, bill_to_tier, bill_to_id, contract_id, billing_path, period_start, period_end, total_minor, currency, issued_at, due_at)
      VALUES ($1, $2, 'parent', $1, $3, 'enterprise_sla', '2026-06-01', '2026-06-30', 128450, 'USD', '2026-07-03T15:00:00Z', '2026-08-17T00:00:00Z') RETURNING id`, [org.orgId, REGION_SOUTH, msa]))[0]!.id;
    await admin(`INSERT INTO invoice_lines (org_id, region_id, invoice_id, location_id, job_id, description, quantity_milli, unit_price_minor, amount_minor)
      VALUES ($1, $2, $3, $4, $5, 'Quarterly PM — RTU-1, RTU-2', 1000, 42500, 42500)`, [org.orgId, REGION_SOUTH, inv, austin, pm.id]);
    const job = await s2.gateway.createJob({ siteId: austinRoof, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: ws, serviceWindowEnd: we, equipmentIds: [rtu2] });
    await s2.gateway.createJob({ siteId: renoRoof, serviceCode: "PM-VISIT", priority: "pm", serviceWindowStart: ws, serviceWindowEnd: we });
    // A crew on the Austin job, so the page has a crew NOT to show.
    const crew = (await s2.gateway.createCrew({ label: `Crew Drive ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
    for (const kind of ["license", "background_check"] as const) {
      const c = await s2.gateway.recordCredential({ crewId: crew, kind, identifier: `${kind}-${RUN}`, validFrom: "2026-01-01", validTo: "2027-12-31" });
      await s2.gateway.verifyCredential({ credentialId: c.id });
    }
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ($1,$2,$3,'internal','disp.drive6@ac.test','Dispatcher','["dispatcher"]','region',$3,$4,true)`, ["d6000000-0000-0000-0000-000000000002", INTERNAL_ORG_ID, REGION_SOUTH, hash]);
    const s3 = await connectShell({ surfaceId: "S3", baseUrl: GATEWAY, fetch, credentials: { email: "disp.drive6@ac.test", password: PASSWORD } });
    const assigned = await s3.gateway.assignCrew({ jobId: job.id, crewId: crew, orgId: org.orgId, regionId: REGION_SOUTH });
    must(assigned.ok, "the seed crew should clear the gate");
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ($1,$2,$3,'customer',$4,'Austin FM','[]','location',$5,$6,true), ($7,$2,$3,'customer',$8,'Amped Exec','[]','parent',$2,$6,true)`,
      [FM, org.orgId, REGION_SOUTH, FM_EMAIL, austin, hash, EXEC, EXEC_EMAIL]);
    await s2.logout(); await s3.logout();

    // The one build step, with this run's gateway stamped into the frame.
    const build = spawn(process.execPath, [join(ROOT, "tools/ci/build-surface.ts"), "S6"], { env: { ...process.env, AC_GATEWAY: GATEWAY }, stdio: ["ignore", "pipe", "pipe"] });
    let blog = "";
    build.stdout!.on("data", (d) => { blog += String(d); });
    build.stderr!.on("data", (d) => { blog += String(d); });
    must((await new Promise<number>((r) => build.on("exit", (c) => r(c ?? 1)))) === 0, `build-surface S6 failed:\n${blog}`);

    site = serveDist(join(ROOT, "apps/s6-customer-portal/dist"));
    cdp = await Cdp.launch(chrome);
    await cdp.openTab(`${SITE}/login`);
    // AC_DRIVE_SHOTS=<dir> keeps a PNG of each screen the drive read — for a
    // person to look at what the checks below only assert.
    const shots = process.env.AC_DRIVE_SHOTS;
    if (shots) { mkdirSync(shots, { recursive: true }); await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 860, deviceScaleFactor: 1, mobile: false }); }
    const shot = async (name: string, full = false) => {
      if (!shots || !cdp) return;
      // A full-page capture for a screen that scrolls: the site card's ledger
      // sits below the fold, and a layout defect below the fold is still a defect.
      const h = full ? await cdp.eval<number>(`document.documentElement.scrollHeight`) : 0;
      const r = await cdp.send("Page.captureScreenshot", full
        ? { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1180, height: Math.min(h, 4000), scale: 1 } }
        : { format: "png" }) as { data: string };
      writeFileSync(join(shots, `s6-${name}.png`), Buffer.from(r.data, "base64"));
    };

    // ── 1. the portal boots to a login form, in Rankine's plate (no tenant theme for this host)
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form");
    const brandSlot = await cdp.eval<string>(`document.getElementById("ac-brand")?.textContent ?? "missing"`);
    must(brandSlot === "", `the brand slot should be empty for an unknown host, got ${JSON.stringify(brandSlot.slice(0, 40))}`);
    await shot("01-login");
    check(1, "S6 boots to a login form; the brand slot is empty for an unknown host, so the plate stands");

    // ── 2. the facility manager signs in over the cookie session and lands on Sites
    await cdp.eval(fillAndSubmit("login-form", { email: FM_EMAIL, password: PASSWORD }));
    await cdp.waitFor(`!document.getElementById("login-form") && ${has("Austin — Roof")}`, "the manager's sites");
    check(2, "the facility manager's login lands on Sites");

    // ── 3. the tree is the manager's: breadcrumb, location, two sites — no Reno, no West
    const who = await cdp.eval<string>(`document.getElementById("who")?.innerText ?? ""`);
    must(who === "Amped Fitness › Amped / South › Austin", `the breadcrumb should be the manager's own path, got ${JSON.stringify(who)}`);
    await cdp.waitFor(has("1 open job"), "the site's live work to arrive — jobs.list answers after accounts.list");
    const page3 = await cdp.eval<string>(text);
    must(/Location: Austin\. You see this location and what is under it\./.test(page3), "the scope sentence");
    must(/Amped \/ South/.test(page3) && /Austin — Basement AHU/.test(page3), "the region node above and both sites below");
    must(!/Reno/.test(page3) && !/Amped \/ West/.test(page3), "REGRESSION: the manager's page shows another location or region");
    must(/1 open job/i.test(page3), "the site carries its live work");
    await shot("02-sites-facility-manager");
    check(3, "the manager's tree stops at their location — region node above, two sites below, nothing beside");

    // ── 4. Work: the job's state in words, the response pill, and no crew anywhere
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Work").click(); return true; })()`);
    await cdp.waitFor(has("Crew assigned"), "the work list");
    const headers = await cdp.eval<string[]>(`[...document.querySelectorAll("th")].map(th => th.innerText.trim())`);
    must(!headers.includes("Crew"), `no crew column on a customer's board, got ${JSON.stringify(headers)}`);
    must(!(await cdp.eval<boolean>(has(`Crew Drive ${RUN}`))), "REGRESSION: the crew's label reached the customer's page");
    must(await cdp.eval<boolean>(has("Responded")), "the satisfied timer reads as responded");
    await shot("03-work-facility-manager");
    check(4, "Work reads 'Crew assigned' and 'Responded' — and the crew's name is nowhere on the page");

    // ── 5. Request service from a site's link: preselected, filled, sent, reset, receipt
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Sites").click(); return true; })()`);
    await cdp.waitFor(has("Austin — Basement AHU"), "sites again");
    await cdp.eval(`(() => {
      const row = [...document.querySelectorAll(".s6-node__row")].find(r => r.innerText.includes("Austin — Basement AHU"));
      [...row.querySelectorAll("a")].find(a => a.textContent.trim() === "Request service").click(); return true;
    })()`);
    await cdp.waitFor(`document.getElementById("request-form")`, "the request form");
    await shot("04-request-form");
    const preselected = await cdp.eval<string>(`document.getElementById("request-site").value`);
    must(preselected === austinAhu, "the site the link named is preselected");
    const offered = await cdp.eval<string[]>(`[...document.querySelectorAll("#request-site option")].map(o => o.value)`);
    must(offered.length === 2 && offered.includes(austinRoof) && offered.includes(austinAhu), `only the manager's two sites are offered, got ${offered.length}`);
    await cdp.eval(`(() => { document.querySelector('#request-form input[value="urgent"]').click(); return true; })()`);
    await cdp.eval(fillAndSubmit("request-form", { description: "Water pooling under the basement AHU since this morning." }));
    await cdp.waitFor(`document.getElementById("request-sent")`, "the receipt");
    const receipt = await cdp.eval<string>(`document.getElementById("request-sent").innerText`);
    must(/Received — your request at Austin — Basement AHU is with the office/.test(receipt), `the receipt names the site, got ${JSON.stringify(receipt)}`);
    await shot("05-request-sent");
    const cleared = await cdp.eval<string>(`document.getElementById("request-description").value`);
    must(cleared === "", "the form resets after a send");
    const routineAgain = await cdp.eval<boolean>(`document.querySelector('#request-form input[value="routine"]').checked`);
    must(routineAgain, "the priority default survives the reset (defaultChecked, not checked)");
    const row = (await admin(`SELECT priority, region_id, requested_by FROM service_requests ORDER BY created_at DESC LIMIT 1`))[0]!;
    must(row.priority === "urgent" && row.region_id === REGION_SOUTH && row.requested_by === FM, "the row is the manager's, urgent, in the site's region");
    check(5, "a request from the site's link is preselected, sent as urgent, reset, and acknowledged by site name");

    // ── 6. the request appears under Work as waiting
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Work").click(); return true; })()`);
    await cdp.waitFor(has("Waiting for the office"), "the request in the work list");
    check(6, "the request is listed under Work as waiting for the office");

    // ── 7. THE SITE CARD (item 9): from the tree, the site's name opens its card — where, who, what runs there, one ledger, the roof
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Sites").click(); return true; })()`);
    await cdp.waitFor(has("Austin — Basement AHU"), "sites once more");
    await cdp.eval(`(() => { [...document.querySelectorAll("a.s6-node__name")].find(a => a.textContent.trim() === "Austin — Roof").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("site-card") && document.getElementById("site-units-count") && document.getElementById("site-contacts") && document.querySelector("#site-roof img") && document.getElementById("site-history")?.children.length >= 3`, "the card's five panels to arrive");
    await shot("05b-site-card", true);
    const card = await cdp.eval<string>(text);
    must(/Austin — Roof/.test(card) && /ATX-01/.test(card), "the site and its code");
    must(/Amped \/ South › Austin/.test((await cdp.eval<string>(`document.getElementById("site-crumbs").innerText`))), "the breadcrumb is the manager's own");
    must(/4500 Burnet Rd/.test(card) && /Austin, TX 78756/.test(card), "the address as recorded");
    must(/3 units — 2 RTU · 1 Exhaust/.test(card.replace(/\s+/g, " ")), `the count line, got ${JSON.stringify(/\d+ units[^\n]*/.exec(card)?.[0])}`);
    must(/4819U10231/.test(card) && /Carrier 48TC-D08/.test(card), "serial, make and model");
    must(/PM-Q2/.test(card), "last serviced names the completed PM");
    must((card.match(/PM-Q2/g) ?? []).length >= 2, "both RTUs were serviced by the PM — RTU-2's OPEN repair does not move its date");
    must(/Not yet serviced by us/.test(card), "the exhaust fan has no history");
    must(/Dana Ortiz/.test(card) && /On site 6a–3p/.test(card), "the on-site manager and their note");
    must(/Front desk/.test(card) && /Location: Austin/i.test(card), "the location's desk, marked as inherited (the role line is set in small caps, so innerText is upper-case)");
    const tel = await cdp.eval<string>(`document.querySelector('#site-contacts a[href^="tel:"]')?.getAttribute("href") ?? ""`);
    must(tel === "tel:5125550100", `a dialable number, got ${JSON.stringify(tel)}`);
    const kinds = await cdp.eval<string[]>(`[...document.querySelectorAll("#site-history [data-kind]")].map(li => li.dataset.kind)`);
    must(JSON.stringify(kinds) === JSON.stringify(["job", "invoice", "job"]), `newest first, a job on the day of its visit — tomorrow's repair, July's invoice, June's PM; got ${JSON.stringify(kinds)}`);
    must(/\$425\.00/.test(card), "the site's subtotal in dollars from minor units");
    must(!/12,845|128450/.test(card), "REGRESSION: the consolidated header total is on the customer's card");
    must(!(await cdp.eval<boolean>(has(`Crew Drive ${RUN}`))), "REGRESSION: the crew reached the site card");
    const img = await cdp.eval<{ src: string; w: number; h: number; complete: boolean }>(`(() => { const i = document.querySelector("#site-roof img"); return { src: i.src.slice(0, 22), w: i.naturalWidth, h: i.naturalHeight, complete: i.complete }; })()`);
    must(img.src === "data:image/png;base64," && img.w === 640 && img.h === 360, `the gateway's picture is drawn inline (${JSON.stringify(img)})`);
    must(await cdp.eval<boolean>(has("Imagery © Stub Tiles")), "with the provider's credit");
    must(tileHits === 1, `the provider was asked exactly once, got ${tileHits}`);
    const overflow = await cdp.eval<{ sw: number; iw: number }>(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })`);
    must(overflow.sw <= overflow.iw, `the card must not scroll sideways (scrollWidth ${overflow.sw} > viewport ${overflow.iw})`);
    check(7, "the site card: address and roof, the manager and the desk, 3 units with derived last-service, one dated ledger with the site's own subtotal — no crew, no header total, no sideways scroll");

    // ── 8. the request-service BUTTONS: the card's own preselects the site; the header's is on every screen
    await cdp.eval(`(() => { document.getElementById("site-request").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("request-form")`, "the request form from the card");
    must((await cdp.eval<string>(`document.getElementById("request-site").value`)) === austinRoof, "the card's button preselects its site");
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Work").click(); return true; })()`);
    await cdp.waitFor(has("Crew assigned"), "Work");
    const navBtn = await cdp.eval<{ tag: string; text: string; y: number }>(`(() => { const b = document.getElementById("nav-request"); const r = b.getBoundingClientRect(); return { tag: b.tagName, text: b.innerText.trim(), y: r.top }; })()`);
    must(navBtn.tag === "BUTTON" && navBtn.text === "REQUEST SERVICE", `a button in the masthead, got ${JSON.stringify(navBtn)}`);
    must(navBtn.y < 300, `the header button sits near the top of the page, got y=${navBtn.y}`);
    await cdp.eval(`(() => { document.getElementById("nav-request").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("request-form")`, "the request form from the header");
    // A deep link to a site outside the manager's scope is a plain sentence, not a card and not an error.
    await cdp.navigate(`${SITE}/site/${renoRoof}`);
    await cdp.waitFor(`document.getElementById("site-missing")`, "the out-of-scope site's page");
    must(!(await cdp.eval<boolean>(has("Reno"))), "REGRESSION: an out-of-scope site's name reached the manager's page");
    check(8, "the card's button preselects its site; the header's Request service button is a button, near the top, on every screen; a deep link outside scope says so");

    // ── 9. Terms at Austin — Roof: the parent's 4-hour, and where it came from
    await cdp.navigate(`${SITE}/terms/site/${austinRoof}`);
    await cdp.waitFor(has("Terms at Austin — Roof"), "the terms screen");
    await cdp.waitFor(has("Set in the master agreement"), "the resolution");
    const terms7 = await cdp.eval<string>(text);
    must(/Response commitment/.test(terms7) && /4 hour/.test(terms7), "the response term in words");
    must(/Amped Fitness › Amped \/ South › Austin › Austin — Roof/.test(terms7), "the breadcrumb on the terms screen");
    must(await cdp.eval<boolean>(`!!document.getElementById("as-of")`), "the as-of control");
    await shot("06-terms-austin-roof");
    check(9, "Terms at the manager's site: 4 hour, set in the master agreement, under the manager's own breadcrumb");

    // ── 10. a deep link to Reno's terms is not the manager's: the resolver says unknown_scope, in the customer's words
    await cdp.navigate(`${SITE}/terms/site/${renoRoof}`);
    await cdp.waitFor(`document.querySelector(".s6-refusal")`, "a refusal for a node outside the scope");
    const refused = await cdp.eval<string>(`document.querySelector(".s6-refusal").innerText`);
    must(/Refused/.test(refused) && /no site node/.test(refused), `the refusal is the gateway's sentence, got ${JSON.stringify(refused)}`);
    must(!(await cdp.eval<boolean>(`!!document.querySelector(".ac-refusal")`)), "not the console card");
    await shot("07-terms-out-of-scope-refused");
    check(10, "a deep link to another location's terms is refused with the gateway's words — no console card");

    // ── 11. sign out → login form; the executive signs in and the SAME bundle shows the whole account
    await cdp.eval(`(() => { document.querySelector(".s6-nav__logout").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form after sign-out");
    await cdp.eval(fillAndSubmit("login-form", { email: EXEC_EMAIL, password: PASSWORD }));
    await cdp.waitFor(`!document.getElementById("login-form") && ${has("Reno — Roof")}`, "the executive's sites");
    const page9 = await cdp.eval<string>(text);
    must(/Every region, location and site under this agreement\./.test(page9), "the executive's scope sentence");
    must(/Amped \/ West/.test(page9) && /Austin — Roof/.test(page9) && /Reno — Roof/.test(page9), "both regions, every site");
    await shot("08-sites-executive");
    check(11, "sign out, then the executive: the same bundle, the whole tree");

    // ── 12. Terms at Reno — Roof for the executive: the WEST region node's 2-hour wins, and the screen says so
    await cdp.navigate(`${SITE}/terms/site/${renoRoof}`);
    await cdp.waitFor(has("Set at Region: Amped / West"), "the region-tier resolution");
    must(await cdp.eval<boolean>(has("2 hour")), "2 hour at Reno");
    await shot("09-terms-reno-executive");
    check(12, "Terms at Reno for the executive: 2 hour, set at Region: Amped / West");

    // ── 13. Agreements: the paper, with the data-rights position
    await cdp.navigate(`${SITE}/agreements`);
    await cdp.waitFor(has("Master agreement"), "the agreements list");
    must(await cdp.eval<boolean>(has("Rights reserved to Rankine")), "OQ5's position is shown to the customer that took it");
    must(await cdp.eval<boolean>(has("In force")), "the state in words");
    await shot("10-agreements");
    check(13, "Agreements: the master agreement, in force, data rights reserved");

    // ── 14. the executive's Work spans both regions, though the token is bound to South
    await cdp.navigate(`${SITE}/work`);
    await cdp.waitFor(has("PM-VISIT"), "Reno's job on the executive's board");
    must(await cdp.eval<boolean>(has("HVAC-REPAIR")), "and Austin's");
    check(14, "the executive's Work carries both regions' jobs");

    // ── 15. the executive's card for Reno: the same bundle over Reno's rows — no coordinates, no picture, no Austin
    await cdp.navigate(`${SITE}/site/${renoRoof}`);
    await cdp.waitFor(`document.getElementById("site-card") && document.getElementById("site-units-count") && document.querySelector("#site-roof[data-unavailable]")`, "Reno's card for the executive");
    const renoCard = await cdp.eval<string>(text);
    must(/Reno — Roof/.test(renoCard) && /1 Casino Way/.test(renoCard), "Reno's own address");
    must(/1 unit — 1 Pkg/.test(renoCard.replace(/\s+/g, " ")) && /T-88213/.test(renoCard), "Reno's one unit");
    must(!/RTU-1|Dana Ortiz|4500 Burnet/.test(renoCard), "REGRESSION: Austin's record on Reno's card");
    must((await cdp.eval<string>(`document.getElementById("site-roof").dataset.unavailable`)) === "no_coordinates", "no coordinates on record → said so, no fetch");
    must(tileHits === 1, `no provider call for a site without coordinates, got ${tileHits}`);
    await shot("11-site-card-reno-executive", true);
    check(15, "the executive's Reno card: Reno's address, Reno's unit, no picture because no coordinates — and nothing of Austin's");

    console.log(`\ndrive-s6: ${passed} checks passed`);
  } finally {
    if (cdp) await cdp.close();
    site?.close();
    tiles?.close();
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
        try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } catch (e) { console.warn(`drive-s6: could not drop ${SCRATCH}: ${String(e)}`); } finally { c.release(); }
      }
    }
    await admin0.end().catch(() => {});
  }
}

main().catch((e) => { console.error(`\ndrive-s6 FAILED after ${passed} checks\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
