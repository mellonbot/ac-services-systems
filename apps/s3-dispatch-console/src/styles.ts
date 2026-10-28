/**
 * S3's LAYOUT. Roles and density variables only, same discipline as S2_CSS.
 * Mobile rules aligned with the Rankine prototype.
 */
export const S3_CSS = `
.s3-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s3-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-status-at-risk);border-radius:var(--radius-control)}
.s3-notice p{margin:0}
.s3-loading,.s3-empty,.s3-muted{color:var(--color-text-muted)}
.s3-buckets{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:var(--space-3);margin:0 0 var(--space-4)}
.s3-bucket{display:flex}
.s3-bucket>section{flex:1;border-top:3px solid var(--color-text)}
.s3-detail-grid{display:grid;grid-template-columns:minmax(18rem,1fr) minmax(0,2.4fr);gap:var(--space-4);align-items:start}
.s3-comms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4)}
.s3-visit{display:grid;grid-template-columns:5.5rem minmax(0,1fr);gap:var(--space-3)}
.dispatch-header{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-4);padding:var(--space-2) var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-card);background:var(--color-surface)}
.dispatch-board__row{display:grid;grid-template-columns:var(--column-rail) 1fr;border-bottom:1px solid var(--color-border);min-height:64px}
.dispatch-board__tech{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3);border-right:1px solid var(--color-border)}
.s3-act{min-height:var(--control-height);appearance:none;border:0;background:none;padding:0;color:var(--color-action-text);font:inherit;cursor:pointer}
.s3-chips{display:flex;flex-wrap:wrap;gap:var(--space-1)}
.s3-grid-scroll{overflow-x:auto}

/* ---- Mobile surfaces (Rankine prototype alignment) ---- */
@media (max-width: 640px) {
  .s3-app { gap: var(--space-2); padding-bottom: var(--space-4); }
  .dispatch-header { flex-direction: column; align-items: stretch; gap: var(--space-2); padding: var(--space-3); }
  .s3-buckets { grid-template-columns: 1fr; }
  .s3-detail-grid { grid-template-columns: 1fr; }
  .s3-comms { grid-template-columns: 1fr; }
  .s3-visit { grid-template-columns: 1fr; }
  .dispatch-board__row { grid-template-columns: 1fr; }
  .dispatch-board__tech { border-right: 0; border-bottom: 1px solid var(--color-border); }
  .s3-act { min-height: 44px; padding: var(--space-2) var(--space-3); }
  .s3-chips .ac-chip { min-height: 36px; }
  .s3-confirm { max-width: 100%; }
}
@media (max-width: 480px) {
  .dispatch-board__hours { display: none; }
  .dispatch-board__header { grid-template-columns: 1fr; }
}
`;
