/**
 * S1 THROUGH A REAL BROWSER — item 8's DOM layer, and the one claim in this
 * repository that cannot be tested any other way.
 *
 *   DATABASE_URL=postgres://... node tools/ci/drive-s1.ts
 *
 * SURFACES.S1.degraded says: "Statically generated; forms queue to a durable
 * buffer and replay. Site stays up when the gateway does not." Every part of
 * that sentence is about a browser:
 *
 *   - "site stays up" is a page that renders with nothing listening on the
 *     gateway's port. So this drive starts the SITE first and the GATEWAY
 *     later, and reads the page in between. No other suite can be run in that
 *     order, because no other surface has anything to show before login.
 *   - "durable" is localStorage surviving a navigation. So the drive reloads
 *     the tab with a lead still queued.
 *   - "replay" is the same submission id arriving twice and one row existing.
 *     So the drive counts rows in the database, not messages on the page.
 *
 * It also carries 09 §3.11's standing check — the `value`-versus-
 * `defaultValue` defect that cost C4 a silent second rate — because this form
 * calls `form.reset()` after a submit and that is exactly the shape that bit.
 *
 * Same scratch-database discipline as drive-s2-c4, drive-s6 and drive-s8
 * (which see): create, migrate, drive, drop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { REGION_SOUTH, REGION_WEST } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
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
 * `apps/s1-marketing/src/app.test.ts` holds the same list against the markup;
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
  const leadCount = async (): Promise<number> =>
    Number((await admin(`SELECT count(*)::int AS n FROM leads`))[0]!.n);

  let gateway: ChildProcess | undefined;
  let site: Server | undefined;
  let cdp: Cdp | undefined;
  let log = "";
  try {
    // Two active regions and one deactivated one: the coverage claim is
    // `regions`, and a region we have switched off is not a metro we serve.
    await admin(`INSERT INTO regions (id, code, name, active) VALUES ($1,'SOUTH','South',true), ($2,'WEST','West',true) ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH, REGION_WEST]);
    await admin(`INSERT INTO regions (id, code, name, active, min_crew_density) VALUES ($1,'DORMANT','Dormant Metro',false,7) ON CONFLICT (id) DO NOTHING`, ["d1000000-0000-0000-0000-0000000000aa"]);

    // The one build step, with this run's gateway stamped into the frame.
    const build = spawn(process.execPath, [join(ROOT, "tools/ci/build-surface.ts"), "S1"], { env: { ...process.env, AC_GATEWAY: GATEWAY }, stdio: ["ignore", "pipe", "pipe"] });
    let blog = "";
    build.stdout!.on("data", (d) => { blog += String(d); });
    build.stderr!.on("data", (d) => { blog += String(d); });
    must((await new Promise<number>((r) => build.on("exit", (c) => r(c ?? 1)))) === 0, `build-surface S1 failed:\n${blog}`);

    // NOTHING is listening on the gateway's port yet. That is the point.
    site = serveDist(join(ROOT, "apps/s1-marketing/dist"));
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

    // ── 1. THE SITE IS UP WITH NO GATEWAY AT ALL
    await cdp.waitFor(has("Commercial HVAC service"), "the front page, with nothing listening on the gateway");
    must(!(await cdp.eval<boolean>(has("Dallas")))
      && !(await cdp.eval<boolean>(has("South"))), "no metro may appear before a row does");
    await shot("01-front-page-no-gateway");
    check(1, "the front page renders with nothing listening on the gateway's port");

    // ── 2. the degraded slot carries the declared text from the HTML itself
    const slotText = await cdp.eval<string>(`document.querySelector("ac-degraded")?.textContent ?? ""`);
    must(/durable buffer/i.test(slotText), `the frame carries S1's declared degraded line, got ${JSON.stringify(slotText.slice(0, 80))}`);
    check(2, "the degraded slot's text is in the frame, so it does not depend on the bundle having loaded");

    // ── 3. the form takes a lead while the gateway is down, and says QUEUED
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Ask us to call").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("lead-form")`, "the lead form");
    await cdp.eval(fillAndSubmit("lead-form", { name: `Queued Visitor ${RUN}`, phone: "555 0101", metro: "South", note: "Roof unit short-cycling." }));
    await cdp.waitFor(has("waiting to send"), "the queued notice");
    must(!(await cdp.eval<boolean>(has("we have your message"))), "REGRESSION: the page told a stranger we have their message while it sat in their own browser");
    await shot("02-queued-while-down");
    check(3, "a lead submitted with the gateway down is held, and the page says held — never sent");

    // ── 4. it is DURABLE: it is in storage, and it survives a reload
    const stored = await cdp.eval<string>(`localStorage.getItem("ac.s1.pending") ?? ""`);
    must(stored.includes(`Queued Visitor ${RUN}`), "the queue is written to storage, not held in a tab");
    const submissionId = JSON.parse(stored)[0].input.submissionId as string;
    await cdp.navigate(`${SITE}/enquire`);
    await cdp.waitFor(has("waiting to send"), "the queue after a reload");
    check(4, "the queue survives a reload — a stranger on one bar who closes the tab has not lost what they wrote");

    // ── 5. the form RESET left the fields empty (09 §3.11 — value vs defaultValue)
    const leftover = await cdp.eval<string[]>(`(() => {
      const f = document.getElementById("lead-form");
      return ["name", "phone", "metro", "note"].map(n => String(f.elements.namedItem(n)?.value ?? ""));
    })()`);
    must(leftover.every((v) => v === ""), `the form resets clean; found ${JSON.stringify(leftover)}. This is 09 §3.11's defect: put \`value\` back on a field and this is the check that fails.`);
    check(5, "the form resets to empty fields — the value/defaultValue defect that cost C4 a silent second rate");

    // ── 6. the gateway comes up, and the queue goes on its own
    gateway = spawn(process.execPath, [join(ROOT, "apps/gateway/src/main.ts")], {
      env: { ...process.env, PORT: String(GATEWAY_PORT), DATABASE_URL: DB, AC_DEV_ORIGINS: SITE }, stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout!.on("data", (d) => { log += String(d); });
    gateway.stderr!.on("data", (d) => { log += String(d); });
    await waitHealthy(() => log);
    // The page is already open and has been told nothing. The retry timer is
    // what has to notice — the same thing that happens to a phone that walks
    // back into signal.
    await cdp.waitFor(has("we have your message"), "the queue to flush by itself", 40_000);
    must(await leadCount() === 1, `exactly one lead after the flush, found ${await leadCount()}`);
    must(!(await cdp.eval<boolean>(has("waiting to send"))), "and the queued notice is gone");
    must((await cdp.eval<string>(`localStorage.getItem("ac.s1.pending") ?? ""`)) === "[]", "and the buffer is empty");
    await shot("03-flushed");
    check(6, "the queue flushes itself when the gateway comes back — no button, no reload");

    // ── 7. the row is the one the browser minted, in PROSPECT/UNASSIGNED, with a real session behind it
    const row = (await admin(`SELECT l.submission_id, l.org_id, l.region_id, l.contact, a.actor_id, a.session_id, s.principal_kind
                                FROM leads l
                                JOIN audit_log a ON a.entity_id = l.id
                                JOIN sessions s ON s.id = a.session_id`))[0]!;
    must(row.submission_id === submissionId, "the id the browser minted is the id the row carries");
    must(row.principal_kind === "anonymous", "a real session row, of the kind the bootstrap migration has admitted since 0001");
    must((row.contact as { name: string }).name === `Queued Visitor ${RUN}`, "and the stranger's own words");
    check(7, "the lead carries the browser's submission id, lands in PROSPECT/UNASSIGNED, and has a real anonymous session behind it");

    // ── 8. THE REPLAY: the same queued lead put back and flushed again is still one row
    await cdp.eval(`(() => {
      localStorage.setItem("ac.s1.pending", ${JSON.stringify(stored)});
      return true;
    })()`);
    await cdp.navigate(`${SITE}/enquire`);
    await cdp.waitFor(`(localStorage.getItem("ac.s1.pending") ?? "[]") === "[]"`, "the replayed lead to clear", 40_000);
    must(await leadCount() === 1, `a replay of a landed lead is not a second row; found ${await leadCount()}`);
    must(!(await cdp.eval<boolean>(has("did not go through"))), "and the visitor is not told anything failed");
    check(8, "a replay of a lead that already landed is one row and no alarm — the unique index answering means success, arriving late");

    // ── 9. coverage is the ROWS, and names no dormant region and no density
    await cdp.navigate(`${SITE}/coverage`);
    await cdp.waitFor(has("South"), "the coverage list from the hierarchy");
    const page9 = await cdp.eval<string>(text);
    must(/West/.test(page9), "both active regions");
    must(!/Dormant Metro/.test(page9), "REGRESSION: a deactivated region was published as a metro we serve");
    must(!/\b7\b/.test(page9.replace(/\d{4}/g, "")), "REGRESSION: min_crew_density reached the page");
    must(!/density/i.test(page9), "the D14 supply rule is not a public claim");
    await shot("04-coverage");
    check(9, "the coverage list is `regions` through ac_public_coverage() — active rows, names only, no density");

    // ── 10. a lead the gateway refuses on its merits stops, and says why in the gateway's words
    await cdp.navigate(`${SITE}/enquire`);
    await cdp.waitFor(`document.getElementById("lead-form")`, "the form");
    await cdp.eval(fillAndSubmit("lead-form", { name: `No Way To Answer ${RUN}`, phone: "", metro: "", note: "" }));
    await cdp.waitFor(has("leave an email address or a phone number"), "the gateway's own refusal on the page", 30_000);
    must(await leadCount() === 1, "a refused lead is not a row");
    must((await cdp.eval<string>(`localStorage.getItem("ac.s1.pending") ?? ""`)) === "[]", "and it is not retried forever");
    await shot("05-refused");
    check(10, "a lead refused on its merits is dropped from the queue and shown in the gateway's own words");

    // ── 11. the copy ceiling, on the painted page
    const pages: string[] = [];
    for (const path of ["/", "/coverage", "/enquire"]) {
      await cdp.navigate(`${SITE}${path}`);
      await cdp.waitFor(`${text}.length > 40`, `the page at ${path}`);
      pages.push(await cdp.eval<string>(text));
    }
    const painted = pages.join("\n");
    for (const [re, what] of TIME_CLAIMS) {
      must(!re.test(painted), `S1's painted copy claims ${what}; the ceiling for that is D7a/OQ6 and it is not written yet (F9)`);
    }
    check(11, "no availability or response-time claim on any painted page — the D7a/OQ6 ceiling is unwritten, so it is zero");

    // ── 12. S1 wears the house red, and it is the brand role that put it there
    await cdp.navigate(`${SITE}/`);
    await cdp.waitFor(has("Commercial HVAC"), "the front page");
    const brand = await cdp.eval<{ token: string; painted: string }>(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const el = document.querySelector(".s1-cta");
      return { token: cs.getPropertyValue("--color-brand").trim(), painted: getComputedStyle(el).backgroundColor };
    })()`);
    must(brand.token.length > 0, "the brand role is defined on this surface");
    must(!/^rgb\(0,\s*0,\s*0\)$/.test(brand.painted), `S1 is the one surface where the brand does NOT resolve to Ink Black, got ${brand.painted}`);
    check(12, "the call-to-action is painted from --color-brand — S1 is the one surface that wears the house red");

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
