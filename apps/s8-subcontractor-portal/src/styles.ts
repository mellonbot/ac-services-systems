/**
 * S8's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. S8 is not white-label (the firm
 * works under Rankine's plate, `stateRamp: true`), so nothing here is a
 * tenant's to re-point; it is the arrangement of a firm's row, its roster,
 * a crew's documents, its work and its statements around the two forms.
 */
export const S8_CSS = `
.s8-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s8-app>section{display:flex;flex-direction:column;gap:var(--space-4)}
.s8-scope,.s8-crumbs{margin:0;color:var(--color-text-muted);display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
.s8-loading,.s8-empty,.s8-muted{color:var(--color-text-muted)}
.s8-row__actions{display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s8-summary{margin:0;display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:baseline}
.s8-summary strong{font-family:var(--font-instrument);font-variant-numeric:tabular-nums;font-size:var(--text-lg)}
.s8-login{max-width:40ch;margin:var(--space-12) auto 0}
.s8-field--pair{display:flex;gap:var(--space-3)}
.s8-position{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,28ch),1fr));gap:var(--space-4)}
@media (max-width:760px){.s8-field--pair{flex-direction:column}}
`;
