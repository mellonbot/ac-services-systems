/**
 * S4's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. S4 renders the state ramp (an
 * at-risk count, a region below its density rule), so the brand roles
 * resolve to Ink Black here and nothing on the page is red but a fault.
 * Heads, panels and figure tiles are the shared chrome (pageHead, panel,
 * statStrip); this sheet arranges them and draws only what is S4's own.
 * Mobile rules aligned with the Rankine prototype.
 */
export const S4_CSS = `
.s4-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s4-asof{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;color:var(--color-text-muted);font-size:var(--text-sm)}
.s4-loading,.s4-empty,.s4-muted{color:var(--color-text-muted)}
.s4-areas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4);margin:0 0 var(--space-4)}
@media (min-width:1360px){.s4-areas{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:640px){.s4-areas{grid-template-columns:1fr}}
.s4-sub{font-size:var(--text-sm);color:var(--color-text-muted)}
.s4-num{font-family:var(--font-instrument);font-variant-numeric:tabular-nums;white-space:nowrap}
.s4-total td{font-weight:600;border-top:2px solid var(--color-border-hard)}
.s4-scroll{overflow-x:auto}
.s4-means{margin:0;padding:0;list-style:none;display:grid;gap:var(--space-2);font-size:var(--text-sm)}
.s4-means b{font-weight:600}
.s4-metrics{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.s4-metric{appearance:none;border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-text);min-height:var(--control-height);padding:0 var(--space-3);cursor:pointer;font:inherit;transition:border-color var(--motion-fast) var(--ease),color var(--motion-fast) var(--ease),box-shadow var(--motion-fast) var(--ease)}
.s4-metric[aria-pressed="true"]{border-color:var(--color-action-text);color:var(--color-action-text);box-shadow:var(--elevation-raised)}
@media (prefers-reduced-motion:reduce){.s4-metric{transition:none}}
.s4-trends{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--tile-wide)),1fr));gap:var(--space-3)}
.s4-trend{margin:0;border:1px solid var(--color-border);border-radius:var(--radius-card);background:var(--color-surface);padding:var(--space-2) var(--space-3)}
.s4-trend h3{margin:0;font-size:var(--text-sm);display:flex;justify-content:space-between;gap:var(--space-2)}
.s4-trend svg{display:block;width:100%;height:56px}
.s4-trend__line{fill:none;stroke:var(--color-action-text);stroke-width:2}
.s4-trend__area{fill:var(--color-surface-sunken);stroke:none}
.s4-trend__end{fill:var(--color-action-text)}
.s4-trend__grid{stroke:var(--color-border);stroke-width:1}
.s4-readonly{font-size:var(--text-sm);color:var(--color-text-muted);border-top:1px solid var(--color-border);padding-top:var(--space-2)}
.s4-login{max-width:var(--measure-narrow);margin:10vh auto 0}

/* ---- Mobile surfaces (Rankine prototype alignment) ---- */
@media (max-width: 640px) {
  .s4-app { gap: var(--space-2); padding-bottom: var(--space-4); }
  .s4-areas, .s4-trends { grid-template-columns: 1fr; }
  .s4-metric { min-height: 44px; }
}
`;
