import { test } from "node:test";
import assert from "node:assert/strict";
import { headersForLiveSurfaces, redirectsForLiveSurfaces } from "./build-pages.ts";
import { ROLLOUT, SURFACES, isLive } from "../../packages/contracts/src/index.ts";

test("the first rollout is the front page, the office, dispatch and the technician fallback — and only those", () => {
  assert.deepEqual([...ROLLOUT], ["S1", "S2", "S3", "S5"]);
  for (const id of ROLLOUT) assert.ok(SURFACES[id].enabled, `${id} is in the rollout but not enabled`);
});

test("every live surface's bundle and stylesheet revalidate on each load", () => {
  const headers = headersForLiveSurfaces();
  for (const path of ["/bundle.js", "/ui.css", "/service-manager/bundle.js", "/dispatch/bundle.js", "/dispatch/ui.css", "/technician/bundle.js"]) {
    assert.match(headers, new RegExp(`^${path.replaceAll(".", "\\.")}\\n  Cache-Control: no-cache$`, "m"));
  }
  assert.match(headers, /^\/dispatch\/chunks\/\*\n  Cache-Control: public, max-age=31536000, immutable$/m, "hashed chunks never revalidate");
  for (const off of ["/hq/", "/customer/", "/subcontractor/", "/vendor/"]) {
    assert.doesNotMatch(headers, new RegExp(`^${off.replaceAll(".", "\\.")}`, "m"), `${off} is not live and gets no rule`);
  }
});

test("only live portals are routed; every other path falls to S1, which answers it", () => {
  const redirects = redirectsForLiveSurfaces().trim().split("\n");
  assert.equal(isLive("S1"), true);
  assert.deepEqual(redirects, [
    "/service-manager /service-manager/ 308",
    "/service-manager/* /service-manager/index.html 200",
    "/dispatch /dispatch/ 308",
    "/dispatch/* /dispatch/index.html 200",
    "/technician /technician/ 308",
    "/technician/* /technician/index.html 200",
    "/* /index.html 200",
  ]);
});
