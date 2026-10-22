import { test } from "node:test";
import assert from "node:assert/strict";
import { headersForEnabledSurfaces } from "./build-pages.ts";

test("every enabled surface's bundle and stylesheet revalidate on each load", () => {
  const headers = headersForEnabledSurfaces();
  for (const path of ["/bundle.js", "/ui.css", "/dispatch/bundle.js", "/dispatch/ui.css"]) {
    assert.match(headers, new RegExp(`^${path.replaceAll(".", "\\.")}\\n  Cache-Control: no-cache$`, "m"));
  }
  assert.match(headers, /^\/chunks\/\*\n  Cache-Control: public, max-age=31536000, immutable$/m, "hashed chunks never revalidate");
  assert.doesNotMatch(headers, /^\/vendor\//m, "a disabled surface gets no rule");
});
