import { test } from "node:test";
import assert from "node:assert/strict";
import { importsDriver, touchesWire } from "./surface-wire.ts";

test("importsDriver: a static import, and the dynamic import that used to slip past", () => {
  assert.equal(importsDriver(`import pg from "pg";`), true);
  assert.equal(importsDriver(`const { default: pg } = await import("pg");`), true);
  assert.equal(importsDriver(`const m = await import( 'postgres' );`), true);
  assert.equal(importsDriver(`import { x } from "./pg-url.ts";`), false);
});

test("touchesWire: every spelling of reaching the wire from a surface", () => {
  for (const src of [
    `fetch("/x")`,
    `await globalThis.fetch("/x")`,
    `window.fetch("/x")`,
    `const f = globalThis.fetch; f("/x");`,
    `const f = fetch;`,
    `new window.WebSocket("wss://x")`,
    `new WebSocket("wss://x")`,
    `new self["EventSource"]("/e")`,
  ]) assert.equal(touchesWire(src), true, src);
});

test("touchesWire: the boot's hand-off to the shell, and the client's own methods, are not the wire", () => {
  assert.equal(touchesWire(`const app = createApp({ baseUrl, fetch: globalThis.fetch.bind(globalThis), window });`), false);
  assert.equal(touchesWire(`await shell.gateway.listJobs({}); const f = opts.fetch;`), false);
});
