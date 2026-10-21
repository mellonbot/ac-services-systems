// One-off write smoke, LOCAL ac_dev only — not part of dist. Drives the real window:
// Customer Portal → Add (whole company) → Edit name → Remove, checking each step in SQL.
// Run after `npm run build`: `npx electron smoke-write.cjs` (needs the ac-pg docker container).
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");

const sql = (q) => execFileSync("docker", ["exec", "ac-pg", "psql", "-U", "postgres", "-d", "ac_dev", "-At", "-c", q], { encoding: "utf8" }).trim();
const email = `smoke-${Date.now()}@ac.test`;

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
  const set = (name, value) => js(`(() => { const el = document.querySelector("#form [name=${name}]"); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("change")); })()`);

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
};

require("./dist/main.cjs");
app.on("browser-window-created", (_e, win) => {
  win.webContents.once("did-finish-load", () => {
    run(win).then(() => { console.log("SMOKE OK"); app.quit(); }, (e) => { console.error("SMOKE FAILED:", e.message); app.exit(1); });
  });
});
