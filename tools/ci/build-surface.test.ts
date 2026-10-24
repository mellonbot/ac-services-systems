/** Needs esbuild (build-surface imports it): the zero-install guard skips this file, saying so. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let mod: typeof import("./build-surface.ts") | null = null;
try { mod = await import("./build-surface.ts"); } catch { /* esbuild not installed */ }
const skip = mod ? false : "esbuild is not installed — run after pnpm install";

test("leakedNodeImport reads the chunks, not only bundle.js", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ac-build-"));
  try {
    writeFileSync(join(dir, "bundle.js"), `import("./chunks/a.js");`);
    mkdirSync(join(dir, "chunks"));
    writeFileSync(join(dir, "chunks/a.js"), `export const x = 1;`);
    assert.equal(mod!.leakedNodeImport(dir), null);
    writeFileSync(join(dir, "chunks/b.js"), `import { readFileSync } from "node:fs";`);
    assert.match(mod!.leakedNodeImport(dir) ?? "", /chunks\/b\.js imports a node: module/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a production (minified) build emits no source map, and clears one an earlier build left", { skip }, async () => {
  const dev = await mod!.buildSurface("S4");
  assert.ok(existsSync(join(dev.outDir, "bundle.js.map")), "a development build keeps its map");
  const prod = await mod!.buildSurface("S4", { minify: true });
  const maps = [...readdirSync(prod.outDir, { recursive: true })].map(String).filter((f) => f.endsWith(".map"));
  assert.deepEqual(maps, []);
});
