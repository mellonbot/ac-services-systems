/**
 * @ac/ui — the density-typed component set, and the renderer boundary.
 *
 * A surface imports this and never preact, htm or @preact/signals; the guard
 * holds that line (09 §3.10). What a surface gets:
 *   html / mount / signals      — render.ts, the one file that names the renderer
 *   the components              — each typed to its spec's admitted densities
 *   the screen router           — built from the surface's SCREENS registry
 *   UI_CSS                      — the stylesheet build-surface.ts writes to dist/
 */
export * from "./component.ts";
export { html, mount, signal, computed, effect, batch, component, admits } from "./render.ts";
export type { VNode, ComponentChildren, Signal, ReadonlySignal, Admitted, ViewProps } from "./render.ts";
export * from "./components/status-pill.ts";
export * from "./components/primary-action.ts";
export * from "./components/data-grid.ts";
export * from "./components/compliance-badge.ts";
export * from "./components/refusal-card.ts";
export * from "./components/refusal-notice.ts";
export * from "./components/degraded-banner.ts";
export * from "./components/customer-card.ts";
export * from "./components/account-menu.ts";
export * from "./components/messenger.ts";
export * from "./router.ts";
export * from "./resource-store.ts";
export * from "./screen-helpers.ts";
export * from "./fixed-units.ts";
export * from "./layout.ts";
export { spinFavicon } from "./favicon.ts";
export { UI_CSS } from "./styles.ts";
