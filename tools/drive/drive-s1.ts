/**
 * S1, THE FRONT DOOR, THROUGH A REAL BROWSER.
 *
 *   DATABASE_URL=postgres://... node tools/drive/drive-s1.ts
 *
 * SURFACES.S1.degraded says: "the page renders with no gateway call. Signing
 * in needs the gateway: when it does not answer, the form says so and keeps
 * what was typed. Nothing is queued." Every part of that is about a browser:
 *
 *   - "renders with no gateway call" is a page that renders with nothing
 *     listening on the gateway's port. So this drive starts the SITE first and
 *     the GATEWAY later, and signs in between.
 *   - "sends each person where they belong" is the browser's own location
 *     changing, and a session cookie the destination accepts. So the drive
 *     reads `location.pathname` and asks the gateway, AS the destination,
 *     who is signed in — with the cookie the browser holds and script cannot read.
 *
 * And OFFLINE (steps 9–11): the site is built as it ships — S1 at `/`, S5 at
 * `/technician/`, and the `/sw.js` that keeps both on the device. A technician
 * signs in on a field device and reaches their job list; then the network is
 * cut twice over (the browser's own offline switch, and the site and gateway
 * both stopped) and the same tab, reloaded at `/`, must land on that job list
 * from the cache. A new tab, offline, must be told it holds no shift — no form,
 * no spinner.
 *
 * Same scratch-database discipline as drive-s2-c4, drive-s6 and drive-s8
 * (which see): create, migrate, drive, drop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../services/gateway/src/db/pg-tx.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { hashPassword } from "../../services/gateway/src/auth/auth.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { Cdp, findChrome } from "./cdp.ts";
import { connectShell } from "../../packages/shell/src/index.ts";
import { SURFACE_PATHS } from "../../packages/contracts/src/surfaces.ts";
import { stateMsaTerms } from "../../packages/domain/src/inheritance/fixtures/msa-terms.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GIVEN_DB = process.env.DATABASE_URL;
const dbName = (url: string): string => new URL(url).pathname.replace(/^\//, "");
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const GATEWAY_PORT = 23000 + Math.floor(Math.random() * 400);
const SITE_PORT = 24500 + Math.floor(Math.random() * 400);
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const RUN = Date.now().toString(36).toUpperCase();
const SCRATCH = process.env.AC_DRIVE_DB ?? `ac_drive1_${RUN.toLowerCase()}`;

let passed = 0;
const check = (n: number, what: string) => { passed++; console.log(`  ${String(n).padStart(2)} ✓ ${what}`); };
const must = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json" };
const S5_PATH = SURFACE_PATHS.S5;
/** The site as Pages serves it: S5's paths fall to S5's page, every other path to S1's. */
const serveSite = (dir: string): Server => {
  const s = createServer((req, res) => {
    const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^(\.\.[/\\])+/, "");
    let file = join(dir, rel);
    const page = rel === S5_PATH || rel.startsWith(`${S5_PATH}/`) ? join(dir, S5_PATH, "index.html") : join(dir, "index.html");
    if (!existsSync(file) || statSync(file).isDirectory()) file = page;
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
const has = (needle: string) => `${text}.toLowerCase().includes(${JSON.stringify(needle.toLowerCase())})`;

/**
 * The copy ceiling, read off the PAINTED page rather than off a render.
 * `apps/s1-front-door/src/app.test.ts` holds the same list against the markup;
 * this one holds it against what a person actually sees, including anything a
 * stylesheet's `content` or a `::before` put there. D7a and OQ6 set the
 * ceiling and neither is written down yet (action plan F9), so the ceiling is
 * zero.
 */
const TIME_CLAIMS: readonly [RegExp, string][] = [
  [/\b24[\s/-]?7\b/i, "round-the-clock availability"],
  [/\bwithin\s+\d+\s*(minute|hour|day|business)/i, "a response window"],
  [/\bsame[- ]day\b/i, "same-day service"],
  [/\bguarantee[ds]?\b/i, "a guarantee"],
  [/\buptime\b/i, "an uptime number"],
  [/\bSLA\b/, "an SLA"],
];

async function main(): Promise<void> {
  const maySkip = !process.env.CI || process.env.AC_DRIVE_OPTIONAL === "1";
  if (!GIVEN_DB) {
    if (maySkip) { console.log("drive-s1: DATABASE_URL not set — skipped"); return; }
    throw new Error("DATABASE_URL is not set, and a skip in CI is a check that stopped checking");
  }
  const chrome = findChrome();
  if (!chrome) {
    if (maySkip) { console.log("drive-s1: no chrome found — skipped"); return; }
    throw new Error("no chrome found and this is CI. Set AC_CHROME, or AC_DRIVE_OPTIONAL=1 to accept the gap deliberately");
  }
  console.log(`drive-s1: ${chrome}`);

  const ownScratch = !process.env.AC_DRIVE_DB;
  const maintenance = withDb(GIVEN_DB, dbName(GIVEN_DB) === "postgres" ? "template1" : "postgres");
  const DB = withDb(GIVEN_DB, SCRATCH);
  const admin0 = createPool(maintenance, "ac-drive1-admin");
  admin0.on("error", () => {});
  try {
    if (ownScratch) {
      const c = await admin0.connect();
      try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); }
      console.log(`drive-s1: scratch database ${SCRATCH}`);
      const mig = spawn(process.execPath, [join(ROOT, "tools/ci/migrate.ts")], { env: { ...process.env, DATABASE_URL: DB }, stdio: ["ignore", "pipe", "pipe"] });
      let mlog = "";
      mig.stdout!.on("data", (d) => { mlog += String(d); });
      mig.stderr!.on("data", (d) => { mlog += String(d); });
      const mcode = await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1)));
      must(mcode === 0, `migrate failed on the scratch database:\n${mlog}`);
    }
  } catch (e) { await admin0.end().catch(() => {}); throw e; }

  const pool: Pool = createPool(DB, "ac-drive1");
  pool.on("error", () => {});
  const admin = async (sql: string, params: unknown[] = []) => {
    const c = await pool.connect();
    try { return (await c.query(sql, params)).rows; } finally { c.release(); }
  };
  const sessionSurface = async (email: string): Promise<string | null> =>
    ((await admin(`SELECT s.surface_id FROM sessions s JOIN users u ON u.id = s.principal_id WHERE u.email = $1 AND s.revoked_at IS NULL ORDER BY s.expires_at DESC LIMIT 1`, [email]))[0]?.surface_id as string | undefined) ?? null;
  const PASSWORD = "correct horse battery staple";

  let gateway: ChildProcess | undefined;
  let site: Server | undefined;
  let siteDir: string | undefined;
  let cdp: Cdp | undefined;
  let log = "";
  try {
    // Three logins whose surfaces the registry decides: the office (S2 only), a
    // principal (S2, S3 and S4 — a choice), and a technician (no surface without a device).
    await admin(`INSERT INTO regions (id, code, name, active) VALUES ($1,'SOUTH','South',true) ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
    const hash = hashPassword(PASSWORD);
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ('d1d00000-0000-0000-0000-000000000001',$1,$2,'internal','office.drive1@ac.test','Office Manager','["office_manager"]','parent',$1,$3,true),
             ('d1d00000-0000-0000-0000-000000000002',$1,$2,'internal','principal.drive1@ac.test','Principal','["principal"]','parent',$1,$3,true),
             ('d1d00000-0000-0000-0000-000000000003',$1,$2,'internal','tech.drive1@ac.test','Technician','["technician"]','region',$2,$3,true),
             ('d1d00000-0000-0000-0000-000000000004',$1,$2,'internal','owner.drive1@ac.test','Drive Owner','["account_owner"]','parent',$1,$3,true),
             ('d1d00000-0000-0000-0000-000000000005',$1,$2,'internal','dispatch.drive1@ac.test','Dispatcher','["dispatcher"]','region',$2,$3,true)
      ON CONFLICT (id) DO NOTHING`, [INTERNAL_ORG_ID, REGION_SOUTH, hash]);

    // The site as it ships, with this run's gateway stamped into the frames:
    // S1 at the root, S5 under its path, and the offline shell over both
    // (tools/ci/build-pages.ts does the same with the production gateway).
    // Loaded here, not at the top: build-surface pulls in esbuild.
    const { buildSurface } = await import("../ci/build-surface.ts");
    const { builtUrls, serviceWorker } = await import("../ci/offline-shell.ts");
    siteDir = mkdtempSync(join(tmpdir(), "ac-drive1-site-"));
    const s1 = await buildSurface("S1", { gateway: GATEWAY, basePath: "/" });
    const s1Files = builtUrls("S1", s1.outDir);
    cpSync(s1.outDir, siteDir, { recursive: true });
    const s5 = await buildSurface("S5", { gateway: GATEWAY, basePath: S5_PATH });
    const s5Files = builtUrls("S5", s5.outDir);
    cpSync(s5.outDir, join(siteDir, S5_PATH), { recursive: true });
    // The worker is built from the copies the site serves, which the drive owns.
    const served = (files: { url: string }[]) => files.map((f) => ({ url: f.url, file: join(siteDir!, f.url.endsWith("/") ? `${f.url}index.html` : f.url) }));
    writeFileSync(join(siteDir, "sw.js"), serviceWorker([...served(s1Files), ...served(s5Files)]));

    // NOTHING is listening on the gateway's port yet. That is the point.
    site = serveSite(siteDir);
    cdp = await Cdp.launch(chrome);
    const shots = process.env.AC_DRIVE_SHOTS;
    if (shots) { mkdirSync(shots, { recursive: true }); }
    await cdp.openTab(`${SITE}/`);
    if (shots) await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 860, deviceScaleFactor: 1, mobile: false });
    const shot = async (name: string) => {
      if (!shots || !cdp) return;
      const r = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
      writeFileSync(join(shots, `s1-${name}.png`), Buffer.from(r.data, "base64"));
    };
    const pathname = () => cdp!.eval<string>("location.pathname");
    const backToTheDoor = async () => {
      await cdp!.navigate(`${SITE}/`);
      await cdp!.waitFor(`document.getElementById("sign-in-form")`, "the sign-in form");
    };

    // ── 1. THE PAGE IS UP WITH NO GATEWAY AT ALL
    await cdp.waitFor(has("AC Services — Service System"), "the front door, with nothing listening on the gateway");
    await cdp.waitFor(`document.getElementById("sign-in-form")`, "the sign-in form");
    must(!(await cdp.eval<boolean>(has("Dispatch Console"))) && !(await cdp.eval<boolean>(has("Service Manager"))), "no portal is listed before sign-in — where a login belongs is the gateway's answer");
    await shot("01-front-door-no-gateway");
    check(1, "the front door renders, form and all, with nothing listening on the gateway's port");

    // ── 2. the degraded slot carries the declared text from the HTML itself
    const slotText = await cdp.eval<string>(`document.querySelector("ac-degraded")?.textContent ?? ""`);
    must(/signing in will not work yet/i.test(slotText), `the frame carries S1's declared degraded notice, got ${JSON.stringify(slotText.slice(0, 80))}`);
    check(2, "the degraded slot's text is in the frame, so it does not depend on the bundle having loaded");

    // ── 3. a sign-in with the gateway down says so, keeps what was typed, and goes nowhere
    await cdp.eval(fillAndSubmit("sign-in-form", { email: "office.drive1@ac.test", password: PASSWORD }));
    await cdp.waitFor(`document.querySelector(".ac-refusal, [role=alert]") !== null || ${has("could not")} || ${has("failed to fetch")}`, "the page to say the sign-in did not get through", 20_000);
    must(await pathname() === "/", "nobody is sent anywhere on a sign-in that never arrived");
    must((await cdp.eval<string>(`document.getElementById("email").value`)) === "office.drive1@ac.test", "the address the person typed is still there");
    await shot("02-gateway-down");
    check(3, "with the gateway down a sign-in is refused on the page, the form keeps the address, and the browser stays put — nothing is queued");

    // ── the gateway comes up
    gateway = spawn(process.execPath, [join(ROOT, "services/gateway/src/main.ts")], {
      env: { ...process.env, PORT: String(GATEWAY_PORT), DATABASE_URL: DB, AC_DEV_ORIGINS: SITE }, stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout!.on("data", (d) => { log += String(d); });
    gateway.stderr!.on("data", (d) => { log += String(d); });
    await waitHealthy(() => log);

    // ── 4. one surface: the office manager is sent to the office, holding a session the office accepts
    await backToTheDoor();
    await cdp.eval(fillAndSubmit("sign-in-form", { email: "office.drive1@ac.test", password: PASSWORD }));
    await cdp.waitFor(`location.pathname === "/service-manager/"`, "the browser to go to the office", 20_000);
    must(await sessionSurface("office.drive1@ac.test") === "S2", "the session minted is the office's");
    const me = await cdp.eval<number>(`fetch(${JSON.stringify(`${GATEWAY}/me`)}, { credentials: "include", headers: { "x-ac-surface": "S2" } }).then(r => r.status)`);
    must(me === 200, `the office answers session.me with the cookie the front door set, got ${me}`);
    check(4, "the office manager lands on /service-manager/ holding the office's session — the cookie S1 never saw, and S2 accepts");

    // ── 5. several surfaces: the principal is asked, and the pick is where they go
    await backToTheDoor();
    await cdp.eval(fillAndSubmit("sign-in-form", { email: "principal.drive1@ac.test", password: PASSWORD }));
    await cdp.waitFor(`document.getElementById("go-S3") !== null`, "the chooser", 20_000);
    must(await cdp.eval<boolean>(`["go-S2", "go-S3", "go-S4"].every((id) => document.getElementById(id))`), "every surface the principal's role opens is offered");
    must(await pathname() === "/", "nobody is sent anywhere before they choose");
    await shot("03-chooser");
    await cdp.eval(`document.getElementById("go-S3").click()`);
    await cdp.waitFor(`location.pathname === "/dispatch/"`, "the browser to go to dispatch", 20_000);
    must(await sessionSurface("principal.drive1@ac.test") === "S3", "the session minted is the pick's");
    check(5, "a login with several surfaces is asked which; the pick mints that surface's session and the browser goes there");

    // ── 6. a technician is told to give the device, and the box shows the field for it
    await backToTheDoor();
    await cdp.eval(fillAndSubmit("sign-in-form", { email: "tech.drive1@ac.test", password: PASSWORD }));
    await cdp.waitFor(has("This login signs in on a field device"), "the gateway's own words: this login signs in on a field device", 20_000);
    must(await cdp.eval<boolean>(`document.querySelector("[role=alert]") !== null`), "said as a refusal, not just the label beside the box");
    await cdp.eval(`document.getElementById("field-device").click()`);
    await cdp.waitFor(`document.getElementById("hardware-id") !== null`, "the device ID field");
    await shot("04-field-device");
    check(6, "a technician without a device ID is told to give one, and ticking the box shows the field");

    // ── 7. the copy ceiling, on the painted pages
    const pages: string[] = [await cdp.eval<string>(text)];
    await cdp.navigate(`${SITE}/no-such-place`);
    await cdp.waitFor(has("Nothing at this address"), "the not-found page");
    pages.push(await cdp.eval<string>(text));
    const painted = pages.join("\n");
    for (const [re, what] of TIME_CLAIMS) {
      must(!re.test(painted), `S1's painted copy claims ${what}; the ceiling for that is D7a/OQ6 and it is not written yet (F9)`);
    }
    check(7, "no availability or response-time claim on any painted page — the D7a/OQ6 ceiling is unwritten, so it is zero");

    // ── 8. S1 wears the house red, and it is the brand role that put it there
    await backToTheDoor();
    const brand = await cdp.eval<{ token: string; ink: string }>(`(() => {
      const cs = getComputedStyle(document.documentElement);
      return { token: cs.getPropertyValue("--color-brand").trim(), ink: cs.getPropertyValue("--color-text").trim() };
    })()`);
    must(brand.token.length > 0, "the brand role is defined on this surface");
    must(brand.token.toLowerCase() !== brand.ink.toLowerCase(), `S1 is the one surface where the brand does NOT resolve to Ink Black, got ${brand.token}`);
    check(8, "--color-brand is the house red here, not Ink Black — S1 is the one surface that wears it");

    // ── OFFLINE. A crew, a device, a shift and a job — the same calls S2's and S3's screens make.
    const TECH = "d1d00000-0000-0000-0000-000000000003";
    const HARDWARE = `DRIVE1-TABLET-${RUN}`;
    const office = await connectShell({ surfaceId: "S2", baseUrl: GATEWAY, fetch, credentials: { email: "owner.drive1@ac.test", password: PASSWORD } });
    const org = await office.gateway.createOrganization({ name: "Amped Fitness", externalRef: `drive1-${RUN}`, firstRegionNode: { regionId: REGION_SOUTH, name: "Amped / South" } });
    const loc = (await office.gateway.createAccount({ orgId: org.orgId, tier: "location", parentId: org.regionNodeId, name: "Austin" })).id;
    const SITE_NAME = `Austin — Roof ${RUN}`;
    const roof = (await office.gateway.createAccount({ orgId: org.orgId, tier: "site", parentId: loc, name: SITE_NAME })).id;
    const msa = (await office.gateway.createContract({ orgId: org.orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: org.orgId, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true })).id;
    await stateMsaTerms(office.gateway, { contractId: msa, orgId: org.orgId, regionId: REGION_SOUTH, effectiveFrom: "2026-01-01" });
    await office.gateway.transitionContract({ contractId: msa, to: "active" });
    const crewId = (await office.gateway.createCrew({ label: `Door Crew ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
    for (const kind of ["license", "background_check"] as const) {
      const c = await office.gateway.recordCredential({ crewId, kind, identifier: `${kind}-${RUN}`, validFrom: "2026-01-01", validTo: "2027-12-31" });
      await office.gateway.verifyCredential({ credentialId: c.id });
    }
    await admin(`UPDATE users SET crew_id = $2 WHERE id = $1`, [TECH, crewId]);
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    const jobId = (await office.gateway.createJob({ siteId: roof, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: new Date(minute - 30 * 60_000).toISOString(), serviceWindowEnd: new Date(minute + 3 * 3600_000).toISOString() })).id;
    const dispatch = await connectShell({ surfaceId: "S3", baseUrl: GATEWAY, fetch, credentials: { email: "dispatch.drive1@ac.test", password: PASSWORD } });
    must((await dispatch.gateway.assignCrew({ jobId, crewId, orgId: org.orgId, regionId: REGION_SOUTH })).ok, "the crew should clear the gate");
    const deviceId = (await office.gateway.registerDevice({ hardwareId: HARDWARE, kind: "web_fallback", publicKey: Buffer.from("not-yet-checked").toString("base64"), regionId: REGION_SOUTH })).id;
    await office.gateway.grantDeviceShift({ deviceId, crewId, technicianId: TECH, windowStart: new Date(Date.now() - 3600_000).toISOString(), windowEnd: new Date(Date.now() + 8 * 3600_000).toISOString() });
    await office.logout(); await dispatch.logout();

    // ── 9. online: the technician signs in on the device and reaches the job list; the worker holds the pages
    await backToTheDoor();
    await cdp.eval(`document.getElementById("field-device").click()`);
    await cdp.waitFor(`document.getElementById("hardware-id") !== null`, "the device ID field");
    await cdp.eval(fillAndSubmit("sign-in-form", { email: "tech.drive1@ac.test", password: PASSWORD, hardwareId: HARDWARE }));
    await cdp.waitFor(`location.pathname.startsWith(${JSON.stringify(`${S5_PATH}/`)})`, "the browser to go to S5", 20_000);
    await cdp.waitFor(has(SITE_NAME), "the technician's job on Today", 20_000);
    await cdp.waitFor(`navigator.serviceWorker.controller !== null`, "the offline shell to control the page", 20_000);
    await cdp.waitFor(`Object.keys(sessionStorage).some((k) => k.startsWith("ac.s5.reads.") && sessionStorage.getItem(k).includes(${JSON.stringify(SITE_NAME)})) && sessionStorage.getItem("ac.shift.held") !== null`, "the shift and its job list held in the tab");
    await shot("05-technician-online");
    check(9, "a technician signs in at the front door on a field device and reaches Today; the tab holds the shift and the worker holds the pages");

    // ── 10. the network is cut — the browser's switch, and the site and gateway both gone — and the same tab reopens the shift
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    site.closeAllConnections();
    await new Promise<void>((r) => site!.close(() => r()));
    site = undefined;
    gateway.kill("SIGTERM");
    await new Promise<void>((r) => gateway!.once("exit", () => r()));
    await cdp.navigate(`${SITE}/`);
    await cdp.waitFor(`location.pathname.startsWith(${JSON.stringify(`${S5_PATH}/`)})`, "the front door to send the held shift on to S5", 20_000);
    await cdp.waitFor(has(SITE_NAME), "the job list, from the tab, with no network", 20_000);
    await cdp.waitFor(`document.querySelector("ac-degraded") && !document.querySelector("ac-degraded").hidden`, "the page to say it is offline");
    must(!(await cdp.eval<boolean>(`!!document.getElementById("login-form")`)), "no sign-in asked for");
    await shot("06-technician-offline");
    await cdp.eval(`document.getElementById("clock-in").click()`);
    await cdp.waitFor(`Object.keys(localStorage).some((k) => k.startsWith("ac.s5.pending.") && JSON.parse(localStorage.getItem(k)).length === 1)`, "the clock-in queued on the device");
    check(10, "offline, the same tab reloaded at / lands on S5's job list from the cache — no sign-in — and a tap is queued on the device");

    // ── 11. a new tab, offline: nothing held, so a plain refusal — no form, no spinner
    await cdp.openTab(`${SITE}/`, async () => {
      await cdp!.send("Network.enable");
      await cdp!.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    });
    await cdp.waitFor(has("No signal"), "the offline refusal", 20_000);
    must(await cdp.eval<boolean>(has("this tab holds no shift to open offline")), "it says why");
    must(await pathname() === "/", "nobody is sent anywhere");
    must(!(await cdp.eval<boolean>(`!!document.getElementById("sign-in-form") || ${has("Signing in…")}`)), "no form to submit, no spinner");
    await shot("07-new-tab-offline");
    check(11, "offline, a new tab holds no shift: the front door says so plainly, with no form and no spinner");

    console.log(`\ndrive-s1: ${passed} checks passed`);
  } finally {
    if (cdp) await cdp.close();
    site?.closeAllConnections();
    site?.close();
    if (siteDir) rmSync(siteDir, { recursive: true, force: true });
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
        try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } catch (e) { console.warn(`drive-s1: could not drop ${SCRATCH}: ${String(e)}`); } finally { c.release(); }
      }
    }
    await admin0.end().catch(() => {});
  }
}

main().catch((e) => { console.error(`\ndrive-s1 FAILED after ${passed} checks\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
