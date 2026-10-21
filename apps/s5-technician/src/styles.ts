/**
 * S5's LAYOUT — field density: 56px controls, no hover-dependent affordance,
 * generous touch targets. Roles and density variables only, same discipline
 * as every other surface's own CSS file; the page head, stat strip and panels
 * are packages/ui UI_CSS, and this sheet only arranges what sits inside them.
 */
export const S5_CSS = `
.s5-app{display:flex;flex-direction:column;gap:var(--space-4);padding:var(--space-3)}
.s5-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-status-at-risk);border-radius:var(--radius-control)}
.s5-notice__dismiss{appearance:none;background:none;border:0;margin-inline-start:auto;cursor:pointer;color:var(--color-text-muted);padding:0 var(--space-2);min-height:var(--control-height)}
.s5-loading,.s5-empty,.s5-muted{color:var(--color-text-muted)}
.s5-login{max-width:44ch;margin:6vh auto 0}
.s5-job{display:flex;flex-direction:column;gap:var(--space-4)}
.s5-job-list{list-style:none;margin:0;padding:0}
.s5-job-row{display:flex;align-items:center;gap:var(--space-3);min-height:var(--row-height);padding:var(--space-2) 0}
.s5-job-row+.s5-job-row{border-top:1px solid var(--color-border)}
.s5-job-row__service{flex:1;font-weight:600}
.s5-job-row__state{color:var(--color-text-muted)}
.s5-link--open{margin-inline-start:auto}
.s5-actions{display:flex;flex-wrap:wrap;gap:var(--space-3)}
.s5-checklist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s5-attention{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border:1px solid var(--color-status-breached);border-radius:var(--radius-card)}
@media (max-width:600px){.s5-job-row{flex-wrap:wrap}}
`;
