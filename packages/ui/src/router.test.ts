import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPath, buildPath, createRouter, type History, type ScreenSpec } from "./router.ts";

test("matchPath binds :params, honours a trailing optional, and refuses extra segments", () => {
  assert.deepEqual(matchPath("/accounts/:orgId?", "/accounts"), {});
  assert.deepEqual(matchPath("/accounts/:orgId?", "/accounts/org-1"), { orgId: "org-1" });
  assert.equal(matchPath("/accounts/:orgId?", "/accounts/org-1/extra"), null);
  assert.deepEqual(matchPath("/accounts/:orgId/new/:tier", "/accounts/o/new/location"), { orgId: "o", tier: "location" });
  assert.equal(matchPath("/accounts/:orgId/new/:tier", "/accounts/o/new"), null, "required param missing");
  assert.equal(matchPath("/contracts/:orgId", "/accounts/o"), null);
  assert.deepEqual(matchPath("/terms/:tier/:nodeId", "/terms/site/a%20b?x=1"), { tier: "site", nodeId: "a b" }, "decoded, query ignored");
  assert.deepEqual(matchPath("/", "/"), {});
});

test("buildPath is matchPath's inverse and refuses a missing required param", () => {
  assert.equal(buildPath("/accounts/:orgId?"), "/accounts");
  assert.equal(buildPath("/accounts/:orgId?", { orgId: "o 1" }), "/accounts/o%201");
  assert.equal(buildPath("/terms/:tier/:nodeId", { tier: "site", nodeId: "n" }), "/terms/site/n");
  assert.throws(() => buildPath("/terms/:tier/:nodeId", { tier: "site" }), /needs :nodeId/);
});

const SCREENS = {
  "accounts.new": { path: "/accounts/:orgId/new/:tier", uses: ["session.me"] },
  "accounts.tree": { path: "/accounts/:orgId?", uses: ["session.me"] },
  "terms.resolved": { path: "/terms/:tier/:nodeId", uses: ["terms.resolved"] },
} as const satisfies Record<string, ScreenSpec>;

const fakeHistory = (start: string) => {
  let path = start;
  const pops = new Set<() => void>();
  const pushed: string[] = [];
  const h: History = {
    path: () => path,
    push: (p) => { path = p; pushed.push(p); },
    onPop: (cb) => { pops.add(cb); return () => pops.delete(cb); },
  };
  return { h, pushed, back: (to: string) => { path = to; for (const cb of pops) cb(); }, pops };
};

test("the router resolves the current path at start, navigates by screen id, and follows back/forward", () => {
  const { h, pushed, back, pops } = fakeHistory("/accounts/org-1");
  const r = createRouter(SCREENS, h);
  assert.deepEqual(r.current.value, { screen: "accounts.tree", params: { orgId: "org-1" } });

  r.navigate("terms.resolved", { tier: "site", nodeId: "n9" });
  assert.deepEqual(pushed, ["/terms/site/n9"]);
  assert.deepEqual(r.current.value, { screen: "terms.resolved", params: { tier: "site", nodeId: "n9" } });

  const stop = r.start();
  back("/accounts/org-1/new/location");
  assert.deepEqual(r.current.value, { screen: "accounts.new", params: { orgId: "org-1", tier: "location" } });
  stop();
  assert.equal(pops.size, 0);

  assert.equal(r.href("accounts.tree"), "/accounts");
  assert.equal(r.resolve("/nowhere"), null);
});

test("first declared match wins — the registry is ordered specific to general", () => {
  const r = createRouter(SCREENS, fakeHistory("/").h);
  // "/accounts/o/new/site" also has the shape a greedy tree route could claim; the specific route is declared first.
  assert.equal(r.resolve("/accounts/o/new/site")?.screen, "accounts.new");
  assert.equal(r.resolve("/accounts/o")?.screen, "accounts.tree");
});
