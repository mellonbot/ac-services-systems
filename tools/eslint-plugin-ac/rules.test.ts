/**
 * The surface-layer rules fire on the spellings that used to slip past them.
 * Needs eslint, so it runs where the repo is installed (guard's `full` job and
 * any laptop); the zero-install guard has no eslint and skips it, saying so.
 */
import { test, describe, it } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SURFACE = join(ROOT, "apps/s2-service-manager/src/app.ts");

let eslint: typeof import("eslint") | null = null;
try { eslint = await import("eslint"); } catch { /* not installed */ }

if (!eslint) {
  test("eslint-plugin-ac rules", { skip: "eslint is not installed — run after pnpm install" }, () => {});
} else {
  const { RuleTester } = eslint;
  // RuleTester reports through describe/it when they exist; hand it node:test's.
  Object.assign(RuleTester, { describe, it, itOnly: it.only });
  const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: "module" } });
  const { default: noDb } = await import("./rules/no-db-in-surface.js");
  const { default: noFetch } = await import("./rules/no-fetch-in-surface.js");

  tester.run("no-db-in-surface", noDb, {
    valid: [
      { code: `import { x } from "../../../packages/contracts/src/scope.ts";`, filename: SURFACE },
      { code: `const m = await import("./screens.ts");`, filename: SURFACE },
    ],
    invalid: [
      { code: `import pg from "pg";`, filename: SURFACE, errors: [{ messageId: "banned" }] },
      { code: `import { t } from "@ac/schema";`, filename: SURFACE, errors: [{ messageId: "banned" }] },
      // The repo imports by relative .ts path: the @ac/schema ban alone never fired.
      { code: `import { t } from "../../../packages/schema/src/tenancy.ts";`, filename: SURFACE, errors: [{ messageId: "banned" }] },
      { code: `export { t } from "../../../packages/schema/src/index.ts";`, filename: SURFACE, errors: [{ messageId: "banned" }] },
      { code: `const pg = await import("pg");`, filename: SURFACE, errors: [{ messageId: "banned" }] },
    ],
  });

  tester.run("no-fetch-in-surface", noFetch, {
    valid: [
      { code: `const app = createApp({ baseUrl, fetch: globalThis.fetch.bind(globalThis), window });`, filename: SURFACE },
      { code: `shell.gateway.listJobs({});`, filename: SURFACE },
      { code: `const f = opts.fetch;`, filename: SURFACE },
    ],
    invalid: [
      { code: `fetch("/x");`, filename: SURFACE, errors: [{ messageId: "global" }] },
      { code: `globalThis.fetch("/x");`, filename: SURFACE, errors: [{ messageId: "global" }] },
      { code: `window.fetch("/x");`, filename: SURFACE, errors: [{ messageId: "global" }] },
      { code: `const f = globalThis.fetch; f("/x");`, filename: SURFACE, errors: [{ messageId: "global" }] },
      { code: `const f = fetch;`, filename: SURFACE, errors: [{ messageId: "global" }] },
      { code: `new window.WebSocket("wss://x");`, filename: SURFACE, errors: [{ messageId: "global" }] },
      { code: `new globalThis["EventSource"]("/e");`, filename: SURFACE, errors: [{ messageId: "global" }] },
      { code: `new WebSocket("wss://x");`, filename: SURFACE, errors: [{ messageId: "global" }] },
    ],
  });
}
