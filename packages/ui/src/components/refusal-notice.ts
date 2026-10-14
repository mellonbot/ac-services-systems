import type { Refusal } from "../../../contracts/src/index.ts";
import { MARK_GLYPHS } from "../../../tokens/src/index.ts";
import { RefusalNoticeSpec } from "../component.ts";
import { component, html } from "../render.ts";
import { refusalHeading, type RefusalRoute } from "./refusal-card.ts";

export type RefusalNoticeProps = {
  readonly refusal: Refusal;
  /** Where the person can go from here. The notice renders them; the surface decides what they do. */
  readonly routes?: readonly RefusalRoute[];
  /** For a refusal that answered a form: a way to clear it without leaving the screen. */
  readonly onDismiss?: () => void;
};

/**
 * RefusalCard's plain sibling. The card renders the admission axis, the
 * permitted authoring tiers and the code, because the people who can act on
 * those sit at a console. Everyone else — a customer, a firm, a vendor, a
 * stranger on the marketing page, a crew on a roof, the read-only dashboard —
 * needs the same heading, the gateway's message verbatim, and a way forward.
 * Six surfaces each wrote that; this is it, once, with the fault mark the
 * state schedule requires beside the word (colour never carries alone).
 */
export const RefusalNotice = component<typeof RefusalNoticeSpec, RefusalNoticeProps>(RefusalNoticeSpec, (p) => {
  const r = p.refusal;
  return html`<section class="ac-notice" role="alert" data-tone="breached" data-kind=${r.kind} data-density=${p.density}>
    <h2 class="ac-notice__heading"><span class="ac-notice__mark" aria-hidden="true">${MARK_GLYPHS.fault}</span> ${refusalHeading(r)}</h2>
    <p class="ac-notice__message">${r.message}</p>
    ${p.routes && p.routes.length
      ? html`<div class="ac-notice__routes">
          ${p.routes.map((route) => html`<button type="button" class="ac-action" data-kind=${route.primary ? "primary" : "quiet"} data-density=${p.density} onClick=${route.onSelect}>${route.label}</button>`)}
        </div>`
      : null}
    ${p.onDismiss ? html`<button type="button" class="ac-link ac-link--button" onClick=${p.onDismiss}>Dismiss</button>` : null}
  </section>`;
});
