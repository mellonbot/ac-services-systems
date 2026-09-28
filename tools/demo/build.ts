#!/usr/bin/env node
/**
 * THE CLICKABLE DEMO — every built surface, the real bundles, one page.
 *
 *   node tools/demo/build.ts        → tools/demo/dist/index.html
 *
 * Each surface (all but S7) is bundled from its own src/app.ts exactly as
 * tools/ci/build-surface.ts bundles it, with two substitutions and nothing
 * else:
 *   - the History API behind `browserHistory` is swapped for an in-memory path,
 *     because a surface frame here is a srcdoc document and has no URL of its own;
 *   - `fetch` in the frame posts to the launcher, where tools/demo/gateway.ts
 *     answers the catalogue from seeded data.
 * Screens, components, the shell, the generated client, the refusal mapping and
 * the degraded flag are the product's own code, unmodified.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { SURFACES, type SurfaceId } from "../../packages/contracts/src/index.ts";
import { UI_CSS } from "../../packages/ui/src/styles.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HERE = fileURLToPath(new URL("./", import.meta.url));
const OUT = join(HERE, "dist");
const BUILT: SurfaceId[] = ["S1", "S2", "S3", "S4", "S5", "S6", "S8"];
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Yellowtail&display=swap">`;

const memoryHistory: Plugin = {
  name: "demo-memory-history",
  setup(b) {
    b.onLoad({ filter: /packages[\\/]ui[\\/]src[\\/]router\.ts$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const out = src
        .replace("path: () => w.location.pathname,", "path: () => ((globalThis as any).__acPath ?? \"/\"),")
        .replace("push: (p) => w.history.pushState(null, \"\", p),", "push: (p) => { (globalThis as any).__acPath = p; (globalThis as any).__acNavigated?.(p); },");
      if (out === src || !out.includes("__acNavigated")) throw new Error("router.ts no longer matches the demo's history patch — update tools/demo/build.ts");
      return { contents: out, loader: "ts" };
    });
  },
};

/** Runs in each surface frame before its bundle: the frame's fetch, by postMessage to the launcher. */
const prelude = (id: SurfaceId) => `(() => {
  const SURFACE = ${JSON.stringify(id)};
  let n = 0;
  const pending = new Map(), streams = new Set();
  const enc = new TextEncoder();
  const post = (m) => parent.postMessage(Object.assign({ ac: "demo", surface: SURFACE }, m), "*");
  globalThis.__acPath = "/";
  globalThis.__acNavigated = (p) => post({ type: "path", path: p });
  const setValue = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m || m.ac !== "demo") return;
    if (m.type === "res") { const r = pending.get(m.id); pending.delete(m.id); if (r) r(m); }
    else if (m.type === "event") { const f = enc.encode("event: domain\\ndata: " + JSON.stringify(m.env) + "\\n\\n"); for (const c of streams) { try { c.enqueue(f); } catch { streams.delete(c); } } }
    else if (m.type === "nav") { globalThis.__acPath = m.path; dispatchEvent(new PopStateEvent("popstate")); post({ type: "path", path: m.path }); }
    else if (m.type === "online") { dispatchEvent(new Event("online")); }
    else if (m.type === "fill") { for (const [k, v] of Object.entries(m.values)) { const el = document.querySelector('input[name="' + k + '"]'); if (el) setValue(el, v); } }
  });
  globalThis.fetch = (url, init = {}) => {
    const u = String(url);
    if (new URL(u).pathname === "/events") {
      let ctl;
      const body = new ReadableStream({ start(c) { ctl = c; streams.add(c); }, cancel() { streams.delete(ctl); } });
      init.signal && init.signal.addEventListener("abort", () => { streams.delete(ctl); try { ctl.close(); } catch {} });
      return Promise.resolve({ status: 200, ok: true, body, json: async () => ({}), text: async () => "" });
    }
    const id = ++n;
    return new Promise((resolve, reject) => {
      pending.set(id, (m) => {
        if (m.offline) { reject(new TypeError("Failed to fetch")); return; }
        resolve({ status: m.status, ok: m.status >= 200 && m.status < 300, json: async () => m.body, text: async () => JSON.stringify(m.body) });
      });
      post({ type: "req", id, url: u, method: init.method || "GET", headers: init.headers || {}, body: init.body });
    });
  };
  addEventListener("error", (e) => post({ type: "error", message: String(e.message) }));
  addEventListener("unhandledrejection", (e) => post({ type: "error", message: String(e.reason && (e.reason.stack || e.reason.message) || e.reason) }));
})();`;

const inlineScript = (js: string) => js.replace(/<\/script/gi, "<\\/script");

const bundleSurface = async (id: SurfaceId): Promise<string> => {
  const s = SURFACES[id];
  const appDir = join(ROOT, "apps", s.app);
  const r = await build({
    entryPoints: [join(appDir, "src/app.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
    minify: true, legalComments: "none", logLevel: "silent", plugins: [memoryHistory],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  const js = r.outputFiles[0]!.text;
  const frame = readFileSync(join(appDir, "frame.html"), "utf8")
    .replace('<meta name="ac-gateway" content="">', '<meta name="ac-gateway" content="https://api.rankine.demo">')
    .replace('<link rel="stylesheet" href="/ui.css">', `${FONTS}<style>${UI_CSS}</style>`)
    .replace('<script type="module" src="/bundle.js"></script>', `<script>${inlineScript(prelude(id))}</script><script>${inlineScript(js)}</script>`);
  if (!frame.includes("__acNavigated")) throw new Error(`${id}: frame.html no longer has the slots the demo fills`);
  return frame;
};

const bundleGateway = async (): Promise<string> => {
  const r = await build({
    entryPoints: [join(HERE, "gateway.ts")], bundle: true, write: false, format: "iife", globalName: "ACDemo", platform: "browser", target: "es2022",
    minify: true, legalComments: "none", logLevel: "silent",
  });
  return r.outputFiles[0]!.text;
};

const frames: Record<string, string> = {};
for (const id of BUILT) frames[id] = await bundleSurface(id);
const surfaces = (Object.keys(SURFACES) as SurfaceId[]).map((id) => ({ id, name: SURFACES[id].name, phase: SURFACES[id].phase, block: SURFACES[id].block, built: BUILT.includes(id), density: SURFACES[id].density, authScope: SURFACES[id].authScope }));
const tokens = /<style>(:root\{[^<]*\})<\/style>/.exec(readFileSync(join(ROOT, "apps/s2-service-manager/frame.html"), "utf8"))![1]!;
const badge = /<svg class="ac-badge-mark__svg"[\s\S]*?<\/svg>/.exec(readFileSync(join(ROOT, "apps/s2-service-manager/frame.html"), "utf8"))![0].replace('width="40" height="40"', 'width="36" height="36" aria-hidden="true"');
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const gateway = await bundleGateway();
const final = readFileSync(join(HERE, "launcher.html"), "utf8")
  .replace("/*__TOKENS__*/", () => tokens)
  .replace("<!--__FONTS__-->", () => FONTS)
  .replace("<!--__BADGE__-->", () => badge)
  .replace("/*__GATEWAY__*/", () => inlineScript(gateway))
  .replace("/*__DATA__*/", () => inlineScript(`const FRAMES = ${json(frames)};\nconst SURFACE_LIST = ${json(surfaces)};`));
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.html"), final);
console.log(`demo: ${BUILT.join(" ")} → ${join(OUT, "index.html").replace(ROOT, "")}  ${(final.length / 1024).toFixed(0)} KB`);
