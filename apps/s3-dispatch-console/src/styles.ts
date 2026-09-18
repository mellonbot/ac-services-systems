/**
 * S3's LAYOUT. Roles and density variables only, same discipline as S2_CSS —
 * the guard fails a colour literal here as it does in packages/ui. Component
 * styling lives in packages/ui UI_CSS; this is the arrangement of the board
 * and the dispatch screen around it.
 */
export const S3_CSS = `
.s3-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s3-nav{display:flex;align-items:center;gap:var(--space-4);padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s3-nav__who{margin-inline-start:auto;color:var(--color-text-muted);font-size:var(--text-sm)}
.s3-nav__logout{appearance:none;background:none;border:0;margin:0;padding:0;cursor:pointer;color:var(--color-action);font:inherit}
.s3-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-status-at-risk);border-radius:var(--radius-none)}
.s3-notice p{margin:0}
.s3-notice__dismiss{appearance:none;background:none;border:0;margin-inline-start:auto;cursor:pointer;color:var(--color-text-muted);padding:0 var(--space-2)}
.s3-h1{margin:0 0 var(--space-4);font-size:var(--text-xl)}
.s3-h2{margin:var(--space-4) 0 var(--space-2);font-size:var(--text-lg)}
.s3-loading,.s3-empty,.s3-muted{color:var(--color-text-muted)}
.s3-row-actions{display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s3-link{color:var(--color-action);text-decoration:none}
.s3-link:hover{text-decoration:underline}
.s3-login{max-width:40ch;margin:10vh auto 0}
.s3-form{display:flex;flex-direction:column;gap:var(--space-3)}
.s3-field{display:flex;flex-direction:column;gap:var(--space-1)}
.s3-field>span{font-weight:600;font-size:var(--text-sm);color:var(--color-text-muted)}
.s3-input{min-height:var(--control-height);padding:0 var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-none);background:var(--color-surface);color:var(--color-text);font:inherit}
.s3-job-facts{display:grid;grid-template-columns:auto 1fr;gap:var(--space-2) var(--space-4);margin:0 0 var(--space-4);align-items:baseline}
.s3-job-facts dt{color:var(--color-text-muted);font-size:var(--text-sm)}
.s3-job-facts dd{margin:0}
.s3-candidates{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s3-candidate{display:flex;align-items:center;gap:var(--space-4);padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-none)}
.s3-candidate__label{flex:1}
@media (max-width:760px){.s3-nav{align-items:stretch;flex-wrap:wrap}.s3-nav__who{order:2;width:100%;margin-inline-start:0}.s3-candidate{flex-wrap:wrap}}
`;
