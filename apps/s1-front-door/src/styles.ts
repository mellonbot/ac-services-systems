/**
 * S1's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui.
 *
 * S1 is the one surface in the system that wears the BRAND roles. Everywhere
 * else they resolve to Ink Black (the registry's `stateRamp` flag, which is
 * `false` here and true everywhere else); since Rev C the red reaches every
 * surface as the action accent instead. Nothing on this page bears state: a
 * person who has not signed in has nothing under SLA and no compliance to
 * read. So `--color-brand` is the real thing here: the yard (scene.ts) reads
 * it for the forklift and the cones.
 *
 * `comfort` density: 44px controls, 15px body, hover affordances allowed.
 * This is the page every person who uses the platform starts at, and the one
 * a technician reads on a phone in a car park.
 */
export const S1_CSS = `
.s1-app{display:flex;flex-direction:column;gap:var(--space-4)}
.s1-sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.s1-h1{margin:0 0 var(--space-2);font-family:var(--font-display);font-size:var(--text-display);font-weight:800;letter-spacing:var(--track-tight);line-height:1.15}
.s1-h2{margin:var(--space-6) 0 var(--space-2);font-family:var(--font-display);font-size:var(--text-lg);font-weight:700;letter-spacing:var(--track-tight)}
.s1-welcome{margin:0 0 var(--space-2);font-size:var(--text-xl)}
.s1-lede{margin:0 0 var(--space-4);font-size:var(--text-md);max-width:var(--measure-text)}
.s1-label{margin:0 0 var(--space-2);font-family:var(--font-label);font-size:var(--text-xs);font-weight:600;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}

/* The door: the form beside the yard, the form first in reading order. */
.s1-door{display:grid;grid-template-columns:minmax(0,var(--measure-short)) minmax(0,1fr);gap:var(--space-8);align-items:start;margin-top:var(--space-4)}
.s1-door__panel{display:flex;flex-direction:column}
.s1-check{display:flex;align-items:center;gap:var(--space-2);min-height:var(--control-height)}
.s1-check input{width:var(--space-4);height:var(--space-4);accent-color:var(--color-action)}
.s1-check input:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.s1-instrument{font-family:var(--font-instrument);font-variant-numeric:tabular-nums}

/* The chooser: one plate per surface the login opens. */
.s1-choices{display:flex;flex-direction:column;gap:var(--space-3);margin:0 0 var(--space-4);padding:0;list-style:none}
.s1-portal{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;width:100%;min-height:calc(2 * var(--control-height));padding:var(--space-2) var(--space-4);line-height:1.25;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);color:var(--color-text);font-family:inherit;text-align:left;text-decoration:none;cursor:pointer;transition:border-color var(--motion-base) var(--ease),box-shadow var(--motion-base) var(--ease)}
.s1-portal strong{font-family:var(--font-display);font-size:var(--text-lg);font-weight:700;letter-spacing:var(--track-tight)}
.s1-portal span{color:var(--color-text-muted);font-family:var(--font-instrument);font-size:var(--text-sm)}
.s1-portal:hover{border-color:var(--color-border-hard);box-shadow:var(--elevation-raised)}
.s1-portal:hover strong{text-decoration:underline}
.s1-portal:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.s1-portal[disabled]{cursor:progress}

.s1-scene{position:relative;border-radius:var(--radius-card);overflow:hidden;box-shadow:var(--elevation-card)}
.s1-scene__stage{aspect-ratio:16/9;background:url(/scene-still.webp) center/cover no-repeat}
.s1-scene[data-live] .s1-scene__stage{background:none}
.s1-scene__stage canvas{display:block;width:100%;height:100%}

.s1-missing{max-width:var(--measure-text)}
.s1-missing__path{margin:0 0 var(--space-4)}
.s1-missing__path code{font-family:var(--font-instrument);font-size:var(--text-sm);padding:var(--space-1) var(--space-2);background:var(--color-surface-sunken);border-radius:var(--radius-control);color:var(--color-text);word-break:break-all}
.s1-missing__ways{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-4)}
.s1-missing__action{display:inline-flex;align-items:center;text-decoration:none}
@media (prefers-reduced-motion:reduce){.s1-portal{transition:none}}

/* ---- Narrow screens: the form, then the yard beneath it ---- */
@media (max-width: 860px) {
  .s1-door { grid-template-columns: minmax(0,1fr); gap: var(--space-6); }
  .s1-scene__stage { aspect-ratio: 4/3; }
}
@media (max-width: 640px) {
  .s1-app { gap: var(--space-3); padding-bottom: var(--space-4); }
  .s1-missing__ways { flex-direction: column; align-items: flex-start; }
}
`;
