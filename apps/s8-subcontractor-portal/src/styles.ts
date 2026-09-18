/**
 * S8's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. S8 is not white-label (the firm
 * works under Rankine's plate, `stateRamp: true`), so nothing here is a
 * tenant's to re-point; it is the arrangement of a firm's row, its roster,
 * a crew's documents, its work and its statements around the two forms.
 */
export const S8_CSS = `
.s8-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s8-nav{display:flex;align-items:center;gap:var(--space-4);padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s8-nav__who{margin-inline-start:auto;color:var(--color-text-muted);font-size:var(--text-sm)}
.s8-nav__logout{appearance:none;background:none;border:0;margin:0;padding:0;cursor:pointer;color:var(--color-action);font:inherit}
.s8-h1{margin:0 0 var(--space-2);font-size:var(--text-xl)}
.s8-h2{margin:var(--space-6) 0 var(--space-2);font-size:var(--text-lg)}
.s8-scope,.s8-crumbs{margin:0 0 var(--space-4);color:var(--color-text-muted);display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
.s8-loading,.s8-empty,.s8-muted{color:var(--color-text-muted)}
.s8-link{color:var(--color-action);text-decoration:none}
.s8-link:hover{text-decoration:underline}
.s8-link--button{appearance:none;background:none;border:0;margin:0;padding:0;cursor:pointer;font:inherit}
.s8-link--button:disabled{color:var(--color-text-muted);cursor:default;text-decoration:none}
.s8-row__actions{display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s8-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(20ch,1fr));gap:var(--space-3);margin:0 0 var(--space-4)}
.s8-facts div{padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);background:var(--color-surface)}
.s8-facts dt{font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s8-facts dd{margin:var(--space-1) 0 0;font-weight:600}
.s8-summary{margin:0 0 var(--space-2);display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:baseline}
.s8-summary strong{font-family:var(--font-instrument);font-size:var(--text-lg)}
.s8-total{font-family:var(--font-instrument);font-size:var(--text-lg)}
.s8-login{max-width:40ch;margin:10vh auto 0}
.s8-form{display:flex;flex-direction:column;gap:var(--space-3);max-width:64ch}
.s8-field{display:flex;flex-direction:column;gap:var(--space-1);flex:1}
.s8-field--pair{display:flex;gap:var(--space-3)}
.s8-field>span{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted)}
.s8-input{min-height:var(--control-height);padding:0 var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-none);background:var(--color-surface);color:var(--color-text);font:inherit}
.s8-textarea{padding:var(--space-2);min-height:calc(var(--control-height) * 2.5);resize:vertical}
.s8-refusal{padding:var(--space-3);border:1px solid var(--color-status-breached);background:var(--color-surface);max-width:64ch}
.s8-refusal__heading{margin:0 0 var(--space-2);font-size:var(--text-md)}
.s8-refusal__message{margin:0 0 var(--space-2)}
.s8-refusal__routes{display:flex;gap:var(--space-3)}
.s8-sent{padding:var(--space-2) var(--space-3);border:1px solid var(--color-status-ok);background:var(--color-surface);max-width:64ch}
.s8-position{display:grid;grid-template-columns:repeat(auto-fit,minmax(28ch,1fr));gap:var(--space-6);margin-top:var(--space-4)}
@media (max-width:760px){.s8-nav{align-items:stretch;flex-wrap:wrap}.s8-nav__who{order:2;width:100%;margin-inline-start:0}.s8-field--pair{flex-direction:column}}
`;
