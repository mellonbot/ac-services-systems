#!/usr/bin/env node
/**
 * Renders one turn of a yard model to 36 transparent 256px frames.
 *
 *   node tools/icons/render.mjs <rtu|truck> <frames-dir>
 *
 * Models are S1's own (apps/s1-marketing/public/<m>.glb); three.js is S1's
 * install, so run `pnpm install` first. Needs playwright-core on the path and
 * a Chromium (PW_CHROMIUM, default /opt/pw-browsers/chromium). compose.sh
 * turns the frames into the favicon.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const S1 = path.join(HERE, "../../apps/s1-marketing");
const FRAMES = 36;
const [model, out] = process.argv.slice(2);
if (!model || !out) { console.error("usage: node tools/icons/render.mjs <rtu|truck> <frames-dir>"); process.exit(2); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".glb": "model/gltf-binary" };
const resolve = (url) =>
  url === "/" ? path.join(HERE, "turntable.html")
  : url.startsWith("/model/") ? path.join(S1, "public", path.basename(url))
  : url.startsWith("/three/") ? path.join(S1, "node_modules/three", url.slice("/three/".length))
  : null;
const server = http.createServer((q, s) => {
  const f = resolve(decodeURIComponent(q.url.split("?")[0]));
  if (!f) { s.writeHead(404); return s.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" }); s.end(b);
  });
}).listen(0);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error(e));
await page.goto(`http://localhost:${server.address().port}/?m=${model}`);
await page.waitForFunction(() => window.ready, null, { timeout: 60_000 });
fs.mkdirSync(out, { recursive: true });
for (let i = 0; i < FRAMES; i++) {
  const uri = await page.evaluate((a) => window.frame(a), (i / FRAMES) * Math.PI * 2);
  fs.writeFileSync(path.join(out, `f${String(i).padStart(2, "0")}.png`), Buffer.from(uri.split(",")[1], "base64"));
}
await browser.close();
server.close();
