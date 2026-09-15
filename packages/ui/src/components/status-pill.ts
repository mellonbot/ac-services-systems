import { STATUS_GLYPH } from "../../../tokens/src/index.ts";
import { StatusPillSpec } from "../component.ts";
import { component, html } from "../render.ts";

export type Status = keyof typeof STATUS_GLYPH;

export type StatusPillProps = {
  readonly status: Status;
  /** Overrides the register's word. The glyph and the colour role still come from the status. */
  readonly label?: string;
};

/**
 * Glyph + word + colour, always all three (tokens/whitelabel.ts STATUS_GLYPH).
 * The colour is a role — `data-status` selects `var(--color-status-*)` in the
 * stylesheet — so this file names no colour and the field's dark surface
 * re-points it for free.
 */
export const StatusPill = component<typeof StatusPillSpec, StatusPillProps>(StatusPillSpec, (p) => {
  const g = STATUS_GLYPH[p.status];
  return html`<span class="ac-pill" role="status" data-status=${p.status} data-density=${p.density}>
    <span class="ac-pill__glyph" aria-hidden="true">${g.glyph}</span><span class="ac-pill__word">${p.label ?? g.word}</span>
  </span>`;
});
