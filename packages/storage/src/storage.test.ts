import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storageKey, signV4, s3Store, diskStore, storeFromEnv, type S3Fetch } from "./index.ts";

const AWS = { region: "us-east-1", service: "s3", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", amzDate: "20130524T000000Z", host: "examplebucket.s3.amazonaws.com" };
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("SigV4: AWS's published GET Object example, to the byte", () => {
  const auth = signV4({ ...AWS, method: "GET", path: "/test.txt", headers: { range: "bytes=0-9" }, payloadHash: EMPTY });
  assert.equal(auth, "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

test("SigV4: AWS's published PUT Object example — a reserved character in the key is percent-encoded", () => {
  const auth = signV4({
    ...AWS, method: "PUT", path: "/test$file.text",
    headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
    payloadHash: "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
  });
  assert.match(auth, /SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test("s3Store: a PUT and a GET to endpoint/bucket/key, signed; a refused answer is an error, not empty bytes", async () => {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: Uint8Array }[] = [];
  const stored = new Map<string, Uint8Array>();
  const fake: S3Fetch = async (url, init) => {
    calls.push({ url, ...init });
    if (url.endsWith("/missing")) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "NoSuchKey" };
    if (init.method === "PUT") stored.set(url, init.body!);
    const b = stored.get(url) ?? new Uint8Array();
    return { ok: true, status: 200, arrayBuffer: async () => b.slice().buffer, text: async () => "" };
  };
  const store = s3Store({ endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "ac-media", region: "auto", accessKeyId: "id", secretAccessKey: "secret" }, fake, () => new Date("2026-10-21T12:00:00Z"));
  const key = storageKey("r1", "o1", "request_photo", "p1");
  await store.put(key, new Uint8Array([1, 2, 3]), "image/png");
  assert.equal(calls[0]!.url, "https://acct.r2.cloudflarestorage.com/ac-media/r1/o1/request_photo/p1");
  assert.equal(calls[0]!.method, "PUT");
  assert.equal(calls[0]!.headers["content-type"], "image/png");
  assert.equal(calls[0]!.headers["x-amz-date"], "20261021T120000Z");
  assert.match(calls[0]!.headers.authorization!, /^AWS4-HMAC-SHA256 Credential=id\/20261021\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.deepEqual([...await store.get(key)], [1, 2, 3]);
  await assert.rejects(store.get(storageKey("r1", "o1", "request_photo", "missing")), /404 NoSuchKey/);
});

test("diskStore: what goes in comes out, under the key's own path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ac-store-"));
  try {
    const store = diskStore(dir);
    const key = storageKey("r1", "o1", "request_photo", "p1");
    await store.put(key, new Uint8Array([9, 8, 7]), "image/jpeg");
    assert.deepEqual([...await store.get(key)], [9, 8, 7]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("storeFromEnv: a full bucket, a directory, nothing, or a half-configured bucket that fails at start", () => {
  const f: S3Fetch = async () => { throw new Error("unused"); };
  assert.equal(storeFromEnv({}, f), null);
  assert.ok(storeFromEnv({ AC_STORAGE_DIR: "/tmp/x" }, f));
  assert.ok(storeFromEnv({ AC_STORAGE_ENDPOINT: "https://e", AC_STORAGE_BUCKET: "b", AC_STORAGE_KEY_ID: "k", AC_STORAGE_SECRET: "s" }, f));
  assert.throws(() => storeFromEnv({ AC_STORAGE_ENDPOINT: "https://e", AC_STORAGE_BUCKET: "b" }, f), /AC_STORAGE_KEY_ID, AC_STORAGE_SECRET not set/);
});

test("s3Store.probe: a signed GET of a never-written key — only 404 NoSuchKey (or 200) passes", async () => {
  const answer = (status: number, body: string): S3Fetch => async (url, init) => {
    assert.equal(url, "https://acct.r2.cloudflarestorage.com/ac-media/readyz-probe");
    assert.equal(init.method, "GET");
    assert.match(init.headers.authorization!, /^AWS4-HMAC-SHA256 Credential=id\//);
    return { ok: status === 200, status, arrayBuffer: async () => new ArrayBuffer(0), text: async () => body };
  };
  const cfg = { endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "ac-media", region: "auto", accessKeyId: "id", secretAccessKey: "secret" };
  await s3Store(cfg, answer(404, "<Error><Code>NoSuchKey</Code></Error>")).probe();
  await s3Store(cfg, answer(200, "")).probe();
  await assert.rejects(s3Store(cfg, answer(403, "<Error><Code>AccessDenied</Code></Error>")).probe(), /probe ac-media → 403 .*AccessDenied/);
  await assert.rejects(s3Store(cfg, answer(404, "<Error><Code>NoSuchBucket</Code></Error>")).probe(), /404 .*NoSuchBucket/);
  const silent: S3Fetch = async () => { throw new Error("fetch failed"); };
  await assert.rejects(s3Store(cfg, silent).probe(), /fetch failed/);
});

test("diskStore.probe: a writable directory passes, created if absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ac-store-"));
  try {
    await diskStore(join(dir, "nested")).probe();
    await assert.rejects(diskStore(join(dir, "nested", "\0")).probe());
  } finally { await rm(dir, { recursive: true, force: true }); }
});
