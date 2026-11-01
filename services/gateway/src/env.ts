import type { IncomingMessage } from "node:http";
import { createPool } from "./db/pg-tx.ts";
import { generateKeypair, keypairFromPem } from "./auth/auth.ts";
import { createThrottle } from "./auth/throttle.ts";
import { sessionConfigFromEnv, allowedOrigins } from "./auth/session.ts";
import { storeFromEnv } from "../../../packages/storage/src/index.ts";
import { imageryConfigFromEnv, mapTileConfigFromEnv, geocodeConfigFromEnv } from "./handlers/imagery.ts";
import { HttpError } from "./http/http.ts";

/**
 * Process state for the gateway entry. Importing this opens the pool and
 * starts the throttle sweep — it is the running gateway, not a library.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
export const DATABASE_URL: string = url;

export const TOKEN_TTL = Number(process.env.TOKEN_TTL_SECONDS ?? 8 * 3600);
/**
 * ITEM 8 — how long a stranger stays a principal. Fifteen minutes is the time
 * to fill in a form and press the button once more after a typo, and it is
 * deliberately not the eight hours a person who signed in gets: nothing on
 * the other side of this token is worth keeping open, and every minute of it
 * is a minute a token scraped off a page is still good for.
 */
export const ANONYMOUS_TTL = Number(process.env.ANONYMOUS_TTL_SECONDS ?? 900);
/**
 * The actor id on an anonymous audit row. A constant, the way WORKER_ACTOR is
 * in the worker: `actor_id` is a uuid and not a foreign key, so the honest
 * answer to "who did this" is a named nobody rather than an invented user.
 * The SESSION id beside it is real and per-visit, which is what makes two
 * submissions from one visitor distinguishable in the log.
 */
export const ANONYMOUS_ACTOR = "00000000-0000-0000-0000-0000000000a1";

export const keypair = process.env.AC_SIGNING_KEY_PEM
  ? keypairFromPem(process.env.AC_SIGNING_KEY_PEM, process.env.AC_SIGNING_KID ?? "k1")
  : generateKeypair("ephemeral");
if (keypair.kid === "ephemeral") console.warn("gateway: AC_SIGNING_KEY_PEM not set — tokens die with this process");
export const keys = new Map([[keypair.kid, keypair.publicKey]]);
export const pool = createPool(DATABASE_URL);
export const SESSION = sessionConfigFromEnv(process.env);
// Item 9: the overhead-imagery provider, if one is configured. Unset → the
// site card gets "not_configured" and draws the address alone (OPEN-S6-IMAGERY).
export const IMAGERY = imageryConfigFromEnv(process.env);
// S2's home map: the basemap tile provider, if one is configured. Unset → the
// map draws the pin on a plain grid and says why.
export const MAP_TILES = mapTileConfigFromEnv(process.env);
// ...and the geocoder that gives a typed address the point the map pins.
export const GEOCODE = geocodeConfigFromEnv(process.env);
// Object storage for photos (0017): an R2 bucket, a directory, or not
// configured — in which case an upload is refused in words, not a 500.
export const STORE = storeFromEnv(process.env, (fetchUrl, init) => fetch(fetchUrl, init as RequestInit));
if (!STORE) console.warn("gateway: no object storage configured (AC_STORAGE_*) — photo uploads are refused as storage_not_configured");
export const ORIGINS = allowedOrigins(SESSION);
if (!SESSION.site) console.warn(`gateway: AC_SITE not set — development posture: cookies are not Secure and browser origins are ${ORIGINS.size ? [...ORIGINS].join(", ") : "NONE (bearer only)"}`);

/**
 * Behind Cloudflare (infra/cloudflare/worker.mjs sets AC_BEHIND_CLOUDFLARE=1
 * when it starts the container) every request arrives from the Worker, so the
 * socket's address is the edge's, and the client's is CF-Connecting-IP, which
 * Cloudflare sets and a client cannot. Anywhere else that header is whatever
 * the caller typed — one per request defeats every per-address limit below —
 * so it is read only when this is set.
 */
export const BEHIND_CLOUDFLARE = process.env.AC_BEHIND_CLOUDFLARE === "1";

/**
 * Production serves only the surfaces in ROLLOUT (packages/contracts/src/surfaces.ts):
 * no session is minted and no request is taken for any other. Unset everywhere
 * else, so every enabled surface stays reachable to tests, drives and the demo.
 */
export const ROLLOUT_ENFORCED = process.env.AC_ROLLOUT === "1";

/**
 * The doors anyone can knock on, throttled. Per address so one client cannot
 * saturate the event loop or the sessions table.
 *
 * Failed sign-ins are counted two ways, and both are looked at before the
 * password is. Per (email, address), ten in fifteen minutes: the guesser is
 * shut out and the account's owner, somewhere else, is not. Per email alone,
 * a hundred: a guesser spread over many addresses still meets a ceiling.
 *
 * The trade-off, chosen: counted per email alone at ten, anyone who knew an
 * address could lock its owner out indefinitely with ten bad tries every
 * fifteen minutes. Now that takes a hundred failures from ten or more
 * addresses per window — still possible for a determined attacker with many
 * addresses, who in exchange gets at most a hundred guesses per window,
 * against a password hashed for exactly that. A right password never counts.
 */
export const LOGIN_BY_ADDRESS = createThrottle({ limit: 120, windowMs: 60_000 });
const LOGIN_FAILURES_BY_EMAIL_AND_ADDRESS = createThrottle({ limit: 10, windowMs: 15 * 60_000 });
const LOGIN_FAILURES_BY_EMAIL = createThrottle({ limit: 100, windowMs: 15 * 60_000 });
export const ANONYMOUS_BY_ADDRESS = createThrottle({ limit: 20, windowMs: 60_000 });
export const addressOf = (req: IncomingMessage): string => {
  const cf = BEHIND_CLOUDFLARE ? req.headers["cf-connecting-ip"] : undefined;
  return (typeof cf === "string" && cf) || req.socket.remoteAddress || "unknown";
};
// Ended windows are dropped each minute, so the tables hold only live ones.
setInterval(() => { for (const t of [LOGIN_BY_ADDRESS, LOGIN_FAILURES_BY_EMAIL_AND_ADDRESS, LOGIN_FAILURES_BY_EMAIL, ANONYMOUS_BY_ADDRESS]) t.sweep(); }, 60_000).unref();
/** Before the password: this email from this address, and this email from anywhere. */
export const signInAllowed = (req: IncomingMessage, who: string): boolean =>
  !LOGIN_FAILURES_BY_EMAIL_AND_ADDRESS.spent(`${who} ${addressOf(req)}`) && !LOGIN_FAILURES_BY_EMAIL.spent(who);
export const signInFailed = (req: IncomingMessage, who: string): void => {
  LOGIN_FAILURES_BY_EMAIL_AND_ADDRESS.hit(`${who} ${addressOf(req)}`);
  LOGIN_FAILURES_BY_EMAIL.hit(who);
};
export const throttled = (ok: boolean, what: string): void => {
  if (!ok) throw new HttpError(429, `too many ${what} — wait a minute and try again`);
};
