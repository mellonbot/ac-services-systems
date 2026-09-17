/**
 * C4 THROUGH A REAL BROWSER — the checks a string render cannot make.
 *
 *   DATABASE_URL=postgres://... node tools/ci/drive-s2-c4.ts
 *
 * The suite in `test/integration/s2-c4.test.ts` drives the same operations over
 * the wire through the shell, and 61 render tests assert S2's markup. Neither
 * catches a defect that lives in the DOM between two actions, and C4 shipped
 * with two of those. So this walks the network screens the way a service
 * manager does — record a firm, fail to activate it, sign, activate, add a
 * crew, put a document on file, verify it once and fail to verify it twice,
 * then set TWO rates in one session — and asserts what the page says.
 *
 * Check 11 is the one that pays for the file: the second rate is the action
 * that silently never reached the gateway, and nothing else in the repository
 * would notice if `defaultValue` became `value` again.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { Cdp, findChrome } from "./cdp.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GIVEN_DB = process.env.DATABASE_URL;

/**
 * THE DRIVE GETS ITS OWN DATABASE, and this is not tidiness.
 *
 * The drive records crews. D14 refuses a location in a region whose crew
 * density is below the rule, so a crew this file creates RAISES that density
 * and the C1 suite's "below density is a 422" stops being true — it passed,
 * silently, on a database nobody else had touched. In CI the integration suite
 * happens to run first, which means the coupling is real and invisible and
 * survives until somebody reorders two lines in a workflow.
 *
 * So: create a database, migrate it, drive it, drop it. `AC_DRIVE_DB` names one
 * explicitly for a run that wants to keep the rows and look at them.
 */
const dbName = (url: string): string => new URL(url).pathname.replace(/^\//, "");
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const GATEWAY_PORT = 22080 + Math.floor(Math.random() * 500);
const SITE_PORT = 22600 + Math.floor(Math.random() * 500);
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const RUN = Date.now().toString(36).toUpperCase();
const SCRATCH = process.env.AC_DRIVE_DB ?? `ac_drive_${RUN.toLowerCase()}`;
const EMAIL = `owner.drive@ac.test`;
const PASSWORD = "correct horse battery staple";
const USER = `d4000000-0000-0000-0000-000000000001`;

let passed = 0;
const check = (n: number, what: string) => { passed++; console.log(`  ${String(n).padStart(2)} ✓ ${what}`); };
const must = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json" };

/** The surface's own origin. Unknown paths fall back to index.html — the router is client-side, so a deep link is not a 404. */
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

/** Fill named fields and submit, the way a person does — set the value, fire input, then submit. */
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
const refusalText = `(document.querySelector(".ac-refusal")?.innerText ?? "")`;
/** A GRID ROW, not the page. "9500" is also in the rate field's own helper copy, and a page-text probe passes on the instructions. */
const gridRow = (needle: string) => `[...document.querySelectorAll("tbody tr")].some(r => r.innerText.includes(${JSON.stringify(needle)}))`;

async function main(): Promise<void> {
  // A skip is a pass that looked like work. On a laptop with no database that
  // is the right answer; in CI it is how a check stops checking and nobody
  // notices for four months. So CI turns both skips into failures, and a run
  // that genuinely wants to opt out has to say so on the command line.
  const maySkip = !process.env.CI || process.env.AC_DRIVE_OPTIONAL === "1";
  if (!GIVEN_DB) {
    if (maySkip) { console.log("drive-s2-c4: DATABASE_URL not set — skipped"); return; }
    throw new Error("DATABASE_URL is not set, and a skip in CI is a check that stopped checking");
  }
  const chrome = findChrome();
  if (!chrome) {
    const looked = ["AC_CHROME", "/opt/pw-browsers/...", "/usr/bin/chromium", "/usr/bin/google-chrome"].join(", ");
    if (maySkip) { console.log(`drive-s2-c4: no chrome found (looked at ${looked}) — skipped`); return; }
    throw new Error(`no chrome found and this is CI — looked at ${looked}. Set AC_CHROME, or AC_DRIVE_OPTIONAL=1 to accept the gap deliberately`);
  }
  console.log(`drive-s2-c4: ${chrome}`);

  // Provision the scratch database from the maintenance one, then migrate it.
  const ownScratch = !process.env.AC_DRIVE_DB;
  const maintenance = withDb(GIVEN_DB, dbName(GIVEN_DB) === "postgres" ? "template1" : "postgres");
  const DB = withDb(GIVEN_DB, SCRATCH);
  const admin0 = createPool(maintenance, "ac-drive-admin");
  // DROP ... WITH (FORCE) terminates live connections, and a pg pool with no
  // error listener turns that into an unhandled 'error' event — a run that
  // passed every check and then exited non-zero on the way out.
  admin0.on("error", () => {});
  try {
    if (ownScratch) {
      const c = await admin0.connect();
      try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); }
      console.log(`drive-s2-c4: scratch database ${SCRATCH}`);
      const mig = spawn(process.execPath, [join(ROOT, "tools/ci/migrate.ts")], { env: { ...process.env, DATABASE_URL: DB }, stdio: ["ignore", "pipe", "pipe"] });
      let mlog = "";
      mig.stdout!.on("data", (d) => { mlog += String(d); });
      mig.stderr!.on("data", (d) => { mlog += String(d); });
      const mcode = await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1)));
      must(mcode === 0, `migrate failed on the scratch database:\n${mlog}`);
    }
  } catch (e) {
    await admin0.end().catch(() => {});
    throw e;
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
    await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
    await admin(`INSERT INTO currencies (code) VALUES ('USD') ON CONFLICT DO NOTHING`).catch(() => {});
    await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
      VALUES ($1,$2,$3,'internal',$4,'Drive Owner','["account_owner"]','parent',$2,$5,true)
      ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
      [USER, INTERNAL_ORG_ID, REGION_SOUTH, EMAIL, hashPassword(PASSWORD)]);

    gateway = spawn(process.execPath, [join(ROOT, "apps/gateway/src/main.ts")], {
      env: { ...process.env, PORT: String(GATEWAY_PORT), DATABASE_URL: DB, AC_DEV_ORIGINS: SITE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout!.on("data", (d) => { log += String(d); });
    gateway.stderr!.on("data", (d) => { log += String(d); });
    await waitHealthy(() => log);

    // The one build step, with this run's gateway stamped into the frame.
    const build = spawn(process.execPath, [join(ROOT, "tools/ci/build-surface.ts"), "S2"], {
      env: { ...process.env, AC_GATEWAY: GATEWAY }, stdio: ["ignore", "pipe", "pipe"],
    });
    let blog = "";
    build.stdout!.on("data", (d) => { blog += String(d); });
    build.stderr!.on("data", (d) => { blog += String(d); });
    const code = await new Promise<number>((r) => build.on("exit", (c) => r(c ?? 1)));
    must(code === 0, `build-surface S2 failed:\n${blog}`);

    site = serveDist(join(ROOT, "apps/s2-service-manager/dist"));
    cdp = await Cdp.launch(chrome);
    await cdp.openTab(`${SITE}/login`);

    // ── 1. the login screen renders at all
    await cdp.waitFor(`document.getElementById("login-form")`, "the login form");
    check(1, "S2 boots to a login form");

    // ── 2. a real login sets the cookie and lands on the tree
    await cdp.eval(fillAndSubmit("login-form", { email: EMAIL, password: PASSWORD }));
    await cdp.waitFor(`!document.getElementById("login-form")`, "the login form to go away");
    check(2, "login over the cookie session leaves the login screen");

    // ── 3. the network screen is reachable and empty-stated
    await cdp.navigate(`${SITE}/network`);
    await cdp.waitFor(`${text}.includes("Network") || document.querySelector(".ac-data-grid, .s2-tree__head")`, "the network screen");
    check(3, "the network screen renders");

    // ── 4. a firm cannot be recorded without an OQ5 position
    await cdp.navigate(`${SITE}/network/firms/new`);
    await cdp.waitFor(`document.getElementById("firm-form")`, "the firm form");
    const disabled = await cdp.eval<boolean>(`!!document.getElementById("record-firm")?.disabled`);
    must(disabled, "the record button should be disabled while OQ5 is unset");
    check(4, "OQ5 unstated — the record button is disabled, nothing is sent");

    // ── 5. stating it enables the form, and the firm is recorded
    const name = `Drive Mechanical ${RUN}`;
    await cdp.eval(`(() => { const r = document.querySelector('#firm-oq5 input[value="reserved"]'); r.click(); return true; })()`);
    await cdp.waitFor(`!document.getElementById("record-firm")?.disabled`, "the record button to enable");
    await cdp.eval(`(() => { const s = document.querySelector('#firm-form select[name="regionId"]'); s.selectedIndex = 0; s.dispatchEvent(new Event("change", {bubbles:true})); return true; })()`);
    await cdp.eval(fillAndSubmit("firm-form", { legalName: name, settlementTermsDays: "30" }));
    await cdp.waitFor(`${text}.includes(${JSON.stringify(name)})`, "the recorded firm");
    check(5, "a firm enters through one door — recorded, onboarding");

    // ── 6. activation without a signed MSA is refused BY NAME
    await cdp.waitFor(`document.getElementById("step-active")`, "the activate step");
    await cdp.eval(`(() => { document.getElementById("step-active").click(); return true; })()`);
    await cdp.waitFor(`${refusalText}.length > 0`, "a refusal card for the unsigned MSA");
    const unsigned = await cdp.eval<string>(refusalText);
    must(/msa_unsigned/i.test(unsigned), `expected msa_unsigned, got: ${unsigned}`);
    check(6, "activation without a signed MSA is refused as msa_unsigned");

    // ── 7. signing it, then activating, walks the ladder
    await cdp.eval(`(() => {
      const f = document.querySelector(".s2-form--inline");
      f.elements.namedItem("msaSignedAt").value = "2026-09-01";
      f.requestSubmit();
      return true;
    })()`);
    await cdp.waitFor(`${text}.includes("signed 2026-09-01")`, "the recorded signature");
    await cdp.waitFor(`document.getElementById("step-active")`, "the activate step after signing");
    await cdp.eval(`(() => { document.getElementById("step-active").click(); return true; })()`);
    await cdp.waitFor(`document.querySelector(".s2-firm .s2-state")?.innerText.trim() === "active"`, "the firm to reach active");
    check(7, "MSA signed → activated: onboarding → active, and the ladder holds");

    // ── 8. a crew under the firm, its tenancy following its employment
    const crew = `Crew ${RUN}`;
    await cdp.eval(`(() => {
      const a = document.querySelector('.s2-firm a[href*="/network/crews/new"]')
        ?? [...document.querySelectorAll("a")].find(x => /\\+\\s*Crew/i.test(x.textContent));
      if (!a) throw new Error("no + Crew link; links were: " + [...document.querySelectorAll("a")].map(x => x.textContent.trim()).join(" | "));
      a.click();
      return true;
    })()`);
    await cdp.waitFor(`document.getElementById("crew-form")`, "the crew form");
    await cdp.eval(`(() => {
      const f = document.getElementById("crew-form");
      const e = f.elements.namedItem("employmentType");
      e.value = "subcontracted"; e.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    // Name the firm rather than trusting an index: the select is ordered by the
    // registry, and "the first option" is a different firm on every run.
    await cdp.eval(`(() => {
      const f = document.getElementById("crew-form");
      const firm = f.elements.namedItem("firmId");
      if (firm) {
        const opt = [...firm.options].find(o => o.textContent.includes(${JSON.stringify(name)}));
        if (!opt) throw new Error("the firm just recorded is not selectable: " + [...firm.options].map(o => o.textContent).join(" | "));
        firm.value = opt.value;
        firm.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const reg = f.elements.namedItem("homeRegionId");
      reg.selectedIndex = 0; reg.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await cdp.eval(fillAndSubmit("crew-form", { label: crew }));
    await cdp.waitFor(`${text}.includes(${JSON.stringify(crew)})`, "the recorded crew");
    check(8, "a subcontracted crew is rostered under the firm");

    // ── 9. THE PILL AND THE CHIP AGREE. A render test asserts what a component
    //      was told; this asserts what two components said next to each other.
    await cdp.waitFor(`[...document.querySelectorAll("a")].some(a => a.textContent.trim() === "Documents")`, "the crew's Documents link");
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Documents").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("credential-form")`, "the credential form");
    await cdp.eval(`(() => {
      const f = document.getElementById("credential-form");
      const k = f.elements.namedItem("kind");
      k.value = "background_check"; k.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await cdp.eval(fillAndSubmit("credential-form", { identifier: `BG-${RUN}`, validFrom: "2026-01-01", validTo: "2027-01-01" }));
    await cdp.waitFor(`${text}.includes("BG-${RUN}")`, "the recorded document");
    // The pills are the place a raw enum leaks: the summary labels them from
    // `readableKinds`, the select beside them labels the SAME kinds by its own
    // `replace`, and the two drifted apart once already. Assert the invariant —
    // no identifier reaches a pill — rather than one kind's spelling, because a
    // crew is only shown the kinds its gate requires and the set varies.
    const pills = await cdp.eval<string[]>(`[...document.querySelectorAll(".ac-pill__word")].map(e => e.innerText.trim())`);
    must(pills.length > 0, "the documents screen should show a compliance pill per required kind");
    // `innerText` is the RENDERED text, and the pill is uppercased by CSS — a
    // lowercase-only probe reads BACKGROUND_CHECK as clean. Match either case.
    const raw = pills.filter((w) => /[a-z]_[a-z]/i.test(w));
    must(raw.length === 0, `a raw entity value reached a pill: ${raw.join(" | ")} (all pills: ${pills.join(" | ")})`);
    const options = await cdp.eval<string[]>(`[...document.querySelectorAll('#credential-form [name="kind"] option')].map(o => o.textContent.trim())`);
    must(options.every((o) => !/[a-z]_[a-z]/i.test(o)), `a raw entity value reached the kind select: ${options.join(" | ")}`);
    check(9, `the pills and the kind select both read in words — no raw enum on the page [${pills.join(" · ")}]`);

    // ── 10. VERIFIED ONCE, AND THERE IS NO SECOND TIME. The row's action cell
    //      carries a Verify button while the document is unverified and the
    //      sentence "a correction is a new document" after. Assert the control,
    //      not the word: the pill renders UNVERIFIED in caps, so a probe for
    //      "unverified" is false before the click and false after it.
    const verifyId = await cdp.eval<string | null>(`(() => {
      const b = [...document.querySelectorAll('button[id^="verify-"]')][0];
      return b ? b.id : null;
    })()`);
    must(verifyId !== null, "a freshly recorded document should offer exactly one Verify control");
    await cdp.eval(`(() => { document.getElementById(${JSON.stringify(verifyId)}).click(); return true; })()`);
    await cdp.waitFor(`!document.getElementById(${JSON.stringify(verifyId)})`, "the Verify control to go away once used");
    await cdp.waitFor(`${text}.toLowerCase().includes("a correction is a new document")`, "the immutability sentence on the verified row");
    const pillsAfter = await cdp.eval<string[]>(`[...document.querySelectorAll(".ac-pill__word")].map(e => e.innerText.trim().toLowerCase())`);
    must(!pillsAfter.some((w) => /background.check.*unverified/.test(w)),
      `the background check pill should leave the unverified state: ${pillsAfter.join(" | ")}`);
    const stillVerifiable = await cdp.eval<number>(`document.querySelectorAll('button[id^="verify-"]').length`);
    must(stillVerifiable === 0, "a verified document must offer no second verification — the UI half of already_verified");
    check(10, "S2 verifies once; the control is gone and the row says a correction is a new document");

    // ── 11/12. TWO RATES IN ONE SESSION. This is the pair that pays for the
    //      file. The first succeeded before the fix too; the SECOND silently
    //      never reached the gateway, because `form.reset()` had emptied a
    //      currency field whose default was a DOM property, and HTML5
    //      validation then blocked the submit with no message anywhere.
    await cdp.navigate(`${SITE}/network`);
    await cdp.waitFor(`[...document.querySelectorAll("a")].some(a => a.textContent.trim() === ${JSON.stringify(name)})`, "the firm in the list");
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === ${JSON.stringify(name)}).click(); return true; })()`);
    await cdp.waitFor(`[...document.querySelectorAll("a")].some(a => a.textContent.trim() === "Rate card")`, "the rate card link");
    await cdp.eval(`(() => { [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Rate card").click(); return true; })()`);
    await cdp.waitFor(`document.getElementById("rate-form")`, "the rate form");

    const currencyDefault = await cdp.eval<string>(`document.querySelector('#rate-form [name="currency"]').value`);
    must(currencyDefault === "USD", `the currency field should carry USD before any submit, got ${JSON.stringify(currencyDefault)}`);

    await cdp.eval(fillAndSubmit("rate-form", { serviceCode: "HVAC_REPAIR", rateMinor: "9500", effectiveFrom: "2026-09-10" }));
    await cdp.waitFor(gridRow("9500"), "the first rate as a row in the grid");
    // The handler clears the per-row fields last, so an empty rateMinor is the
    // signal that the first submit finished — filling before it lands is how a
    // driver races the app and blames the app.
    await cdp.waitFor(`document.querySelector('#rate-form [name="rateMinor"]').value === ""`, "the first submit to finish clearing");
    check(11, "the first rate of the session is recorded");

    // The field the reset used to empty. If this is blank, the next submit dies
    // in HTML5 validation and the gateway never hears about it.
    const afterFirst = await cdp.eval<string>(`document.querySelector('#rate-form [name="currency"]').value`);
    must(afterFirst === "USD", `REGRESSION: the currency field was emptied by the first submit (got ${JSON.stringify(afterFirst)}) — the second rate will never reach the gateway`);
    const codeKept = await cdp.eval<string>(`document.querySelector('#rate-form [name="serviceCode"]').value`);
    must(codeKept === "HVAC_REPAIR", `the service code should survive a submit for the next row, got ${JSON.stringify(codeKept)}`);

    await cdp.eval(fillAndSubmit("rate-form", { serviceCode: "HVAC_REPAIR", rateMinor: "10500", effectiveFrom: "2026-10-01" }));
    try {
      await cdp.waitFor(gridRow("10500"), "the SECOND rate as a row in the grid — the regression this file exists for", 8_000);
    } catch (e) {
      const diag = await cdp.eval<Record<string, unknown>>(`(() => {
        const f = document.getElementById("rate-form");
        const vals = {};
        for (const el of f.elements) if (el.name) vals[el.name] = el.value;
        return {
          refusal: document.querySelector(".ac-refusal")?.innerText ?? null,
          notice: document.querySelector(".s2-notice, [role=status]")?.innerText ?? null,
          formValid: f.checkValidity(),
          invalid: [...f.elements].filter(el => el.willValidate && !el.checkValidity()).map(el => el.name + ": " + el.validationMessage),
          values: vals,
        };
      })()`);
      throw new Error(`the second rate never landed.\n${JSON.stringify(diag, null, 2)}\n\noriginal: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
    const grid = await cdp.eval<string>(text);
    must(/9500/.test(grid) && /10500/.test(grid), "both rates should be listed");
    must(/2026-10-01/.test(grid), "the second row's first day should be shown");
    check(12, "the SECOND rate of the session reaches the gateway, and closes the first");

    // ── 13. the close is real: the earlier row is no longer open-ended
    const closed = await cdp.eval<boolean>(`(() => {
      const rows = [...document.querySelectorAll("tr")].map(r => r.innerText);
      const first = rows.find(r => /9500/.test(r));
      return !!first && !/open/.test(first);
    })()`);
    must(closed, "the row that was in effect should be closed at the new first day, not left open");
    check(13, "the row that was in effect is closed at the new day — one price per day");

    console.log(`\ndrive-s2-c4: ${passed} checks passed`);
  } finally {
    if (cdp) await cdp.close();
    site?.close();
    // Wait for the gateway to actually go, not just to be asked: its pool holds
    // connections to the scratch database, and dropping out from under a live
    // backend is how a green run exits 1.
    if (gateway && gateway.exitCode === null) {
      gateway.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((r) => gateway!.once("exit", () => r())),
        new Promise<void>((r) => setTimeout(() => { gateway!.kill("SIGKILL"); r(); }, 5_000)),
      ]);
    }
    await pool.end().catch(() => {});
    if (ownScratch) {
      // FORCE, because the gateway's pool may not have finished closing, and a
      // scratch database left behind is the next run's mystery.
      const c = await admin0.connect().catch(() => null);
      if (c) {
        try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } catch (e) { console.warn(`drive-s2-c4: could not drop ${SCRATCH}: ${String(e)}`); } finally { c.release(); }
      }
    }
    await admin0.end().catch(() => {});
  }
}

main().catch((e) => { console.error(`\ndrive-s2-c4 FAILED after ${passed} checks\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
