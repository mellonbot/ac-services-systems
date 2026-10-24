#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACE_IDS, SURFACE_PATHS, SURFACES } from "../../packages/contracts/src/index.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT = join(ROOT, "dist", "pages");

const gatewayOrigin = (value: string | undefined): string => {
  if (!value?.trim()) throw new Error("AC_GATEWAY is required to build the unified site; set it to the production gateway origin in Cloudflare Pages build variables.");
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("AC_GATEWAY must be an HTTPS origin with no path, query, or fragment.");
  }
  return url.origin;
};

const redirectsForEnabledSurfaces = (): string => {
  const redirects = SURFACE_IDS
    .filter((id) => id !== "S1" && SURFACES[id].enabled)
    .flatMap((id) => {
      const path = SURFACE_PATHS[id];
      return [`${path} ${path}/ 308`, `${path}/* ${path}/index.html 200`];
    });
  redirects.push("/* /index.html 200");
  return `${redirects.join("\n")}\n`;
};

// bundle.js and ui.css keep their names across deploys, so Pages' default
// four-hour cache would leave a browser on the old bundle after a deploy.
// no-cache keeps the copy but revalidates its ETag on every load. chunks/ is
// named by content hash, so a copy is never stale: cache it for a year and skip
// the revalidation round trip.
export const headersForEnabledSurfaces = (): string =>
  SURFACE_IDS
    .filter((id) => SURFACES[id].enabled)
    .flatMap((id) => {
      const prefix = SURFACE_PATHS[id] === "/" ? "" : SURFACE_PATHS[id];
      return [
        ...["bundle.js", "ui.css"].map((file) => `${prefix}/${file}\n  Cache-Control: no-cache\n`),
        `${prefix}/chunks/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
      ];
    })
    .join("");

export const buildPages = async (gateway = gatewayOrigin(process.env.AC_GATEWAY)): Promise<void> => {
  // Loaded here, not at the top: build-surface pulls in esbuild, and the
  // zero-install guard runs this file's test with nothing installed.
  const { buildSurface } = await import("./build-surface.ts");
  rmSync(OUTPUT, { recursive: true, force: true });
  mkdirSync(OUTPUT, { recursive: true });

  for (const id of SURFACE_IDS.filter((surfaceId) => SURFACES[surfaceId].enabled)) {
    const basePath = SURFACE_PATHS[id];
    const built = await buildSurface(id, { minify: true, gateway, basePath });
    const target = basePath === "/" ? OUTPUT : join(OUTPUT, basePath.slice(1));
    // Never a source map: published, it is the surface's whole source.
    cpSync(built.outDir, target, { recursive: true, force: true, filter: (src) => !src.endsWith(".map") });
    console.log(`build-pages: ${id} → ${target.replace(ROOT, "")}`);
  }

  writeFileSync(join(OUTPUT, "_redirects"), redirectsForEnabledSurfaces());
  writeFileSync(join(OUTPUT, "_headers"), headersForEnabledSurfaces());
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await buildPages();
