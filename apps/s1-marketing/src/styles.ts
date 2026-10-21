/**
 * S1's LAYOUT. Roles and density variables only — the guard fails a colour
 * literal here as it does in packages/ui.
 *
 * S1 is the one surface in the system that WEARS THE HOUSE RED. Everywhere
 * else the brand role resolves to Ink Black, because the red measures 0.55°
 * from the fault ink and a red control beside a status chip reads as an alarm
 * (packages/tokens/src/whitelabel.ts, and the registry's `stateRamp` flag,
 * which is `false` here and true everywhere else). Nothing on this page bears
 * state: an anonymous visitor has nothing under SLA and no compliance to
 * read. So `var(--color-brand)` is the real thing here, and this is the one
 * file in the repository where it is.
 *
 * `comfort` density: 44px controls, 15px body, hover affordances allowed.
 * This is also the only surface most people who ever touch the platform will
 * see, and the only one they will read on a phone in a car park.
 */
export const S1_CSS = `
.s1-app{display:flex;flex-direction:column;gap:var(--space-4);max-width:var(--measure-text);margin:0 auto}
.ac-mast{max-width:calc(var(--measure-text) + 2 * var(--gutter))}
.s1-nav{display:flex;align-items:center;gap:var(--space-4);padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s1-nav__spacer{margin-inline-start:auto}
.s1-h1{margin:0 0 var(--space-2);font-family:var(--font-display);font-size:var(--text-xl);text-transform:uppercase;letter-spacing:var(--track-normal)}
.s1-h2{margin:var(--space-6) 0 var(--space-2);font-size:var(--text-lg)}
.s1-lede{margin:0 0 var(--space-4);font-size:var(--text-md);max-width:var(--measure-text)}
.s1-loading,.s1-empty,.s1-muted{color:var(--color-text-muted)}
.s1-cta{display:inline-flex;align-items:center;min-height:var(--control-height);padding:0 var(--space-4);background:var(--color-brand);color:var(--color-brand-ink);text-decoration:none;font-weight:600}
.s1-cta:hover{text-decoration:underline}
.s1-metros{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--tile-min),1fr));gap:var(--space-2);margin:0 0 var(--space-4);padding:0;list-style:none}
.s1-metros li{padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);background:var(--color-surface)}
.s1-metros__code{display:block;font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s1-coverage__caveat{margin:0 0 var(--space-4);color:var(--color-text-muted);max-width:var(--measure-text)}
.s1-label{margin:0 0 var(--space-2);font-family:var(--font-label);font-size:var(--text-xs);font-weight:600;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s1-surface-access{margin-top:var(--space-6);scroll-margin-top:var(--space-4)}
.s1-portal:focus-visible,.s1-nav a:focus-visible,.s1-public a:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.s1-public{margin-top:var(--space-8);padding-top:var(--space-4);border-top:1px solid var(--color-border)}
.s1-public__line{margin:0 0 var(--space-3);max-width:var(--measure-short)}
.s1-public__where{margin:var(--space-3) 0 0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s1-call{display:inline-flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);color:var(--color-action-text);text-decoration:none;font-weight:600}
.s1-foot{margin-top:var(--space-6);padding-top:var(--space-3);border-top:1px solid var(--color-border);color:var(--color-text-muted);font-size:var(--text-sm)}

/* ---- The sign-in floor: the service bay in 3D (src/scene.ts), after the ERS recovery line —
   the truck turning on a turntable, a pad on the floor for each portal, and that portal's plate
   pinned above its pad. The panel runs wider than the text column, to the page width less its
   gutters. Live, each plate takes --x/--y from the scene's projection; until then, and where
   WebGL is unavailable, the plates sit on a CSS ellipse over the still (public/scene-still.webp).
   Under 40rem the plates leave the floor and stack under it. ---- */
.s1-scene{position:relative;container-type:inline-size;width:min(100vw - 2 * var(--gutter), var(--page-max));margin:var(--space-4) calc(50% - min(50vw - var(--gutter), var(--page-max) / 2)) 0;border-radius:var(--radius-card);overflow:hidden;box-shadow:var(--elevation-card)}
.s1-scene__stage{aspect-ratio:16/9;background:url(/scene-still.webp) center/cover no-repeat}
.s1-scene[data-live] .s1-scene__stage{background:none}
.s1-scene__stage canvas{display:block;width:100%;height:100%}
.s1-scene__plates{position:absolute;inset:0;margin:0;padding:0;list-style:none;pointer-events:none}
.s1-scene__plate{position:absolute;left:calc(50% + sin(var(--slot)) * 36cqi);top:calc(50% - cos(var(--slot)) * 20cqi);width:clamp(11rem, 15cqi, 12rem);transform:translate(-50%,-100%);pointer-events:auto}
.s1-scene[data-live] .s1-scene__plate{left:var(--x);top:var(--y)}
.s1-portal{display:flex;flex-direction:column;justify-content:center;gap:var(--space-1);min-height:calc(2 * var(--control-height));padding:var(--space-3);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);color:var(--color-text);text-align:center;text-decoration:none;transition:border-color var(--motion-base) var(--ease),box-shadow var(--motion-base) var(--ease)}
.s1-portal strong{font-family:var(--font-display);font-weight:700;letter-spacing:var(--track-tight)}
.s1-portal span{color:var(--color-text-muted);font-size:var(--text-sm)}
.s1-portal:hover{border-color:var(--color-border-hard);box-shadow:var(--elevation-raised)}
.s1-portal:hover strong{text-decoration:underline}
@container (max-width:40rem){
  .s1-scene__stage{aspect-ratio:4/3}
  .s1-scene__plates{position:static;display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);padding:var(--space-3);pointer-events:auto}
  .s1-scene__plate,.s1-scene[data-live] .s1-scene__plate{position:static;width:auto;transform:none}
}

@media (prefers-reduced-motion:reduce){.s1-portal{transition:none}}

/* ---- Rev A (Bulletin No. 2 Rev A): the reference layout's shape — radii and elevation from tokens, colours unchanged ---- */
.s1-h1{font-family:var(--font-display);font-size:var(--text-display);font-weight:800;letter-spacing:var(--track-tight);text-transform:none;line-height:1.15}
.s1-h2{font-family:var(--font-display);font-weight:700;letter-spacing:var(--track-tight);text-transform:none}
.s1-metros li{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);padding:var(--space-3) var(--space-4)}
.s1-cta{border-radius:var(--radius-control)}
.s1-nav{border-bottom:0}
@media(max-width:640px){.s1-nav{flex-wrap:wrap}.s1-nav__spacer{display:none}}
`;
