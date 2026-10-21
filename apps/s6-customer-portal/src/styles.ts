/**
 * S6's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui — which is exactly what makes this
 * surface white-label: a tenant's block re-points the accent roles under
 * `<style id="ac-brand">`, and nothing in this file names a colour it could
 * disagree with. Component styling is UI_CSS; this is the arrangement of a
 * customer's sites, work, agreements and the one form around them.
 */
export const S6_CSS = `
.s6-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s6-app>section,.s6-app>article{display:flex;flex-direction:column;gap:var(--space-4)}
.s6-crumbs{margin:0;color:var(--color-text-muted)}
.s6-site__where{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.s6-loading,.s6-empty,.s6-muted{color:var(--color-text-muted)}
.s6-actions{display:flex;gap:var(--space-4);margin:0}
.s6-tree{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s6-tree .s6-tree{margin-inline-start:var(--space-6);margin-top:var(--space-2)}
.s6-node__row{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;min-height:var(--row-height);padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface)}
.s6-node[data-scope="true"]>.s6-node__row{border-color:var(--color-border-hard)}
.s6-node__tier{font-family:var(--font-label);font-size:var(--text-xs);font-weight:600;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s6-node__name{font-weight:600}
.s6-node__group{font-size:var(--text-sm);color:var(--color-text-muted);border:1px solid var(--color-border);border-radius:var(--radius-pill);padding:0 var(--space-2)}
.s6-node__facts{display:inline-flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm)}
.s6-node__actions{margin-inline-start:auto;display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s6-login{max-width:var(--measure-narrow);margin:10vh auto 0}
.s6-field--inline{flex-direction:row;align-items:center;gap:var(--space-3)}
.s6-fieldset{border:1px solid var(--color-border);border-radius:var(--radius-control);padding:var(--space-2) var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);margin:0}
.s6-fieldset legend{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted);padding:0 var(--space-1)}
.s6-radio{display:flex;gap:var(--space-2);align-items:baseline}
.s6-terms__list{margin:0;display:flex;flex-direction:column}
.s6-term{display:grid;grid-template-columns:minmax(18ch,1fr) minmax(12ch,auto) 2fr;gap:var(--space-2) var(--space-4);align-items:baseline;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)}
.s6-term:last-child{border-bottom:0}
.s6-term__key{color:var(--color-text-muted)}
.s6-term__value{margin:0;font-weight:600;font-family:var(--font-instrument);font-variant-numeric:tabular-nums}
.s6-term__where{margin:0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s6-site__grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:var(--space-4)}
.s6-roof{margin:0 0 var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-control);overflow:hidden;background:var(--color-surface-sunken)}
.s6-roof__img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover}
.s6-roof__credit{font-size:var(--text-xs);color:var(--color-text-muted);padding:var(--space-1) var(--space-2)}
.s6-roof--empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-2);aspect-ratio:16/9;padding:var(--space-3);text-align:center;color:var(--color-text-muted)}
.s6-roof__glyph{color:var(--color-text-muted)}
.s6-roof__coords{font-size:var(--text-sm)}
.s6-address{font-style:normal;display:flex;flex-direction:column;gap:var(--space-1)}
.s6-contacts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-3)}
.s6-contact{display:flex;flex-direction:column;gap:var(--space-1);padding:var(--space-2) 0 0;border-top:1px solid var(--color-border)}
.s6-contact[data-primary="true"]{border-top:3px solid var(--color-border-hard)}
.s6-contact__role{font-family:var(--font-label);font-size:var(--text-xs);font-weight:600;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s6-contact__name{font-weight:600}
.s6-contact__reach{display:flex;gap:var(--space-3);flex-wrap:wrap}
.s6-contact__note{font-size:var(--text-sm)}
.s6-units__count{margin:0 0 var(--space-2)}
.s6-ledger{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.s6-ledger__row{display:grid;grid-template-columns:minmax(14ch,auto) minmax(0,1fr) minmax(12ch,auto) minmax(9ch,auto);gap:var(--space-2) var(--space-4);align-items:baseline;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)}
.s6-ledger__row[data-kind="invoice"]{background:var(--color-surface-sunken);padding-inline:var(--space-2);border-radius:var(--radius-control)}
.s6-ledger__when{color:var(--color-text-muted);font-size:var(--text-sm)}
.s6-ledger__what{display:flex;flex-direction:column;gap:var(--space-1)}
.s6-ledger__title{font-weight:600}
.s6-ledger__detail{font-size:var(--text-sm)}
.s6-ledger__amount{text-align:end;font-weight:600}
.s6-orders{display:flex;flex-direction:column;gap:var(--space-3)}
.s6-order{border:1px solid var(--color-border);border-radius:var(--radius-card);padding:var(--space-4)}
.s6-order__head{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3);flex-wrap:wrap}
.s6-order__title{margin:0;font-family:var(--font-display);font-size:var(--text-md);font-weight:700}
.s6-order__meta{margin:var(--space-1) 0 0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s6-steps{list-style:none;margin:var(--space-4) 0 var(--space-3);padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}
.s6-step{display:flex;flex-direction:column;align-items:center;gap:var(--space-1);position:relative;text-align:center}
.s6-step::before{content:"";position:absolute;top:calc(var(--space-4) / 2 - 1px);left:-50%;width:100%;height:2px;background:var(--color-border)}
.s6-step:first-child::before{display:none}
.s6-step[data-state="done"]::before,.s6-step[data-state="current"]::before{background:var(--color-status-ok)}
.s6-step__dot{width:var(--space-4);height:var(--space-4);border-radius:var(--radius-pill);border:2px solid var(--color-border-hard);background:var(--color-surface);position:relative;z-index:1}
.s6-step[data-state="done"] .s6-step__dot{background:var(--color-status-ok);border-color:var(--color-status-ok)}
.s6-step[data-state="current"] .s6-step__dot{background:var(--color-action-text);border-color:var(--color-action-text)}
.s6-step__label{font-size:var(--text-xs);color:var(--color-text-muted)}
.s6-step[data-state="current"] .s6-step__label{color:var(--color-action-text);font-weight:700}
.s6-order__note{margin:0;padding:var(--space-2) var(--space-3);border-radius:var(--radius-control);background:color-mix(in srgb,var(--color-surface-sunken) 45%,var(--color-surface));font-size:var(--text-sm)}
@media (max-width:1100px){.s6-site__grid{grid-template-columns:1fr}}
@media (max-width:760px){.s6-ledger__row{grid-template-columns:1fr}.s6-ledger__amount{text-align:start}.s6-node__actions{margin-inline-start:0;width:100%}.s6-term{grid-template-columns:1fr}}
`;
