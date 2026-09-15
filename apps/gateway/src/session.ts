import type { IncomingMessage, ServerResponse } from "node:http";
import { SURFACES, SURFACE_IDS } from "../../../packages/contracts/src/surfaces.ts";

/**
 * THE BROWSER SESSION — a cookie the gateway sets and only the gateway reads.
 *
 * 09 §3.2. A browser surface never holds the token in script: the gateway sets
 * `ac_session` as an httpOnly cookie at login and accepts it in place of a
 * bearer on every later request. Three things make that safe, and all three
 * are mechanical:
 *
 *   1. `HttpOnly; Secure; SameSite=Strict`. Script cannot read it; it is not
 *      sent on any cross-SITE request. Surface origins and the gateway share
 *      one registrable domain (AC_SITE), so surface → gateway is same-site.
 *   2. A cookie principal MUST send `x-ac-surface` (main.ts refuses with 403
 *      otherwise). A cross-site form post cannot set a custom header, and a
 *      cross-site fetch with one triggers preflight — which CORS below refuses
 *      for any origin not in the registry. That header is the CSRF line, and
 *      it is the header the generated client already sends on every call.
 *   3. CORS is derived from SURFACES, not configured beside it: the allowed
 *      origins are `https://<app>.<AC_SITE>` for every enabled surface. Adding
 *      an origin is adding a surface, which is a reviewed diff on the registry.
 *
 * Bearer tokens keep working unchanged for devices, tests and non-browser
 * clients. Nothing here is consulted for them except the revocation check,
 * which applies to both.
 */
export const COOKIE = "ac_session";

export type SessionConfig = {
  /** Registrable domain shared by the gateway and every surface, e.g. "ac.example". Unset = development posture. */
  readonly site: string | null;
  /** Extra exact origins allowed in development (http://localhost:5173 …). Ignored when `site` is set. */
  readonly devOrigins: readonly string[];
};

export const sessionConfigFromEnv = (env: NodeJS.ProcessEnv): SessionConfig => ({
  site: env.AC_SITE?.trim() || null,
  devOrigins: (env.AC_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
});

/** Every origin a browser surface may call from. Data from the registry, per environment. */
export const allowedOrigins = (cfg: SessionConfig): ReadonlySet<string> => {
  const out = new Set<string>();
  if (cfg.site) {
    for (const id of SURFACE_IDS) {
      const s = SURFACES[id];
      if (s.enabled && s.namespace !== "anonymous") out.add(`https://${s.app}.${cfg.site}`);
    }
  } else {
    for (const o of cfg.devOrigins) out.add(o);
  }
  return out;
};

/** The Set-Cookie value for a fresh session. */
export const sessionCookie = (token: string, expiresAt: Date, cfg: SessionConfig): string =>
  [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Expires=${expiresAt.toUTCString()}`,
    ...(cfg.site ? ["Secure"] : []),
  ].join("; ");

/** The Set-Cookie value that ends it. */
export const clearedCookie = (cfg: SessionConfig): string =>
  [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0", ...(cfg.site ? ["Secure"] : [])].join("; ");

/** The token carried in the cookie header, if any. Pure. */
export const cookieToken = (cookieHeader: string | undefined): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) {
      const v = part.slice(i + 1).trim();
      return v.length ? v : null;
    }
  }
  return null;
};

export type CorsDecision = { readonly allowed: boolean; readonly headers: Record<string, string> };

/**
 * CORS for one request. An origin in the registry gets the credentialed
 * allow-headers; any other origin gets nothing, and the browser refuses the
 * response on its side. `Vary: Origin` because the answer depends on it.
 */
export const cors = (req: IncomingMessage, origins: ReadonlySet<string>): CorsDecision => {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !origins.has(origin)) return { allowed: false, headers: { vary: "Origin" } };
  return {
    allowed: true,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization, x-ac-surface, x-request-id",
      "access-control-expose-headers": "x-request-id",
      "access-control-max-age": "600",
      vary: "Origin",
    },
  };
};

export const applyHeaders = (res: ServerResponse, headers: Record<string, string>): void => {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
};
