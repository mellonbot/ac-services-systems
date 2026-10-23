import { html, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import { serviceLabel, MAP_TILE_REACH, MAP_ZOOM_MAX, MAP_ZOOM_MIN, WORK_DONE_STATES, tileOf, type AccountWire, type JobStateWire, type JobWire, type LocateSiteOutput } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, type ScreenContext } from "./common.ts";

/**
 * A residential customer, selected: where the home is and every visit we have
 * finished there. The map is the gateway's tiles (sites.mapTile) — the
 * browser never reaches a tile provider with a customer's coordinates — with
 * a pin at the address; drag or arrow keys pan, the wheel or +/− zoom. The
 * pan is held to the box the gateway will serve (MAP_TILE_REACH), so a drag
 * never asks for a tile it would refuse. With no provider configured the pin
 * sits on the bare tile grid and the map says so.
 */
const TILE = 256;
/** Tiles are requested to cover this much either side of centre — wider than the column the map can be given, so a resize never shows a hole. */
const HALF_W = 448, HALF_H = 160;
const START_ZOOM = 17;

type View = { readonly siteId: string; readonly z: number; readonly cx: number; readonly cy: number };
const view = signal<View | null>(null);
let drag: { readonly id: number; x: number; y: number } | null = null;

const homeAt = (lat: number, lng: number, z: number) => { const t = tileOf(lat, lng, z); return { x: t.x * TILE, y: t.y * TILE }; };
/** Hold the centre inside the tiles the gateway will serve at this zoom. */
const clamp = (lat: number, lng: number, v: View): View => {
  const t = tileOf(lat, lng, v.z), hx = Math.floor(t.x), hy = Math.floor(t.y);
  const lo = (n: number) => (n - MAP_TILE_REACH) * TILE, hi = (n: number) => (n + MAP_TILE_REACH + 1) * TILE;
  return { ...v, cx: Math.min(hi(hx), Math.max(lo(hx), v.cx)), cy: Math.min(hi(hy), Math.max(lo(hy), v.cy)) };
};
const viewFor = (site: AccountWire, lat: number, lng: number): View => {
  const v = view.value;
  if (v && v.siteId === site.id) return v;
  const h = homeAt(lat, lng, START_ZOOM);
  return { siteId: site.id, z: START_ZOOM, cx: h.x, cy: h.y };
};
export const panMap = (site: AccountWire, lat: number, lng: number, dx: number, dy: number) => {
  const v = viewFor(site, lat, lng);
  view.value = clamp(lat, lng, { ...v, cx: v.cx + dx, cy: v.cy + dy });
};
export const zoomMap = (site: AccountWire, lat: number, lng: number, dz: number) => {
  const v = viewFor(site, lat, lng);
  const z = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, v.z + dz));
  if (z === v.z) return;
  const k = 2 ** (z - v.z);
  view.value = clamp(lat, lng, { ...v, z, cx: v.cx * k, cy: v.cy * k });
};
export const recentreMap = () => { view.value = null; };
export const forgetLocating = () => { locating.value = {}; };

const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-64, 0], ArrowRight: [64, 0], ArrowUp: [0, -64], ArrowDown: [0, 64] };

/**
 * A typed address has no point until the gateway geocodes it (sites.locate),
 * which writes the point onto the address. Asked once per site per page —
 * a failure that may pass offers Try again; the answer arrives as an
 * account.updated and the tree refetch brings the coordinates.
 */
type Locating = "asking" | LocateSiteOutput["outcome"] | "refused";
const locating = signal<Readonly<Record<string, Locating>>>({});
const settle = (siteId: string, to: Locating) => { locating.value = { ...locating.value, [siteId]: to }; };
export const locate = (ctx: ScreenContext, siteId: string) => {
  settle(siteId, "asking");
  ctx.shell.gateway.locateSite({ siteId }).then(
    (out) => { settle(siteId, out.outcome); if (out.lat !== null) ctx.store.invalidate("accounts.list"); },
    () => settle(siteId, "refused"),
  );
};
const LOCATE_WHY: Readonly<Record<Locating, string>> = {
  asking: "Finding this address on the map…",
  located: "Placing the pin…", recorded: "Placing the pin…",
  not_configured: "No geocoder is configured, so this address cannot be placed on the map yet.",
  no_address: "This address has no street line to place on the map.",
  not_found: "The map provider could not find this exact address — check the street, house number, city and ZIP.",
  provider_unreachable: "The map provider did not answer.",
  refused: "Placing this address was refused.",
};
const RETRYABLE: ReadonlySet<Locating> = new Set(["provider_unreachable", "refused"]);

const homeMap = (ctx: ScreenContext, site: AccountWire): VNode => {
  const lat = site.address?.lat, lng = site.address?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") {
    const state = locating.value[site.id];
    // Asked from render, after it: the request is the store's kind of side effect, the signal write must not land mid-render.
    if (state === undefined && !ctx.degraded) queueMicrotask(() => { if (locating.value[site.id] === undefined) locate(ctx, site.id); });
    const why = state === undefined ? (ctx.degraded ? "Offline — the address is placed on the map when the connection returns." : LOCATE_WHY.asking) : LOCATE_WHY[state];
    return html`<div class="s2-map s2-map--empty" id="home-map">
      <p class="s2-muted" role="status">${why}</p>
      ${state && RETRYABLE.has(state) ? html`<button type="button" class="s2-mutation s2-mutation--quiet" onClick=${() => locate(ctx, site.id)}>Try again</button>` : null}
    </div>`;
  }
  const v = viewFor(site, lat, lng);
  const home = homeAt(lat, lng, v.z);
  const tileRead = (x: number, y: number) =>
    ctx.store.read(keyOf("sites.mapTile", { siteId: site.id, z: v.z, x, y }), () => ctx.shell.gateway.siteMapTile({ siteId: site.id, z: v.z, x, y })).value;
  // Ask for the home's own tile first: if the gateway has no provider (or the provider is down), that one answer says so, and no other tile is asked for.
  const hx = Math.floor(home.x / TILE), hy = Math.floor(home.y / TILE);
  const probe = tileRead(hx, hy);
  const basemap = probe.state === "ready" && probe.value.image !== null;
  const cells: VNode[] = [];
  for (let ty = Math.floor((v.cy - HALF_H) / TILE); ty <= Math.floor((v.cy + HALF_H) / TILE); ty++) {
    for (let tx = Math.floor((v.cx - HALF_W) / TILE); tx <= Math.floor((v.cx + HALF_W) / TILE); tx++) {
      const inReach = Math.abs(tx - hx) <= MAP_TILE_REACH && Math.abs(ty - hy) <= MAP_TILE_REACH && ty >= 0 && ty < 2 ** v.z;
      const t = basemap && inReach ? tileRead(tx, ty) : null;
      const img = t?.state === "ready" ? t.value.image : null;
      cells.push(html`<div class="s2-map__tile" key=${`${v.z}/${tx}/${ty}`} style=${`left:calc(50% + ${Math.round(tx * TILE - v.cx)}px);top:calc(50% + ${Math.round(ty * TILE - v.cy)}px)`}>
        ${img ? html`<img src=${img} alt="" width=${TILE} height=${TILE} draggable=${false} />` : null}
      </div>`);
    }
  }
  const why = probe.state !== "ready" ? (probe.state === "loading" ? "Loading the map…" : "The map could not be read.")
    : probe.value.unavailable === "not_configured" ? "No basemap provider is configured — the pin is drawn on the bare tile grid."
    : probe.value.unavailable === "provider_unreachable" ? "The basemap provider did not answer — the pin is drawn on the bare tile grid."
    : null;
  const attribution = basemap && probe.state === "ready" ? probe.value.attribution : null;

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = drag.x - e.clientX, dy = drag.y - e.clientY;
    drag.x = e.clientX; drag.y = e.clientY;
    panMap(site, lat, lng, dx, dy);
  };
  const up = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };
  const wheel = (e: WheelEvent) => { e.preventDefault(); zoomMap(site, lat, lng, e.deltaY < 0 ? 1 : -1); };
  const key = (e: KeyboardEvent) => {
    const d = PAN_KEYS[e.key];
    if (d) { e.preventDefault(); panMap(site, lat, lng, d[0], d[1]); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomMap(site, lat, lng, 1); }
    else if (e.key === "-") { e.preventDefault(); zoomMap(site, lat, lng, -1); }
  };

  return html`<figure class="s2-map" id="home-map" data-basemap=${basemap ? "tiles" : "grid"}>
    <div class="s2-map__view" tabindex="0" role="application" aria-roledescription="map"
      aria-label=${`Map of ${site.name}. Arrow keys pan, plus and minus zoom.`}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onWheel=${wheel} onKeyDown=${key}>
      ${cells}
      <svg class="s2-map__pin" viewBox="0 0 24 32" width="24" height="32" aria-hidden="true"
        style=${`left:calc(50% + ${Math.round(home.x - v.cx)}px);top:calc(50% + ${Math.round(home.y - v.cy)}px)`}>
        <path d="M12 31C12 31 2 18.6 2 11a10 10 0 0 1 20 0c0 7.6-10 20-10 20Z" />
        <circle cx="12" cy="11" r="4" />
      </svg>
    </div>
    <div class="s2-map__controls">
      <button type="button" class="s2-mutation s2-mutation--quiet" aria-label="Zoom in" disabled=${v.z >= MAP_ZOOM_MAX} onClick=${() => zoomMap(site, lat, lng, 1)}>+</button>
      <button type="button" class="s2-mutation s2-mutation--quiet" aria-label="Zoom out" disabled=${v.z <= MAP_ZOOM_MIN} onClick=${() => zoomMap(site, lat, lng, -1)}>−</button>
      <button type="button" class="s2-mutation s2-mutation--quiet" onClick=${recentreMap}>Re-centre</button>
    </div>
    <figcaption class="s2-map__caption">
      <span class="s2-num">${lat.toFixed(5)}, ${lng.toFixed(5)}</span> · zoom <span class="s2-num">${v.z}</span>
      ${why ? html`<span class="s2-muted" role="status">${why}</span>` : null}
      ${attribution ? html`<span class="s2-muted">${attribution}</span>` : null}
    </figcaption>
  </figure>`;
};

const STATE_WORD: Partial<Readonly<Record<JobStateWire, string>>> = {
  complete: "Complete", invoiced: "Invoiced", needs_pricing: "Complete — needs pricing", awaiting_po: "Complete — waiting on a PO",
  awaiting_pictures: "Complete — waiting on pictures", invoice_trouble: "Complete — trouble invoicing",
};
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Every finished job at the home, oldest first — the order the house's story happened in. */
export const serviceHistoryOf = (jobs: readonly JobWire[], siteId: string): readonly JobWire[] =>
  jobs.filter((j) => j.siteId === siteId && WORK_DONE_STATES.includes(j.state))
    .sort((a, b) => Date.parse(a.serviceWindowEnd) - Date.parse(b.serviceWindowEnd) || a.id.localeCompare(b.id));

const serviceHistory = (ctx: ScreenContext, site: AccountWire): VNode => {
  const jobs = ctx.store.read(keyOf("jobs.list"), () => ctx.shell.gateway.listJobs({})).value;
  return whenReady(ctx, jobs, (j) => DataGrid({
    density: ctx.density,
    stack: true,
    caption: "Service history",
    columns: [
      { key: "serviceWindowEnd", header: "Visit", cell: (r: JobWire) => html`<span class="s2-num">${day(r.serviceWindowEnd)}</span>` },
      { key: "serviceCode", header: "Service", cell: (r: JobWire) => serviceLabel(r.serviceCode) },
      { key: "state", header: "Status", cell: (r: JobWire) => html`${STATE_WORD[r.state] ?? r.state}${r.returnTrip ? html` · <span class="s2-muted">return trip owed</span>` : null}` },
      { key: "latestNote", header: "Latest note", cell: (r: JobWire) => (r.latestNote ? html`<span class="s2-history__note">${r.latestNote.body}</span>` : html`<span class="s2-muted">—</span>`) },
    ],
    rows: serviceHistoryOf(j.jobs, site.id),
    rowKey: (r: JobWire) => r.id,
    emptyText: "No finished service at this address yet.",
  }) ?? html``, () => ctx.store.invalidate("jobs.list"));
};

/** The selected homeowner's card, with the map and the history beside the customer card S6 draws. */
export const homeCard = (ctx: ScreenContext, card: VNode, site: AccountWire | null): VNode => html`<div class="s2-home" id="home-card">
  <div class="s2-home__top">
    ${card}
    ${site ? homeMap(ctx, site) : html`<div class="s2-map s2-map--empty" id="home-map"><p class="s2-muted">This customer has no site yet, so there is no address to pin.</p></div>`}
  </div>
  ${site ? serviceHistory(ctx, site) : null}
</div>`;
