/**
 * S7's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. S7 is not white-label (a vendor
 * works under Rankine's plate, `stateRamp: true`): an order waiting on the
 * vendor and a held invoice are states, drawn with the state ramp.
 */
export const S7_CSS = `
.s7-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s7-h1{margin:0 0 var(--space-2);font-size:var(--text-xl);display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center}
.s7-h2{margin:var(--space-6) 0 var(--space-2);font-size:var(--text-lg)}
.s7-lede{margin:0 0 var(--space-3);color:var(--color-text-muted);max-width:70ch}
.s7-loading,.s7-empty,.s7-muted{color:var(--color-text-muted)}
.s7-scroll{overflow-x:auto}
.s7-row{display:flex;gap:var(--space-3);flex-wrap:wrap}
.s7-row--end{align-items:end}
.s7-form--row{flex-direction:row;flex-wrap:wrap;align-items:end;max-width:none}
.s7-form--row .ac-field{min-width:14ch}
.s7-num{font-family:var(--font-instrument);font-variant-numeric:tabular-nums;white-space:nowrap}
.s7-notes{margin:var(--space-1) 0 0;padding-inline-start:1.2em;color:var(--color-text-muted);font-size:var(--text-sm)}
.s7-login{max-width:40ch;margin:10vh auto 0}
.s7-login .ac-form{border:0;background:none;padding:0;box-shadow:none}
@media (max-width:760px){.s7-row{display:flex;gap:var(--space-3);flex-wrap:wrap}
.s7-row--end{align-items:end}
.s7-form--row{flex-direction:column;align-items:stretch}}

/* ---- Rev A (Bulletin No. 2 Rev A): the reference layout's shape — radii and elevation from tokens, colours unchanged ---- */
.s7-h1{font-family:var(--font-display);font-size:var(--text-display);font-weight:800;letter-spacing:var(--track-tight);text-transform:none;line-height:1.15}
.s7-h2{font-family:var(--font-display);font-weight:700;letter-spacing:var(--track-tight);text-transform:none}
`;
