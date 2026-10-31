/**
 * PEOPLE (0038) THROUGH A REAL BROWSER — the checks a string render cannot make.
 *
 *   DATABASE_URL=postgres://... node tools/ci/drive-s2-people.ts
 *
 * The wire suite (test/integration/s2-people.test.ts) holds what the gateway
 * admits. This walks S2 the way a principal does: make a staff login and a
 * technician login and read each one's temporary password off the page, grant
 * the technician a shift on the devices screen and then extend and revoke it
 * from the shifts panel, reset the staff login's password, and sign in as that
 * person — the temporary password alone is answered with "choose a new one",
 * a mismatch keeps the form, and the new password signs in. Last: the only
 * principal cannot remove their own login. Then Regions (0039), in the same
 * area: DFW is listed and Unassigned is marked and offered by no form; a
 * region is opened and renamed from the panel; closing one still in use is
 * refused naming who is in it, and a closed one leaves the create forms.
 *
 * Its own database, created, migrated and dropped, as drive-s2-c4's is: the
 * last check needs to know every principal on the server.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { SURFACE_PATHS } from "../../packages/contracts/src/index.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { Cdp, findChrome } from "./cdp.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GIVEN_DB = process.env.DATABASE_URL;
const dbName = (url: string): string => new URL(url).pathname.replace(/^\//, "");
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const GATEWAY_PORT = 25080 + Math.floor(Math.random() * 500);
const SITE_PORT = 25600 + Math.floor(Math.random() * 500);
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const RUN = Date.now().toString(36).toLowerCase();
const SCRATCH = process.env.AC_DRIVE_DB ?? `ac_drive_people_${RUN}`;
const EMAIL = "principal.drive@ac.test";
const PASSWORD = "correct horse battery staple";
const USER = "5e000000-0000-0000-0000-0000000000d1";
const S2 = `${SITE}${SURFACE_PATHS.S2}`;
const STAFF_EMAIL = `olive.${RUN}@ac.test`;
const TECH_NAME = `Theo Field ${RUN}`;
const HARDWARE = `WEB-${RUN.toUpperCase()}`;

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

const run = async (args: string[], env: NodeJS.ProcessEnv, what: string): Promise<void> => {
  const p = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout!.on("data", (d) => { out += String(d); });
  p.stderr!.on("data", (d) => { out += String(d); });
  const code = await new Promise<number>((r) => p.on("exit", (c) => r(c ?? 1)));
  must(code === 0, `${what} failed:\n${out}`);
};

/** Fill named fields (a checkbox group by value list, a radio by value) and submit, the way a person does. */
const fillAndSubmit = (formId: string, values: Record<string, string | string[]>) => `(() => {
  const f = document.getElementById(${JSON.stringify(formId)});
  if (!f) throw new Error("no form ${formId}");
  for (const [name, v] of Object.entries(${JSON.stringify(values)})) {
    const els = [...f.querySelectorAll('[name="' + name + '"]')];
    if (els.length === 0) throw new Error("no field " + name + " on ${formId}");
    for (const el of els) {
      if (el.type === "checkbox") el.checked = Array.isArray(v) ? v.includes(el.value) : el.value === v;
      else if (el.type === "radio") el.checked = el.value === v;
      else el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  f.requestSubmit();
  return true;
})()`;

const text = `(document.body?.innerText ?? "")`;
const refusalText = `(document.querySelector(".ac-refusal")?.innerText ?? "")`;
const click = (selector: string) => `(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) throw new Error("nothing at ${selector}"); b.click(); return true; })()`;
const clickText = (selector: string, label: string) => `(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) throw new Error("no ${label} at ${selector}"); b.click(); return true;
})()`;
const TEMP = /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/;
const tempShown = `(document.getElementById("temporary-password")?.textContent ?? "").trim()`;

async function main(): Promise<void> {
  const maySkip = !process.env.CI || process.env.AC_DRIVE_OPTIONAL === "1";
  if (!GIVEN_DB) {
    if (maySkip) { console.log("drive-s2-people: DATABASE_URL not set — skipped"); return; }
    throw new Error("DATABASE_URL is not set, and a skip in CI is a check that stopped checking");
  }
  const chrome = findChrome();
  if (!chrome) {
    if (maySkip) { console.log("drive-s2-people: no chrome found — skipped"); return; }
    throw new Error("no chrome found and this is CI. Set AC_CHROME, or AC_DRIVE_OPTIONAL=1 to accept the gap deliberately");
  }
  console.log(`drive-s2-people: ${chrome}`);

  const ownScratch = !process.env.AC_DRIVE_DB;
  const maintenance = withDb(GIVEN_DB, dbName(GIVEN_DB) === "postgres" ? "template1" : "postgres");
  const DB = withDb(GIVEN_DB, SCRATCH);
  const admin0 = createPool(maintenance, "ac-drive-admin");
  admin0.on("error", () => {});
  if (ownScratch) {
    const c = await admin0.connect();
    try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); }
    console.log(`drive-s2-people: scratch database ${SCRATCH}`);
    await run([join(ROOT, "tools/ci/migrate.ts")], { ...process.env, DATABASE_URL: DB }, "migrate on the scratch database");
  }

  const pool: Pool = createPool(DB, "ac-drive");
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
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ($1,$2,$3,'internal',$4,'Drive Principal','["principal"]','parent',$2,$5,true)
      ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
      [USER, INTERNAL_ORG_ID, REGION_SOUTH, EMAIL, hashPassword(PASSWORD)]);

    gateway = spawn(process.execPath, [join(ROOT, "apps/gateway/src/main.ts")], {
      env: { ...process.env, PORT: String(GATEWAY_PORT), DATABASE_URL: DB, AC_DEV_ORIGINS: SITE }, stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout!.on("data", (d) => { log += String(d); });
    gateway.stderr!.on("data", (d) => { log += String(d); });
    const deadline = Date.now() + 20_000;
    for (;;) {
      try { if ((await fetch(`${GATEWAY}/healthz`)).ok) break; } catch { /* not yet */ }
      if (Date.now() > deadline) throw new Error(`gateway did not come up on :${GATEWAY_PORT}\n${log}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    await run([join(ROOT, "tools/ci/build-surface.ts"), "S2"], { ...process.env, AC_GATEWAY: GATEWAY }, "build-surface S2");
    site = serveDist(join(ROOT, "apps/s2-service-manager/dist"));
    cdp = await Cdp.launch(chrome);
    await cdp.openTab(`${S2}/login`);

    // ── 1. a principal signs in and is offered People
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form");
    await cdp.eval(fillAndSubmit("login-form", { email: EMAIL, password: PASSWORD }));
    await cdp.waitFor(`[...document.querySelectorAll(".ac-nav__domain-name")].some(x => x.textContent === "People")`, "the People tab");
    check(1, "a principal signs in and the department bar offers People");

    // ── 2. a staff login, its temporary password on the page, a hash at the table
    await cdp.navigate(`${S2}/people/new/staff`);
    await cdp.waitFor(`document.getElementById("person-form")?.querySelector('[name="roles"]')`, "the staff form");
    await cdp.eval(fillAndSubmit("person-form", { displayName: "Olive Office", email: STAFF_EMAIL, roles: ["office_manager"], scope: "org", regionId: REGION_SOUTH }));
    await cdp.waitFor(`/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/.test(${tempShown})`, "the temporary password on the person's page");
    const staffTemp = await cdp.eval<string>(tempShown);
    const staff = (await admin(`SELECT id, password_hash, must_change_password FROM users WHERE email = $1`, [STAFF_EMAIL]))[0];
    must(staff?.must_change_password === true, "the new login should hold a temporary password");
    must(!String(staff.password_hash).includes(staffTemp), "the table should hold a hash, not the password");
    check(2, "a staff login is made; its temporary password is on the page and only a hash is at the table");

    // ── 3. Done clears it; the list says a temporary password is outstanding
    await cdp.eval(click("#temporary-done"));
    await cdp.waitFor(`!document.getElementById("temporary-password")`, "the temporary password to go");
    await cdp.navigate(`${S2}/people`);
    await cdp.waitFor(`[...document.querySelectorAll("tbody tr")].some(r => r.innerText.includes("Olive Office") && r.innerText.includes("Temporary password"))`, "Olive's row");
    check(3, "Done takes the password off the page; the list says one is outstanding");

    // ── 4. a technician login, with its own unit
    await cdp.navigate(`${S2}/people/new/technician`);
    await cdp.waitFor(`document.getElementById("person-form")?.querySelector('[name="firmId"]')`, "the technician form");
    await cdp.eval(fillAndSubmit("person-form", { displayName: TECH_NAME, email: `theo.${RUN}@ac.test`, regionId: REGION_SOUTH }));
    await cdp.waitFor(`/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/.test(${tempShown})`, "the technician's temporary password");
    const unit = (await admin(`SELECT c.id, c.kind FROM users u JOIN crews c ON c.id = u.crew_id WHERE u.email = $1`, [`theo.${RUN}@ac.test`]))[0];
    must(unit?.kind === "service", "the technician should stand on their own service unit");
    must(TEMP.test(await cdp.eval<string>(tempShown)), "a temporary password");
    await cdp.eval(click("#temporary-done"));
    check(4, "a technician login is made with its own service unit");

    // ── 5. the shift: granted on the devices screen, then extended and revoked from the shifts panel
    await admin(`INSERT INTO devices (org_id, region_id, hardware_id, kind, public_key, active) VALUES ($1,$2,$3,'web_fallback','',true)`, [INTERNAL_ORG_ID, REGION_SOUTH, HARDWARE]);
    await cdp.navigate(`${S2}/devices/grant`);
    await cdp.waitFor(`[...document.querySelectorAll('#grant-form [name="crewId"] option')].some(o => o.textContent === ${JSON.stringify(TECH_NAME)})`, "the technician's unit on the grant form");
    const local = (ms: number) => { const d = new Date(Date.now() + ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
    const deviceId = (await admin(`SELECT id FROM devices WHERE hardware_id = $1`, [HARDWARE]))[0].id as string;
    await cdp.eval(fillAndSubmit("grant-form", { deviceId, crewId: unit.id, windowStart: local(-60_000), windowEnd: local(2 * 3600_000) }));
    await cdp.waitFor(`[...document.querySelectorAll("#shifts tbody tr")].some(r => r.innerText.includes(${JSON.stringify(HARDWARE)}) && r.innerText.includes("Open"))`, "the open shift in the panel");
    const grantId = (await admin(`SELECT id FROM device_grants WHERE device_id = $1`, [deviceId]))[0].id as string;
    const endBefore = (await admin(`SELECT upper(service_window) AS e FROM device_grants WHERE id = $1`, [grantId]))[0].e as Date;
    await cdp.eval(clickText("#shifts button", "Extend"));
    await cdp.waitFor(`document.getElementById("extend-${grantId}")`, "the extend form");
    await cdp.eval(fillAndSubmit(`extend-${grantId}`, { windowEnd: local(4 * 3600_000) }));
    await cdp.waitFor(`!document.getElementById("extend-${grantId}")`, "the extend form to close");
    const endAfter = (await admin(`SELECT upper(service_window) AS e FROM device_grants WHERE id = $1`, [grantId]))[0].e as Date;
    must(endAfter.getTime() > endBefore.getTime() + 3600_000, `the grant should end later: ${endBefore.toISOString()} → ${endAfter.toISOString()}`);
    check(5, "a shift granted on the devices screen is extended from the shifts panel");

    await cdp.eval(clickText("#shifts button", "Revoke"));
    await cdp.waitFor(`document.getElementById("confirm-revoke-${grantId}")`, "the revoke confirmation");
    await cdp.eval(clickText(`#confirm-revoke-${grantId} button`, "Revoke shift"));
    await cdp.waitFor(`[...document.querySelectorAll("#shifts tbody tr")].some(r => r.innerText.includes(${JSON.stringify(HARDWARE)}) && r.innerText.includes("Revoked"))`, "the revoked shift");
    must((await admin(`SELECT revoked_at FROM device_grants WHERE id = $1`, [grantId]))[0].revoked_at !== null, "revoked at the table");
    check(6, "the shift is revoked through its confirmation, and reads Revoked");

    // ── 7. a reset, from the person's page
    await cdp.navigate(`${S2}/people/${staff.id}`);
    await cdp.waitFor(`document.getElementById("reset-password")`, "the reset button");
    await cdp.eval(click("#reset-password"));
    await cdp.eval(clickText("#confirm-reset button", "Reset password"));
    await cdp.waitFor(`/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/.test(${tempShown}) && ${tempShown} !== ${JSON.stringify(staffTemp)}`, "a new temporary password");
    const resetTemp = await cdp.eval<string>(tempShown);
    check(7, "a reset gives a new temporary password on the page");

    // ── 8. the person signs in: asked for a new password, kept on a mismatch, signed in with it
    await cdp.eval(click(".ac-nav__signout"));
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form after sign-out");
    await cdp.eval(fillAndSubmit("login-form", { email: STAFF_EMAIL, password: resetTemp }));
    await cdp.waitFor(`!!document.querySelector('#login-form [name="newPassword"]')`, "the new-password fields");
    must((await cdp.eval<string>(refusalText)).includes("new password"), "the refusal should ask for a new password");
    await cdp.eval(fillAndSubmit("login-form", { email: STAFF_EMAIL, password: resetTemp, newPassword: `olive's own ${RUN}`, repeatPassword: "something else entirely" }));
    await cdp.waitFor(`${refusalText}.includes("not the same")`, "the mismatch refusal");
    must(await cdp.eval<boolean>(`!!document.querySelector('#login-form [name="newPassword"]')`), "the fields should stay up on a mismatch");
    await cdp.eval(fillAndSubmit("login-form", { email: STAFF_EMAIL, password: resetTemp, newPassword: `olive's own ${RUN}`, repeatPassword: `olive's own ${RUN}` }));
    await cdp.waitFor(`!document.getElementById("login-form")`, "the sign-in to land");
    must(!(await cdp.eval<boolean>(`[...document.querySelectorAll(".ac-nav__domain-name")].some(x => x.textContent === "People")`)), "an office manager is not offered People");
    must((await admin(`SELECT must_change_password FROM users WHERE id = $1`, [staff.id]))[0].must_change_password === false, "the new password should be set");
    check(8, "the temporary password asks for a new one, a mismatch keeps the form, and the new one signs in");

    // ── 9. the only principal cannot remove their own login
    await cdp.eval(click(".ac-nav__signout"));
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form");
    await cdp.eval(fillAndSubmit("login-form", { email: EMAIL, password: PASSWORD }));
    await cdp.waitFor(`!document.getElementById("login-form")`, "the principal back in");
    await cdp.navigate(`${S2}/people/${USER}`);
    await cdp.waitFor(`document.getElementById("set-active")`, "the remove button");
    await cdp.eval(click("#set-active"));
    await cdp.eval(clickText("#confirm-active button", "Remove login"));
    await cdp.waitFor(`${refusalText}.includes("last active company-wide principal")`, "the last-principal refusal");
    must((await admin(`SELECT active FROM users WHERE id = $1`, [USER]))[0].active === true, "the principal should still be active");
    check(9, "the only principal is refused removing their own login, by name");

    // ── 10. Regions, inside People: DFW from the migration, Unassigned listed but never a choice
    await cdp.navigate(`${S2}/people`);
    await cdp.waitFor(`[...document.querySelectorAll("#regions tbody tr")].some(r => r.innerText.includes("Dallas–Fort Worth") && r.innerText.includes("Active"))`, "DFW in the Regions panel");
    must(await cdp.eval<boolean>(`[...document.querySelectorAll("#regions tbody tr")].some(r => r.innerText.includes("Unassigned") && r.innerText.includes("never offered") && !r.querySelector("a"))`), "Unassigned should be listed, marked, and have no page");
    await cdp.navigate(`${S2}/people/new/staff`);
    await cdp.waitFor(`document.querySelectorAll('#person-form [name="regionId"] option').length > 0`, "the staff form's regions");
    const offered = await cdp.eval<string[]>(`[...document.querySelectorAll('#person-form [name="regionId"] option')].map(o => o.textContent)`);
    must(offered.some((o) => o.includes("DFW")) && !offered.some((o) => /unassigned/i.test(o)), `the form should offer DFW and never Unassigned: ${offered.join(" | ")}`);
    check(10, "the Regions panel lists DFW and marks Unassigned, which no create form offers");

    // ── 11. a region opened from the panel, then renamed on its page
    const REGION_CODE = `D${RUN.slice(-6).toUpperCase()}`;
    await cdp.navigate(`${S2}/people`);
    await cdp.waitFor(`[...document.querySelectorAll("#regions a")].some(a => a.textContent.trim() === "+ Region")`, "the + Region action");
    await cdp.eval(clickText("#regions a", "+ Region"));
    await cdp.waitFor(`document.getElementById("region-form")?.querySelector('[name="code"]')`, "the new region form");
    await cdp.eval(fillAndSubmit("region-form", { code: REGION_CODE, name: `Drive ${RUN}`, timezone: "America/Chicago" }));
    await cdp.waitFor(`document.querySelector(".ac-page-head__title")?.textContent === ${JSON.stringify(`Drive ${RUN}`)} && !document.querySelector('#region-form [name="code"]')`, "the region's own page");
    await cdp.eval(fillAndSubmit("region-form", { name: `Drive Renamed ${RUN}` }));
    await cdp.waitFor(`document.querySelector(".ac-page-head__title")?.textContent === ${JSON.stringify(`Drive Renamed ${RUN}`)}`, "the new name");
    const opened = (await admin(`SELECT id, code, name, active FROM regions WHERE code = $1`, [REGION_CODE]))[0];
    must(opened?.name === `Drive Renamed ${RUN}` && opened.active === true, "the region should be open, renamed, its code unchanged");
    check(11, "a region is opened from the panel and renamed on its page; its code stays");

    // ── 12. a region in use is refused by name; an empty one closes and leaves the forms
    await cdp.navigate(`${S2}/people/regions/${REGION_SOUTH}`);
    await cdp.waitFor(`document.getElementById("set-region-active")`, "the close button");
    await cdp.eval(click("#set-region-active"));
    await cdp.eval(clickText("#confirm-region button", "Close region"));
    await cdp.waitFor(`${refusalText}.includes("still holds") && ${refusalText}.includes("Drive Principal")`, "the in-use refusal, naming who");
    must((await admin(`SELECT active FROM regions WHERE id = $1`, [REGION_SOUTH]))[0].active === true, "South should still be open");
    await cdp.navigate(`${S2}/people/regions/${opened.id}`);
    await cdp.waitFor(`document.getElementById("set-region-active")`, "the close button");
    await cdp.eval(click("#set-region-active"));
    await cdp.eval(clickText("#confirm-region button", "Close region"));
    await cdp.waitFor(`document.getElementById("set-region-active")?.textContent === "Open again"`, "the region closed");
    must((await admin(`SELECT active FROM regions WHERE id = $1`, [opened.id]))[0].active === false, "closed at the table");
    await cdp.navigate(`${S2}/people/new/staff`);
    await cdp.waitFor(`document.querySelectorAll('#person-form [name="regionId"] option').length > 0`, "the staff form's regions");
    must(!(await cdp.eval<string[]>(`[...document.querySelectorAll('#person-form [name="regionId"] option')].map(o => o.textContent)`)).some((o) => o.includes(REGION_CODE)), "a closed region is offered nowhere");
    check(12, "closing a region in use is refused by name; an empty one closes and leaves the create forms");

    must(!(await cdp.eval<boolean>(`${text}.includes("scrypt$")`)), "no hash should ever reach the page");
    console.log(`\ndrive-s2-people: ${passed} checks passed`);
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
        try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } catch (e) { console.warn(`drive-s2-people: could not drop ${SCRATCH}: ${String(e)}`); } finally { c.release(); }
      }
    }
    await admin0.end().catch(() => {});
  }
}

main().catch((e) => { console.error(`\ndrive-s2-people FAILED after ${passed} checks\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
