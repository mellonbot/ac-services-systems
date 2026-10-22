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
 * move, and a provider bills per fetch.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZOOM = 18, WIDTH = 640, HEIGHT = 360;
const MAX_BYTES = 1_500_000;
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

export type ImageryConfig = { readonly urlTemplate: string | null; readonly attribution: string | null };
export const imageryConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): ImageryConfig => ({
  urlTemplate: env.AC_IMAGERY_URL?.trim() || null,
  attribution: env.AC_IMAGERY_ATTRIBUTION?.trim() || null,
});

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

type Cached = { at: number; image: string };
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

export const siteImagery = async (
  uow: UnitOfWork, input: SiteImageryInput, config: ImageryConfig, fetcher: Fetcher, now: () => number = Date.now,
): Promise<SiteImageryOutput> => {
  if (typeof input.siteId !== "string" || !UUID.test(input.siteId)) throw new BadInput("siteId must be a uuid");
  const site = (await uow.tx.query<{ id: string; tier: string; address: AddressWire | null }>(
    `SELECT id, tier, address FROM accounts WHERE id = $1`, [input.siteId],
  ))[0];
  if (!site) throw new InputRefused(`no node ${input.siteId} visible in this scope`, "unknown_site");
  if (site.tier !== "site") throw new InputRefused(`"${input.siteId}" is a ${site.tier}, not a site`, "not_a_site");

  const at = coordinatesOf(site.address);
  const base = { siteId: site.id, lat: at?.lat ?? null, lng: at?.lng ?? null, attribution: config.attribution };
  if (!config.urlTemplate) return { ...base, image: null, unavailable: "not_configured" };
  if (!at) return { ...base, image: null, unavailable: "no_coordinates" };

  const key = `${site.id}:${at.lat}:${at.lng}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return { ...base, image: hit.image, unavailable: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(renderTemplate(config.urlTemplate, at), { signal: controller.signal });
    if (!res.ok) return { ...base, image: null, unavailable: "provider_unreachable" };
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!/^image\/(png|jpeg|webp)$/.test(type)) return { ...base, image: null, unavailable: "provider_unreachable" };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return { ...base, image: null, unavailable: "provider_unreachable" };
    const image = `data:${type};base64,${bytes.toString("base64")}`;
    cache.set(key, { at: now(), image });
    return { ...base, image, unavailable: null };
  } catch {
    return { ...base, image: null, unavailable: "provider_unreachable" };
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
export const mapTileConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): MapTileConfig => ({
  urlTemplate: env.AC_MAP_TILE_URL?.trim() || null,
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

export const siteMapTile = async (
  uow: UnitOfWork, input: SiteMapTileInput, config: MapTileConfig, fetcher: Fetcher, now: () => number = Date.now,
): Promise<SiteMapTileOutput> => {
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
  if (!config.urlTemplate) return { ...base, image: null, unavailable: "not_configured" };
  if (!at) return { ...base, image: null, unavailable: "no_coordinates" };
  const home = tileOf(at.lat, at.lng, z);
  if (Math.abs(x - Math.floor(home.x)) > MAP_TILE_REACH || Math.abs(y - Math.floor(home.y)) > MAP_TILE_REACH)
    throw new InputRefused(`tile ${z}/${x}/${y} is more than ${MAP_TILE_REACH} tiles from the site`, "tile_out_of_reach");

  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit && now() - hit.at < TTL_MS) return { ...base, image: hit.image, unavailable: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = config.urlTemplate.replaceAll("{z}", String(z)).replaceAll("{x}", String(x)).replaceAll("{y}", String(y));
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) return { ...base, image: null, unavailable: "provider_unreachable" };
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!/^image\/(png|jpeg|webp)$/.test(type)) return { ...base, image: null, unavailable: "provider_unreachable" };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_TILE_BYTES) return { ...base, image: null, unavailable: "provider_unreachable" };
    const image = `data:${type};base64,${bytes.toString("base64")}`;
    tileCache.set(key, { at: now(), image });
    return { ...base, image, unavailable: null };
  } catch {
    return { ...base, image: null, unavailable: "provider_unreachable" };
  } finally {
    clearTimeout(timer);
  }
};

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
export const geocodeConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): GeocodeConfig => ({ urlTemplate: env.AC_GEOCODE_URL?.trim() || null });
export type JsonFetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const PRECISE = new Set(["address", "poi"]);
export const addressQuery = (a: AddressWire | null | undefined): string | null => {
  if (!a?.line1?.trim()) return null;
  return [a.line1, a.line2, a.city, [a.state, a.postal].filter(Boolean).join(" "), a.country].filter((s) => s && s.trim()).join(", ");
};

export const locateSite = async (uow: UnitOfWork, input: LocateSiteInput, config: GeocodeConfig, fetcher: JsonFetcher): Promise<LocateSiteOutput> => {
  if (typeof input.siteId !== "string" || !UUID.test(input.siteId)) throw new BadInput("siteId must be a uuid");
  const site = (await uow.tx.query<{ id: string; tier: string; address: AddressWire | null }>(
    `SELECT id, tier, address FROM accounts WHERE id = $1`, [input.siteId],
  ))[0];
  if (!site) throw new InputRefused(`no node ${input.siteId} visible in this scope`, "unknown_site");
  if (site.tier !== "site") throw new InputRefused(`"${input.siteId}" is a ${site.tier}, not a site`, "not_a_site");

  const none = (outcome: LocateSiteOutput["outcome"]): LocateSiteOutput => ({ siteId: site.id, lat: null, lng: null, outcome, eventId: null });
  const had = coordinatesOf(site.address);
  if (had) return { siteId: site.id, ...had, outcome: "recorded", eventId: null };
  const q = addressQuery(site.address);
  if (!q) return none("no_address");
  if (!config.urlTemplate) return none("not_configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let at: { lat: number; lng: number } | null;
  try {
    const res = await fetcher(config.urlTemplate.replaceAll("{q}", encodeURIComponent(q)), { signal: controller.signal });
    if (!res.ok) return none("provider_unreachable");
    const body = (await res.json()) as { features?: { place_type?: string[]; geometry?: { type?: string; coordinates?: number[] } }[] };
    const hit = body.features?.find((f) => f.place_type?.some((t) => PRECISE.has(t)) && f.geometry?.type === "Point");
    const [lng, lat] = hit?.geometry?.coordinates ?? [];
    at = lat === undefined || lng === undefined ? null : coordinatesOf({ lat, lng });
  } catch {
    return none("provider_unreachable");
  } finally {
    clearTimeout(timer);
  }
  if (!at) return none("not_found");
  const { eventId } = await updateAccount(uow, { accountId: site.id, address: { ...site.address, lat: at.lat, lng: at.lng } });
  return { siteId: site.id, ...at, outcome: "located", eventId };
};
