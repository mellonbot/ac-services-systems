import { STATUS_GLYPH } from "../../../tokens/src/index.ts";
import { StatusPillSpec } from "../component.ts";
import { component, html } from "../render.ts";

export type Status = keyof typeof STATUS_GLYPH;

export type StatusPillProps = {
  readonly status: Status;
  /** Overrides the register's word. The glyph and the colour role still come from the status. */
  readonly label?: string;
  /**
   * Announce this pill's changes. OFF by default, and that is the fix, not the
   * omission: `role="status"` was on every pill, so a forty-row dispatch board
   * was forty polite live regions and one re-sort read the whole board aloud.
   * A pill is a LABEL. Set this only where a single pill IS the news — one
   * job's SLA on a detail screen — and let a board announce at the board.
   */
  readonly live?: boolean;
};

/**
 * Glyph + word + colour, always all three (tokens/whitelabel.ts STATUS_GLYPH).
 * The colour is a role — `data-status` selects `var(--color-status-*)` in the
 * stylesheet — so this file names no colour and the field's dark surface
 * re-points it for free.
 *
 * The glyph is `aria-hidden`: it is the channel for an eye that cannot use hue,
 * and the word beside it is already the channel for a reader that has no eye.
 */
export const StatusPill = component<typeof StatusPillSpec, StatusPillProps>(StatusPillSpec, (p) => {
  const g = STATUS_GLYPH[p.status];
  return html`<span class="ac-pill" role=${p.live ? "status" : undefined} data-status=${p.status} data-density=${p.density}>
    <span class="ac-pill__glyph" aria-hidden="true">${g.glyph}</span><span class="ac-pill__word">${p.label ?? g.word}</span>
  </span>`;
});
