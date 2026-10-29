import { html, type VNode } from "../../../../packages/ui/src/index.ts";
import { MAP_TILE_REACH, MAP_ZOOM_MAX, MAP_ZOOM_MIN, tileOf, type JobWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { perStore, type ScreenContext } from "./common.ts";

/**
 * WHERE THE JOB IS, FROM ABOVE — the gateway's satellite tiles (sites.mapTile)
 * with a pin at the site, so a dispatcher can see the roof, the yard and the
 * gate before sending a crew. The browser never reaches the tile provider; the
 * gateway fetches each tile and serves only the few around this site.
 *
 * S3 reads the map and never places a site on it: putting a point on an
 * address writes the customer's record (sites.locate → accounts.update), and
 * the account is S2's to author. An address with no point says so and where
 * it gets one.
 *
 * Drag or arrow keys pan, +/− zoom, Ctrl + scroll zooms; plain scroll is the
 * page's. The pan is held to the box the gateway will serve (MAP_TILE_REACH).
 */
const TILE = 256;
/** Tiles are asked for to cover this much either side of centre — wider than the map column, so a resize never shows a hole. */
const HALF_W = 384, HALF_H = 160;
const START_ZOOM = 18;
const WHEEL_PER_LEVEL = 100;

type View = { readonly siteId: string; readonly z: number; readonly cx: number; readonly cy: number };
const viewFor = perStore<View | null>(null);
let drag: { readonly id: number; x: number; y: number } | null = null;
let wheelTravel = 0;

const pointAt = (lat: number, lng: number, z: number) => { const t = tileOf(lat, lng, z); return { x: t.x * TILE, y: t.y * TILE }; };
const clamp = (lat: number, lng: number, v: View): View => {
  const t = tileOf(lat, lng, v.z), hx = Math.floor(t.x), hy = Math.floor(t.y);
  const lo = (n: number) => (n - MAP_TILE_REACH) * TILE, hi = (n: number) => (n + MAP_TILE_REACH + 1) * TILE;
  return { ...v, cx: Math.min(hi(hx), Math.max(lo(hx), v.cx)), cy: Math.min(hi(hy), Math.max(lo(hy), v.cy)) };
};
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-64, 0], ArrowRight: [64, 0], ArrowUp: [0, -64], ArrowDown: [0, 64] };

export const siteMap = (ctx: ScreenContext, job: JobWire): VNode => {
  const lat = job.siteAddress?.lat, lng = job.siteAddress?.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return html`<div class="s3-map s3-map--empty" id="site-map">
      <p class="s3-muted" role="status">${job.siteAddress?.line1
        ? "This address has not been placed on the map yet. It gets its pin when the customer's record is opened in Accounts (Service Manager)."
        : "No street address is recorded for this site, so there is nothing to place on the map."}</p>
    </div>`;
  }

  const view = viewFor(ctx.store);
  const current = (): View => {
    const v = view.value;
    if (v && v.siteId === job.siteId) return v;
    const p = pointAt(lat, lng, START_ZOOM);
    return { siteId: job.siteId, z: START_ZOOM, cx: p.x, cy: p.y };
  };
  const pan = (dx: number, dy: number) => { const v = current(); view.value = clamp(lat, lng, { ...v, cx: v.cx + dx, cy: v.cy + dy }); };
  const zoom = (dz: number) => {
    const v = current();
    const z = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, v.z + dz));
    if (z === v.z) return;
    const k = 2 ** (z - v.z);
    view.value = clamp(lat, lng, { ...v, z, cx: v.cx * k, cy: v.cy * k });
  };

  const v = current();
  const site = pointAt(lat, lng, v.z);
  const tileRead = (x: number, y: number) =>
    ctx.store.read(keyOf("sites.mapTile", { siteId: job.siteId, z: v.z, x, y }), () => ctx.shell.gateway.siteMapTile({ siteId: job.siteId, z: v.z, x, y })).value;
  // The site's own tile first: if no provider is configured (or it is down), that one answer says so and no other tile is asked for.
  const hx = Math.floor(site.x / TILE), hy = Math.floor(site.y / TILE);
  const probe = tileRead(hx, hy);
  const imagery = probe.state === "ready" && probe.value.image !== null;
  const cells: VNode[] = [];
  for (let ty = Math.floor((v.cy - HALF_H) / TILE); ty <= Math.floor((v.cy + HALF_H) / TILE); ty++) {
    for (let tx = Math.floor((v.cx - HALF_W) / TILE); tx <= Math.floor((v.cx + HALF_W) / TILE); tx++) {
      const inReach = Math.abs(tx - hx) <= MAP_TILE_REACH && Math.abs(ty - hy) <= MAP_TILE_REACH && ty >= 0 && ty < 2 ** v.z;
      const t = imagery && inReach ? tileRead(tx, ty) : null;
      const img = t?.state === "ready" ? t.value.image : null;
      cells.push(html`<div class="s3-map__tile" key=${`${v.z}/${tx}/${ty}`} style=${`left:calc(50% + ${Math.round(tx * TILE - v.cx)}px);top:calc(50% + ${Math.round(ty * TILE - v.cy)}px)`}>
        ${img ? html`<img src=${img} alt="" width=${TILE} height=${TILE} draggable=${false} />` : null}
      </div>`);
    }
  }
  const why = probe.state !== "ready" ? (probe.state === "loading" ? "Loading the satellite view…" : "The map could not be read.")
    : probe.value.unavailable === "not_configured" ? "No satellite provider is configured — the pin is drawn on a bare grid."
    : probe.value.unavailable === "provider_unreachable" ? "The satellite provider did not answer — the pin is drawn on a bare grid."
    : null;
  const attribution = imagery && probe.state === "ready" ? probe.value.attribution : null;

  const down = (e: PointerEvent) => {
    // A press on a zoom button is the button's: captured by the view, its click would never land.
    if (e.button !== 0 || (e.target as Element | null)?.closest?.("button")) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = drag.x - e.clientX, dy = drag.y - e.clientY;
    drag.x = e.clientX; drag.y = e.clientY;
    pan(dx, dy);
  };
  const up = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };
  const wheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    wheelTravel += e.deltaY;
    if (Math.abs(wheelTravel) < WHEEL_PER_LEVEL) return;
    zoom(wheelTravel < 0 ? 1 : -1);
    wheelTravel = 0;
  };
  const key = (e: KeyboardEvent) => {
    const d = PAN_KEYS[e.key];
    if (d) { e.preventDefault(); pan(d[0], d[1]); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1); }
    else if (e.key === "-") { e.preventDefault(); zoom(-1); }
  };

  return html`<figure class="s3-map" id="site-map" data-basemap=${imagery ? "tiles" : "grid"}>
    <div class="s3-map__view" tabindex="0" role="application" aria-roledescription="map"
      aria-label=${`Satellite map of ${job.siteName ?? "the site"}. Arrow keys pan, plus and minus zoom.`} title="Drag to pan · Ctrl + scroll to zoom"
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onWheel=${wheel} onKeyDown=${key}>
      ${cells}
      <svg class="s3-map__pin" viewBox="0 0 24 32" width="24" height="32" aria-hidden="true"
        style=${`left:calc(50% + ${Math.round(site.x - v.cx)}px);top:calc(50% + ${Math.round(site.y - v.cy)}px)`}>
        <path d="M12 31C12 31 2 18.6 2 11a10 10 0 0 1 20 0c0 7.6-10 20-10 20Z" />
        <circle cx="12" cy="11" r="4" />
      </svg>
      <div class="s3-map__controls">
        <button type="button" class="s3-map__btn" aria-label="Zoom in" disabled=${v.z >= MAP_ZOOM_MAX} onClick=${() => zoom(1)}>+</button>
        <button type="button" class="s3-map__btn" aria-label="Zoom out" disabled=${v.z <= MAP_ZOOM_MIN} onClick=${() => zoom(-1)}>−</button>
        <button type="button" class="s3-map__btn" onClick=${() => { view.value = null; }}>Re-centre</button>
      </div>
    </div>
    <figcaption class="s3-map__caption">
      <span class="s3-num">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
      ${why ? html`<span role="status">${why}</span>` : null}
      ${attribution ? html`<span>${attribution}</span>` : null}
    </figcaption>
  </figure>`;
};
