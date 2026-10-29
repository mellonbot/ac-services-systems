/**
 * S5's LAYOUT — field density: 56px controls, no hover-dependent affordance,
 * generous touch targets. Roles and density variables only, same discipline
 * as every other surface's own CSS file; the page head, stat strip and panels
 * are packages/ui UI_CSS, and this sheet only arranges what sits inside them.
 * Already aligned with Rankine mobile (generous touch, single-column cards).
 */
export const S5_CSS = `
.s5-app{display:flex;flex-direction:column;gap:var(--space-4);padding:var(--space-3)}
.s5-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-status-at-risk);border-radius:var(--radius-control)}
.s5-notice__dismiss{appearance:none;background:none;border:0;margin-inline-start:auto;cursor:pointer;color:var(--color-text-muted);padding:0 var(--space-2);min-height:var(--control-height)}
.s5-loading,.s5-empty,.s5-muted{color:var(--color-text-muted)}
.s5-login{max-width:var(--measure-narrow);margin:6vh auto 0}
.s5-job{display:flex;flex-direction:column;gap:var(--space-4)}
.s5-jobs{display:flex;flex-direction:column;gap:var(--space-4)}
.s5-cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-3)}
.s5-card{display:flex;flex-direction:column;gap:var(--space-2)}
.s5-card[data-current="true"]{border-top:3px solid var(--color-action-text)}
.s5-card p{margin:0}
.s5-card__when{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-3);font-size:var(--text-lg)}
.s5-nowrap{white-space:nowrap}
.s5-card__title{margin:0;font-family:var(--font-display);font-size:var(--text-xl);font-weight:700;letter-spacing:var(--track-tight)}
.s5-card__link{color:var(--color-text);text-decoration:underline;text-decoration-color:var(--color-border-hard);text-underline-offset:0.2em}
.s5-card__where,.s5-card__state{color:var(--color-text-muted)}
.s5-card__actions{display:flex;flex-wrap:wrap;gap:var(--space-3);margin-top:var(--space-2)}
.s5-link--action{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.s5-job__contact{margin:0}
.s5-wrap{display:flex;flex-direction:column;gap:var(--space-4)}
.s5-wrap p{margin:0}
.s5-outcome{display:flex}
.s5-outcome__opt{appearance:none;-webkit-appearance:none;border:0;background:none;font-family:inherit;cursor:pointer;flex:1;justify-content:center;min-height:var(--control-height)}
.s5-shots{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-3)}
@media (min-width:600px){.s5-shots{grid-template-columns:repeat(4,minmax(0,1fr))}}
.s5-shot{position:relative;aspect-ratio:1;border:1px solid var(--color-border-hard);border-radius:var(--radius-card);background:var(--color-surface-sunken);display:flex;align-items:center;justify-content:center;overflow:hidden}
.s5-shot img{width:100%;height:100%;object-fit:cover}
.s5-shot__remove{position:absolute;top:var(--space-1);inset-inline-end:var(--space-1);min-width:var(--control-height);min-height:var(--control-height);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-text);font:inherit;cursor:pointer}
.s5-shot--add{border-style:dashed;background:var(--color-surface)}
.s5-shot__take{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--color-action-text);font-weight:700;cursor:pointer}
.s5-shot__take:focus-within{outline:var(--focus-ring) var(--color-focus-ring);outline-offset:2px}
.s5-hidden-input{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}
.s5-notes{padding:var(--space-2);min-height:calc(var(--control-height) * 2);resize:vertical}
.s5-pad{display:block;width:100%;height:calc(var(--control-height) * 3);border:1px solid var(--color-border-hard);border-radius:var(--radius-card);background:var(--color-surface);color:var(--color-text);touch-action:none}
.s5-signed{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-3);margin-top:var(--space-2)}
.s5-absent{display:flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);margin-top:var(--space-2)}
.s5-absent input{width:24px;height:24px}
.s5-submit{display:flex}
.s5-clock{display:flex;flex-direction:column;align-items:flex-start;gap:var(--space-2)}
.s5-clock p,.s5-timesheet p{margin:0}
.s5-clock__label{font-family:var(--font-label);font-size:var(--text-xs);font-weight:600;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s5-clock__figure{font-size:var(--text-display);font-weight:600;line-height:1.1}
.s5-clock__note{color:var(--color-text-muted)}
.s5-timesheet{display:flex;flex-direction:column;gap:var(--space-4)}
.s5-days{list-style:none;margin:0;padding:0}
.s5-day{display:grid;grid-template-columns:5ch minmax(0,1fr) auto;align-items:baseline;gap:var(--space-3);min-height:var(--row-height);padding:var(--space-3) 0}
.s5-day+.s5-day{border-top:1px solid var(--color-border)}
.s5-day[data-today="true"]{border-top:3px solid var(--color-action-text)}
.s5-day__name{font-weight:700}
.s5-day__today{display:block;font-size:var(--text-xs);font-weight:600;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s5-day__spans{display:flex;flex-direction:column;gap:var(--space-1);color:var(--color-text-muted)}
.s5-day__total{font-weight:600;white-space:nowrap}
.s5-actions{display:flex;flex-wrap:wrap;gap:var(--space-3)}
.s5-checklist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.s5-check{display:flex;align-items:center;gap:var(--space-3);min-height:var(--row-height);padding:var(--space-2) 0}
.s5-check+.s5-check{border-top:1px solid var(--color-border)}
.s5-check__label{flex:1;min-width:0}
.s5-check__done{color:var(--color-status-ok);font-weight:600}
.s5-attention{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border:1px solid var(--color-status-breached);border-radius:var(--radius-card)}

/* ---- Mobile surfaces (Rankine prototype alignment) ---- */
@media (max-width: 640px) {
  .s5-app { padding-bottom: var(--space-4); }
  .s5-card__actions, .s5-actions { gap: var(--space-2); }
  .s5-outcome__opt { min-height: 48px; }
}
`;
