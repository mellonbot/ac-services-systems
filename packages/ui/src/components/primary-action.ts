import { PrimaryActionSpec } from "../component.ts";
import { component, html } from "../render.ts";

export type PrimaryActionProps = {
  readonly label: string;
  readonly onClick?: () => void;
  /** `submit` inside a form; the default is a plain button so a stray Enter does not post. */
  readonly type?: "button" | "submit";
  readonly kind?: "primary" | "quiet" | "danger";
  /**
   * Disabled WITH the reason, rendered where the control is. A greyed-out
   * button with no explanation is a support call; in degraded mode every
   * mutation's action renders this way with the surface's degraded text.
   */
  readonly disabledReason?: string;
  readonly id?: string;
};

/**
 * The one control that commits something. Sized by `--control-height` — 56px
 * in the field, 36px at a console — and its hover affordance is gated by
 * `--hover`, so in field density there is nothing a cursor would have revealed.
 *
 * `aria-disabled` rather than the `disabled` attribute: a natively disabled
 * button is skipped by focus and its title is unreachable to a keyboard user,
 * which hides the reason from exactly the person who needs it. The click is
 * swallowed here instead.
 */
export const PrimaryAction = component<typeof PrimaryActionSpec, PrimaryActionProps>(PrimaryActionSpec, (p) => {
  const disabled = p.disabledReason !== undefined;
  const onClick = (e: Event) => {
    if (disabled) { e.preventDefault(); return; }
    p.onClick?.();
  };
  return html`<span class="ac-action-wrap" data-density=${p.density}>
    <button class="ac-action" type=${p.type ?? "button"} data-kind=${p.kind ?? "primary"} data-density=${p.density}
      id=${p.id} aria-disabled=${disabled ? "true" : "false"} onClick=${onClick}>${p.label}</button>
    ${disabled ? html`<span class="ac-action__reason" role="note">${p.disabledReason}</span>` : null}
  </span>`;
});
