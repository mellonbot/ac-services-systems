/**
 * S4's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. S4 renders the state ramp (an
 * at-risk count, a region below its density rule), so the brand roles
 * resolve to Ink Black here and nothing on the page is red but a fault.
 */
export const S4_CSS = `
.s4-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s4-nav{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s4-nav__link{color:var(--color-text-muted);text-decoration:none;font-weight:600}
.s4-nav__link[data-current="true"]{color:var(--color-text);box-shadow:inset 0 -2px 0 var(--color-action)}
.s4-nav__who{margin-inline-start:auto;color:var(--color-text-muted);font-size:var(--text-sm)}
.s4-nav__logout{appearance:none;background:none;border:0;margin:0;padding:0;cursor:pointer;color:var(--color-action-text);font:inherit}
.s4-h1{margin:0;font-size:var(--text-xl)}
.s4-h2{margin:0 0 var(--space-2);font-size:var(--text-lg)}
.s4-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-3);justify-content:space-between}
.s4-asof{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;color:var(--color-text-muted);font-size:var(--text-sm)}
.s4-loading,.s4-empty,.s4-muted{color:var(--color-text-muted)}
.s4-link{color:var(--color-action-text);text-decoration:none}
.s4-link:hover{text-decoration:underline}
.s4-areas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4)}
@media (min-width:1360px){.s4-areas{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:640px){.s4-areas{grid-template-columns:1fr}}
.s4-area{border:1px solid var(--color-border);background:var(--color-surface);padding:var(--space-3) var(--space-4);display:flex;flex-direction:column;gap:var(--space-3)}
.s4-area__head{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-2)}
.s4-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-3);margin:0}
.s4-tile{display:flex;flex-direction:column;gap:var(--space-1);min-width:0}
.s4-tile dt{font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s4-tile dd{margin:0;display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:baseline}
.s4-figure{font-family:var(--font-instrument);font-size:var(--text-xl);line-height:1.1;font-variant-numeric:tabular-nums}
.s4-sub{font-size:var(--text-sm);color:var(--color-text-muted)}
.s4-num{font-family:var(--font-instrument);font-variant-numeric:tabular-nums;white-space:nowrap}
.s4-total td{font-weight:600;border-top:2px solid var(--color-border-hard)}
.s4-scroll{overflow-x:auto}
.s4-means{margin:0;padding:0;list-style:none;display:grid;gap:var(--space-2);font-size:var(--text-sm)}
.s4-means b{font-weight:600}
.s4-metrics{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.s4-metric{appearance:none;border:1px solid var(--color-border-hard);background:var(--color-surface);color:var(--color-text);min-height:var(--control-height);padding:0 var(--space-3);cursor:pointer;font:inherit}
.s4-metric[aria-pressed="true"]{border-color:var(--color-action-text);box-shadow:inset 0 -3px 0 var(--color-action)}
.s4-trends{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,28ch),1fr));gap:var(--space-3)}
.s4-trend{margin:0;border:1px solid var(--color-border);background:var(--color-surface);padding:var(--space-2) var(--space-3)}
.s4-area-screen>.s4-h2{margin-top:var(--space-6)}
.s4-trend h3{margin:0;font-size:var(--text-sm);display:flex;justify-content:space-between;gap:var(--space-2)}
.s4-trend svg{display:block;width:100%;height:56px}
.s4-trend__line{fill:none;stroke:var(--color-action-text);stroke-width:2}
.s4-trend__area{fill:var(--color-surface-sunken);stroke:none}
.s4-trend__end{fill:var(--color-action-text)}
.s4-trend__grid{stroke:var(--color-border);stroke-width:1}
.s4-readonly{font-size:var(--text-sm);color:var(--color-text-muted);border-top:1px solid var(--color-border);padding-top:var(--space-2)}
.s4-login{max-width:40ch;margin:10vh auto 0}
.s4-form{display:flex;flex-direction:column;gap:var(--space-3)}
.s4-field{display:flex;flex-direction:column;gap:var(--space-1)}
.s4-field>span{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted)}
.s4-input{min-height:var(--control-height);padding:0 var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-none);background:var(--color-surface);color:var(--color-text);font:inherit}
.s4-refusal{padding:var(--space-3);border:1px solid var(--color-status-breached);background:var(--color-surface);max-width:64ch}
.s4-refusal__heading{margin:0 0 var(--space-2);font-size:var(--text-md)}
.s4-refusal__message{margin:0 0 var(--space-2)}
@media (max-width:760px){.s4-nav__who{order:2;width:100%;margin-inline-start:0}.s4-tiles{grid-template-columns:1fr}}

/* ---- Rev A (Bulletin No. 2 Rev A): the reference layout's shape — radii and elevation from tokens, colours unchanged ---- */
.s4-nav{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px;margin:0 0 var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-card);background:color-mix(in srgb,var(--color-surface-sunken) 50%,var(--color-surface))}
.s4-nav__link{display:inline-flex;align-items:center;padding:var(--space-2) var(--space-4);border-radius:var(--radius-control);color:var(--color-text-muted);font-weight:600;text-decoration:none;box-shadow:none}
.s4-nav__link[data-current="true"]{background:var(--color-surface);color:var(--color-action-text);box-shadow:var(--elevation-raised)}
.s4-nav__who{padding:0 var(--space-2)}
.s4-nav__logout{padding:var(--space-2) var(--space-3);border-radius:var(--radius-control)}
.s4-input{border-radius:var(--radius-control)}
.s4-area,.s4-metric,.s4-refusal,.s4-trend{border-radius:var(--radius-card);box-shadow:var(--elevation-card)}
.s4-h1{font-family:var(--font-display);font-size:var(--text-display);font-weight:800;letter-spacing:var(--track-tight);text-transform:none;line-height:1.15}
.s4-h2{font-family:var(--font-display);font-weight:700;letter-spacing:var(--track-tight);text-transform:none}
`;
