/**
 * S5 THROUGH A REAL BROWSER — a technician's shift, the DOM half of
 * test/integration/s3-s5.test.ts (which proves the same loop over the wire).
 *
 *   DATABASE_URL=postgres://... node tools/ci/drive-s5.ts
 *
 * The office registers a device and grants a shift; dispatch assigns two
 * crews a job each. On a phone-sized page: a technician with no grant on the
 * device is refused at sign-in; the granted technician signs in to Today with
 * their own job and not the other crew's; the job's moves are gated on the
 * shift clock until they clock in; en route → on site → in progress land in
 * the row through the offline queue; a checklist item and a part reach their
 * tables; the wrap-up takes two photos through the real file input and a
 * signature drawn with a pointer, and the job completes with its wrap-up row,
 * its media and its labour; the timesheet shows the shift.
 *
 * Same scratch-database discipline as the other drives: create, migrate,
 * drive, drop. Photos go to a scratch directory (AC_STORAGE_DIR).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { Cdp, findChrome } from "./cdp.ts";
import { SURFACE_PATHS } from "../../packages/contracts/src/surfaces.ts";
import { stateMsaTerms } from "../../packages/domain/src/inheritance/fixtures/msa-terms.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GIVEN_DB = process.env.DATABASE_URL;
const dbName = (url: string): string => new URL(url).pathname.replace(/^\//, "");
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const GATEWAY_PORT = 27600 + Math.floor(Math.random() * 400);
const SITE_PORT = 28100 + Math.floor(Math.random() * 400);
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
/** The fallback lives at its mount path (SURFACE_PATHS.S5), as the unified Pages site serves it. */
const FIELD = `${SITE}${SURFACE_PATHS.S5}`;
const RUN = Date.now().toString(36).toUpperCase();
const SCRATCH = process.env.AC_DRIVE_DB ?? `ac_drive5_${RUN.toLowerCase()}`;
const PASSWORD = "correct horse battery staple";
const HARDWARE = `phone-${RUN}`;
const U = (n: number) => `d5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), DISP = U(2), TECH = U(3), TECH_B = U(4);
const OWNER_EMAIL = "owner.drive5@ac.test", DISP_EMAIL = "disp.drive5@ac.test", TECH_EMAIL = "tech.drive5@ac.test", TECH_B_EMAIL = "tech.b.drive5@ac.test";

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
const click = (selector: string) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("nothing at ${selector.replace(/"/g, "'")}"); el.click(); return true; })()`;
const text = `(document.body?.innerText ?? "")`;
/** Case-insensitive: a StatusPill's word is upper-cased by the stylesheet, and innerText reports what is painted. */
const has = (needle: string) => `${text}.toLowerCase().includes(${JSON.stringify(needle.toLowerCase())})`;

/** Poll the database until a row says what the page already claims — the queue flushes on its own tick. */
const until = async (q: () => Promise<boolean>, what: string, ms = 15_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!(await q())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

async function main(): Promise<void> {
  const maySkip = !process.env.CI || process.env.AC_DRIVE_OPTIONAL === "1";
  if (!GIVEN_DB) {
    if (maySkip) { console.log("drive-s5: DATABASE_URL not set — skipped"); return; }
    throw new Error("DATABASE_URL is not set, and a skip in CI is a check that stopped checking");
  }
  const chrome = findChrome();
  if (!chrome) {
    if (maySkip) { console.log("drive-s5: no chrome found — skipped"); return; }
    throw new Error("no chrome found and this is CI. Set AC_CHROME, or AC_DRIVE_OPTIONAL=1 to accept the gap deliberately");
  }
  console.log(`drive-s5: ${chrome}`);

  const ownScratch = !process.env.AC_DRIVE_DB;
  const maintenance = withDb(GIVEN_DB, dbName(GIVEN_DB) === "postgres" ? "template1" : "postgres");
  const DB = withDb(GIVEN_DB, SCRATCH);
  const admin0 = createPool(maintenance, "ac-drive5-admin");
  admin0.on("error", () => {});
  try {
    if (ownScratch) {
      const c = await admin0.connect();
      try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); }
      console.log(`drive-s5: scratch database ${SCRATCH}`);
      const mig = spawn(process.execPath, [join(ROOT, "tools/ci/migrate.ts")], { env: { ...process.env, DATABASE_URL: DB }, stdio: ["ignore", "pipe", "pipe"] });
      let mlog = "";
      mig.stdout!.on("data", (d) => { mlog += String(d); });
      mig.stderr!.on("data", (d) => { mlog += String(d); });
      const mcode = await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1)));
      must(mcode === 0, `migrate failed on the scratch database:\n${mlog}`);
    }
  } catch (e) { await admin0.end().catch(() => {}); throw e; }

  const pool: Pool = createPool(DB, "ac-drive5");
  pool.on("error", () => {});
  const admin = async (sql: string, params: unknown[] = []) => {
    const c = await pool.connect();
    try { return (await c.query(sql, params)).rows; } finally { c.release(); }
  };

  const storage = mkdtempSync(join(tmpdir(), "ac-drive5-store-"));
  const files = mkdtempSync(join(tmpdir(), "ac-drive5-photos-"));
  let gateway: ChildProcess | undefined;
  let site: Server | undefined;
  let cdp: Cdp | undefined;
  let log = "";
  try {
    await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
    const hash = hashPassword(PASSWORD);
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ($1,$2,$3,'internal',$4,'Drive Owner','["account_owner"]','parent',$2,$5,true),
             ($6,$2,$3,'internal',$7,'Dispatcher','["dispatcher"]','region',$3,$5,true),
             ($8,$2,$3,'internal',$9,'Tech One','["technician"]','region',$3,$5,true),
             ($10,$2,$3,'internal',$11,'Tech Two','["technician"]','region',$3,$5,true)`,
      [OWNER, INTERNAL_ORG_ID, REGION_SOUTH, OWNER_EMAIL, hash, DISP, DISP_EMAIL, TECH, TECH_EMAIL, TECH_B, TECH_B_EMAIL]);

    gateway = spawn(process.execPath, [join(ROOT, "apps/gateway/src/main.ts")], {
      env: { ...process.env, PORT: String(GATEWAY_PORT), DATABASE_URL: DB, AC_DEV_ORIGINS: SITE, AC_STORAGE_DIR: storage }, stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout!.on("data", (d) => { log += String(d); });
    gateway.stderr!.on("data", (d) => { log += String(d); });
    await waitHealthy(() => log);

    // The office signs in the customer, the crews and the device; dispatch assigns — the same calls S2's and S3's screens make.
    const s2 = await connectShell({ surfaceId: "S2", baseUrl: GATEWAY, fetch, credentials: { email: OWNER_EMAIL, password: PASSWORD } });
    const org = await s2.gateway.createOrganization({ name: "Amped Fitness", externalRef: `drive5-${RUN}`, firstRegionNode: { regionId: REGION_SOUTH, name: "Amped / South" } });
    const loc = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "location", parentId: org.regionNodeId, name: "Austin" })).id;
    const roof = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "site", parentId: loc, name: `Austin — Roof ${RUN}` })).id;
    const ahu = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "site", parentId: loc, name: `Austin — Basement AHU ${RUN}` })).id;
    const msa = (await s2.gateway.createContract({ orgId: org.orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: org.orgId, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true })).id;
    await stateMsaTerms(s2.gateway, { contractId: msa, orgId: org.orgId, regionId: REGION_SOUTH, effectiveFrom: "2026-01-01" });
    await s2.gateway.transitionContract({ contractId: msa, to: "active" });
    const crew = async (label: string): Promise<string> => {
      const id = (await s2.gateway.createCrew({ label, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
      for (const kind of ["license", "background_check"] as const) {
        const c = await s2.gateway.recordCredential({ crewId: id, kind, identifier: `${kind}-${label}`, validFrom: "2026-01-01", validTo: "2027-12-31" });
        await s2.gateway.verifyCredential({ credentialId: c.id });
      }
      return id;
    };
    const crewA = await crew(`Crew One ${RUN}`), crewB = await crew(`Crew Two ${RUN}`);
    await admin(`UPDATE users SET crew_id = $2 WHERE id = $1`, [TECH, crewA]);
    await admin(`UPDATE users SET crew_id = $2 WHERE id = $1`, [TECH_B, crewB]);

    // Today's window, inside the shift: the job is this shift's work.
    // Whole minutes, as S3's datetime-local sends them: the clearance is stored to the second, and a window
    // carrying milliseconds past it reads as a certificate that lapses mid-window.
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    const ws = new Date(minute - 30 * 60_000).toISOString(), we = new Date(minute + 3 * 3600_000).toISOString();
    const jobA = (await s2.gateway.createJob({ siteId: roof, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: ws, serviceWindowEnd: we })).id;
    const jobB = (await s2.gateway.createJob({ siteId: ahu, serviceCode: "HVAC-REPAIR", priority: "routine", serviceWindowStart: ws, serviceWindowEnd: we })).id;
    const s3 = await connectShell({ surfaceId: "S3", baseUrl: GATEWAY, fetch, credentials: { email: DISP_EMAIL, password: PASSWORD } });
    must((await s3.gateway.assignCrew({ jobId: jobA, crewId: crewA, orgId: org.orgId, regionId: REGION_SOUTH })).ok, "crew one should clear the gate");
    must((await s3.gateway.assignCrew({ jobId: jobB, crewId: crewB, orgId: org.orgId, regionId: REGION_SOUTH })).ok, "crew two should clear the gate");

    const deviceId = (await s2.gateway.registerDevice({ hardwareId: HARDWARE, kind: "web_fallback", publicKey: Buffer.from("not-yet-checked").toString("base64"), regionId: REGION_SOUTH })).id;
    const grantId = (await s2.gateway.grantDeviceShift({ deviceId, crewId: crewA, technicianId: TECH, windowStart: new Date(Date.now() - 3600_000).toISOString(), windowEnd: new Date(Date.now() + 8 * 3600_000).toISOString() })).id;
    await s2.logout(); await s3.logout();

    const build = spawn(process.execPath, [join(ROOT, "tools/ci/build-surface.ts"), "S5"], { env: { ...process.env, AC_GATEWAY: GATEWAY }, stdio: ["ignore", "pipe", "pipe"] });
    let blog = "";
    build.stdout!.on("data", (d) => { blog += String(d); });
    build.stderr!.on("data", (d) => { blog += String(d); });
    must((await new Promise<number>((r) => build.on("exit", (c) => r(c ?? 1)))) === 0, `build-surface S5 failed:\n${blog}`);

    site = serveDist(join(ROOT, "apps/s5-technician/dist"));
    cdp = await Cdp.launch(chrome);
    await cdp.openTab(`${FIELD}/login`);
    // A phone, held upright: the field density is drawn for this.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const shots = process.env.AC_DRIVE_SHOTS;
    if (shots) mkdirSync(shots, { recursive: true });
    const shot = async (name: string) => {
      if (!shots || !cdp) return;
      const r = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
      writeFileSync(join(shots, `s5-${name}.png`), Buffer.from(r.data, "base64"));
    };

    // ── 1. boots to the three-field device login
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form");
    must(await cdp.eval<boolean>(`["hardwareId","email","password"].every(n => !!document.querySelector('#login-form [name="' + n + '"]'))`), "device, email and password");
    await shot("01-login");
    check(1, "S5 boots to the device login: hardware ID, email, password");

    // ── 2. a technician with no grant on this device is refused, and stays on the form
    await cdp.eval(fillAndSubmit("login-form", { hardwareId: HARDWARE, email: TECH_B_EMAIL, password: PASSWORD }));
    await cdp.waitFor(`document.querySelector(".ac-notice, .ac-refusal")`, "the refusal");
    must(await cdp.eval<boolean>(`!!document.getElementById("login-form")`), "REGRESSION: signed in without a grant");
    await shot("02-no-grant");
    check(2, "a technician with no shift grant on this device is refused at sign-in");

    // ── 3. the granted technician signs in to Today: their job, and not the other crew's
    await cdp.eval(fillAndSubmit("login-form", { hardwareId: HARDWARE, email: TECH_EMAIL, password: PASSWORD }));
    await cdp.waitFor(`!document.getElementById("login-form") && ${has(`Today — Crew One ${RUN}`)}`, "Today");
    await cdp.waitFor(has("Austin — Roof"), "the shift's job");
    must(!(await cdp.eval<boolean>(has("Basement AHU"))), "REGRESSION: another crew's job on this shift's board");
    await shot("03-today");
    check(3, "signed in on the grant: Today for Crew One, its job on it, and not Crew Two's");

    // ── 4. moves wait for the shift clock; Clock in writes a punch on this grant
    must(await cdp.eval<boolean>(`(() => { const b = document.getElementById("card-${jobA}-en_route"); return !!b && (b.disabled || b.getAttribute("aria-disabled") === "true"); })()`), "the first move is gated before clock-in");
    await cdp.eval(click("#clock-in"));
    await until(async () => (await admin(`SELECT count(*)::int AS n FROM shift_punches WHERE grant_id = $1 AND kind = 'in'`, [grantId]))[0]!.n === 1, "the clock-in punch");
    await cdp.waitFor(`(() => { const b = document.getElementById("card-${jobA}-en_route"); return !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true"; })()`, "the first move to open");
    await shot("04-clocked-in");
    check(4, "the job's moves wait for the shift clock; Clock in writes one punch on this grant and opens them");

    // ── 5. en route from the card; on site and in progress from the job — each reaches the row through the queue
    const stateIs = (s: string) => async () => (await admin(`SELECT state FROM jobs WHERE id = $1`, [jobA]))[0]!.state === s;
    await cdp.eval(click(`#card-${jobA}-en_route`));
    await until(stateIs("en_route"), "en_route in the row");
    await cdp.eval(click(".s5-card__link"));
    await cdp.waitFor(`document.getElementById("to-on_site")`, "the job's next move");
    await cdp.eval(click("#to-on_site"));
    await until(stateIs("on_site"), "on_site in the row");
    await cdp.waitFor(`document.getElementById("to-in_progress")`, "in progress offered");
    await cdp.eval(click("#to-in_progress"));
    await until(stateIs("in_progress"), "in_progress in the row");
    const moves = (await admin(`SELECT to_state FROM job_state_events WHERE job_id = $1 ORDER BY created_at`, [jobA])).map((r) => r.to_state as string);
    must(["en_route", "on_site", "in_progress"].every((s) => moves.includes(s)), `each move an event, got ${moves.join(",")}`);
    check(5, "en route, on site, in progress: each tap reaches the job's row and its event log through the offline queue");

    // ── 6. a checklist item and a part reach their tables
    await cdp.eval(click("#check-ppe_donned"));
    await until(async () => (await admin(`SELECT count(*)::int AS n FROM checklist_items WHERE job_id = $1 AND item_key = 'ppe_donned'`, [jobA]))[0]!.n === 1, "the checklist row");
    await cdp.waitFor(`document.getElementById("done-ppe_donned")`, "the item marked done");
    await cdp.eval(fillAndSubmit("parts-form", { partSku: `CONT-40A-${RUN}`, quantity: "1", source: "truck" }));
    await until(async () => (await admin(`SELECT count(*)::int AS n FROM parts_used WHERE job_id = $1 AND part_sku = $2`, [jobA, `CONT-40A-${RUN}`]))[0]!.n === 1, "the part row");
    await shot("06-job");
    check(6, "checklist: PPE marked done, one row; parts: a contactor added from the truck, one row");

    // ── 7. wrap-up: two photos through the real file input, a signature drawn with a pointer
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Wrap up").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("add-photo") && document.getElementById("signature-pad")`, "the wrap-up form");
    must(await cdp.eval<boolean>(`document.getElementById("submit-wrap-up").disabled || document.getElementById("submit-wrap-up").getAttribute("aria-disabled") === "true"`), "submit waits for photos and a signature");
    // Two JPEGs, drawn by the browser itself so no binary lives in the repository.
    for (const [i, colour] of [[1, "#4a6"], [2, "#a64"]] as const) {
      const b64 = await cdp.eval<string>(`(() => { const c = document.createElement("canvas"); c.width = 640; c.height = 480; const g = c.getContext("2d"); g.fillStyle = ${JSON.stringify(colour)}; g.fillRect(0, 0, 640, 480); return c.toDataURL("image/jpeg", 0.8).split(",")[1]; })()`);
      writeFileSync(join(files, `unit-${i}.jpg`), Buffer.from(b64, "base64"));
    }
    const input = await cdp.send("Runtime.evaluate", { expression: `document.getElementById("add-photo")` }) as { result: { objectId: string } };
    await cdp.send("DOM.setFileInputFiles", { objectId: input.result.objectId, files: [join(files, "unit-1.jpg"), join(files, "unit-2.jpg")] });
    await cdp.waitFor(`document.querySelectorAll('[id^="remove-"]').length === 2`, "two photos on the form");
    await cdp.eval(`(() => { const t = document.getElementById("notes"); t.value = "Replaced the contactor; unit cooling at 18F split."; t.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await cdp.eval(`document.getElementById("signature-pad").scrollIntoView({ block: "center" })`);
    const pad = await cdp.eval<{ x: number; y: number; w: number; h: number }>(`(() => { const r = document.getElementById("signature-pad").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const mouse = (type: string, fx: number, fy: number) => cdp!.send("Input.dispatchMouseEvent", { type, x: pad.x + pad.w * fx, y: pad.y + pad.h * fy, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    await mouse("mousePressed", 0.15, 0.6);
    for (let k = 1; k <= 12; k++) await mouse("mouseMoved", 0.15 + k * 0.06, 0.6 - Math.sin(k / 2) * 0.25);
    await mouse("mouseReleased", 0.87, 0.5);
    await cdp.waitFor(`!document.getElementById("submit-wrap-up").disabled && document.getElementById("submit-wrap-up").getAttribute("aria-disabled") !== "true"`, "submit to open");
    await shot("07-wrap-up");
    check(7, "wrap-up: submit waits; two photos through the camera input and a signature drawn with a pointer open it");

    // ── 8. submit → the wrap-up row, the media stored, the job complete
    await cdp.eval(click("#submit-wrap-up"));
    await until(async () => (await admin(`SELECT count(*)::int AS n FROM job_wrap_ups WHERE job_id = $1`, [jobA]))[0]!.n === 1, "the wrap-up row", 30_000);
    const wrap = (await admin(`SELECT outcome, notes, signature_media_id, crew_id, submitted_by FROM job_wrap_ups WHERE job_id = $1`, [jobA]))[0]!;
    must(wrap.outcome === "complete" && /contactor/.test(String(wrap.notes)) && wrap.signature_media_id !== null && wrap.crew_id === crewA && wrap.submitted_by === TECH, `the wrap-up row, got ${JSON.stringify(wrap)}`);
    const media = (await admin(`SELECT kind, count(*)::int AS n FROM job_media WHERE job_id = $1 GROUP BY kind ORDER BY kind`, [jobA])).map((r) => `${r.kind}:${r.n}`).join(",");
    must(/photo:2/.test(media) && /signature:1/.test(media), `two photos and a signature, got ${media}`);
    await until(stateIs("complete"), "the job complete");
    await cdp.waitFor(`!${has("waiting to send")}`, "the outbox to drain");
    await shot("08-submitted");
    check(8, "submitted: one wrap-up row signed and on this crew, two photos and a signature stored, the job complete");

    // ── 9. the timesheet shows the shift running
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Timesheet").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("week-total")`, "the timesheet");
    await shot("09-timesheet");
    check(9, "Timesheet: this week's punches and a running total");

    console.log(`\ndrive-s5: ${passed} checks passed`);
  } catch (e) {
    if (cdp) console.error(`\n--- page at failure ---\n${await cdp.eval<string>(text).catch(() => "(unreadable)")}\n---\n--- gateway ---\n${log.slice(-3000)}\n---`);
    throw e;
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
    rmSync(storage, { recursive: true, force: true });
    rmSync(files, { recursive: true, force: true });
    if (ownScratch) {
      const c = await admin0.connect().catch(() => null);
      if (c) {
        try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } catch (e) { console.warn(`drive-s5: could not drop ${SCRATCH}: ${String(e)}`); } finally { c.release(); }
      }
    }
    await admin0.end().catch(() => {});
  }
}

main().catch((e) => { console.error(`\ndrive-s5 FAILED after ${passed} checks\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
