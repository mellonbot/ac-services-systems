/**
 * S5's LAYOUT — field density: 56px controls, no hover-dependent affordance,
 * generous touch targets. Roles and density variables only, same discipline
 * as every other surface's own CSS file; component styling lives in
 * packages/ui UI_CSS.
 */
export const S5_CSS = `
.s5-app{display:flex;flex-direction:column;gap:var(--space-4);padding:var(--space-3)}
.s5-nav{display:flex;align-items:center;gap:var(--space-4);padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s5-nav__who{margin-inline-start:auto;color:var(--color-text-muted);font-size:var(--text-sm)}
.s5-nav__logout{appearance:none;background:none;border:0;margin:0;padding:0;cursor:pointer;color:var(--color-action);font:inherit;min-height:var(--control-height)}
.s5-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-status-at-risk);border-radius:var(--radius-control)}
.s5-notice__dismiss{appearance:none;background:none;border:0;margin-inline-start:auto;cursor:pointer;color:var(--color-text-muted);padding:0 var(--space-2);min-height:var(--control-height)}
.s5-h1{margin:0 0 var(--space-3);font-size:var(--text-xl)}
.s5-h2{margin:var(--space-5) 0 var(--space-2);font-size:var(--text-lg)}
.s5-loading,.s5-empty,.s5-muted{color:var(--color-text-muted)}
.s5-login{max-width:44ch;margin:6vh auto 0}
.s5-form{display:flex;flex-direction:column;gap:var(--space-3)}
.s5-field{display:flex;flex-direction:column;gap:var(--space-1)}
.s5-field>span{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted)}
.s5-input{min-height:var(--control-height);padding:0 var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-none);background:var(--color-surface);color:var(--color-text);font:inherit}
.s5-job-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s5-job-row{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-card)}
.s5-job-row__service{flex:1;font-weight:600}
.s5-job-row__state{color:var(--color-text-muted)}
.s5-link{color:var(--color-action);text-decoration:none}
.s5-link--open{margin-inline-start:auto}
.s5-actions{display:flex;flex-wrap:wrap;gap:var(--space-3)}
.s5-checklist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s5-queued{color:var(--color-text-muted)}
.s5-attention{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border:1px solid var(--color-status-breached);border-radius:var(--radius-card)}
.s5-refusal{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--color-status-breached);border-radius:var(--radius-card)}
@media (max-width:600px){.s5-nav{flex-wrap:wrap}.s5-nav__who{order:2;width:100%;margin-inline-start:0}.s5-job-row{flex-wrap:wrap}}

/* ---- Rev A (Bulletin No. 2 Rev A): the reference layout's shape — radii and elevation from tokens, colours unchanged ---- */
.s5-nav{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px;margin:0 0 var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-card);background:color-mix(in srgb,var(--color-surface-sunken) 50%,var(--color-surface))}
.s5-nav__link{display:inline-flex;align-items:center;padding:var(--space-2) var(--space-4);border-radius:var(--radius-control);color:var(--color-text-muted);font-weight:600;text-decoration:none;box-shadow:none}
.s5-nav__link[data-current="true"]{background:var(--color-surface);color:var(--color-action-text);box-shadow:var(--elevation-raised)}
.s5-nav__who{padding:0 var(--space-2)}
.s5-nav__logout{padding:var(--space-2) var(--space-3);border-radius:var(--radius-control)}
.s5-input{border-radius:var(--radius-control)}
.s5-h1{font-family:var(--font-display);font-size:var(--text-display);font-weight:800;letter-spacing:var(--track-tight);text-transform:none;line-height:1.15}
.s5-h2{font-family:var(--font-display);font-weight:700;letter-spacing:var(--track-tight);text-transform:none}
.s5-job-row{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);padding:var(--space-3) var(--space-4);margin-bottom:var(--space-2)}
.s5-job-list{list-style:none;padding:0;margin:0}
.s5-form{border-radius:var(--radius-card)}
`;
