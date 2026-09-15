#!/usr/bin/env node
/**
 * Builds a surface's browser bundle. THE ONE BUILD STEP in the repository, and
 * the tests do not use it — component and screen logic run under `node --test`
 * against the same .ts files this bundles.
 *
 *   node tools/ci/build-surface.ts S2            one surface
 *   node tools/ci/build-surface.ts --all         every enabled surface
 *   node tools/ci/build-surface.ts S2 --minify   release build
 *
 * Output, in apps/<app>/dist/ (gitignored):
 *   index.html   the frame, copied from apps/<app>/frame.html (emitted from the registry)
 *   bundle.js    esbuild of src/main.ts — esm, es2022, browser, sourcemapped
 *   bundle.js.map
 *   ui.css       packages/ui UI_CSS — roles only, no colours
 *
 * No config file exists to drift: the options are here, beside the guard that
 * reads the same repo. esbuild resolves `preact` from packages/ui alone, which
 * is where it is declared; a surface that imported it directly would fail to
 * resolve under .npmrc isolation before the guard ever ran.
 *
 * Needs `pnpm install` (esbuild is a native binary). That is the whole
 * dependency of the build path; the guard and the unit suite need nothing.
 */
import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { SURFACES, SURFACE_IDS, type SurfaceId } from "../../packages/contracts/src/index.ts";
import { UI_CSS } from "../../packages/ui/src/styles.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export type BuildReport = {
  readonly id: SurfaceId;
  readonly outDir: string;
  readonly bundleBytes: number;
  readonly bundleGzipBytes: number;
  readonly files: readonly string[];
};

export const buildSurface = async (id: SurfaceId, opts: { minify?: boolean } = {}): Promise<BuildReport> => {
  const s = SURFACES[id];
  const appDir = join(ROOT, "apps", s.app);
  const outDir = join(appDir, "dist");
  const entry = join(appDir, "src/main.ts");
  const frame = join(appDir, "frame.html");
  if (!existsSync(frame)) throw new Error(`${id}: no frame.html — run \`node tools/ci/emit-surfaces.ts\``);
  mkdirSync(outDir, { recursive: true });

  const result = await build({
    entryPoints: [entry],
    outfile: join(outDir, "bundle.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    minify: opts.minify ?? false,
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
    define: { "process.env.NODE_ENV": JSON.stringify(opts.minify ? "production" : "development") },
  });
  if (result.errors.length) throw new Error(result.errors.map((e) => e.text).join("\n"));

  // The bundle must be browser-only. A node: import that esbuild left in place
  // (platform: browser does not polyfill) would throw at module evaluation.
  const bundle = readFileSync(join(outDir, "bundle.js"), "utf8");
  const leak = /from\s*["']node:|require\(\s*["']node:/.exec(bundle);
  if (leak) throw new Error(`${id}: bundle imports a node: module (${leak[0]}) — something below the shell reached for the platform`);

  writeFileSync(join(outDir, "ui.css"), UI_CSS);
  writeFileSync(join(outDir, "index.html"), readFileSync(frame, "utf8"));

  const inputs = Object.keys(result.metafile?.inputs ?? {});
  return {
    id,
    outDir,
    bundleBytes: statSync(join(outDir, "bundle.js")).size,
    bundleGzipBytes: gzipSync(bundle).length,
    files: inputs,
  };
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const minify = args.includes("--minify");
  const ids: SurfaceId[] = args.includes("--all")
    ? SURFACE_IDS.filter((id) => SURFACES[id].enabled)
    : args.filter((a): a is SurfaceId => (SURFACE_IDS as readonly string[]).includes(a));
  if (ids.length === 0) {
    console.error("usage: node tools/ci/build-surface.ts <S1..S8> [--minify] | --all");
    process.exit(2);
  }
  for (const id of ids) {
    const r = await buildSurface(id, { minify });
    const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
    console.log(`build-surface: ${id} → ${r.outDir.replace(ROOT, "")}  bundle ${kb(r.bundleBytes)} (${kb(r.bundleGzipBytes)} gzip), ${r.files.length} modules${minify ? ", minified" : ""}`);
  }
}
