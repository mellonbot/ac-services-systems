import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtUrls, serviceWorker, OFFLINE_SURFACES } from "./offline-shell.ts";
import { headersForLiveSurfaces } from "./build-pages.ts";

const fakeDist = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "ac-sw-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
};

test("only the front door and the technician pages are kept offline", () => {
  assert.deepEqual([...OFFLINE_SURFACES], ["S1", "S5"]);
});

test("a built surface's files are kept under the URLs the site serves them at — pages as their directory, never a map", () => {
  const s1 = fakeDist({ "index.html": "<p>", "bundle.js": "1", "chunks/scene-AB.js": "2", "bundle.js.map": "{}", "fonts/plex.woff2": "f" });
  const s5 = fakeDist({ "index.html": "<p>", "bundle.js": "5" });
  try {
    assert.deepEqual(builtUrls("S1", s1).map((f) => f.url), ["/", "/bundle.js", "/chunks/scene-AB.js", "/fonts/plex.woff2"]);
    assert.deepEqual(builtUrls("S5", s5).map((f) => f.url), ["/technician/", "/technician/bundle.js"]);
  } finally { rmSync(s1, { recursive: true }); rmSync(s5, { recursive: true }); }
});

test("the worker's cache is named for its contents, and it answers only S1's and S5's own GETs", () => {
  const dir = fakeDist({ "index.html": "<p>", "bundle.js": "1" });
  try {
    const files = builtUrls("S1", dir);
    const a = serviceWorker(files);
    assert.equal(serviceWorker(files), a, "the same build, the same worker");
    writeFileSync(join(dir, "bundle.js"), "2");
    assert.notEqual(serviceWorker(files), a, "a new build is a new cache");
    assert.match(a, /url\.origin !== self\.location\.origin\) return null/, "never another origin — the gateway is one");
    assert.match(a, /req\.method !== "GET"\) return null/);
    assert.match(a, /"\/technician\/"/);
    assert.doesNotMatch(a, /service-manager|dispatch|customer/, "no other surface's path");
    assert.match(a, /fetch\(e\.request\)\.catch/, "network first; the cache only when that fails");
  } finally { rmSync(dir, { recursive: true }); }
});

test("sw.js revalidates on every load", () => {
  assert.match(headersForLiveSurfaces(), /^\/sw\.js\n  Cache-Control: no-cache$/m);
});
