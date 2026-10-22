import { ShiftCardSpec } from "../component.ts";
import { component, html, type ComponentChildren } from "../render.ts";

export type ShiftCardProps = {
  readonly id?: string;
  /** The card's name for a screen reader; the card takes focus, so it needs one. */
  readonly label: string;
  /** Always shown, at the top. */
  readonly top: ComponentChildren;
  /** Unfolds under `top` while the card is engaged. */
  readonly topReveal?: ComponentChildren;
  /** Shown at rest; folds away while the card is engaged. */
  readonly middle?: ComponentChildren;
  /** Always shown, in the well at the foot. */
  readonly bottom: ComponentChildren;
  /** Unfolds in the well while the card is engaged — the well rises into the space `middle` gave up. */
  readonly bottomReveal?: ComponentChildren;
};

/**
 * A card that shifts when engaged: the middle folds away and the well at the
 * foot rises with the detail. Ported from Cult UI's shift-card by behaviour
 * only — no motion library, no entrance animation, no hover lift. Engaged is
 * :hover or :focus-within, so a mouse, the keyboard and a tap all reach it,
 * and the folded content stays in the markup for anything that reads it.
 */
export const ShiftCard = component<typeof ShiftCardSpec, ShiftCardProps>(ShiftCardSpec, (p) => {
  const fold = (dir: "in" | "out", body: ComponentChildren) =>
    body == null ? null : html`<div class="ac-shift-card__fold" data-fold=${dir}><div>${body}</div></div>`;
  return html`<article class="ac-shift-card" id=${p.id} tabindex="0" aria-label=${p.label} data-density=${p.density}>
    <header class="ac-shift-card__top">${p.top}${fold("in", p.topReveal)}</header>
    ${fold("out", p.middle)}
    <div class="ac-shift-card__bottom">${p.bottom}${fold("in", p.bottomReveal)}</div>
  </article>`;
});
