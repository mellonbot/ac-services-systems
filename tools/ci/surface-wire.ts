/**
 * The textual half of no-db-in-surface and no-fetch-in-surface, for the
 * zero-install guard (schema-guard.ts §5). Patterns over source text, so they
 * are kept here where a test can show each spelling fires.
 */

/** A database driver, imported statically or loaded with `import("pg")`. */
export const importsDriver = (src: string): boolean =>
  /(from\s+|import\s*\(\s*)["'](pg|postgres|drizzle-orm|knex|typeorm|mysql2?)["']/.test(src);

const WIRE = "fetch|EventSource|XMLHttpRequest|WebSocket";

/**
 * The surface's boot handing the platform's fetch to the shell — the one
 * sanctioned mention, since the shell gives it to the SDK runtime and nobody else.
 */
const HANDED_TO_SHELL = /\bfetch:\s*globalThis\.fetch\.bind\(globalThis\)/g;

/**
 * The wire touched directly: `fetch(` / `new WebSocket(`; anything off the
 * global object — `globalThis.fetch(`, `new window.WebSocket(`,
 * `const f = globalThis.fetch`; and `const f = fetch;`.
 */
export const touchesWire = (src: string): boolean => {
  const s = src.replace(HANDED_TO_SHELL, "");
  return new RegExp(`(^|[^.\\w])(${WIRE})\\s*\\(`).test(s) ||
    new RegExp(`\\b(globalThis|window|self)\\s*(\\.\\s*|\\[\\s*["'])(${WIRE})\\b`).test(s) ||
    new RegExp(`=\\s*(${WIRE})\\s*;`).test(s);
};
