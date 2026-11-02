import { test } from "node:test";
import assert from "node:assert/strict";
import { registerOfflineShell } from "./offline-shell.ts";

test("the offline shell registers /sw.js for the whole site, and a browser that cannot is left alone", async () => {
  const seen: [string, { scope: string }][] = [];
  registerOfflineShell({ navigator: { serviceWorker: { register: async (url, opts) => { seen.push([url, opts]); } } } });
  assert.deepEqual(seen, [["/sw.js", { scope: "/" }]]);
  registerOfflineShell({ navigator: {} });
  registerOfflineShell({ navigator: { serviceWorker: { register: () => Promise.reject(new Error("404")) } } });
  registerOfflineShell({ navigator: { serviceWorker: { register: () => { throw new Error("SecurityError"); } } } });
  await new Promise((r) => setTimeout(r, 0));
});
