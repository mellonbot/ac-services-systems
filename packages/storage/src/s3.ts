import { createHash, createHmac } from "node:crypto";
import type { ObjectStore, StorageKey } from "./index.ts";

/**
 * An S3-compatible bucket — Cloudflare R2 in production. The gateway runs in
 * a container behind the Worker and has no R2 binding of its own, so it
 * speaks R2's S3 API, signed with AWS Signature Version 4 by hand over
 * node:crypto: the same no-library line the token signer holds.
 *
 * Path-style addressing (`endpoint/bucket/key`), which R2 and every
 * S3-compatible store accept, so the endpoint is the only thing that changes
 * between them.
 */
export type S3Config = {
  /** e.g. https://<account>.r2.cloudflarestorage.com */
  readonly endpoint: string;
  readonly bucket: string;
  /** R2 accepts "auto"; AWS wants the bucket's region. */
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
};

export type S3Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

const sha256Hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s).digest();
/** RFC 3986, as SigV4 requires: everything but unreserved characters is percent-encoded. */
const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The Authorization header for one request (SigV4, header form). Exported so
 * the test can hold it to AWS's published example.
 */
export const signV4 = (req: {
  readonly method: string; readonly host: string; readonly path: string;
  /** Lower-case names. `host`, `x-amz-date` and `x-amz-content-sha256` are added here. */
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadHash: string; readonly region: string; readonly service: string;
  readonly accessKeyId: string; readonly secretAccessKey: string; readonly amzDate: string;
}): string => {
  const day = req.amzDate.slice(0, 8);
  const all: Record<string, string> = { ...req.headers, host: req.host, "x-amz-date": req.amzDate, "x-amz-content-sha256": req.payloadHash };
  const names = Object.keys(all).sort();
  const canonical = [
    req.method,
    req.path.split("/").map(uriEncode).join("/"),
    "",
    names.map((n) => `${n}:${all[n]!.trim()}\n`).join(""),
    names.join(";"),
    req.payloadHash,
  ].join("\n");
  const scope = `${day}/${req.region}/${req.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", req.amzDate, scope, sha256Hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${req.secretAccessKey}`, day), req.region), req.service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${req.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
};

const amzDateOf = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const STORE_TIMEOUT_MS = 15_000;

export const s3Store = (cfg: S3Config, fetchImpl: S3Fetch, now: () => Date = () => new Date()): ObjectStore => {
  const base = new URL(cfg.endpoint);
  const call = async (method: "PUT" | "GET", key: StorageKey, body?: Uint8Array, contentType?: string) => {
    const path = `/${cfg.bucket}/${key}`;
    const payloadHash = sha256Hex(body ?? "");
    const amzDate = amzDateOf(now());
    const headers: Record<string, string> = contentType ? { "content-type": contentType } : {};
    const authorization = signV4({
      method, host: base.host, path, headers, payloadHash, region: cfg.region, service: "s3",
      accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, amzDate,
    });
    const url = `${base.origin}${path.split("/").map(uriEncode).join("/")}`;
    const res = await fetchImpl(url, {
      method,
      headers: { ...headers, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, authorization },
      ...(body ? { body } : {}),
      // The caller holds a database transaction while this runs; a store that
      // never answers must not hold it forever.
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`[storage] ${method} ${key} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  return {
    async put(key, body, contentType) { await call("PUT", key, body, contentType); },
    async get(key) { return new Uint8Array(await (await call("GET", key)).arrayBuffer()); },
  };
};
