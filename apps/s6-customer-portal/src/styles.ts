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
.s6-nav{display:flex;align-items:center;gap:var(--space-4);padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s6-nav__who{margin-inline-start:auto;color:var(--color-text-muted);font-size:var(--text-sm)}
.s6-nav__logout{appearance:none;background:none;border:0;margin:0;padding:0;cursor:pointer;color:var(--color-action);font:inherit}
.s6-h1{margin:0 0 var(--space-2);font-size:var(--text-xl)}
.s6-h2{margin:var(--space-6) 0 var(--space-2);font-size:var(--text-lg)}
.s6-scope,.s6-crumbs{margin:0 0 var(--space-4);color:var(--color-text-muted)}
.s6-loading,.s6-empty,.s6-muted{color:var(--color-text-muted)}
.s6-link{color:var(--color-action);text-decoration:none}
.s6-link:hover{text-decoration:underline}
.s6-actions{display:flex;gap:var(--space-4);margin:var(--space-4) 0 0}
.s6-tree{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s6-tree .s6-tree{margin-inline-start:var(--space-6);margin-top:var(--space-2)}
.s6-node__row{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);background:var(--color-surface)}
.s6-node[data-scope="true"]>.s6-node__row{border-color:var(--color-border-hard)}
.s6-node__tier{font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s6-node__name{font-weight:600}
.s6-node__group{font-size:var(--text-sm);color:var(--color-text-muted);border:1px solid var(--color-border);padding:0 var(--space-2)}
.s6-node__facts{display:inline-flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm)}
.s6-node__actions{margin-inline-start:auto;display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s6-login{max-width:40ch;margin:10vh auto 0}
.s6-form{display:flex;flex-direction:column;gap:var(--space-3);max-width:64ch}
.s6-field{display:flex;flex-direction:column;gap:var(--space-1)}
.s6-field--inline{flex-direction:row;align-items:center;gap:var(--space-3);margin:0 0 var(--space-4)}
.s6-field>span{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted)}
.s6-input{min-height:var(--control-height);padding:0 var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-none);background:var(--color-surface);color:var(--color-text);font:inherit}
.s6-textarea{padding:var(--space-2);min-height:calc(var(--control-height) * 2.5);resize:vertical}
.s6-fieldset{border:1px solid var(--color-border);padding:var(--space-2) var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);margin:0}
.s6-fieldset legend{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted);padding:0 var(--space-1)}
.s6-radio{display:flex;gap:var(--space-2);align-items:baseline}
.s6-refusal{padding:var(--space-3);border:1px solid var(--color-status-breached);background:var(--color-surface);max-width:64ch}
.s6-refusal__heading{margin:0 0 var(--space-2);font-size:var(--text-md)}
.s6-refusal__message{margin:0 0 var(--space-2)}
.s6-refusal__routes{display:flex;gap:var(--space-3)}
.s6-sent{padding:var(--space-2) var(--space-3);border:1px solid var(--color-status-ok);background:var(--color-surface)}
.s6-terms__list{margin:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s6-term{display:grid;grid-template-columns:minmax(18ch,1fr) minmax(12ch,auto) 2fr;gap:var(--space-2) var(--space-4);align-items:baseline;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);background:var(--color-surface)}
.s6-term__key{color:var(--color-text-muted)}
.s6-term__value{margin:0;font-weight:600;font-family:var(--font-instrument)}
.s6-term__where{margin:0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s6-site{display:flex;flex-direction:column;gap:var(--space-4)}
.s6-site__head{display:flex;flex-direction:column;gap:var(--space-2);padding-bottom:var(--space-3);border-bottom:3px solid var(--color-border-hard)}
.s6-site__title{display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap}
.s6-site__title .s6-h1{margin:0}
.s6-site__acts{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap}
.s6-site__grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr) minmax(0,2fr);gap:var(--space-4)}
.s6-panel{border:1px solid var(--color-border);background:var(--color-surface);padding:var(--space-3)}
.s6-panel__h{margin:0 0 var(--space-3);font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted);border-bottom:1px solid var(--color-border);padding-bottom:var(--space-1)}
.s6-roof{margin:0 0 var(--space-3);border:1px solid var(--color-border);background:var(--color-surface-sunken)}
.s6-roof__img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover}
.s6-roof__credit{font-size:var(--text-xs);color:var(--color-text-muted);padding:var(--space-1) var(--space-2)}
.s6-roof--empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-2);aspect-ratio:16/9;padding:var(--space-3);text-align:center;color:var(--color-text-muted)}
.s6-roof__glyph{color:var(--color-text-muted)}
.s6-roof__coords{font-size:var(--text-sm)}
.s6-address{font-style:normal;display:flex;flex-direction:column;gap:var(--space-1)}
.s6-facts{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3) var(--space-4)}
.s6-facts>div{display:flex;flex-direction:column;gap:var(--space-1)}
.s6-facts dt{font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s6-facts dd{margin:0;font-weight:600}
.s6-facts dd.ac-num{font-size:var(--text-xl)}
.s6-contacts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-3)}
.s6-contact{display:flex;flex-direction:column;gap:var(--space-1);padding-inline-start:var(--space-3);border-inline-start:3px solid var(--color-border)}
.s6-contact[data-primary="true"]{border-inline-start-color:var(--color-border-hard)}
.s6-contact__role{font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s6-contact__name{font-weight:600}
.s6-contact__reach{display:flex;gap:var(--space-3);flex-wrap:wrap}
.s6-contact__note{font-size:var(--text-sm)}
.s6-units__count{margin:0 0 var(--space-2)}
.s6-ledger{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.s6-ledger__row{display:grid;grid-template-columns:minmax(14ch,auto) minmax(0,1fr) minmax(12ch,auto) minmax(9ch,auto);gap:var(--space-2) var(--space-4);align-items:baseline;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)}
.s6-ledger__row[data-kind="invoice"]{background:var(--color-surface-sunken);padding-inline:var(--space-2)}
.s6-ledger__when{color:var(--color-text-muted);font-size:var(--text-sm)}
.s6-ledger__what{display:flex;flex-direction:column;gap:var(--space-1)}
.s6-ledger__title{font-weight:600}
.s6-ledger__detail{font-size:var(--text-sm)}
.s6-ledger__amount{text-align:end;font-weight:600}
.s6-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:1100px){.s6-site__grid{grid-template-columns:1fr 1fr}.s6-panel--where{grid-column:1 / -1}}
@media (max-width:760px){.s6-site__grid{grid-template-columns:1fr}.s6-ledger__row{grid-template-columns:1fr}.s6-ledger__amount{text-align:start}.s6-nav{align-items:stretch;flex-wrap:wrap}.s6-nav__who{order:2;width:100%;margin-inline-start:0}.s6-node__actions{margin-inline-start:0;width:100%}.s6-term{grid-template-columns:1fr}}
`;
