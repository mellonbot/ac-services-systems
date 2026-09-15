import type { Operation, SurfaceId, EventEnvelope } from "../../contracts/src/index.ts";
import { classifyRefusal, GatewayRefusal, type WireError } from "../../contracts/src/refusals.ts";

/**
 * THE ONE PLACE `fetch` IS CALLED.
 *
 * The generated client (./generated/client.ts) knows the catalogue; this file
 * knows the wire. Between them there is no third thing — a surface holds a
 * client and the client holds a transport, and the transport was built by the
 * shell with the gateway's origin. A surface cannot name a URL, because no
 * method takes one.
 *
 * tools/ci/schema-guard.ts fails the build on `fetch(`, `EventSource`,
 * `XMLHttpRequest` or `WebSocket` anywhere in apps/s*, packages/shell or
 * packages/ui. This file is the allowlist's single entry.
 */
export type Transport = {
  /** One request. Resolves with the parsed JSON body; rejects with GatewayRefusal. */
  request(op: Operation, input: unknown): Promise<unknown>;
  /** The SSE feed. Returns the unsubscribe function. */
  stream(op: Operation, onEvent: (e: EventEnvelope) => void, onState: (s: StreamState) => void): () => void;
};

export type StreamState = "connecting" | "open" | "closed" | "failed";

export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** "include" in cookie-session mode, so the browser attaches the httpOnly `ac_session` cookie cross-origin (same-site). */
  credentials?: "include" | "omit";
}) => Promise<{
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
}>;

export type HttpTransportConfig = {
  /** The gateway's origin. Set once by the shell; never by a surface. */
  readonly baseUrl: string;
  /** Sent as `x-ac-surface`. The header selects among an operation's surfaces; the token authorizes. */
  readonly surfaceId: SurfaceId;
  readonly fetch: FetchLike;
  /** Bearer token, read per request so a re-login takes effect without rebuilding the client. Null in cookie-session mode. */
  readonly token: () => string | null;
  /**
   * Cookie-session mode: the browser holds the httpOnly `ac_session` cookie the
   * gateway set at login; script never sees a token. Every request is sent with
   * `credentials: "include"`. The gateway requires `x-ac-surface` on cookie
   * requests — the header this transport always sends — which, with
   * SameSite=Strict and CORS preflight, is the CSRF line.
   */
  readonly session?: "bearer" | "cookie";
  readonly requestId?: () => string;
  /**
   * Transport outcome per request: `true` on any HTTP answer at all, `false`
   * when the gateway did not answer or answered 5xx. The shell's degraded flag
   * is driven from here and from nowhere else.
   */
  readonly onOutcome?: (reachable: boolean) => void;
};

const newRequestId = (): string => globalThis.crypto.randomUUID();

const urlFor = (baseUrl: string, op: Operation, input: unknown): string => {
  const url = new URL(op.path, baseUrl);
  if (op.carrier === "query" && input && typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
};

export const httpTransport = (cfg: HttpTransportConfig): Transport => {
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = {
      accept: "application/json",
      "x-ac-surface": cfg.surfaceId,
      "x-request-id": (cfg.requestId ?? newRequestId)(),
    };
    const t = cfg.token();
    if (t) h.authorization = `Bearer ${t}`;
    return h;
  };

  const request = async (op: Operation, input: unknown): Promise<unknown> => {
    const h = headers();
    let body: string | undefined;
    if (op.carrier === "body") {
      h["content-type"] = "application/json";
      body = JSON.stringify(input ?? {});
    }
    let res: Awaited<ReturnType<FetchLike>>;
    const credentials = cfg.session === "cookie" ? { credentials: "include" as const } : {};
    try {
      res = await cfg.fetch(urlFor(cfg.baseUrl, op, input), { method: op.method, headers: h, ...credentials, ...(body !== undefined ? { body } : {}) });
    } catch (e) {
      cfg.onOutcome?.(false);
      throw new GatewayRefusal({ kind: "transport", status: null, message: (e as Error).message || "gateway unreachable" });
    }
    if (res.ok) {
      cfg.onOutcome?.(true);
      return res.json();
    }
    let wire: WireError | null = null;
    try { wire = (await res.json()) as WireError; } catch { wire = null; }
    const refusal = classifyRefusal(res.status, wire);
    cfg.onOutcome?.(refusal.kind !== "transport");
    throw new GatewayRefusal(refusal);
  };

  const stream = (op: Operation, onEvent: (e: EventEnvelope) => void, onState: (s: StreamState) => void): (() => void) => {
    const ctl = new AbortController();
    onState("connecting");
    void (async () => {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await cfg.fetch(urlFor(cfg.baseUrl, op, undefined), { method: op.method, headers: { ...headers(), accept: "text/event-stream" }, signal: ctl.signal, ...(cfg.session === "cookie" ? { credentials: "include" as const } : {}) });
      } catch {
        if (!ctl.signal.aborted) { cfg.onOutcome?.(false); onState("failed"); }
        return;
      }
      if (!res.ok || !res.body) {
        cfg.onOutcome?.(res.status < 500);
        onState("failed");
        return;
      }
      cfg.onOutcome?.(true);
      onState("open");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const parsed = parseSseFrame(frame);
            if (parsed) onEvent(parsed);
          }
        }
        onState("closed");
      } catch {
        if (!ctl.signal.aborted) { cfg.onOutcome?.(false); onState("failed"); } else onState("closed");
      }
    })();
    return () => ctl.abort();
  };

  return { request, stream };
};

/** One `event:`/`data:` frame → EventEnvelope, or null for comments and keepalives. Exported for the test. */
export const parseSseFrame = (frame: string): EventEnvelope | null => {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":") || line.trim() === "") continue;
    const i = line.indexOf(":");
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (event !== "domain" || data.length === 0) return null;
  try { return JSON.parse(data.join("\n")) as EventEnvelope; } catch { return null; }
};
