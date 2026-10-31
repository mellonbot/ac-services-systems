/**
 * S1's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui.
 *
 * S1 is the one surface in the system that wears the BRAND roles. Everywhere
 * else they resolve to Ink Black (the registry's `stateRamp` flag, which is
 * `false` here and true everywhere else); since Rev C the red reaches every
 * surface as the action accent instead. Nothing on this page bears
 * state: an anonymous visitor has nothing under SLA and no compliance to
 * read. So `--color-brand` is the real thing here: the sign-in yard
 * (scene.ts) reads it for the forklift and the cones.
 *
 * `comfort` density: 44px controls, 15px body, hover affordances allowed.
 * This is also the only surface most people who ever touch the platform will
 * see, and the only one they will read on a phone in a car park.
 * Mobile rules aligned with the Rankine prototype.
 */
export const S1_CSS = `
.s1-app{display:flex;flex-direction:column;gap:var(--space-4)}
.s1-enquire,.s1-coverage{max-width:var(--measure-text)}
.s1-sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.s1-h1{margin:0 0 var(--space-2);font-family:var(--font-display);font-size:var(--text-xl);text-transform:uppercase;letter-spacing:var(--track-normal)}
.s1-h2{margin:var(--space-6) 0 var(--space-2);font-size:var(--text-lg)}
.s1-welcome{margin:0 0 var(--space-2);font-size:var(--text-xl)}
.s1-callout{margin:var(--space-6) 0 0}
.s1-callout__action{display:inline-flex;align-items:center;text-decoration:none}
.s1-lede{margin:0 0 var(--space-4);font-size:var(--text-md);max-width:var(--measure-text)}
.s1-loading,.s1-empty,.s1-muted{color:var(--color-text-muted)}
.s1-metros{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--tile-min),1fr));gap:var(--space-2);margin:0 0 var(--space-4);padding:0;list-style:none}
.s1-metros li{padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);background:var(--color-surface)}
.s1-metros__code{display:block;font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s1-coverage__caveat{margin:0 0 var(--space-4);color:var(--color-text-muted);max-width:var(--measure-text)}
.s1-label{margin:0 0 var(--space-2);font-family:var(--font-label);font-size:var(--text-xs);font-weight:600;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s1-surface-access{margin-top:var(--space-6);scroll-margin-top:var(--space-4)}
.s1-portal:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.s1-call{display:inline-flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);color:var(--color-action-text);text-decoration:none;font-weight:600}
.s1-missing{max-width:var(--measure-text)}
.s1-missing__path{margin:0 0 var(--space-4)}
.s1-missing__path code{font-family:var(--font-instrument);font-size:var(--text-sm);padding:var(--space-1) var(--space-2);background:var(--color-surface-sunken);border-radius:var(--radius-control);color:var(--color-text);word-break:break-all}
.s1-missing__portals{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--tile-min),1fr));gap:var(--space-2);margin:0 0 var(--space-6);padding:0;list-style:none}
.s1-missing__portals .s1-portal{align-items:flex-start;text-align:left;white-space:normal}
.s1-missing__portals .s1-portal span{font-family:var(--font-instrument)}
.s1-missing__ways{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-4)}
.s1-foot{margin-top:var(--space-6);padding-top:var(--space-3);border-top:1px solid var(--color-border);color:var(--color-text-muted);font-size:var(--text-sm)}
.s1-scene{position:relative;container-type:inline-size;margin-top:var(--space-4);border-radius:var(--radius-card);overflow:hidden;box-shadow:var(--elevation-card)}
.s1-scene__stage{aspect-ratio:16/9;background:url(/scene-still.webp) center/cover no-repeat}
.s1-scene[data-live] .s1-scene__stage{background:none}
.s1-scene__stage canvas{display:block;width:100%;height:100%}
.s1-scene__plates{position:absolute;inset:0;margin:0;padding:0;list-style:none;pointer-events:none}
.s1-scene__plate{position:absolute;left:calc(49.4% + sin(var(--slot)) * 30.6% + cos(var(--slot)) * 3.2%);top:calc(57.3% + sin(var(--slot)) * 5.4% - cos(var(--slot)) * 23.5%);width:max-content;--out-x:clamp(-1, 2 * sin(var(--slot)), 1);--out-y:clamp(-1, -2 * cos(var(--slot)), 1);transform:translate(calc(-50% + var(--out-x) * (50% + var(--space-3))),calc(-50% + var(--out-y) * (50% + var(--space-3))));pointer-events:auto}
.s1-scene[data-live] .s1-scene__plate{left:var(--x);top:var(--y)}
.s1-portal{display:flex;flex-direction:column;justify-content:center;min-height:var(--control-height);padding:var(--space-1) var(--space-3);white-space:nowrap;line-height:1.25;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);color:var(--color-text);text-align:center;text-decoration:none;transition:border-color var(--motion-base) var(--ease),box-shadow var(--motion-base) var(--ease)}
.s1-portal strong{font-family:var(--font-display);font-size:var(--text-sm);font-weight:700;letter-spacing:var(--track-tight)}
.s1-portal span{color:var(--color-text-muted);font-size:var(--text-xs)}
.s1-portal:hover{border-color:var(--color-border-hard);box-shadow:var(--elevation-raised)}
.s1-portal:hover strong{text-decoration:underline}
@container (min-width:56rem){
  .s1-portal{padding:var(--space-2) var(--space-4)}
  .s1-portal strong{font-size:var(--text-md)}
  .s1-portal span{font-size:var(--text-sm)}
}
@container (max-width:45rem){
  .s1-scene__stage{aspect-ratio:4/3}
  .s1-scene__plates{position:static;display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);padding:var(--space-3);pointer-events:auto}
  .s1-scene__plate,.s1-scene[data-live] .s1-scene__plate{position:static;width:auto;transform:none}
}
/* A portal that is enabled but not in the production ROLLOUT: barrier tape on the brand layer (no yellow ink exists; amber is state-only). */
.s1-portal--closed{overflow:hidden;cursor:not-allowed;background:var(--color-surface-sunken);box-shadow:none}
.s1-portal--closed:hover{border-color:var(--color-border);box-shadow:none}
.s1-portal--closed:hover strong{text-decoration:none}
.s1-portal .s1-tape{display:flex;justify-content:center;margin:var(--space-1) calc(-1 * var(--space-6)) 0;padding:var(--space-1) 0;transform:rotate(-3deg);background:repeating-linear-gradient(-45deg,var(--color-brand) 0 var(--space-2),var(--color-brand-ink) var(--space-2) calc(2 * var(--space-2)))}
.s1-portal .s1-tape__label{padding:0 var(--space-2);background:var(--color-brand);color:var(--color-brand-ink);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.s1-portal{transition:none}}
.s1-h1{font-family:var(--font-display);font-size:var(--text-display);font-weight:800;letter-spacing:var(--track-tight);text-transform:none;line-height:1.15}
.s1-h2{font-family:var(--font-display);font-weight:700;letter-spacing:var(--track-tight);text-transform:none}
.s1-metros li{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);padding:var(--space-3) var(--space-4)}

/* ---- Mobile surfaces (Rankine prototype alignment) ---- */
@media (max-width: 640px) {
  .s1-app { gap: var(--space-3); padding-bottom: var(--space-4); }
  .s1-metros, .s1-missing__portals { grid-template-columns: 1fr; }
  .s1-call, .s1-portal { min-height: 44px; }
  .s1-missing__ways { flex-direction: column; align-items: flex-start; }
}
`;
