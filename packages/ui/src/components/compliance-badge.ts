import { ComplianceBadgeSpec } from "../component.ts";
import { component, html } from "../render.ts";

export type ComplianceBadgeProps = {
  readonly cleared: boolean;
  /** The gate's reason when not cleared — `missing`, `expired_in_window`, `unverified`, `crew_inactive` — and its detail. */
  readonly reason?: string;
  readonly detail?: string;
};

/**
 * Console only. There is no field variant to import — `density: "field"` is a
 * type error at the call site — because a crew cannot act on a refusal and
 * showing them one starts the wrong conversation. The gate itself is enforced
 * at `dispatch.assign`; this badge only reports what it decided.
 */
export const ComplianceBadge = component<typeof ComplianceBadgeSpec, ComplianceBadgeProps>(ComplianceBadgeSpec, (p) =>
  html`<span class="ac-badge" data-cleared=${p.cleared ? "true" : "false"} data-density=${p.density} title=${p.detail}>
    <span class="ac-badge__glyph" aria-hidden="true">${p.cleared ? "●" : "✕"}</span>
    <span class="ac-badge__word">${p.cleared ? "Cleared" : `Not cleared${p.reason ? ` — ${p.reason.replace(/_/g, " ")}` : ""}`}</span>
  </span>`);
