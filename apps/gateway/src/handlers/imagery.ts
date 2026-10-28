import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { updateAccount } from "./hierarchy.ts";
import { MAP_TILE_REACH, MAP_ZOOM_MAX, MAP_ZOOM_MIN, tileOf, type SiteImageryInput, type SiteImageryOutput, type SiteMapTileInput, type SiteMapTileOutput, type LocateSiteInput, type LocateSiteOutput, type AddressWire } from "../../../../packages/contracts/src/operations.ts";

/**
 * ITEM 9 — OVERHEAD IMAGERY OF A SITE, served by the gateway.
 *
 * The obvious way to put a satellite view on a customer's site card is an
 * <img> whose src is a map provider's URL with the coordinates in it. That
 * puts a provider key in a bundle anyone can read, sends every customer's
 * site coordinates to a third party from the customer's own browser, and
 * gives a surface a URL to reach for — the one thing non-negotiable #14
 * forbids. It also cannot carry the cookie session's CSRF line.
 *
 * So the gateway fetches it. The surface asks `sites.imagery` through the
 * generated client like any other read; this handler resolves the site
 * (under RLS — an invisible site is `unknown_site`), reads its coordinates
 * off `accounts.address`, asks the configured provider, and returns the
 * image inline as a data: URL. The provider is a URL template in the
 * gateway's environment, never in code:
 *
 *   AC_IMAGERY_URL          e.g. https://provider.example/static?center={lat},{lng}&zoom={zoom}&size={w}x{h}&key=…
 *   AC_IMAGERY_ATTRIBUTION  the credit line the provider's terms require, shown under the image
 *
 * Unset, the answer is `unavailable: "not_configured"` and the card draws
 * the address alone. That is an answer, not an error — the card is complete
 * without the picture, and the picture is a provider contract this
 * repository has not signed (docs/OPEN_DECISIONS.md, OPEN-S6-IMAGERY).
 *
 * Cached per site and coordinates for a day, in process: a roof does not
 * move, and a provider bills per fetch. A failure is cached too, for a
 * minute, so a provider that is down is not asked again by every card.
 *
 * The provider is asked OUTSIDE the request's transaction: each handler is
 * split into a read (in the unit of work, which main.ts releases) and a fetch
 * after it. Fetched inside, a slow provider held a pool connection per call,
 * and ten of them held the whole pool.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZOOM = 18, WIDTH = 640, HEIGHT = 360;
const MAX_BYTES = 1_500_000;
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const FAILURE_TTL_MS = 60 * 1000;

export type ImageryConfig = { readonly urlTemplate: string | null; readonly attribution: string | null };
export const imageryConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): ImageryConfig => {
  // Prefer an explicit template. Otherwise, when a MapTiler key is present,
  // use its static map endpoint (same key already used for tiles and geocoding).
  // Attribution is required by MapTiler's terms.
  const explicit = env.AC_IMAGERY_URL?.trim() || null;
  const key = env.AC_MAPTILER_KEY?.trim();
  const urlTemplate = explicit || (key
    ? `https://api.maptiler.com/maps/streets/static/{lng},{lat},{zoom}/{w}x{h}.png?key=${encodeURIComponent(key)}`
    : null);
  const attribution = env.AC_IMAGERY_ATTRIBUTION?.trim()
    || (urlTemplate ? "© MapTiler © OpenStreetMap contributors" : null);
  return { urlTemplate, attribution };
};

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

type Cached = { at: number; image: string | null };
/** A hit within its TTL: a day for an image, a minute for a failure. */
const fresh = (c: Cached | undefined, now: number): c is Cached => !!c && now - c.at < (c.image === null ? FAILURE_TTL_MS : TTL_MS);
const cache = new Map<string, Cached>();
/** Tests reach for this; the gateway never does. */
export const clearImageryCache = () => cache.clear();

export const coordinatesOf = (address: AddressWire | null | undefined): { lat: number; lng: number } | null => {
  if (!address) return null;
  const { lat, lng } = address;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
};

export const renderTemplate = (template: string, v: { lat: number; lng: number }): string =>
  template
    .replaceAll("{lat}", String(v.lat)).replaceAll("{lng}", String(v.lng))
    .replaceAll("{zoom}", String(ZOOM)).replaceAll("{w}", String(WIDTH)).replaceAll("{h}", String(HEIGHT));

/** A read that either answered, or needs the provider — asked after the transaction is released. */
export type Plan<T, F> = { readonly answer: T } | { readonly fetch: (fetcher: F) => Promise<T> };
export const runPlan = <T, F>(plan: Plan<T, F>, fetcher: F): Promise<T> => ("answer" in plan ? Promise.resolve(plan.answer) : plan.fetch(fetcher));

export const siteImageryRead = async (
  uow: UnitOfWork, input: SiteImageryInput, config: ImageryConfig, now: () => number = Date.now,
): Promise<Plan<SiteImageryOutput, Fetcher>> => {
  if (typeof input.siteId !== "string" || !UUID.test(input.siteId)) throw new BadInput("siteId must be a uuid");
  const site = (await uow.tx.query<{ id: string; tier: string; address: AddressWire | null }>(
    `SELECT id, tier, address FROM accounts WHERE id = $1`, [input.siteId],
  ))[0];
  if (!site) throw new InputRefused(`no node ${input.siteId} visible in this scope`, "unknown_site");
  if (site.tier !== "site") throw new InputRefused(`"${input.siteId}" is a ${site.tier}, not a site`, "not_a_site");

  const at = coordinatesOf(site.address);
  const base = { siteId: site.id, lat: at?.lat ?? null, lng: at?.lng ?? null, attribution: config.attribution };
  if (!config.urlTemplate) return { answer: { ...base, image: null, unavailable: "not_configured" } };
  if (!at) return { answer: { ...base, image: null, unavailable: "no_coordinates" } };

  const key = `${site.id}:${at.lat}:${at.lng}`;
  const hit = cache.get(key);
  if (fresh(hit, now())) return { answer: { ...base, image: hit.image, unavailable: hit.image ? null : "provider_unreachable" } };
  const template = config.urlTemplate;
  return {
    fetch: async (fetcher) => {
      const image = await fetchImage(fetcher, renderTemplate(template, at), MAX_BYTES);
      cache.set(key, { at: now(), image });
      return { ...base, image, unavailable: image ? null : "provider_unreachable" };
    },
  };
};

export const siteImagery = async (
  uow: UnitOfWork, input: SiteImageryInput, config: ImageryConfig, fetcher: Fetcher, now: () => number = Date.now,
): Promise<SiteImageryOutput> => runPlan(await siteImageryRead(uow, input, config, now), fetcher);

/** An image as a data: URL, or null for every way a provider can fail. */
const fetchImage = async (fetcher: Fetcher, url: string, maxBytes: number): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!/^image\/(png|jpeg|webp)$/.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * S2's HOME MAP — one basemap tile at a time, by the same route and for the
 * same reasons as the picture above: the office's browser asks the gateway,
 * the gateway asks the provider. The provider is a {z}/{x}/{y} template:
 *
 *   AC_MAP_TILE_URL          e.g. https://tiles.example/{z}/{x}/{y}.png?key=…
 *   AC_MAP_ATTRIBUTION       the credit line the provider's terms require
 *
 * A tile is served only near a site this principal can see — within
 * MAP_TILE_REACH tiles of the site's own, at MAP_ZOOM_MIN–MAP_ZOOM_MAX — so a
 * signed-in session is a pan around a home, not a free proxy onto a provider
 * that bills per fetch. Cached by tile, not by site: two homes on a street
 * share their tiles.
 */
export type MapTileConfig = { readonly urlTemplate: string | null; readonly attribution: string | null };
/**
 * One MapTiler key is enough: AC_MAPTILER_KEY fills both templates below —
 * satellite-with-labels tiles and US address geocoding. AC_MAP_TILE_URL or
 * AC_GEOCODE_URL, when set, win, for another style or another provider.
 */
const maptiler = (env: NodeJS.ProcessEnv, path: string): string | null => {
  const key = env.AC_MAPTILER_KEY?.trim();
  return key ? `https://api.maptiler.com/${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}` : null;
};
export const mapTileConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): MapTileConfig => ({
  urlTemplate: env.AC_MAP_TILE_URL?.trim() || maptiler(env, "maps/hybrid/256/{z}/{x}/{y}.jpg"),
  attribution: env.AC_MAP_ATTRIBUTION?.trim() || null,
});

const MAX_TILE_BYTES = 400_000;
const tileCache = new Map<string, Cached>();
export const clearMapTileCache = () => tileCache.clear();

const intIn = (v: unknown, name: string, lo: number, hi: number): number => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < lo || n > hi) throw new BadInput(`${name} must be an integer in ${lo}..${hi}`);
  return n;
};

export const siteMapTileRead = async (
  uow: UnitOfWork, input: SiteMapTileInput, config: MapTileConfig, now: () => number = Date.now,
): Promise<Plan<SiteMapTileOutput, Fetcher>> => {
  if (typeof input.siteId !== "string" || !UUID.test(input.siteId)) throw new BadInput("siteId must be a uuid");
  const z = intIn(input.z, "z", MAP_ZOOM_MIN, MAP_ZOOM_MAX);
  const x = intIn(input.x, "x", 0, 2 ** z - 1), y = intIn(input.y, "y", 0, 2 ** z - 1);
  const site = (await uow.tx.query<{ id: string; tier: string; address: AddressWire | null }>(
    `SELECT id, tier, address FROM accounts WHERE id = $1`, [input.siteId],
  ))[0];
  if (!site) throw new InputRefused(`no node ${input.siteId} visible in this scope`, "unknown_site");
  if (site.tier !== "site") throw new InputRefused(`"${input.siteId}" is a ${site.tier}, not a site`, "not_a_site");

  const base = { z, x, y, attribution: config.attribution };
  const at = coordinatesOf(site.address);
  if (!config.urlTemplate) return { answer: { ...base, image: null, unavailable: "not_configured" } };
  if (!at) return { answer: { ...base, image: null, unavailable: "no_coordinates" } };
  const home = tileOf(at.lat, at.lng, z);
  if (Math.abs(x - Math.floor(home.x)) > MAP_TILE_REACH || Math.abs(y - Math.floor(home.y)) > MAP_TILE_REACH)
    throw new InputRefused(`tile ${z}/${x}/${y} is more than ${MAP_TILE_REACH} tiles from the site`, "tile_out_of_reach");

  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (fresh(hit, now())) return { answer: { ...base, image: hit.image, unavailable: hit.image ? null : "provider_unreachable" } };
  const url = config.urlTemplate.replaceAll("{z}", String(z)).replaceAll("{x}", String(x)).replaceAll("{y}", String(y));
  return {
    fetch: async (fetcher) => {
      const image = await fetchImage(fetcher, url, MAX_TILE_BYTES);
      tileCache.set(key, { at: now(), image });
      return { ...base, image, unavailable: image ? null : "provider_unreachable" };
    },
  };
};

export const siteMapTile = async (
  uow: UnitOfWork, input: SiteMapTileInput, config: MapTileConfig, fetcher: Fetcher, now: () => number = Date.now,
): Promise<SiteMapTileOutput> => runPlan(await siteMapTileRead(uow, input, config, now), fetcher);

/**
 * PLACING A SITE. An address is typed as words — nothing in the forms asks
 * for a latitude — so the map has nothing to pin until something turns the
 * words into a point. The gateway does, the first time the office opens the
 * home's map: it asks the geocoder (same provider and reasons as the tiles),
 * and writes the point onto the address through accounts.update, so it is
 * audited like any other edit and asked for once per site, not per view.
 *
 *   AC_GEOCODE_URL   e.g. https://api.maptiler.com/geocoding/{q}.json?key=…&limit=1
 *
 * {q} is the address, URL-encoded. The answer is GeoJSON; only a feature
 * whose place_type is an address or a named place is taken — a street, town
 * or postcode centroid would put the pin in somebody else's yard.
 */
export type GeocodeConfig = { readonly urlTemplate: string | null };
export const geocodeConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): GeocodeConfig => ({
  urlTemplate: env.AC_GEOCODE_URL?.trim() || maptiler(env, "geocoding/{q}.json?limit=1&country=us"),
});
export type JsonFetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const PRECISE = new Set(["address", "poi"]);
export const addressQuery = (a: AddressWire | null | undefined): string | null => {
  if (!a?.line1?.trim()) return null;
  return [a.line1, a.line2, a.city, [a.state, a.postal].filter(Boolean).join(" "), a.country].filter((s) => s && s.trim()).join(", ");
};

/**
 * Three steps, so the geocoder is asked with no transaction open: read the
 * site (one unit of work), ask the provider (none), and write the point (a
 * second, short unit of work that reads the site again and writes only if the
 * address is still the one that was asked about and still has no point).
 */
export type LocatePlan = { readonly answer: LocateSiteOutput } | { readonly siteId: string; readonly query: string };
type Located = { readonly lat: number; readonly lng: number } | "not_found" | "provider_unreachable";
const geocodeFailures = new Map<string, number>();
export const clearGeocodeCache = () => geocodeFailures.clear();

const siteRow = async (uow: UnitOfWork, siteId: string) => {
  const site = (await uow.tx.query<{ id: string; tier: string; address: AddressWire | null }>(
    `SELECT id, tier, address FROM accounts WHERE id = $1`, [siteId],
  ))[0];
  if (!site) throw new InputRefused(`no node ${siteId} visible in this scope`, "unknown_site");
  if (site.tier !== "site") throw new InputRefused(`"${siteId}" is a ${site.tier}, not a site`, "not_a_site");
  return site;
};
const unplaced = (siteId: string, outcome: LocateSiteOutput["outcome"]): LocateSiteOutput => ({ siteId, lat: null, lng: null, outcome, eventId: null });

export const locateSiteRead = async (uow: UnitOfWork, input: LocateSiteInput, config: GeocodeConfig, now: () => number = Date.now): Promise<LocatePlan> => {
  if (typeof input.siteId !== "string" || !UUID.test(input.siteId)) throw new BadInput("siteId must be a uuid");
  const site = await siteRow(uow, input.siteId);
  const had = coordinatesOf(site.address);
  if (had) return { answer: { siteId: site.id, ...had, outcome: "recorded", eventId: null } };
  const q = addressQuery(site.address);
  if (!q) return { answer: unplaced(site.id, "no_address") };
  if (!config.urlTemplate) return { answer: unplaced(site.id, "not_configured") };
  const failedAt = geocodeFailures.get(q);
  if (failedAt !== undefined && now() - failedAt < FAILURE_TTL_MS) return { answer: unplaced(site.id, "provider_unreachable") };
  return { siteId: site.id, query: q };
};

/** Ask the geocoder. No transaction is held while this runs; a failure is remembered for a minute. */
export const geocode = async (q: string, config: GeocodeConfig, fetcher: JsonFetcher, now: () => number = Date.now): Promise<Located> => {
  if (!config.urlTemplate) return "provider_unreachable";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(config.urlTemplate.replaceAll("{q}", encodeURIComponent(q)), { signal: controller.signal });
    if (!res.ok) { geocodeFailures.set(q, now()); return "provider_unreachable"; }
    const body = (await res.json()) as { features?: { place_type?: string[]; geometry?: { type?: string; coordinates?: number[] } }[] };
    const hit = body.features?.find((f) => f.place_type?.some((t) => PRECISE.has(t)) && f.geometry?.type === "Point");
    const [lng, lat] = hit?.geometry?.coordinates ?? [];
    return (lat === undefined || lng === undefined ? null : coordinatesOf({ lat, lng })) ?? "not_found";
  } catch {
    geocodeFailures.set(q, now());
    return "provider_unreachable";
  } finally {
    clearTimeout(timer);
  }
};

export const locateSiteWrite = async (uow: UnitOfWork, siteId: string, query: string, found: Located): Promise<LocateSiteOutput> => {
  if (typeof found === "string") return unplaced(siteId, found);
  const site = await siteRow(uow, siteId);
  const had = coordinatesOf(site.address);
  if (had) return { siteId: site.id, ...had, outcome: "recorded", eventId: null };
  // The address was edited while the geocoder was asked: this point is for
  // words the site no longer has. Nothing is written; the next open asks again.
  if (addressQuery(site.address) !== query) return unplaced(site.id, "not_found");
  const { eventId } = await updateAccount(uow, { accountId: site.id, address: { ...site.address, lat: found.lat, lng: found.lng } });
  return { siteId: site.id, ...found, outcome: "located", eventId };
};

/** All three steps in one unit of work — for a caller with no pool to release (the tests). main.ts runs them apart. */
export const locateSite = async (uow: UnitOfWork, input: LocateSiteInput, config: GeocodeConfig, fetcher: JsonFetcher, now: () => number = Date.now): Promise<LocateSiteOutput> => {
  const plan = await locateSiteRead(uow, input, config, now);
  if ("answer" in plan) return plan.answer;
  return locateSiteWrite(uow, plan.siteId, plan.query, await geocode(plan.query, config, fetcher, now));
};
