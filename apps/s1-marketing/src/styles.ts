/**
 * S1's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui.
 *
 * S1 is the one surface in the system that WEARS THE HOUSE RED. Everywhere
 * else the brand role resolves to Ink Black, because the red measures 1.2°
 * from the fault ink and a red control beside a status chip reads as an alarm
 * (packages/tokens/src/whitelabel.ts, and the registry's `stateRamp` flag,
 * which is `false` here and true everywhere else). Nothing on this page bears
 * state: an anonymous visitor has nothing under SLA and no compliance to
 * read. So `var(--color-brand)` is the real thing here, and this is the one
 * file in the repository where it is.
 *
 * `comfort` density: 44px controls, 15px body, hover affordances allowed.
 * This is also the only surface most people who ever touch the platform will
 * see, and the only one they will read on a phone in a car park.
 */
export const S1_CSS = `
.s1-app{display:flex;flex-direction:column;gap:var(--space-4);max-width:72ch;margin:0 auto}
.s1-nav{display:flex;align-items:center;gap:var(--space-4);padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s1-nav__mark{font-family:var(--font-wordmark);text-transform:uppercase;letter-spacing:var(--track-mark);color:var(--color-brand-text);font-weight:700}
.s1-nav__spacer{margin-inline-start:auto}
.s1-h1{margin:0 0 var(--space-2);font-family:var(--font-display);font-size:var(--text-xl);text-transform:uppercase;letter-spacing:var(--track-normal)}
.s1-h2{margin:var(--space-6) 0 var(--space-2);font-size:var(--text-lg)}
.s1-lede{margin:0 0 var(--space-4);font-size:var(--text-md);max-width:60ch}
.s1-loading,.s1-empty,.s1-muted{color:var(--color-text-muted)}
.s1-link{color:var(--color-action);text-decoration:none}
.s1-link:hover{text-decoration:underline}
.s1-cta{display:inline-flex;align-items:center;min-height:var(--control-height);padding:0 var(--space-4);background:var(--color-brand);color:var(--color-brand-ink);text-decoration:none;font-weight:600}
.s1-cta:hover{text-decoration:underline}
.s1-metros{display:grid;grid-template-columns:repeat(auto-fill,minmax(18ch,1fr));gap:var(--space-2);margin:0 0 var(--space-4);padding:0;list-style:none}
.s1-metros li{padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);background:var(--color-surface)}
.s1-metros__code{display:block;font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s1-coverage__caveat{margin:0 0 var(--space-4);color:var(--color-text-muted);max-width:60ch}
.s1-form{display:flex;flex-direction:column;gap:var(--space-3);max-width:60ch}
.s1-field{display:flex;flex-direction:column;gap:var(--space-1);flex:1}
.s1-field>span{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted)}
.s1-field__hint{font-weight:400;color:var(--color-text-muted);font-size:var(--text-xs)}
.s1-input{min-height:var(--control-height);padding:0 var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-none);background:var(--color-surface);color:var(--color-text);font:inherit}
.s1-textarea{padding:var(--space-2);min-height:calc(var(--control-height) * 2.5);resize:vertical;font:inherit}
.s1-sent{padding:var(--space-3);border:1px solid var(--color-status-ok);background:var(--color-surface);max-width:60ch}
.s1-queued{padding:var(--space-3);border:1px solid var(--color-status-at-risk);background:var(--color-surface);max-width:60ch}
.s1-refusal{padding:var(--space-3);border:1px solid var(--color-status-breached);background:var(--color-surface);max-width:60ch}
.s1-refusal__heading{margin:0 0 var(--space-2);font-size:var(--text-md)}
.s1-refusal__message{margin:0 0 var(--space-2)}
.s1-refusal__routes{display:flex;gap:var(--space-3)}
.s1-call{display:inline-flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);color:var(--color-action);text-decoration:none;font-weight:600}
.s1-foot{margin-top:var(--space-6);padding-top:var(--space-3);border-top:1px solid var(--color-border);color:var(--color-text-muted);font-size:var(--text-sm)}
`;
