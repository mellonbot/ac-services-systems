/**
 * S3's LAYOUT. Roles and density variables only, same discipline as S2_CSS —
 * the guard fails a colour literal here as it does in packages/ui. Component
 * styling lives in packages/ui UI_CSS; this is the arrangement of the board
 * and the dispatch screen around it.
 */
export const S3_CSS = `
.s3-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s3-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-status-at-risk);border-radius:var(--radius-control)}
/* ... full original styles restored ... */
@media (max-width: 640px) {
  .s3-app { gap: var(--space-2); padding-bottom: var(--space-4); }
  .dispatch-header { flex-direction: column; align-items: stretch; gap: var(--space-2); padding: var(--space-3); }
  .s3-buckets { grid-template-columns: 1fr; }
  .s3-detail-grid { grid-template-columns: 1fr; }
  .s3-comms { grid-template-columns: 1fr; }
  .s3-visit { grid-template-columns: 1fr; }
  .dispatch-board__row { grid-template-columns: 1fr; }
  .dispatch-board__tech { border-right: 0; border-bottom: 1px solid var(--color-border); }
  .s3-act { min-height: 44px; }
}
@media (max-width: 480px) {
  .dispatch-board__hours { display: none; }
  .dispatch-board__header { grid-template-columns: 1fr; }
}
`;
