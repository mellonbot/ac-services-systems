// One-off write smoke, LOCAL ac_dev only — not part of dist. Drives the real window, checking each step in SQL:
// Customer Portal → Add (whole company) → Edit name → Remove;
// Companies → Add Ours → Technician under it → Remove company refused → Remove technician → Remove company;
// Companies → Add Contractor (new firm) refused until data rights are chosen → Remove it.
// Run after `npm run build`: `npx electron smoke-write.cjs` (needs the ac-pg docker container).
const { app } = require("electron");
const { execFileSync } = require("node:child_process");

const sql = (q) => execFileSync("docker", ["exec", "ac-pg", "psql", "-U", "postgres", "-d", "ac_dev", "-At", "-c", q], { encoding: "utf8" }).trim();
const ts = Date.now();
const email = `smoke-${ts}@ac.test`;
const techEmail = `smoke-tech-${ts}@ac.test`;
const company = `Smoke Co ${ts}`;
const contractor = `Smoke Contractor ${ts}`;

const run = async (win) => {
  const js = (code) => win.webContents.executeJavaScript(code);
  const waitFor = async (code, what) => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const row = `[...document.querySelectorAll("#tbody tr")].find((tr) => tr.querySelector("td.email")?.firstChild?.textContent === ${JSON.stringify(email)})`;
  const set = (name, value) => js(`(() => { const el = document.querySelector("#form [name=${name}]"); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); })()`);

  await waitFor(`document.body.dataset.ready === "1"`, "first render");
  if (await js(`document.body.dataset.db`) !== "local") throw new Error("refusing: the window is not on Local");

  const orgId = sql(`SELECT o.id FROM organizations o WHERE o.kind = 'customer' AND o.active
    AND EXISTS (SELECT 1 FROM accounts a WHERE a.org_id = o.id AND a.tier = 'region' AND a.active) ORDER BY o.name LIMIT 1`);
  if (!orgId) throw new Error("no customer org with a region node in ac_dev");

  await js(`[...document.querySelectorAll("#kinds button")].find((b) => b.textContent.startsWith("Customer Portal")).click()`);
  await js(`document.getElementById("add").click()`);
  await waitFor(`document.getElementById("dialog").open && !!document.querySelector("#form [name=orgId]")`, "add form");
  await set("orgId", orgId);
  await waitFor(`!!document.querySelector("#form [name=node]")`, "account tree");
  console.log("tree options (NBSP shown as ·):", JSON.stringify(await js(`[...document.querySelectorAll("#form [name=node] option")].slice(0, 6).map((o) => o.textContent.replace(/\u00a0/g, "·"))`)));
  await set("node", "parent");
  const region = await js(`document.querySelector("#form [name=wholeRegion] option:not([value=''])").value`);
  await set("wholeRegion", region);
  await set("email", email);
  await set("displayName", "Smoke Test");
  await set("password", "smoke-password-123");
  await set("password2", "smoke-password-123");
  await js(`document.getElementById("form").requestSubmit()`);
  await waitFor(`!document.getElementById("dialog").open && !!${row}`, "the new row");
  console.log("after add:   ", sql(`SELECT namespace, scope_tier, display_name, active FROM users WHERE email = '${email}'`));

  await js(`[...${row}.querySelectorAll("button")].find((b) => b.textContent === "Edit").click()`);
  await waitFor(`document.getElementById("dialog").open && !!document.querySelector("#form [name=displayName]")`, "edit form");
  await set("displayName", "Smoke Test Edited");
  await js(`document.getElementById("form").requestSubmit()`);
  await waitFor(`!document.getElementById("dialog").open && ${row}?.children[1].textContent === "Smoke Test Edited"`, "the edited row");
  console.log("after edit:  ", sql(`SELECT namespace, scope_tier, display_name, active FROM users WHERE email = '${email}'`));

  await js(`[...${row}.querySelectorAll("button")].find((b) => b.textContent === "Remove").click()`);
  await waitFor(`!${row}`, "the row to leave the active list");
  console.log("after remove:", sql(`SELECT namespace, scope_tier, display_name, active FROM users WHERE email = '${email}'`));
  const banner = await js(`document.getElementById("banner").hidden ? "" : document.getElementById("banner").textContent`);
  if (banner) console.log("banner:", banner);

  // ── Companies ──
  const open = (name) => js(`[...document.querySelectorAll("#kinds button")].find((b) => b.querySelector(".name").textContent === ${JSON.stringify(name)}).click()`);
  const rowOf = (text) => `[...document.querySelectorAll("#tbody tr")].find((tr) => tr.querySelector("td")?.firstChild?.textContent === ${JSON.stringify(text)})`;
  const click = (row, label) => js(`[...${row}.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
  const check = (name, value) => js(`document.querySelector("#form [name=${name}][value=${value}]").click()`);
  const bannerText = `(document.getElementById("banner").hidden ? "" : document.getElementById("banner").textContent)`;

  await open("Companies");
  await js(`document.getElementById("add").click()`);
  await waitFor(`document.getElementById("dialog").open && !!document.querySelector("#form [name=type]")`, "add company form");
  await check("type", "ours");
  await set("name", company);
  await set("regionId", await js(`document.querySelector("#form [name=regionId] option:not([value=''])").value`));
  await js(`document.getElementById("form").requestSubmit()`);
  await waitFor(`!document.getElementById("dialog").open && !!${rowOf(company)}`, "the new company row");
  const crewId = sql(`SELECT id FROM crews WHERE label = '${company}'`);
  console.log("company added:   ", sql(`SELECT employment_type, firm_id IS NULL AS no_firm, region_id = home_region_id AS same_region, active FROM crews WHERE id = '${crewId}'`));
  console.log("company row:     ", JSON.stringify(await js(`[...${rowOf(company)}.querySelectorAll("td")].slice(0, 6).map((td) => td.textContent)`)));

  await open("Technician");
  await js(`document.getElementById("add").click()`);
  await waitFor(`document.getElementById("dialog").open && !!document.querySelector("#form [name=crewId]")`, "add technician form");
  console.log("picker groups:   ", JSON.stringify(await js(`[...document.querySelectorAll("#form [name=crewId] optgroup")].map((g) => g.label)`)));
  await set("crewId", crewId);
  await set("email", techEmail);
  await set("displayName", "Smoke Tech");
  await set("password", "smoke-password-123");
  await set("password2", "smoke-password-123");
  await js(`document.getElementById("form").requestSubmit()`);
  await waitFor(`!document.getElementById("dialog").open && !!${rowOf(techEmail)}`, "the technician row");
  console.log("technician added:", sql(`SELECT crew_id = '${crewId}' AS under_company, namespace, roles, active FROM users WHERE email = '${techEmail}'`));

  await open("Companies");
  await waitFor(`!!${rowOf(company)}`, "the company row");
  await click(rowOf(company), "Remove");
  await waitFor(`${bannerText}.includes("Move its 1 technician")`, "the refusal");
  console.log("remove refused:  ", await js(bannerText), "| active:", sql(`SELECT active FROM crews WHERE id = '${crewId}'`));

  await open("Technician");
  await waitFor(`!!${rowOf(techEmail)}`, "the technician row");
  await click(rowOf(techEmail), "Remove");
  await waitFor(`!${rowOf(techEmail)}`, "the technician to leave the active list");
  console.log("technician removed:", sql(`SELECT active FROM users WHERE email = '${techEmail}'`));

  await open("Companies");
  await waitFor(`!!${rowOf(company)}`, "the company row");
  await click(rowOf(company), "Remove");
  await waitFor(`!${rowOf(company)}`, "the company to leave the active list");
  console.log("company removed: ", sql(`SELECT active FROM crews WHERE id = '${crewId}'`), "| banner:", JSON.stringify(await js(bannerText)));

  await js(`document.getElementById("add").click()`);
  await waitFor(`document.getElementById("dialog").open && !!document.querySelector("#form [name=type]")`, "add company form");
  await check("type", "contractor");
  await check("firmMode", "new");
  await set("legalName", contractor);
  console.log("name follows legal name:", await js(`document.querySelector("#form [name=companyName]").value`) === contractor,
    "| terms prefilled:", await js(`document.querySelector("#form [name=paymentTermsDays]").value`),
    "| rights checked:", await js(`[...document.querySelectorAll("#form [name=dataRights]")].filter((r) => r.checked).length`));
  await set("firmRegionId", await js(`document.querySelector("#form [name=firmRegionId] option:not([value=''])").value`));
  await js(`document.getElementById("form").requestSubmit()`);
  await waitFor(`document.querySelector("#form .form-error")?.textContent === "Choose whether diagnostic data rights are reserved"`, "the data-rights refusal");
  console.log("unchosen rights: ", await js(`document.querySelector("#form .form-error").textContent`), "| firms:", sql(`SELECT count(*) FROM subcontractor_firms WHERE legal_name = '${contractor}'`));
  await check("dataRights", "no");
  await js(`document.getElementById("form").requestSubmit()`);
  await waitFor(`!document.getElementById("dialog").open && !!${rowOf(contractor)}`, "the contractor row");
  console.log("contractor added:", sql(`SELECT f.status, f.settlement_terms_days, f.diagnostic_data_rights_reserved, f.msa_signed_at IS NULL, o.kind, c.employment_type, c.org_id = f.org_id
    FROM crews c JOIN subcontractor_firms f ON f.id = c.firm_id JOIN organizations o ON o.id = f.org_id WHERE c.label = '${contractor}' AND c.active`));
  console.log("contractor row:  ", JSON.stringify(await js(`[...${rowOf(contractor)}.querySelectorAll("td")].slice(0, 7).map((td) => td.textContent)`)));
  await click(rowOf(contractor), "Remove");
  await waitFor(`!${rowOf(contractor)}`, "the contractor to leave the active list");
  console.log("contractor removed:", sql(`SELECT active FROM crews WHERE label = '${contractor}'`));
};

require("./dist/main.cjs");
app.on("browser-window-created", (_e, win) => {
  win.webContents.once("did-finish-load", () => {
    run(win).then(() => { console.log("SMOKE OK"); app.quit(); }, (e) => { console.error("SMOKE FAILED:", e.message); app.exit(1); });
  });
});
