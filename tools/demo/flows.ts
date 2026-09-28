/** Clicks through the demo's walkthroughs in headless Chromium, across frames, and prints what each surface says back. */
import { fileURLToPath } from "node:url";
import { Cdp, findChrome } from "../ci/cdp.ts";

const PAGE = fileURLToPath(new URL("./dist/index.html", import.meta.url));
const cdp = await Cdp.launch(findChrome()!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inFrame = <T>(id: string, body: string) => cdp.eval<T>(`(() => { const f = [...document.querySelectorAll("iframe")].find((x) => x.title.startsWith("${id} ")); const w = f.contentWindow, d = f.contentDocument;
  const setV = (el, v) => { const p = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(p, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  const byText = (sel, t) => [...d.querySelectorAll(sel)].find((e) => e.textContent.trim() === t);
  const rowWith = (t) => [...d.querySelectorAll("tr, li, article, section, div")].reverse().find((e) => e.textContent.includes(t) && e.querySelector("button, a"));
  ${body} })()`);
const text = (id: string) => inFrame<string>(id, `return d.body.innerText;`);
const tab = async (id: string) => { await cdp.eval(`document.querySelector('.tab[data-id="${id}"]').click()`); await sleep(1500); };
const nav = async (id: string, path: string) => { await inFrame(id, `w.postMessage({ ac: "demo", type: "nav", path: ${JSON.stringify(path)} }, "*");`); await sleep(1200); };
const show = async (label: string, id: string, n = 600) => console.log(`--- ${label}\n${(await text(id)).replace(/\n+/g, " | ").slice(0, n)}\n`);

try {
  await cdp.openTab("about:blank");
  await cdp.navigate(`file://${PAGE}`);
  await cdp.waitFor(`typeof ACDemo !== "undefined"`, "launcher");
  await sleep(1500);

  // S3: the gate refuses Crew B, then S2 verifies, then S3 assigns South Crew 1.
  await tab("S3");
  await inFrame("S3", `byText("a, button", "Dispatch").click();`);
  await sleep(1500);
  await show("S3 dispatch candidates", "S3", 1200);
  await tab("S2");
  await nav("S2", "/network/crews/e0000000-0000-0000-0000-0000000000a2/documents");
  await show("S2 Crew B documents", "S2", 900);
  await inFrame("S2", `byText("button", "Verify").click();`);
  await sleep(1200);
  await show("S2 after verify", "S2", 900);
  await tab("S3");
  await nav("S3", "/board");
  await inFrame("S3", `byText("a, button", "Dispatch").click();`);
  await sleep(1500);
  await show("S3 candidates after verify", "S3", 1200);
  await inFrame("S3", `const r = rowWith("South Crew 1"); [...r.querySelectorAll("button")].find((b) => b.textContent.trim() === "Assign").click();`);
  await sleep(1500);
  await show("S3 after assign", "S3", 900);

  // S5: the technician sees it.
  await tab("S5");
  await sleep(500);
  await inFrame("S5", `d.querySelector("form").requestSubmit();`);
  await sleep(1800);
  await show("S5 jobs", "S5", 700);

  // S8: enroll, retire refused, acknowledge.
  await tab("S8");
  await nav("S8", "/crews");
  await inFrame("S8", `setV(d.getElementById("enroll-label"), "Lone Star — Crew C"); d.getElementById("enroll-form").requestSubmit();`);
  await sleep(1500);
  await show("S8 after enroll", "S8", 900);
  await inFrame("S8", `const r = rowWith("Lone Star — Crew A"); [...r.querySelectorAll("button")].find((b) => b.textContent.trim() === "Retire").click();`);
  await sleep(1500);
  await show("S8 retire Crew A", "S8", 900);
  await nav("S8", "/statements/s0000000-0000-0000-0000-000000000001");
  await inFrame("S8", `d.getElementById("acknowledge-form").requestSubmit();`);
  await sleep(1500);
  await show("S8 after acknowledge", "S8", 900);
  await tab("S2");
  await nav("S2", "/network/f0000000-0000-0000-0000-00000000000a");
  await show("S2 network Lone Star (expects Crew C)", "S2", 1200);

  // S6: request service.
  await tab("S6");
  await nav("S6", "/request");
  await inFrame("S6", `const s = d.getElementById("request-site"); s.value = s.options[s.options.length - 1].value; s.dispatchEvent(new Event("change", { bubbles: true })); setV(d.getElementById("request-description"), "Thermostat in studio B reads 84°F."); d.getElementById("request-form").requestSubmit();`);
  await sleep(1500);
  await show("S6 after request", "S6", 700);

  // S1: a lead, then one while the gateway is down, then recovery.
  await tab("S1");
  await nav("S1", "/enquire");
  const lead = (name: string) => inFrame("S1", `setV(d.getElementById("lead-name"), ${JSON.stringify(name)}); setV(d.getElementById("lead-phone"), "512-555-0199"); d.getElementById("lead-form").requestSubmit();`);
  await lead("Jordan Reyes");
  await sleep(1500);
  await show("S1 after submit", "S1", 500);
  await cdp.eval(`document.getElementById("outage").click()`);
  await nav("S1", "/enquire");
  await lead("Sam Okafor");
  await sleep(2000);
  await show("S1 while down", "S1", 700);
  await cdp.eval(`document.getElementById("outage").click()`);
  await sleep(4000);
  await show("S1 after recovery", "S1", 700);

  console.log("--- log", await cdp.eval<string>(`document.getElementById("log").innerText.split("\\n").slice(0, 40).join(" | ")`));
  console.log("errors:", await cdp.eval(`JSON.stringify(window.__demoErrors || [])`));
} finally { await cdp.close(); }
