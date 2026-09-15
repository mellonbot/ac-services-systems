import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { allowedOrigins, sessionCookie, clearedCookie, cookieToken, cors, sessionConfigFromEnv } from "./session.ts";
import { SURFACES, SURFACE_IDS } from "../../../packages/contracts/src/surfaces.ts";

const prod = sessionConfigFromEnv({ AC_SITE: "ac.example" });
const dev = sessionConfigFromEnv({ AC_DEV_ORIGINS: "http://localhost:5173, http://localhost:4173" });

test("allowed origins are derived from the registry: one https origin per enabled, non-anonymous surface under AC_SITE", () => {
  const o = allowedOrigins(prod);
  for (const id of SURFACE_IDS) {
    const s = SURFACES[id];
    const expect = s.enabled && s.namespace !== "anonymous";
    assert.equal(o.has(`https://${s.app}.ac.example`), expect, `${id} (${s.app}) enabled=${s.enabled}`);
  }
  assert.ok(!o.has("https://s4-hq-dashboard.ac.example"), "a phase-disabled surface is not an origin — deferring a surface (D9) also closes its door");
  assert.ok(!o.has("https://s1-marketing.ac.example"), "the anonymous marketing site never holds a session");
});

test("development posture takes exact origins from AC_DEV_ORIGINS and nothing else; with neither, nobody", () => {
  assert.deepEqual([...allowedOrigins(dev)].sort(), ["http://localhost:4173", "http://localhost:5173"]);
  assert.equal(allowedOrigins(sessionConfigFromEnv({})).size, 0);
});

test("the session cookie is httpOnly, SameSite=Strict, path-wide, expires with the token, and Secure only in production posture", () => {
  const exp = new Date("2026-09-16T01:00:00Z");
  const p = sessionCookie("tok.en.sig", exp, prod);
  assert.match(p, /^ac_session=tok\.en\.sig; /);
  for (const attr of ["Path=/", "HttpOnly", "SameSite=Strict", "Secure", `Expires=${exp.toUTCString()}`]) assert.ok(p.includes(attr), `${attr} missing from ${p}`);
  assert.ok(!p.includes("Domain="), "host-only: the cookie goes to the gateway host and nowhere else");
  const d = sessionCookie("t", exp, dev);
  assert.ok(!d.includes("Secure"), "plain http in development");
  assert.ok(d.includes("HttpOnly") && d.includes("SameSite=Strict"), "the two attributes that matter are never relaxed");
});

test("the cleared cookie has Max-Age=0 and the same attributes", () => {
  const c = clearedCookie(prod);
  assert.match(c, /^ac_session=; /);
  for (const attr of ["Max-Age=0", "HttpOnly", "SameSite=Strict", "Secure", "Path=/"]) assert.ok(c.includes(attr), attr);
});

test("cookieToken reads ac_session out of a cookie header and ignores everything else", () => {
  assert.equal(cookieToken("theme=dark; ac_session=abc.def.ghi; other=1"), "abc.def.ghi");
  assert.equal(cookieToken("ac_session=abc"), "abc");
  assert.equal(cookieToken("ac_session="), null);
  assert.equal(cookieToken("notours=abc"), null);
  assert.equal(cookieToken(undefined), null);
  assert.equal(cookieToken("ac_sessionx=abc"), null, "prefix is not a match");
});

const req = (origin?: string) => ({ headers: origin ? { origin } : {} }) as unknown as IncomingMessage;

test("cors: a registry origin gets the credentialed allow-headers echoing that origin; an unlisted origin gets only Vary", () => {
  const origins = allowedOrigins(prod);
  const ok = cors(req("https://s2-service-manager.ac.example"), origins);
  assert.equal(ok.allowed, true);
  assert.equal(ok.headers["access-control-allow-origin"], "https://s2-service-manager.ac.example");
  assert.equal(ok.headers["access-control-allow-credentials"], "true");
  assert.match(ok.headers["access-control-allow-headers"]!, /x-ac-surface/);
  assert.equal(ok.headers.vary, "Origin");

  for (const bad of ["https://evil.example", "https://s2-service-manager.ac.example.evil.example", "http://s2-service-manager.ac.example", "https://s4-hq-dashboard.ac.example", undefined]) {
    const no = cors(req(bad), origins);
    assert.equal(no.allowed, false, String(bad));
    assert.deepEqual(no.headers, { vary: "Origin" }, String(bad));
  }
});

test("cors never answers with a wildcard — credentials and * are incompatible, and the origin list is the point", () => {
  const ok = cors(req("https://s3-dispatch-console.ac.example"), allowedOrigins(prod));
  assert.notEqual(ok.headers["access-control-allow-origin"], "*");
});
