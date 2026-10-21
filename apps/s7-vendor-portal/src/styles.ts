/**
 * S7's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui. S7 is not white-label (a vendor
 * works under Rankine's plate, `stateRamp: true`): an order waiting on the
 * vendor and a held invoice are states, drawn with the state ramp.
 */
export const S7_CSS = `
.s7-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s7-loading,.s7-empty,.s7-muted{color:var(--color-text-muted)}
.s7-scroll{overflow-x:auto}
.s7-row{display:flex;gap:var(--space-3);flex-wrap:wrap}
.s7-row--end{align-items:end}
.s7-form--row{flex-direction:row;flex-wrap:wrap;align-items:end;max-width:none}
.s7-form--row>label{min-width:14ch}
.s7-num{font-family:var(--font-instrument);font-variant-numeric:tabular-nums;white-space:nowrap}
.s7-list{margin:0;padding-inline-start:var(--space-4)}
.s7-notes{margin:var(--space-1) 0 0;padding-inline-start:var(--space-4);color:var(--color-text-muted);font-size:var(--text-sm)}
.s7-login{max-width:var(--measure-narrow);margin:10vh auto 0}
@media (max-width:760px){.s7-form--row{flex-direction:column;align-items:stretch}}
`;
