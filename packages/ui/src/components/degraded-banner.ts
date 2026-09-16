import { MARK_GLYPHS } from "../../../tokens/src/index.ts";
import { DegradedBannerSpec } from "../component.ts";
import { component, html } from "../render.ts";

export type DegradedBannerProps = {
  /** `shell.isDegraded()`. The banner reads it; nothing in a surface writes it. */
  readonly degraded: boolean;
  /** `SURFACES[id].degraded` — the mode declared before the outage. */
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
  lastOkAt === null ? "No response from the gateway yet this session." : `Last good response ${ageOf(now - lastOkAt)} ago.`;

/**
 * Rendered by every surface, in its own density, and hidden when the flag is
 * down. The text is the registry's declaration; the age is the one live fact.
 * For S3 this is the staleness clock its entry describes; for S2 it is the
 * read-only notice; for S5 it says the device is holding intent.
 */
export const DegradedBanner = component<typeof DegradedBannerSpec, DegradedBannerProps>(DegradedBannerSpec, (p) => {
  if (!p.degraded) return null;
  return html`<div class="ac-degraded" role="alert" data-density=${p.density}>
    <span class="ac-degraded__mark" aria-hidden="true">${MARK_GLYPHS.fault}</span>
    <strong class="ac-degraded__title">Gateway unreachable.</strong>
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
  if (p.degraded) slot.textContent = `${MARK_GLYPHS.fault} Gateway unreachable. ${p.text} ${degradedLine(p.lastOkAt, p.now)}`;
};
