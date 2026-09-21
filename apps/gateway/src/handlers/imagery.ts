import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { SiteImageryInput, SiteImageryOutput, AddressWire } from "../../../../packages/contracts/src/operations.ts";

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
