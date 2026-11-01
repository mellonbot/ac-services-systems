/**
 * S3 THROUGH A REAL BROWSER — the dispatcher's day, the DOM half of
 * test/integration/s3-s5.test.ts (which proves the same loop over the wire).
 *
 *   DATABASE_URL=postgres://... node tools/drive/drive-s3.ts
 *
 * A South dispatcher signs in and lands on the board; takes a phoned-in call
 * through New job and arrives at the gated door with the job open; sees the
 * crew whose licence has lapsed refused with a reason and no Assign button,
 * and the cleared crew with one; assigns, lands on Job Detail with the crew
 * named and the row written; leaves an internal note; releases the crew
 * through the confirm and sees the job back to Unassigned; finds the West
 * job nowhere on the board and a deep link to it answered "not on this
 * board"; signs out.
 *
 * Same scratch-database discipline as the other drives: create, migrate,
 * drive, drop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../services/gateway/src/pg-tx.ts";
import { hashPassword } from "../../services/gateway/src/auth.ts";
import { connectShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH, REGION_WEST } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { Cdp, findChrome } from "./cdp.ts";
import { SURFACE_PATHS } from "../../packages/contracts/src/surfaces.ts";
import { stateMsaTerms } from "../../packages/domain/src/inheritance/fixtures/msa-terms.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GIVEN_DB = process.env.DATABASE_URL;
const dbName = (url: string): string => new URL(url).pathname.replace(/^\//, "");
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const GATEWAY_PORT = 25600 + Math.floor(Math.random() * 400);
const SITE_PORT = 26100 + Math.floor(Math.random() * 400);
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
/** The console lives at its mount path (SURFACE_PATHS.S3), as the unified Pages site serves it. */
const CONSOLE = `${SITE}${SURFACE_PATHS.S3}`;
const RUN = Date.now().toString(36).toUpperCase();
const SCRATCH = process.env.AC_DRIVE_DB ?? `ac_drive3_${RUN.toLowerCase()}`;
const PASSWORD = "correct horse battery staple";
const OWNER = "d3000000-0000-0000-0000-000000000001", DISP = "d3000000-0000-0000-0000-000000000002";
const OWNER_EMAIL = "owner.drive3@ac.test", DISP_EMAIL = "disp.south.drive3@ac.test";

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

async function main(): Promise<void> {
  const maySkip = !process.env.CI || process.env.AC_DRIVE_OPTIONAL === "1";
  if (!GIVEN_DB) {
    if (maySkip) { console.log("drive-s3: DATABASE_URL not set — skipped"); return; }
    throw new Error("DATABASE_URL is not set, and a skip in CI is a check that stopped checking");
  }
  const chrome = findChrome();
  if (!chrome) {
    if (maySkip) { console.log("drive-s3: no chrome found — skipped"); return; }
    throw new Error("no chrome found and this is CI. Set AC_CHROME, or AC_DRIVE_OPTIONAL=1 to accept the gap deliberately");
  }
  console.log(`drive-s3: ${chrome}`);

  const ownScratch = !process.env.AC_DRIVE_DB;
  const maintenance = withDb(GIVEN_DB, dbName(GIVEN_DB) === "postgres" ? "template1" : "postgres");
  const DB = withDb(GIVEN_DB, SCRATCH);
  const admin0 = createPool(maintenance, "ac-drive3-admin");
  admin0.on("error", () => {});
  try {
    if (ownScratch) {
      const c = await admin0.connect();
      try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); }
      console.log(`drive-s3: scratch database ${SCRATCH}`);
      const mig = spawn(process.execPath, [join(ROOT, "tools/ci/migrate.ts")], { env: { ...process.env, DATABASE_URL: DB }, stdio: ["ignore", "pipe", "pipe"] });
      let mlog = "";
      mig.stdout!.on("data", (d) => { mlog += String(d); });
      mig.stderr!.on("data", (d) => { mlog += String(d); });
      const mcode = await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1)));
      must(mcode === 0, `migrate failed on the scratch database:\n${mlog}`);
    }
  } catch (e) { await admin0.end().catch(() => {}); throw e; }

  const pool: Pool = createPool(DB, "ac-drive3");
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
    await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South'), ($2,'WEST','West') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH, REGION_WEST]);
    const hash = hashPassword(PASSWORD);
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ($1,$2,$3,'internal',$4,'Drive Owner','["account_owner"]','parent',$2,$5,true),
             ($6,$2,$3,'internal',$7,'South Dispatcher','["dispatcher"]','region',$3,$5,true)`, [OWNER, INTERNAL_ORG_ID, REGION_SOUTH, OWNER_EMAIL, hash, DISP, DISP_EMAIL]);

    gateway = spawn(process.execPath, [join(ROOT, "services/gateway/src/main.ts")], {
      env: { ...process.env, PORT: String(GATEWAY_PORT), DATABASE_URL: DB, AC_DEV_ORIGINS: SITE }, stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout!.on("data", (d) => { log += String(d); });
    gateway.stderr!.on("data", (d) => { log += String(d); });
    await waitHealthy(() => log);

    // The office signs the customers and the crews in through the real operations — the same calls S2's screens make.
    const s2 = await connectShell({ surfaceId: "S2", baseUrl: GATEWAY, fetch, credentials: { email: OWNER_EMAIL, password: PASSWORD } });
    const customer = async (name: string, regionId: string, siteName: string): Promise<{ orgId: string; siteId: string }> => {
      const org = await s2.gateway.createOrganization({ name, externalRef: `drive3-${name}-${RUN}`, firstRegionNode: { regionId, name: `${name} / region` } });
      const loc = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "location", parentId: org.regionNodeId, name: `${name} location` })).id;
      const siteId = (await s2.gateway.createAccount({ orgId: org.orgId, tier: "site", parentId: loc, name: siteName })).id;
      const msa = (await s2.gateway.createContract({ orgId: org.orgId, regionId, scopeTier: "parent", scopeId: org.orgId, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true })).id;
      await stateMsaTerms(s2.gateway, { contractId: msa, orgId: org.orgId, regionId, effectiveFrom: "2026-01-01" });
      await s2.gateway.transitionContract({ contractId: msa, to: "active" });
      return { orgId: org.orgId, siteId };
    };
    const south = await customer("Amped Fitness", REGION_SOUTH, `Austin — Roof ${RUN}`);
    const west = await customer("Westside Clinic", REGION_WEST, `Phoenix — Mech Room ${RUN}`);

    const crew = async (label: string, licenceTo: string): Promise<string> => {
      const id = (await s2.gateway.createCrew({ label, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
      for (const [kind, validTo] of [["license", licenceTo], ["background_check", "2027-12-31"]] as const) {
        const c = await s2.gateway.recordCredential({ crewId: id, kind, identifier: `${kind}-${label}`, validFrom: "2026-01-01", validTo });
        await s2.gateway.verifyCredential({ credentialId: c.id });
      }
      return id;
    };
    const cleared = await crew(`Crew Cleared ${RUN}`, "2027-12-31");
    const lapsed = await crew(`Crew Lapsed ${RUN}`, "2026-06-30");

    const t = new Date(Date.now() + 24 * 3600_000);
    const ws = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 15)).toISOString();
    const we = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 19)).toISOString();
    const westJob = (await s2.gateway.createJob({ siteId: west.siteId, serviceCode: "HVAC-REPAIR", priority: "routine", serviceWindowStart: ws, serviceWindowEnd: we })).id;
    await s2.logout();

    const build = spawn(process.execPath, [join(ROOT, "tools/ci/build-surface.ts"), "S3"], { env: { ...process.env, AC_GATEWAY: GATEWAY }, stdio: ["ignore", "pipe", "pipe"] });
    let blog = "";
    build.stdout!.on("data", (d) => { blog += String(d); });
    build.stderr!.on("data", (d) => { blog += String(d); });
    must((await new Promise<number>((r) => build.on("exit", (c) => r(c ?? 1)))) === 0, `build-surface S3 failed:\n${blog}`);

    site = serveDist(join(ROOT, "apps/s3-dispatch-console/dist"));
    cdp = await Cdp.launch(chrome);
    await cdp.openTab(`${CONSOLE}/login`);
    const shots = process.env.AC_DRIVE_SHOTS;
    if (shots) { mkdirSync(shots, { recursive: true }); await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); }
    const shot = async (name: string) => {
      if (!shots || !cdp) return;
      const r = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
      writeFileSync(join(shots, `s3-${name}.png`), Buffer.from(r.data, "base64"));
    };

    // ── 1. the console boots to a login form, not the preview: a gateway answered
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form");
    must(!(await cdp.eval<boolean>(`!!document.getElementById("preview-banner")`)), "REGRESSION: the preview's sample data with a live gateway");
    await shot("01-login");
    check(1, "S3 boots to a login form against a live gateway — no preview banner, no sample data");

    // ── 2. the dispatcher signs in and lands on the board; the West job is not on it
    await cdp.eval(fillAndSubmit("login-form", { email: DISP_EMAIL, password: PASSWORD }));
    await cdp.waitFor(`!document.getElementById("login-form") && document.querySelector('[aria-current="page"]')?.textContent.trim() === "Dispatch Board"`, "the board");
    must(!(await cdp.eval<boolean>(has("Phoenix"))), "REGRESSION: another region's site on the South board");
    await shot("02-board");
    check(2, "signed in, landed on the Dispatch Board — and nothing of the West region on it");

    // ── 3. New job: a phoned-in call at the South site opens and goes straight to the gated door
    await cdp.eval(click("#new-job"));
    await cdp.waitFor(`document.getElementById("new-job-form")`, "the new-job form");
    const siteOptions = await cdp.eval<string>(`[...document.querySelectorAll("#new-job-site option")].map(o => o.textContent).join("|")`);
    must(siteOptions.includes("Austin — Roof") && !siteOptions.includes("Phoenix"), `the site list is the dispatcher's region alone, got ${siteOptions}`);
    await cdp.eval(fillAndSubmit("new-job-form", { siteId: south.siteId, serviceCode: "HVAC-REPAIR", priority: "urgent" }));
    await cdp.waitFor(`${has("is open, response due")} && ${has("Candidate crews")}`, "the job opened and the dispatch screen");
    const job = (await admin(`SELECT id, state, region_id FROM jobs WHERE site_id = $1`, [south.siteId]))[0]!;
    must(job.state === "created" && job.region_id === REGION_SOUTH, `the job row, got ${JSON.stringify(job)}`);
    must((await cdp.eval<string>(`location.pathname`)).endsWith(`/job/${job.id}`), "the gated door for this job");
    await shot("03-job-opened");
    check(3, "New job: South sites only; the call opens a job in the South region and lands on its gated door");

    // ── 4. the gate, painted: the lapsed crew carries its reason and no Assign; the cleared crew has one
    await cdp.waitFor(`${has(`Crew Cleared ${RUN}`)} && ${has(`Crew Lapsed ${RUN}`)}`, "both crews as candidates");
    must(await cdp.eval<boolean>(`!!document.getElementById("assign-${cleared}")`), "Assign for the cleared crew");
    must(!(await cdp.eval<boolean>(`!!document.getElementById("assign-${lapsed}")`)), "REGRESSION: an Assign button for a crew the gate refuses");
    const lapsedRow = await cdp.eval<string>(`[...document.querySelectorAll(".s3-candidate")].find(li => li.innerText.includes(${JSON.stringify(`Crew Lapsed ${RUN}`)})).innerText`);
    must(/licen[cs]e/i.test(lapsedRow), `the lapsed crew's reason names the licence, got ${JSON.stringify(lapsedRow)}`);
    await shot("04-gate");
    check(4, "the gate, painted: the lapsed crew shows its reason and no Assign button; the cleared crew can be assigned");

    // ── 5. Assign → Job Detail, the crew named, the assignment row written, the job assigned
    await cdp.eval(click(`#assign-${cleared}`));
    await cdp.waitFor(`${has("assigned to")} && document.getElementById("release-open")`, "Job Detail with the crew on it");
    must((await cdp.eval<string>(`location.pathname`)).endsWith(`/jobs/${job.id}`), "Job Detail for this job");
    const a = (await admin(`SELECT crew_id FROM assignments WHERE job_id = $1 AND released_at IS NULL`, [job.id]))[0];
    must(a?.crew_id === cleared, "one live assignment, to the cleared crew");
    must((await admin(`SELECT state FROM jobs WHERE id = $1`, [job.id]))[0]!.state === "assigned", "the job moved to assigned");
    await shot("05-assigned");
    check(5, "Assign: lands on Job Detail with Release offered; the assignment row is the cleared crew's; the job is assigned");

    // ── 6. an internal note, from the page to the row and back onto the page
    const note = `Gate code 4471 — ask for Dana ${RUN}`;
    await cdp.eval(`(() => { const i = document.querySelector('input[aria-label="Internal note"]'); i.value = ${JSON.stringify(note)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await cdp.eval(click("#note-add"));
    await cdp.waitFor(has(note), "the note on the page");
    must((await admin(`SELECT count(*)::int AS n FROM job_notes WHERE job_id = $1 AND body = $2`, [job.id, note]))[0]!.n === 1, "one note row");
    await shot("06-note");
    check(6, "Internal note: written from the page, one row, shown back under Internal notes");

    // ── 7. Release asks first; "Keep them on it" changes nothing; "Release crew" sends the job back to Unassigned
    await cdp.eval(click("#release-open"));
    await cdp.waitFor(`document.getElementById("release-confirm")`, "the release confirm");
    await cdp.eval(click("#release-keep"));
    await cdp.waitFor(`!document.getElementById("release-confirm") && document.getElementById("release-open")`, "the confirm dismissed");
    must((await admin(`SELECT count(*)::int AS n FROM assignments WHERE job_id = $1 AND released_at IS NULL`, [job.id]))[0]!.n === 1, "Keep changed nothing");
    await cdp.eval(click("#release-open"));
    await cdp.waitFor(`document.getElementById("release-yes")`, "the release confirm again");
    await cdp.eval(click("#release-yes"));
    await cdp.waitFor(`${has(`released from job ${job.id}`)} && !document.getElementById("release-confirm")`, "the release receipt");
    must((await admin(`SELECT count(*)::int AS n FROM assignments WHERE job_id = $1 AND released_at IS NULL`, [job.id]))[0]!.n === 0, "no live assignment");
    must((await admin(`SELECT state FROM jobs WHERE id = $1`, [job.id]))[0]!.state === "created", "the job reopened for dispatch");
    await shot("07-released");
    check(7, "Release: asks first, Keep changes nothing, Release crew sends the job back to Unassigned in the row and on the page");

    // ── 8. a deep link to the West job's gated door: not on this board, and nothing to assign
    await cdp.navigate(`${CONSOLE}/job/${westJob}`);
    await cdp.waitFor(`${has("is not on this board")} || ${has("Candidate crews")}`, "the West job's door");
    must(await cdp.eval<boolean>(has("is not on this board")), "REGRESSION: another region's job opened at the South dispatcher's door");
    must(!(await cdp.eval<boolean>(`!!document.querySelector('[id^="assign-"]')`)), "REGRESSION: an Assign button for another region's job");
    await shot("08-west-refused");
    check(8, "a deep link to the West job: not on this board, and no Assign button");

    // ── 9. sign out → the login form
    await cdp.eval(click(".ac-nav__signout"));
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form after sign-out");
    check(9, "sign out returns to the login form");

    console.log(`\ndrive-s3: ${passed} checks passed`);
  } catch (e) {
    if (cdp) console.error(`\n--- page at failure ---\n${await cdp.eval<string>(text).catch(() => "(unreadable)")}\n---`);
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
    if (ownScratch) {
      const c = await admin0.connect().catch(() => null);
      if (c) {
        try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } catch (e) { console.warn(`drive-s3: could not drop ${SCRATCH}: ${String(e)}`); } finally { c.release(); }
      }
    }
    await admin0.end().catch(() => {});
  }
}

main().catch((e) => { console.error(`\ndrive-s3 FAILED after ${passed} checks\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
