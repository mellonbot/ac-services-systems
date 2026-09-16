/**
 * THE COMPONENT STYLESHEET, as a string so the guard can read it: no `#rrggbb`,
 * no colour function — every colour is `var(--color-*)` from packages/tokens/src/css.ts,
 * every size is a density variable. One stylesheet serves all three densities
 * because the frame's `:root` block decides what the variables hold; a
 * component never asks which density it is in, it reads the variables.
 *
 * The house it draws is Rankine Operating Company, Identity Standards Bulletin
 * No. 1 — a period American catalogue, struck on screen. Plate 7 states the
 * rule that keeps that from becoming costume: THE ERA OWNS THE MARKS, THE
 * LIVERY AND THE EQUIPMENT PLATES; THE SCREEN INHERITS ITS DISCIPLINE. Rules
 * instead of boxes, plate numbering, two inks, figures in columns, nothing
 * decorative — and still legible to a gloved hand in an attic at 2pm in July.
 *
 * Which is why there is not a rounded corner in this file, and why every
 * numeral in the company is `tabular-nums` whether its face loaded or not.
 *
 * `build-surface.ts` writes this to `dist/ui.css`; the frame links it.
 */
export const UI_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:var(--color-scheme)}
/* Every number holds its column even when no face loaded at all — the degraded
   state is legible on purpose, which is the staleness clock's argument. */
html,body{font-variant-numeric:tabular-nums}
body{margin:0;background:var(--color-page);color:var(--color-text);font:var(--body-text)/1.6 var(--font-text)}
:focus-visible{outline:var(--focus-ring) var(--color-focus-ring);outline-offset:2px}
code,.ac-num{font-family:var(--font-instrument);font-variant-numeric:tabular-nums}
code{font-size:0.95em;background:var(--color-surface-sunken);padding:1px var(--space-1);border:1px solid var(--color-border)}
main#mount{padding:var(--gutter);background:var(--color-surface)}

/* ---- Masthead: the wordmark, the descriptor, the trade line ----
   A thick-thin rule under condensed gothic caps — the standard American
   catalogue masthead of the period, and the one piece of artwork that also
   cuts in vinyl and embroiders. */
.ac-mast{padding:var(--space-4) var(--gutter) var(--space-2);background:var(--color-page);border-bottom:1px solid var(--color-border)}
.ac-mast__lockup{display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap}
.ac-mark{font-family:var(--font-display);font-weight:800;font-size:var(--text-xl);letter-spacing:var(--track-mark);color:var(--color-action-text);line-height:.9}
.ac-wordmark{font-family:var(--font-display);font-weight:800;font-size:var(--text-display);letter-spacing:var(--track-mark);text-transform:uppercase;line-height:.88}
.ac-wordmark__co{font-family:var(--font-engraved);font-weight:700;font-size:var(--text-xs);letter-spacing:var(--track-widest);text-transform:uppercase;color:var(--color-action-text)}
.ac-mast__rule{border-top:4px solid var(--color-text);border-bottom:1px solid var(--color-text);height:6px;margin-top:var(--space-2)}
.ac-mast__trade,.ac-mast__endorse{font-family:var(--font-instrument);font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted);padding-top:var(--space-2)}
.ac-mast__endorse{color:var(--color-action-text)}

/* ---- Plate head: a titled section is numbered, like a plate ---- */
.ac-plate__head{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2) var(--space-4);padding-bottom:var(--space-2);border-bottom:3px solid var(--color-text);margin-bottom:var(--space-3)}
.ac-plate__no{font-family:var(--font-instrument);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-page);background:var(--color-text);padding:2px var(--space-2)}
.ac-plate__title{font-family:var(--font-display);font-weight:700;font-size:var(--text-xl);letter-spacing:var(--track-normal);text-transform:uppercase;margin:0}

/* ---- StatusPill: rule, fill and word — Form R-4 ----
   The rule is drawn in the state's OWN ink, never in --color-border: a chip's
   rule carries SHAPE, and the border role measures 2.65:1 (errata E-08).
   The fill is transparent in the light stock and oxide on the field ground,
   where hue has stopped working and form is the only channel left. */
.ac-pill{display:inline-flex;align-items:center;gap:var(--space-1);padding:0 var(--space-2);height:calc(var(--control-height) - var(--space-2));border-radius:var(--radius-none);border:1px solid var(--status-color);color:var(--status-color);background:var(--status-fill,transparent);font-family:var(--font-instrument);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;white-space:nowrap}
.ac-pill__glyph{color:var(--status-color)}
.ac-pill[data-status="ok"]{--status-color:var(--color-status-ok)}
.ac-pill[data-status="at_risk"]{--status-color:var(--color-status-at-risk)}
.ac-pill[data-status="breached"]{--status-color:var(--color-status-breached);--status-fill:var(--color-status-breached-fill)}
.ac-pill[data-status="blocked"]{--status-color:var(--color-status-blocked)}

/* ---- PrimaryAction: a copper fill, sized by the density ----
   The label is --color-action-ink at 4.63:1 on the fill, NOT --color-surface:
   copper is 3.31:1 and is large-type-only, so the ink that sits on it is its
   own role. The rule carries the control's shape on the field ground, where the
   fill alone is 3.61:1 and the press state is darker still. */
.ac-action-wrap{display:inline-flex;flex-direction:column;gap:var(--space-1);align-items:flex-start}
.ac-action{min-height:var(--control-height);min-width:var(--control-height);padding:0 var(--space-4);border-radius:var(--radius-none);border:1px solid var(--color-action-text);background:var(--color-action);color:var(--color-action-ink);font-family:var(--font-display);font-size:var(--text-md);font-weight:800;letter-spacing:var(--track-wide);text-transform:uppercase;cursor:pointer}
.ac-action[data-kind="quiet"]{background:transparent;color:var(--color-action-text)}
.ac-action[data-kind="danger"]{background:var(--color-status-breached-fill);border-color:var(--color-status-breached);color:var(--color-status-breached)}
.ac-action:hover{filter:brightness(calc(1 - 0.08 * var(--hover)))}
/* Press feedback is :active, not :hover — errata E-06. A tablet has no cursor. */
.ac-action:active{background:var(--color-action-pressed);border-color:var(--color-action-pressed)}
.ac-action[aria-disabled="true"]{opacity:0.55;cursor:not-allowed}
.ac-action__reason{color:var(--color-text-muted);font-size:var(--text-sm)}

/* ---- DataGrid: a railway working timetable ----
   Ruled, dense, figures in columns, state in codes. The head sits on the
   darkest ground in the stock, which is why every ink is measured against it. */
.ac-grid{border-collapse:collapse;width:100%;font-size:var(--body-text)}
.ac-grid__caption{text-align:start;font-family:var(--font-instrument);font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted);padding:var(--space-1) 0}
.ac-grid__th,.ac-grid__td{height:var(--row-height);padding:0 var(--space-3);border-bottom:1px solid var(--color-border);text-align:start;vertical-align:middle}
.ac-grid__th[data-align="end"],.ac-grid__td[data-align="end"]{text-align:end}
.ac-grid__th{position:sticky;top:0;background:var(--color-surface-sunken);color:var(--color-text-muted);font-family:var(--font-instrument);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;white-space:nowrap;border-bottom:3px solid var(--color-text)}
.ac-grid__sort{all:unset;cursor:pointer;color:inherit;font:inherit}
.ac-grid__row[tabindex]{cursor:pointer}
.ac-grid__row:hover{background:color-mix(in srgb,var(--color-surface-sunken) calc(100% * var(--hover)),transparent)}
.ac-grid__row[data-selected="true"]{background:var(--color-surface-sunken);box-shadow:inset 3px 0 0 var(--color-action)}
.ac-grid__empty td{color:var(--color-text-muted);text-align:center}

/* ---- ComplianceBadge (console only) ---- */
.ac-badge{display:inline-flex;align-items:center;gap:var(--space-1);padding:0 var(--space-2);border-radius:var(--radius-none);border:1px solid var(--badge-color,var(--color-border));color:var(--badge-color,inherit);font-family:var(--font-instrument);font-size:var(--text-xs);letter-spacing:var(--track-normal);text-transform:uppercase}
.ac-badge[data-cleared="true"]{--badge-color:var(--color-status-ok)}
.ac-badge[data-cleared="false"]{--badge-color:var(--color-status-breached)}
.ac-badge__glyph{color:var(--badge-color)}

/* ---- RefusalCard: the axis, the message verbatim, the routes ---- */
.ac-refusal{border:1px solid var(--color-border-hard);border-inline-start:6px solid var(--refusal-color);border-radius:var(--radius-none);padding:var(--space-3) var(--space-4);max-width:56ch;background:var(--color-surface)}
.ac-refusal[data-axis="structural"]{--refusal-color:var(--color-status-blocked)}
.ac-refusal[data-axis="commercial"]{--refusal-color:var(--color-status-at-risk)}
.ac-refusal[data-kind="token"],.ac-refusal[data-kind="transport"]{--refusal-color:var(--color-status-breached)}
.ac-refusal[data-kind="scope"],.ac-refusal[data-kind="bad_request"],.ac-refusal[data-kind="no_route"],.ac-refusal[data-kind="phase_disabled"]{--refusal-color:var(--color-status-blocked)}
.ac-refusal__heading{margin:0 0 var(--space-2);font-family:var(--font-display);font-size:var(--text-lg);font-weight:700;letter-spacing:var(--track-normal);text-transform:uppercase}
.ac-refusal__mark{color:var(--refusal-color)}
.ac-refusal__message{margin:0 0 var(--space-2)}
.ac-refusal__facts{display:grid;grid-template-columns:max-content 1fr;gap:var(--space-1) var(--space-3);margin:0 0 var(--space-2);font-family:var(--font-instrument);color:var(--color-text-muted);font-size:var(--text-xs);letter-spacing:var(--track-normal);text-transform:uppercase}
.ac-refusal__facts dd{margin:0;color:var(--color-text);text-transform:none}
.ac-refusal__axis{margin:0 0 var(--space-3);font-family:var(--font-engraved);font-style:italic;color:var(--color-text-muted)}
.ac-refusal__routes{display:flex;flex-wrap:wrap;gap:var(--space-2)}

/* ---- DegradedBanner / <ac-degraded> ----
   A frozen board with a visible staleness clock beats a board that quietly
   lies, so this is a rule across the top of the page, not a toast. */
.ac-degraded,ac-degraded{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:baseline;padding:var(--space-2) var(--gutter);background:var(--color-surface-sunken);border-bottom:3px solid var(--color-status-breached);font-size:var(--text-sm)}
ac-degraded[hidden]{display:none}
.ac-degraded__mark{color:var(--color-status-breached)}
.ac-degraded__title{font-family:var(--font-display);letter-spacing:var(--track-normal);text-transform:uppercase}
.ac-degraded__age{font-family:var(--font-instrument);color:var(--color-text-muted);font-size:var(--text-xs);letter-spacing:var(--track-normal)}
`;

/** Every `var(--name)` the stylesheet reads. The test checks each is defined by tokenCss for every density. */
export const cssVariablesRead = (css: string): readonly string[] =>
  [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!))].sort();

/** Variables the stylesheet defines itself (scoped, like `--status-color`), which tokenCss does not have to. */
export const cssVariablesDefined = (css: string): readonly string[] =>
  [...new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))].sort();

/**
 * The selectors that render the state ramp. The house accent sits 16.3° from
 * ochre — the bulletin says so on Plate 3 — and the system does not solve that
 * with a better orange. It solves it structurally: every state carries a word,
 * and COPPER NEVER ENTERS A STATE-BEARING COLUMN. That second half is an
 * invariant, so the test reads this list and fails any rule here that paints an
 * action role.
 */
export const STATE_BEARING_SELECTORS = Object.freeze([".ac-pill", ".ac-badge"]);
