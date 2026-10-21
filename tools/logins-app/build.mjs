import { build } from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tokenCss } from "../../packages/tokens/src/css.ts";
import { LOCAL_DEFAULT } from "./src/connections.ts";

const dist = fileURLToPath(new URL("./dist/", import.meta.url));
const src = fileURLToPath(new URL("./src/", import.meta.url));
mkdirSync(dist, { recursive: true });

const node = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron", "pg-native"], logLevel: "warning" };
await build({ ...node, entryPoints: [`${src}main.ts`], outfile: `${dist}main.cjs` });
await build({ ...node, entryPoints: [`${src}preload.ts`], outfile: `${dist}preload.cjs` });
await build({ entryPoints: [`${src}renderer/app.ts`], outfile: `${dist}renderer.js`, bundle: true, platform: "browser", format: "esm", target: "es2022", logLevel: "warning",
  define: { LOCAL_DEFAULT: JSON.stringify(LOCAL_DEFAULT) } });

copyFileSync(`${src}renderer/index.html`, `${dist}index.html`);
copyFileSync(`${src}renderer/app.css`, `${dist}app.css`);
// tokenCss already returns a `:root{…}` block.
writeFileSync(`${dist}tokens.css`, tokenCss("console"));
