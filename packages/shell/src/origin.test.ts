import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayOrigin } from "./index.ts";

const doc = (meta: string | null, host: string, hostname?: string) => ({
  querySelector: () => (meta === null ? null : { getAttribute: () => meta }),
  location: hostname === undefined ? { protocol: "https:", host } : { protocol: "https:", host, hostname },
});

test("a stamped meta wins, and an empty stamp does not", () => {
  assert.equal(gatewayOrigin(doc("http://127.0.0.1:19000", "127.0.0.1:8000")), "http://127.0.0.1:19000");
  assert.equal(gatewayOrigin(doc("  http://gw.example  ", "s2.ac.example")), "http://gw.example");
  assert.equal(gatewayOrigin(doc("", "s2.ac.example")), "https://api.ac.example");
  assert.equal(gatewayOrigin(doc(null, "s2.ac.example")), "https://api.ac.example");
});

test("without a local fallback the host is used as written, hostname unread", () => {
  assert.equal(gatewayOrigin(doc(null, "s2.ac.example")), "https://api.ac.example");
  assert.equal(gatewayOrigin(doc(null, "127.0.0.1:8000")), "https://api.0.0.1:8000");
  assert.equal(gatewayOrigin(doc(null, "")), "https://api.");
});

test("a local fallback rewrites only loopback hosts", () => {
  const fallback = "http://127.0.0.1:8080";
  const at = (host: string, hostname?: string) => gatewayOrigin(doc(null, host, hostname), { localFallback: fallback });
  assert.equal(at("127.0.0.1:8000", "127.0.0.1"), fallback);
  assert.equal(at("localhost:8000", "localhost"), fallback);
  assert.equal(at("[::1]:8000", "::1"), fallback);
  assert.equal(at("127.0.0.2:8000", "127.0.0.2"), fallback);
  assert.equal(at(""), fallback);
  assert.equal(at("s3.ac.example", "s3.ac.example"), "https://api.ac.example");
  assert.equal(gatewayOrigin(doc("http://gw.example", "127.0.0.1:8000", "127.0.0.1"), { localFallback: fallback }), "http://gw.example");
});
