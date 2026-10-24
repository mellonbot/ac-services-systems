import { MARK_GLYPHS } from "../../../tokens/src/index.ts";
import { DegradedBannerSpec } from "../component.ts";
import { component, effect, html, signal } from "../render.ts";

export type DegradedBannerProps = {
  /** `shell.isDegraded()`. The banner reads it; nothing in a surface writes it. */
  readonly degraded: boolean;
  /** `SURFACES[id].degradedNotice` — the declared mode, in the reader's words. */
  readonly text: string;
  /** Epoch ms of the last answered request, or null if none this session. */
  readonly lastOkAt: number | null;
  /** Epoch ms now. A parameter, so the age is a fact the test can state. */
  readonly now: number;
};

/** "12 s", "4 min", "2 h" — coarse on purpose; a staleness clock that ticks seconds is a distraction. */
export const ageOf = (sinceMs: number): string => {
  const s = Math.max(0, Math.floor(sinceMs / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
};

export const degradedLine = (lastOkAt: number | null, now: number): string =>
  lastOkAt === null ? "Not connected yet this session." : `Last connected ${ageOf(now - lastOkAt)} ago.`;

/**
 * Rendered by every surface, in its own density, and hidden when the flag is
 * down. The text is the registry's notice; the age is the one live fact.
 * For S3 this is the staleness clock its entry describes; for S2 it is the
 * read-only notice; for S5 it says the device is holding intent.
 */
export const DegradedBanner = component<typeof DegradedBannerSpec, DegradedBannerProps>(DegradedBannerSpec, (p) => {
  if (!p.degraded) return null;
  return html`<div class="ac-degraded" role="alert" data-density=${p.density}>
    <span class="ac-degraded__mark" aria-hidden="true">${MARK_GLYPHS.fault}</span>
    <span class="ac-degraded__text">${p.text}</span>
    <span class="ac-degraded__age">${degradedLine(p.lastOkAt, p.now)}</span>
  </div>`;
});

/**
 * The frame's `<ac-degraded hidden>` slot, driven without a render: the frame
 * carries the declared text at build time, so the only live parts are the
 * `hidden` attribute and the age. Takes the element's shape rather than a DOM
 * type so it runs under node --test.
 */
export type DegradedSlot = { hidden: boolean; textContent: string | null };

export const applyDegraded = (slot: DegradedSlot, p: DegradedBannerProps): void => {
  slot.hidden = !p.degraded;
  // The fault mark leads, the same one the rendered banner draws. This path runs
  // when the bundle has loaded but the surface has not mounted a tree, and it is
  // the one the frame ships — it should not be the one variant of the banner
  // with no mark on it.
  if (p.degraded) slot.textContent = `${MARK_GLYPHS.fault} ${p.text} ${degradedLine(p.lastOkAt, p.now)}`;
};

/**
 * Keeps the slot current: re-applied whenever what `read` reads changes, and
 * again on every call of the returned `tick` — the age is the one live fact,
 * and nothing else changes while a surface stays degraded, so without a tick
 * "Last connected 12 s ago" would read 12 s for as long as the outage lasted.
 * A surface calls `tick` from the 1s interval it already runs.
 */
export const driveDegraded = (slot: DegradedSlot, read: () => Omit<DegradedBannerProps, "now">, now: () => number): (() => void) => {
  const at = signal(now());
  effect(() => { applyDegraded(slot, { ...read(), now: at.value }); });
  return () => { at.value = now(); };
};
