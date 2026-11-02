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
 * Same scratch-database discipline as drive-s2-c4, drive-s6 and drive-s8
 * (which see): create, migrate, drive, drop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../services/gateway/src/db/pg-tx.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { hashPassword } from "../../services/gateway/src/auth/auth.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { Cdp, findChrome } from "./cdp.ts";

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
             ('d1d00000-0000-0000-0000-000000000003',$1,$2,'internal','tech.drive1@ac.test','Technician','["technician"]','region',$2,$3,true)
      ON CONFLICT (id) DO NOTHING`, [INTERNAL_ORG_ID, REGION_SOUTH, hash]);

    // The one build step, with this run's gateway stamped into the frame.
    const build = spawn(process.execPath, [join(ROOT, "tools/ci/build-surface.ts"), "S1"], { env: { ...process.env, AC_GATEWAY: GATEWAY }, stdio: ["ignore", "pipe", "pipe"] });
    let blog = "";
    build.stdout!.on("data", (d) => { blog += String(d); });
    build.stderr!.on("data", (d) => { blog += String(d); });
    must((await new Promise<number>((r) => build.on("exit", (c) => r(c ?? 1)))) === 0, `build-surface S1 failed:\n${blog}`);

    // NOTHING is listening on the gateway's port yet. That is the point.
    site = serveDist(join(ROOT, "apps/s1-front-door/dist"));
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

    console.log(`\ndrive-s1: ${passed} checks passed`);
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
        try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } catch (e) { console.warn(`drive-s1: could not drop ${SCRATCH}: ${String(e)}`); } finally { c.release(); }
      }
    }
    await admin0.end().catch(() => {});
  }
}

main().catch((e) => { console.error(`\ndrive-s1 FAILED after ${passed} checks\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
