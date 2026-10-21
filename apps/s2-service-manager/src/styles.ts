/**
 * S2's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. Component styling lives in
 * packages/ui UI_CSS; this is the arrangement of a console screen around it.
 */
export const S2_CSS = `
.s2-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s2-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-status-at-risk);border-radius:var(--radius-control)}
.s2-notice p{margin:0}
.s2-notice__dismiss{appearance:none;background:none;border:0;margin-inline-start:auto;cursor:pointer;color:var(--color-text-muted);padding:0 var(--space-2)}
.s2-two-col{display:grid;grid-template-columns:minmax(var(--column-side),1fr) minmax(0,3fr);gap:var(--space-6);align-items:start}
.s2-col--orgs{position:sticky;top:var(--space-3)}
.s2-node{display:inline-block;padding-inline-start:calc(var(--depth,0) * var(--space-6))}
.s2-node[data-depth="1"]{--depth:1}
.s2-node[data-depth="2"]{--depth:2}
.s2-node[data-tier="region"]{font-weight:600}
.s2-node[data-tier="site"]{color:var(--color-text-muted)}
.s2-row-actions{display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s2-doc-summary{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-3)}
.s2-link--action{display:inline-flex;align-items:center;text-decoration:none}
.s2-empty,.s2-loading{color:var(--color-text-muted)}
.s2-form-screen{max-width:var(--measure-text);display:flex;flex-direction:column;gap:var(--space-3)}
.s2-fieldset small{color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-fieldset{border:1px solid var(--color-border);border-radius:var(--radius-control);padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-3)}
.s2-form__actions{display:flex;align-items:center;gap:var(--space-4)}
.s2-parent{margin:0;color:var(--color-text-muted)}
.s2-login{max-width:var(--measure-narrow);margin:10vh auto 0}

/* C2 — agreements, the register-driven override form, and the resolution trace. */
.s2-state{display:inline-block;padding:0 var(--space-2);border-radius:var(--radius-pill);border:1px solid var(--color-border);font-size:var(--text-sm)}
.s2-state[data-tone="live"]{border-color:var(--color-action-text);color:var(--color-text)}
.s2-state[data-tone="pending"]{border-style:dashed;color:var(--color-text-muted)}
.s2-state[data-tone="ended"]{color:var(--color-text-muted);text-decoration:line-through}
/* C4 — a suspended firm: held, not ended. Dotted rather than dashed so the
   three filing states are distinguishable without hue, like the state marks
   above; the colour roles stay the neutral ones, because filing state is not
   operational health and must not borrow the status ramp. */
.s2-state[data-tone="held"]{border-style:dotted;color:var(--color-text-muted)}
.s2-terms{display:grid;grid-template-columns:auto 1fr;gap:var(--space-2) var(--space-4);margin:0;align-items:baseline}
.s2-terms dt{color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-terms dd{margin:0}
.s2-firm{display:flex;flex-direction:column;gap:var(--space-3)}
.s2-muted{color:var(--color-text-muted)}
.s2-oq5{display:flex;flex-direction:column;gap:var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-control);padding:var(--space-3)}
.s2-oq5 legend{padding-inline:var(--space-2);font-weight:600}
.s2-oq5__unset{color:var(--color-status-at-risk)}
.s2-radio{display:flex;align-items:center;gap:var(--space-2);min-height:var(--control-height)}
.s2-policy{margin:0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-policy[data-combine="ratchet"]{color:var(--color-text)}
.s2-rationale{margin:0 0 var(--space-2);color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-purchasing{display:flex;flex-direction:column;gap:var(--space-3)}
.s2-list{margin:0;padding-inline-start:var(--space-4)}
.s2-trace{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s2-trace__step{display:grid;grid-template-columns:minmax(var(--label-min),1fr) max-content minmax(var(--label-min),1fr);gap:var(--space-1) var(--space-3);align-items:baseline;padding-block:var(--space-1);border-bottom:1px solid var(--color-border)}
.s2-trace__outcome{font-variant-caps:all-small-caps;letter-spacing:var(--track-normal)}
.s2-trace__step[data-outcome="won"] .s2-trace__outcome{color:var(--color-action-text)}
.s2-trace__step[data-outcome="not_walked"]{color:var(--color-text-muted)}
.s2-trace__tier{font-weight:600}
.s2-trace__value{font-family:var(--font-instrument);font-variant-numeric:tabular-nums}
.s2-trace__note{grid-column:1/-1;color:var(--color-text-muted)}
.s2-trace-table{width:100%;border-collapse:collapse}
.s2-refused{margin:var(--space-3) 0 0;padding-inline-start:var(--space-4);color:var(--color-status-at-risk)}
@media (max-width:760px){
  .s2-nav__group{flex:1 1 14rem}
  .s2-nav__group-links{flex-wrap:wrap}
  .s2-notice__dismiss{min-height:var(--space-12);display:inline-flex;align-items:center}
  .s2-two-col{grid-template-columns:minmax(0,1fr)}
  .s2-col--orgs{position:static}
  .s2-form__actions{align-items:stretch;flex-direction:column}
  .s2-context{grid-template-columns:minmax(0,1fr)}
  .s2-app .s2-trace-table{display:block;width:100%;max-width:100%;overflow-x:auto}
  .s2-app .s2-trace__step{grid-template-columns:minmax(0,1fr) max-content}
}

/* Rev A: heads, panels and tiles are drawn by packages/ui (pageHead, panel, statStrip); this only arranges. */
.s2-two-col>*{min-width:0}

/* Persistent location: the operator's resolved scope stays separate from the
   customer, firm, or order currently open in the workspace. */
.s2-nav__group{display:flex;flex-direction:column;gap:var(--space-1);padding-inline:var(--space-2);min-width:0}
.s2-nav__group-label,.s2-context__label{color:var(--color-text-muted);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase}
.s2-nav__group-links{display:flex;align-items:center;gap:var(--space-1)}
.s2-context{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-3) var(--space-6);padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface)}
.s2-context__scope,.s2-context__current{display:flex;flex-direction:column;gap:var(--space-1);min-width:0}
.s2-context ol{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2);list-style:none;margin:0;padding:0;min-width:0}
.s2-context li{display:inline-flex;align-items:baseline;gap:var(--space-1);min-width:0}
.s2-context li+li::before{content:"/";color:var(--color-text-muted);margin-inline-end:var(--space-1)}
.s2-context li[aria-current="location"]{font-weight:700}
.s2-context li small{color:var(--color-text-muted);font-size:var(--text-xs)}
.s2-mutation{appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:var(--control-height);padding:0 var(--space-3);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-action-text);font:inherit;font-weight:600;cursor:pointer}
.s2-mutation:hover:not(:disabled){background:var(--color-surface-sunken)}
.s2-mutation:focus-visible,.s2-help summary:focus-visible{outline:var(--focus-ring) var(--color-focus-ring);outline-offset:2px}
.s2-mutation:disabled{opacity:0.55;cursor:not-allowed}
.s2-mutation--danger{border-color:var(--color-status-breached);color:var(--color-status-breached)}
.s2-mutation--quiet{color:var(--color-text-muted)}
.s2-confirm{display:flex;flex-direction:column;gap:var(--space-1);min-width:min(var(--measure-narrow),100%);max-width:var(--measure-short);padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface)}
.s2-confirm p{margin:0;color:var(--color-text-muted)}
.s2-confirm__actions{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-1)}
.s2-help{color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-help summary{color:var(--color-action-text);cursor:pointer;font-weight:600}
.s2-help p{margin:var(--space-1) 0 0}
.s2-proposal{display:flex;flex-direction:column;gap:var(--space-2)}
`;
