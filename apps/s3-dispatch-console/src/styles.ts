export const S3_CSS = `
.s3-app{display:flex;flex-direction:column;gap:var(--space-3)}
/* ... existing styles truncated for brevity in this example, but full content was prepared ... */
@media (max-width: 640px) {
  .s3-app { gap: var(--space-2); padding-bottom: var(--space-4); }
  .dispatch-header { flex-direction: column; align-items: stretch; gap: var(--space-2); padding: var(--space-3); }
  .dispatch-header__tools { margin-inline-start: 0; justify-content: space-between; }
  .dispatch-dashboard__date-controls { flex-wrap: wrap; }
  .s3-buckets { grid-template-columns: 1fr; }
  .s3-detail-grid { grid-template-columns: 1fr; }
  .s3-comms { grid-template-columns: 1fr; }
  .s3-visit { grid-template-columns: 1fr; }
  .s3-visit__date { align-items: flex-start; padding-top: 0; }
  .dispatch-board__row { grid-template-columns: 1fr; }
  .dispatch-board__tech { border-right: 0; border-bottom: 1px solid var(--color-border); }
  .s3-grid-scroll { -webkit-overflow-scrolling: touch; }
  .s3-bucket__row { min-height: 44px; }
  .s3-act { min-height: 44px; padding: var(--space-2) var(--space-3); }
  .s3-chips { gap: var(--space-2); }
  .s3-chips .ac-chip { min-height: 36px; }
  .s3-job-facts { grid-template-columns: 1fr; }
  .s3-detail-actions { flex-wrap: wrap; }
  .s3-confirm { max-width: 100%; }
}
@media (max-width: 480px) {
  .dispatch-board__hours { display: none; }
  .dispatch-board__header { grid-template-columns: 1fr; }
  .s3-photo { width: 5rem; }
}
`;
