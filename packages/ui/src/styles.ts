/**
 * THE COMPONENT STYLESHEET, as a string so the guard can read it: no `#rrggbb`,
 * no colour function — every colour is `var(--color-*)` from packages/tokens/src/css.ts,
 * every size is a density variable. One stylesheet serves all three densities
 * because the frame's `:root` block decides what the variables hold; a
 * component never asks which density it is in, it reads the variables.
 *
 * `build-surface.ts` writes this to `dist/ui.css`; the frame links it.
 */
export const UI_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:var(--color-scheme)}
body{margin:0;background:var(--color-surface);color:var(--color-text);font:var(--body-text)/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
:focus-visible{outline:var(--focus-ring) var(--color-focus-ring);outline-offset:2px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.95em}
main#mount{padding:var(--gutter)}

/* ---- StatusPill: glyph + word + colour, always all three ---- */
.ac-pill{display:inline-flex;align-items:center;gap:var(--space-1);padding:0 var(--space-2);height:calc(var(--control-height) - var(--space-2));border-radius:var(--radius-lg);border:1px solid var(--color-border);white-space:nowrap}
.ac-pill__glyph{color:var(--status-color)}
.ac-pill[data-status="ok"]{--status-color:var(--color-status-ok)}
.ac-pill[data-status="at_risk"]{--status-color:var(--color-status-at-risk)}
.ac-pill[data-status="breached"]{--status-color:var(--color-status-breached)}
.ac-pill[data-status="blocked"]{--status-color:var(--color-status-blocked)}

/* ---- PrimaryAction: sized by the density, hover gated by --hover ---- */
.ac-action-wrap{display:inline-flex;flex-direction:column;gap:var(--space-1);align-items:flex-start}
.ac-action{min-height:var(--control-height);min-width:var(--control-height);padding:0 var(--space-4);border-radius:var(--radius-md);border:1px solid var(--color-action);background:var(--color-action);color:var(--color-surface);font:inherit;font-weight:600;cursor:pointer}
.ac-action[data-kind="quiet"]{background:transparent;color:var(--color-action)}
.ac-action[data-kind="danger"]{background:var(--color-status-breached);border-color:var(--color-status-breached)}
.ac-action:hover{filter:brightness(calc(1 - 0.08 * var(--hover)))}
.ac-action:active{background:var(--color-action-pressed);border-color:var(--color-action-pressed)}
.ac-action[aria-disabled="true"]{opacity:0.55;cursor:not-allowed}
.ac-action__reason{color:var(--color-text-muted);font-size:var(--text-sm)}

/* ---- DataGrid: real table, density row height ---- */
.ac-grid{border-collapse:collapse;width:100%;font-size:var(--body-text)}
.ac-grid__caption{text-align:start;color:var(--color-text-muted);padding:var(--space-1) 0}
.ac-grid__th,.ac-grid__td{height:var(--row-height);padding:0 var(--space-2);border-bottom:1px solid var(--color-border);text-align:start;vertical-align:middle}
.ac-grid__th[data-align="end"],.ac-grid__td[data-align="end"]{text-align:end}
.ac-grid__th{position:sticky;top:0;background:var(--color-surface-sunken);color:var(--color-text-muted);font-weight:600}
.ac-grid__sort{all:unset;cursor:pointer;color:inherit;font:inherit}
.ac-grid__row[tabindex]{cursor:pointer}
.ac-grid__row:hover{background:color-mix(in srgb,var(--color-surface-sunken) calc(100% * var(--hover)),transparent)}
.ac-grid__row[data-selected="true"]{background:var(--color-surface-sunken);box-shadow:inset 3px 0 0 var(--color-action)}
.ac-grid__empty td{color:var(--color-text-muted);text-align:center}

/* ---- ComplianceBadge (console only) ---- */
.ac-badge{display:inline-flex;align-items:center;gap:var(--space-1);padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--color-border)}
.ac-badge[data-cleared="true"] .ac-badge__glyph{color:var(--color-status-ok)}
.ac-badge[data-cleared="false"] .ac-badge__glyph{color:var(--color-status-breached)}

/* ---- RefusalCard: the axis, the message verbatim, the routes ---- */
.ac-refusal{border:1px solid var(--color-border);border-inline-start:4px solid var(--refusal-color);border-radius:var(--radius-md);padding:var(--space-3) var(--space-4);max-width:56ch;background:var(--color-surface)}
.ac-refusal[data-axis="structural"]{--refusal-color:var(--color-status-blocked)}
.ac-refusal[data-axis="commercial"]{--refusal-color:var(--color-status-at-risk)}
.ac-refusal[data-kind="token"],.ac-refusal[data-kind="transport"]{--refusal-color:var(--color-status-breached)}
.ac-refusal[data-kind="scope"],.ac-refusal[data-kind="bad_request"],.ac-refusal[data-kind="no_route"],.ac-refusal[data-kind="phase_disabled"]{--refusal-color:var(--color-status-blocked)}
.ac-refusal__heading{margin:0 0 var(--space-2);font-size:var(--text-md);font-weight:600}
.ac-refusal__mark{color:var(--refusal-color)}
.ac-refusal__message{margin:0 0 var(--space-2)}
.ac-refusal__facts{display:grid;grid-template-columns:max-content 1fr;gap:var(--space-1) var(--space-3);margin:0 0 var(--space-2);color:var(--color-text-muted);font-size:var(--text-sm)}
.ac-refusal__facts dd{margin:0;color:var(--color-text)}
.ac-refusal__axis{margin:0 0 var(--space-3);font-style:italic;color:var(--color-text-muted)}
.ac-refusal__routes{display:flex;flex-wrap:wrap;gap:var(--space-2)}

/* ---- DegradedBanner / <ac-degraded> ---- */
.ac-degraded,ac-degraded{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:baseline;padding:var(--space-2) var(--gutter);background:var(--color-surface-sunken);border-bottom:2px solid var(--color-status-breached)}
ac-degraded[hidden]{display:none}
.ac-degraded__mark{color:var(--color-status-breached)}
.ac-degraded__age{color:var(--color-text-muted);font-size:var(--text-sm)}
`;

/** Every `var(--name)` the stylesheet reads. The test checks each is defined by tokenCss for every density. */
export const cssVariablesRead = (css: string): readonly string[] =>
  [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!))].sort();

/** Variables the stylesheet defines itself (scoped, like `--status-color`), which tokenCss does not have to. */
export const cssVariablesDefined = (css: string): readonly string[] =>
  [...new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))].sort();
