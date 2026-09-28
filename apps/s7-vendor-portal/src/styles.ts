/**
 * S7's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. S7 is not white-label (a vendor
 * works under Rankine's plate, `stateRamp: true`): an order waiting on the
 * vendor and a held invoice are states, drawn with the state ramp.
 */
export const S7_CSS = `
.s7-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s7-nav{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s7-nav__link{color:var(--color-text-muted);text-decoration:none;font-weight:600}
.s7-nav__link[data-current="true"]{color:var(--color-text);box-shadow:inset 0 -2px 0 var(--color-action)}
.s7-nav__who{margin-inline-start:auto;color:var(--color-text-muted);font-size:var(--text-sm)}
.s7-nav__logout{appearance:none;background:none;border:0;margin:0;padding:0;cursor:pointer;color:var(--color-action-text);font:inherit}
.s7-h1{margin:0 0 var(--space-2);font-size:var(--text-xl);display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center}
.s7-h2{margin:var(--space-6) 0 var(--space-2);font-size:var(--text-lg)}
.s7-lede{margin:0 0 var(--space-3);color:var(--color-text-muted);max-width:70ch}
.s7-loading,.s7-empty,.s7-muted{color:var(--color-text-muted)}
.s7-link{color:var(--color-action-text);text-decoration:none}
.s7-link:hover{text-decoration:underline}
.s7-link--button{appearance:none;background:none;border:0;margin:0;padding:0;cursor:pointer;font:inherit}
.s7-scroll{overflow-x:auto}
.s7-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(20ch,1fr));gap:var(--space-3);margin:0 0 var(--space-4)}
.s7-facts div{padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);background:var(--color-surface)}
.s7-facts dt{font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s7-facts dd{margin:var(--space-1) 0 0;font-weight:600}
.s7-form{display:flex;flex-direction:column;gap:var(--space-3);max-width:72ch;padding:var(--space-3);border:1px solid var(--color-border);background:var(--color-surface)}
.s7-row{display:flex;gap:var(--space-3);flex-wrap:wrap}
.s7-row--end{align-items:end}
.s7-form--row{flex-direction:row;flex-wrap:wrap;align-items:end}
.s7-field{display:flex;flex-direction:column;gap:var(--space-1);min-width:14ch;flex:1}
.s7-field>span{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted)}
.s7-field small{color:var(--color-text-muted);font-size:var(--text-sm)}
.s7-input{min-height:var(--control-height);padding:0 var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-none);background:var(--color-page);color:var(--color-text);font:inherit}
.s7-num{font-family:var(--font-instrument);font-variant-numeric:tabular-nums;white-space:nowrap}
.s7-notes{margin:var(--space-1) 0 0;padding-inline-start:1.2em;color:var(--color-text-muted);font-size:var(--text-sm)}
.s7-sent{padding:var(--space-2) var(--space-3);border:1px solid var(--color-status-ok);background:var(--color-surface);max-width:72ch}
.s7-refusal{padding:var(--space-3);border:1px solid var(--color-status-breached);background:var(--color-surface);max-width:72ch}
.s7-refusal__heading{margin:0 0 var(--space-2);font-size:var(--text-md)}
.s7-refusal__message{margin:0 0 var(--space-2)}
.s7-login{max-width:40ch;margin:10vh auto 0}
.s7-login .s7-form{border:0;background:none;padding:0}
@media (max-width:760px){.s7-nav__who{order:2;width:100%;margin-inline-start:0}.s7-row{display:flex;gap:var(--space-3);flex-wrap:wrap}
.s7-row--end{align-items:end}
.s7-form--row{flex-direction:column;align-items:stretch}}
`;
