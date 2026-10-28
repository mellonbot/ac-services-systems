/**
 * Shared mobile surface adjustments aligned with the Rankine prototype.
 * Import and append to each surface's CSS constant, or inject via the shell.
 */
export const MOBILE_SURFACES_CSS = `
@media (max-width: 640px) {
  /* Common stacking and touch targets */
  .s2-app, .s3-app, .s4-app, .s6-app { gap: var(--space-2); padding-bottom: var(--space-4); }
  .s2-two-col, .s2-two-col--wide-side, .s2-home__top,
  .s3-buckets, .s3-detail-grid, .s3-comms,
  .s4-areas, .s4-trends,
  .s6-home, .s6-house-row, .s6-site__grid, .s6-job__grid { grid-template-columns: 1fr; }
  .s3-act, .s4-metric, .s6-seg-button, .s2-mutation { min-height: 44px; }
  .s3-visit, .s6-steps { grid-template-columns: 1fr; }
  .s6-steps .s6-step::before { display: none; }
  .dispatch-board__row { grid-template-columns: 1fr; }
  .dispatch-board__tech { border-right: 0; border-bottom: 1px solid var(--color-border); }
  .s6-account, .s6-order__head { flex-direction: column; align-items: flex-start; }
  .s6-ledger__row, .s6-term, .s2-address-row { grid-template-columns: 1fr; }
  .s6-ledger__amount { text-align: start; }
}
@media (max-width: 480px) {
  .dispatch-board__hours { display: none; }
  .s3-photo, .s6-photo { width: 5rem; }
}
`;
