/**
 * S8's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. S8 is not white-label (the firm
 * works under Rankine's plate, `stateRamp: true`), so nothing here is a
 * tenant's to re-point; it is the arrangement of a firm's row, its roster,
 * a crew's documents, its work and its statements around the two forms.
 */
export const S8_CSS = `
.s8-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s8-h1{margin:0 0 var(--space-2);font-size:var(--text-xl)}
.s8-h2{margin:var(--space-6) 0 var(--space-2);font-size:var(--text-lg)}
.s8-scope,.s8-crumbs{margin:0 0 var(--space-4);color:var(--color-text-muted);display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
.s8-loading,.s8-empty,.s8-muted{color:var(--color-text-muted)}
.s8-row__actions{display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s8-summary{margin:0 0 var(--space-2);display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:baseline}
.s8-summary strong{font-family:var(--font-instrument);font-size:var(--text-lg)}
.s8-total{font-family:var(--font-instrument);font-size:var(--text-lg)}
.s8-login{max-width:40ch;margin:10vh auto 0}
.s8-field--pair{display:flex;gap:var(--space-3)}
.s8-position{display:grid;grid-template-columns:repeat(auto-fit,minmax(28ch,1fr));gap:var(--space-6);margin-top:var(--space-4)}
@media (max-width:760px){.s8-field--pair{flex-direction:column}}

/* ---- Rev A (Bulletin No. 2 Rev A): the reference layout's shape — radii and elevation from tokens, colours unchanged ---- */
.s8-h1{font-family:var(--font-display);font-size:var(--text-display);font-weight:800;letter-spacing:var(--track-tight);text-transform:none;line-height:1.15}
.s8-h2{font-family:var(--font-display);font-weight:700;letter-spacing:var(--track-tight);text-transform:none}
.s8-summary{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);padding:var(--space-3) var(--space-4)}
`;
