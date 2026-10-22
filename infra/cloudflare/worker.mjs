/**
 * THE EDGE IN FRONT OF THE GATEWAY — a Cloudflare Worker whose only job is to
 * keep one container (Dockerfile at the repo root: apps/gateway + apps/worker)
 * running and to forward every request on api.<AC_SITE> to it, byte for byte,
 * SSE included. It holds no logic of its own: authentication, scope, CORS and
 * the catalogue are the gateway's, exactly as they are on a laptop.
 *
 * One instance, by name. The gateway's SSE fan-out is one LISTEN client per
 * process, and the worker's sweeps assume one unregioned worker (SKIP LOCKED
 * makes a second one safe, not useful), so Phase 1 is a single container.
 * Tier 3 — a container per region, AC_REGION_ID set — is a second name here
 * and nothing else.
 *
 * Secrets reach the container as environment variables at start, from the
 * Worker's own secrets (`wrangler secret put`); nothing is baked into the
 * image. The cron keeps the container's inactivity timer from ever elapsing,
 * so the relay, SLA cascade and expiry sweep run whether or not a browser
 * is open.
 */
import { DurableObject } from "cloudflare:workers";

const PORT = 8080;
const INSTANCE = "gateway";
/** The platform maximum. The cron re-arms it every five minutes. */
const INACTIVITY_MS = 6 * 60 * 60 * 1000;
const READY_ATTEMPTS = 300; // × 200 ms = 60 s for a cold start (pnpm-free image; Node boots in about a second)

const REQUIRED = ["DATABASE_URL", "AC_SIGNING_KEY_PEM", "AC_SITE"];
const PASSTHROUGH = ["AC_SIGNING_KID", "AC_IMAGERY_URL", "AC_IMAGERY_ATTRIBUTION", "AC_MAP_TILE_URL", "AC_MAP_ATTRIBUTION", "AC_GEOCODE_URL", "TOKEN_TTL_SECONDS", "ANONYMOUS_TTL_SECONDS", "AC_REGION_ID",
  // Object storage for photos (0017) — the R2 bucket over its S3 API. All four or none.
  "AC_STORAGE_ENDPOINT", "AC_STORAGE_BUCKET", "AC_STORAGE_KEY_ID", "AC_STORAGE_SECRET", "AC_STORAGE_REGION"];

export class Gateway extends DurableObject {
  #starting;

  constructor(ctx, env) {
    super(ctx, env);
    const c = ctx.container;
    // A Durable Object restarted under a running container starts without a
    // timeout; set it again or the platform stops the container shortly.
    if (c?.running) void ctx.blockConcurrencyWhile(() => c.setInactivityTimeout(INACTIVITY_MS));
  }

  async fetch(request) {
    this.#starting ??= this.#ensureReady().finally(() => { this.#starting = undefined; });
    await this.#starting;
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container.getTcpPort(PORT).fetch(forwarded);
  }

  async #ensureReady() {
    const c = this.ctx.container;
    if (!c) throw new Error("no container is bound to this Durable Object");
    if (!c.running) {
      const missing = REQUIRED.filter((k) => !this.env[k]);
      if (missing.length) throw new Error(`gateway secrets not set: ${missing.join(", ")} — wrangler secret put <NAME> -c infra/cloudflare/wrangler.jsonc`);
      const env = { PORT: String(PORT) };
      for (const k of [...REQUIRED, ...PASSTHROUGH]) if (this.env[k]) env[k] = String(this.env[k]);
      c.start({ enableInternet: true, env });
    }
    await c.setInactivityTimeout(INACTIVITY_MS);
    const port = c.getTcpPort(PORT);
    let last;
    for (let i = 0; i < READY_ATTEMPTS; i++) {
      try {
        const r = await port.fetch("http://container/healthz", { signal: AbortSignal.timeout(1_000) });
        await r.body?.cancel();
        if (r.ok) return;
        throw new Error(`healthz answered ${r.status}`);
      } catch (e) {
        last = e;
        await scheduler.wait(200);
      }
    }
    throw new Error(`the gateway did not become ready on :${PORT}`, { cause: last });
  }
}

const instance = (env) => env.GATEWAY.getByName(INSTANCE);

export default {
  async fetch(request, env) {
    try {
      return await instance(env).fetch(request);
    } catch (e) {
      // The gateway's own refusals never reach here — they are responses. This
      // is the container failing to start, which the degraded banner on every
      // surface already knows how to show.
      return new Response(JSON.stringify({ error: "GatewayUnavailable", message: e.message }), {
        status: 503, headers: { "content-type": "application/json", "retry-after": "10", "cache-control": "no-store" },
      });
    }
  },
  /** Every five minutes: a request, so the inactivity timer never elapses and the worker's loops keep running. */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(instance(env).fetch("https://gateway/healthz").then((r) => r.body?.cancel()));
  },
};
