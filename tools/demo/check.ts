/** Drives the built demo in headless Chromium: every surface boots, renders, and reports no frame errors. */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Cdp, findChrome } from "../ci/cdp.ts";

const PAGE = fileURLToPath(new URL("./dist/index.html", import.meta.url));
const SHOTS = fileURLToPath(new URL("./dist/shots/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const chrome = findChrome();
if (!chrome) throw new Error("no chrome");
const cdp = await Cdp.launch(chrome);
const frameText = (id: string) => `(() => { const f = [...document.querySelectorAll("iframe")].find((x) => x.title.startsWith("${id} ")); return f && f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerText : ""; })()`;
const shot = async (name: string) => {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
  writeFileSync(`${SHOTS}${name}.png`, Buffer.from(r.data, "base64"));
};
try {
  await cdp.openTab("about:blank");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp.navigate(`file://${PAGE}`);
  await cdp.waitFor(`typeof ACDemo !== "undefined"`, "launcher");
  for (const id of (process.argv[2] ?? "S1,S2,S3,S4,S5,S6,S7,S8").split(",")) {
    await cdp.eval(`document.querySelector('.tab[data-id="${id}"]').click()`);
    await new Promise((r) => setTimeout(r, 2500));
    const text = await cdp.eval<string>(frameText(id));
    console.log(`=== ${id}\n${text.slice(0, 700)}\n`);
    await shot(id);
  }
  const errors = JSON.parse(await cdp.eval<string>(`JSON.stringify(window.__demoErrors || [])`)) as string[];
  console.log("errors:", errors);
  // A frame error is a broken demo, not a line to skim past.
  if (errors.length > 0) process.exitCode = 1;
} finally { await cdp.close(); }
