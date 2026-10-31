/**
 * S2's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. Component styling lives in
 * packages/ui UI_CSS; this is the arrangement of a console screen around it.
 * Mobile rules aligned with the Rankine prototype.
 */
export const S2_CSS = `
.s2-app{display:flex;flex-direction:column;gap:var(--space-3)}
/* The console names itself under the masthead, as S3's does — a styled line, not a second h1: each screen keeps its own. */
.s2-console-head{display:flex;flex-direction:column;gap:var(--space-1);margin-top:var(--space-2)}
.s2-console-head__title{margin:0;font-family:var(--font-display);font-size:var(--text-mast);font-weight:800;letter-spacing:var(--track-tight);line-height:1.1;color:var(--color-text);text-wrap:balance}
.s2-console-head__lede{margin:0;max-width:var(--measure-text);color:var(--color-text-muted);font-size:var(--text-md)}
@media (max-width:640px){.s2-console-head__title{font-size:var(--text-display)}}
.s2-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-border-hard);border-radius:var(--radius-control)}
.s2-notice p{margin:0}
.s2-notice__dismiss{appearance:none;background:none;border:0;margin-inline-start:auto;cursor:pointer;color:var(--color-text-muted);padding:0 var(--space-2);min-height:var(--control-height)}
.s2-two-col{display:grid;grid-template-columns:minmax(var(--column-side),1fr) minmax(0,3fr);gap:var(--space-6);align-items:start}
.s2-col--orgs{position:sticky;top:var(--space-3)}
.s2-two-col--wide-side{grid-template-columns:minmax(min-content,2fr) minmax(0,3fr)}
@media (max-width:1100px){.s2-two-col--wide-side{grid-template-columns:minmax(0,1fr)}.s2-two-col--wide-side .s2-col--orgs{position:static}}
.s2-node{display:flex;align-items:stretch;min-height:calc(var(--row-height) + var(--space-2));margin-block:calc(-1 * var(--space-2))}
.s2-node__guide{position:relative;flex:none;width:var(--space-6)}
.s2-node__guide::before,.s2-node__guide::after{content:"";position:absolute;inset-inline-start:var(--space-2)}
.s2-node__guide[data-guide="rail"]::before,.s2-node__guide[data-guide="tee"]::before{top:0;bottom:-1px;border-inline-start:1px solid var(--color-text-muted)}
.s2-node__guide[data-guide="elbow"]::before{top:0;height:50%;border-inline-start:1px solid var(--color-text-muted)}
.s2-node__guide[data-guide="tee"]::after,.s2-node__guide[data-guide="elbow"]::after{top:50%;inset-inline-end:var(--space-1);border-top:1px solid var(--color-text-muted)}
.s2-node__label{align-self:center;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:var(--space-3);padding-block:var(--space-1)}
.s2-node__count{color:var(--color-text-muted);font-size:var(--text-sm);white-space:nowrap}
.s2-node[data-tier="region"] .s2-node__name{font-family:var(--font-display);font-size:var(--text-lg);font-weight:700}
.s2-node[data-tier="location"] .s2-node__name{font-weight:600}
.s2-tier{color:var(--color-text-muted);font-family:var(--font-label);font-size:var(--text-sm);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase}
.s2-row-actions{display:inline-flex;align-items:center;gap:var(--space-3);white-space:nowrap}
.s2-doc-summary{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-3)}
.s2-link--action{display:inline-flex;align-items:center;text-decoration:none}
.s2-empty,.s2-loading{color:var(--color-text-muted)}
.s2-form-screen{max-width:var(--measure-text);display:flex;flex-direction:column;gap:var(--space-3)}
.s2-fieldset small{color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-fieldset{border:1px solid var(--color-border);border-radius:var(--radius-control);padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-3)}
.s2-form__actions{display:flex;align-items:center;gap:var(--space-4)}
.s2-address-row{display:grid;grid-template-columns:minmax(0,2fr) minmax(4rem,1fr) minmax(6rem,1fr);gap:var(--space-3)}
.s2-parent{margin:0;color:var(--color-text-muted)}
.s2-login{max-width:var(--measure-narrow);margin:10vh auto 0}
.s2-state{display:inline-block;padding:0 var(--space-2);border-radius:var(--radius-pill);border:1px solid var(--color-border);font-size:var(--text-sm)}
.s2-state[data-tone="live"]{border-color:var(--color-action-text);color:var(--color-text)}
.s2-state[data-tone="pending"]{border-style:dashed;color:var(--color-text-muted)}
.s2-state[data-tone="ended"]{color:var(--color-text-muted);text-decoration:line-through}
.s2-state[data-tone="held"]{border-style:dotted;color:var(--color-text-muted)}
.s2-state[data-tone="settled"]{color:var(--color-text)}
.s2-terms{display:grid;grid-template-columns:auto 1fr;gap:var(--space-2) var(--space-4);margin:0;align-items:baseline}
.s2-terms dt{color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-terms dd{margin:0}
.s2-firm{display:flex;flex-direction:column;gap:var(--space-3)}
.s2-muted{color:var(--color-text-muted)}
.s2-hovercard{position:fixed;z-index:20;pointer-events:none}
.s2-num{font-family:var(--font-instrument);font-variant-numeric:tabular-nums;white-space:nowrap}
/* 0038: a temporary password, shown once — the instrument face, large enough to read aloud over the phone. */
.s2-secret{display:block;width:fit-content;font-family:var(--font-instrument);font-variant-numeric:tabular-nums;font-size:var(--text-xl);font-weight:600;letter-spacing:var(--track-wide);padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);color:var(--color-text);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);user-select:all}
.s2-chips{display:flex;flex-wrap:wrap;gap:var(--space-1)}
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
.s2-field-error{color:var(--color-status-at-risk);font-size:var(--text-sm)}
.s2-refused{margin:var(--space-3) 0 0;padding-inline-start:var(--space-4);color:var(--color-status-at-risk)}
@media (max-width:760px){
  .s2-address-row{grid-template-columns:1fr}
  .s2-notice__dismiss{min-height:var(--space-12);display:inline-flex;align-items:center}
  .s2-two-col{grid-template-columns:minmax(0,1fr)}
  .s2-node{display:block;margin-block:0;min-height:0}
  .s2-node__guide{display:none}
  .s2-node__label{padding-block:0}
  .s2-node[data-depth="1"]{padding-inline-start:var(--space-3)}
  .s2-node[data-depth="2"]{padding-inline-start:var(--space-6)}
  .s2-col--orgs{position:static}
  .s2-form__actions{align-items:stretch;flex-direction:column}
  .s2-app .s2-trace-table{display:block;width:100%;max-width:100%;overflow-x:auto}
  .s2-app .s2-trace__step{grid-template-columns:minmax(0,1fr) max-content}
}
.s2-two-col>*{min-width:0}
.s2-trail ol{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-1) var(--space-2);list-style:none;margin:0;padding:0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-trail li{min-width:0}
.s2-trail li+li::before{content:"/";margin-inline-end:var(--space-2)}
.s2-trail li[aria-current="location"]{color:var(--color-text);font-weight:600}
.s2-mutation{appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:var(--control-height);padding:0 var(--space-3);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-action-text);font:inherit;font-weight:600;cursor:pointer}
.s2-mutation:hover:not(:disabled){background:var(--color-surface-sunken)}
.s2-mutation:focus-visible,.s2-help summary:focus-visible{outline:var(--focus-ring) var(--color-focus-ring);outline-offset:2px}
.s2-mutation:disabled{opacity:0.55;cursor:not-allowed}
.s2-mutation--danger{font-weight:600}
.s2-mutation--quiet{color:var(--color-text-muted)}
.s2-confirm{display:flex;flex-direction:column;gap:var(--space-1);min-width:min(var(--measure-narrow),100%);max-width:var(--measure-short);padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface)}
.s2-confirm p{margin:0;color:var(--color-text-muted)}
.s2-confirm__actions{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-1)}
.s2-help{color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-help summary{display:flex;align-items:center;min-height:var(--control-height);color:var(--color-action-text);cursor:pointer;font-weight:600}
.s2-help p{margin:var(--space-1) 0 0}
.s2-proposal{display:flex;flex-direction:column;gap:var(--space-2)}
.s2-col--tree{display:flex;flex-direction:column;gap:var(--space-4)}
.s2-col--tree>*{margin:0}

/* ---- Accounts: find a customer (search + Filter menu), then its detail ---- */
.s2-find{display:flex;gap:var(--space-2);align-items:stretch;margin:0 0 var(--space-3)}
.s2-find__q{flex:1 1 auto;min-width:0}
.s2-find__tally{display:flex;flex-wrap:wrap;align-items:center;gap:0 var(--space-3);margin:0 0 var(--space-2);color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-find__clear{appearance:none;display:inline-flex;align-items:center;min-height:var(--control-height);padding:0;border:0;background:none;color:var(--color-action-text);font:inherit;font-weight:600;cursor:pointer}
.s2-find__clear:hover{text-decoration:underline}
.s2-find__clear:focus-visible,.s2-filter__toggle:focus-visible{outline:var(--focus-ring) var(--color-focus-ring);outline-offset:2px}
.s2-filter{position:relative;flex:none}
.s2-filter__toggle{appearance:none;position:relative;display:inline-flex;align-items:center;gap:var(--space-2);height:100%;min-height:var(--control-height);padding:0 var(--space-8) 0 var(--space-3);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-text);font:inherit;font-weight:600;cursor:pointer;transition:background-color var(--motion-fast) var(--ease)}
.s2-filter__toggle::after{content:"";position:absolute;inset-inline-end:var(--space-3);top:50%;margin-top:-2px;border:4px solid transparent;border-top-color:currentColor;border-bottom:0;pointer-events:none}
.s2-filter__toggle:hover,.s2-filter__toggle[aria-expanded="true"]{background:var(--color-surface-sunken)}
.s2-filter__count{display:inline-flex;align-items:center;justify-content:center;min-width:calc(var(--space-4) + var(--space-1));padding:0 var(--space-1);border-radius:var(--radius-pill);background:var(--color-action);color:var(--color-action-ink);font-size:var(--text-xs);line-height:1.6}
.s2-filter__menu{position:absolute;z-index:15;top:calc(100% + var(--space-1));inset-inline-end:0;display:flex;flex-direction:column;gap:var(--space-3);width:var(--measure-narrow);max-width:calc(100vw - var(--space-8));padding:var(--space-3);background:var(--color-surface);border:1px solid var(--color-border-hard);border-radius:var(--radius-card);box-shadow:var(--elevation-raised)}
.s2-filter__menu:focus{outline:0}
.s2-filter__field{display:flex;flex-direction:column;gap:var(--space-1)}
.s2-filter__field>span,.s2-site-pick__label{color:var(--color-text-muted);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase}
.s2-filter__foot{display:flex;justify-content:space-between;gap:var(--space-2);padding-top:var(--space-2);border-top:1px solid var(--color-border)}
.s2-customer{display:flex;flex-direction:column;gap:2px;min-width:0}
.s2-found{color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-detail{display:flex;flex-direction:column;gap:var(--space-4)}
.s2-detail>*{margin:0}
.s2-overview{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:var(--space-4);align-items:start}
.s2-overview__site{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
.s2-site-pick{display:inline-flex;align-items:center;gap:var(--space-2)}
.s2-agreement{display:flex;flex-direction:column;gap:2px}
.s2-agreement__kind{font-weight:600}
.s2-map{margin:0;display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
.s2-map--empty{padding:var(--space-3);border:1px dashed var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface-sunken)}
.s2-map--empty p{margin:0}
.s2-map__view{position:relative;overflow:hidden;height:calc(var(--row-height) * 9);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface-sunken);cursor:grab;touch-action:none;user-select:none}
.s2-map__view:active{cursor:grabbing}
.s2-map__view:focus-visible{outline:var(--focus-ring) var(--color-focus-ring);outline-offset:2px}
.s2-map__tile{position:absolute;width:256px;height:256px;box-shadow:inset 0 0 0 0.5px var(--color-border)}
.s2-map__tile img{display:block;width:100%;height:100%;pointer-events:none}
.s2-map[data-basemap="tiles"] .s2-map__tile{box-shadow:none}
.s2-map__pin{position:absolute;transform:translate(-50%,-100%);pointer-events:none}
.s2-map__pin path{fill:var(--color-action);stroke:var(--color-text);stroke-width:1}
.s2-map__pin circle{fill:var(--color-action-ink)}
.s2-map__controls{position:absolute;top:var(--space-2);right:var(--space-2);display:flex;gap:var(--space-1)}
.s2-map__btn{min-width:var(--control-height);min-height:var(--control-height);padding:0 var(--space-2);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-text);font:inherit;font-family:var(--font-display);font-size:var(--text-sm);font-weight:600;cursor:pointer;box-shadow:var(--elevation-card)}
.s2-map__btn:hover:not(:disabled){background:var(--color-surface-sunken)}
.s2-map__btn:disabled{color:var(--color-text-muted);cursor:not-allowed}
.s2-map__btn:focus-visible{outline:var(--focus-ring) var(--color-focus-ring);outline-offset:2px}
.s2-map__caption{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-3);font-size:var(--text-sm);color:var(--color-text-muted)}
.s2-history__note{display:inline-block;max-width:var(--measure-cell);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
@media (max-width:1280px){.s2-overview{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){.s2-filter__toggle{transition:none}}

/* ---- Mobile surfaces (Rankine prototype alignment) ---- */
@media (max-width: 640px) {
  .s2-app { gap: var(--space-2); padding-bottom: var(--space-4); }
  .s2-two-col, .s2-two-col--wide-side, .s2-overview { grid-template-columns: 1fr; }
  .s2-find { flex-wrap: wrap; }
  .s2-filter__menu { inset-inline-end: auto; inset-inline-start: 0; }
  .s2-mutation { min-height: 44px; }
  .s2-address-row { grid-template-columns: 1fr; }
  .s2-confirm { max-width: 100%; }
  .s2-form__actions { flex-direction: column; align-items: stretch; }
}
`;
