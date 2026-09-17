/**
 * S2's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. Component styling lives in
 * packages/ui UI_CSS; this is the arrangement of a console screen around it.
 */
export const S2_CSS = `
.s2-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s2-nav{display:flex;align-items:center;gap:var(--space-4);padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s2-nav__link{color:var(--color-text-muted);text-decoration:none;font-weight:600}
.s2-nav__link[data-current="true"]{color:var(--color-text);box-shadow:inset 0 -2px 0 var(--color-action)}
.s2-nav__who{margin-inline-start:auto;color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-nav__logout{appearance:none;background:none;border:0;margin:0;padding:0;cursor:pointer;color:var(--color-action);font:inherit}
.s2-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-status-at-risk);border-radius:var(--radius-none)}
.s2-notice p{margin:0}
.s2-notice__dismiss{appearance:none;background:none;border:0;margin-inline-start:auto;cursor:pointer;color:var(--color-text-muted);padding:0 var(--space-2)}
.s2-two-col{display:grid;grid-template-columns:minmax(260px,1fr) minmax(0,3fr);gap:var(--space-6);align-items:start}
.s2-col--orgs{position:sticky;top:var(--space-3)}
.s2-h1{margin:0 0 var(--space-4);font-size:var(--text-xl)}
.s2-h2{margin:0;font-size:var(--text-lg)}
.s2-tree__head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-2)}
.s2-node{display:inline-block;padding-inline-start:calc(var(--depth,0) * var(--space-6))}
.s2-node[data-depth="1"]{--depth:1}
.s2-node[data-depth="2"]{--depth:2}
.s2-node[data-tier="region"]{font-weight:600}
.s2-node[data-tier="site"]{color:var(--color-text-muted)}
.s2-row-actions{display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s2-link{color:var(--color-action);text-decoration:none}
.s2-link:hover{text-decoration:underline}
.s2-link--action{display:inline-flex;align-items:center;text-decoration:none}
.s2-aside-actions{margin:var(--space-3) 0 0}
.s2-empty,.s2-loading{color:var(--color-text-muted)}
.s2-form-screen{max-width:64ch;display:flex;flex-direction:column;gap:var(--space-3)}
.s2-form{display:flex;flex-direction:column;gap:var(--space-3)}
.s2-field{display:flex;flex-direction:column;gap:var(--space-1)}
.s2-field>span{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted)}
.s2-field small,.s2-fieldset small{color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-input{min-height:var(--control-height);padding:0 var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-none);background:var(--color-surface);color:var(--color-text);font:inherit}
.s2-fieldset{border:1px solid var(--color-border);border-radius:var(--radius-none);padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-3)}
.s2-form__actions{display:flex;align-items:center;gap:var(--space-4)}
.s2-parent{margin:0;color:var(--color-text-muted)}
.s2-login{max-width:40ch;margin:10vh auto 0}

/* C2 — agreements, the register-driven override form, and the resolution trace. */
.s2-state{display:inline-block;padding:0 var(--space-2);border-radius:var(--radius-none);border:1px solid var(--color-border);font-size:var(--text-sm)}
.s2-state[data-tone="live"]{border-color:var(--color-action);color:var(--color-text)}
.s2-state[data-tone="pending"]{border-style:dashed;color:var(--color-text-muted)}
.s2-state[data-tone="ended"]{color:var(--color-text-muted);text-decoration:line-through}
.s2-muted{color:var(--color-text-muted)}
.s2-oq5{display:flex;flex-direction:column;gap:var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-none);padding:var(--space-3)}
.s2-oq5 legend{padding-inline:var(--space-2);font-weight:600}
.s2-oq5__unset{color:var(--color-status-at-risk)}
.s2-radio{display:flex;align-items:baseline;gap:var(--space-2)}
.s2-policy{margin:0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-policy[data-combine="ratchet"]{color:var(--color-text)}
.s2-rationale{margin:0 0 var(--space-2);color:var(--color-text-muted);font-size:var(--text-sm)}
.s2-form--inline{display:flex;flex-wrap:wrap;gap:var(--space-4);align-items:end}
.s2-trace{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s2-trace__step{display:grid;grid-template-columns:10rem 6rem 8rem 1fr;gap:var(--space-3);align-items:baseline}
.s2-trace__outcome{font-variant-caps:all-small-caps;letter-spacing:.04em}
.s2-trace__step[data-outcome="won"] .s2-trace__outcome{color:var(--color-action)}
.s2-trace__step[data-outcome="not_walked"]{color:var(--color-text-muted)}
.s2-trace__note{color:var(--color-text-muted)}
.s2-trace-table{width:100%;border-collapse:collapse}
.s2-refused{margin:var(--space-3) 0 0;padding-inline-start:var(--space-4);color:var(--color-status-at-risk)}
@media (max-width:760px){.s2-nav{align-items:stretch;flex-wrap:wrap}.s2-nav__link,.s2-nav__logout,.s2-notice__dismiss{min-height:44px;display:inline-flex;align-items:center}.s2-nav__who{order:2;width:100%;margin-inline-start:0}.s2-two-col{grid-template-columns:minmax(0,1fr)}.s2-col--orgs{position:static}.s2-two-col .ac-grid,.s2-contracts .ac-grid{display:block;max-width:100%;overflow-x:auto}.s2-form__actions{align-items:stretch;flex-direction:column}.s2-trace__step{grid-template-columns:minmax(0,1fr)}}
`;
