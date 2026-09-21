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
   state is legible on purpose, which is the staleness clock's argument.
   Written as longhands, and it has to be: the font SHORTHAND resets every
   font-variant-* longhand to its initial value, so font:... on body after
   this line computed font-variant-numeric:normal and inherited that to the
   whole document. Measured in Chromium: html tabular-nums, body normal. One
   rule the type schedule calls load-bearing, off everywhere, silently, for the
   cost of a shorthand. styles.test.ts bans the shorthand now. */
html,body{font-variant-numeric:tabular-nums}
body{margin:0;background:var(--color-page);color:var(--color-text);font-family:var(--font-text);font-size:var(--body-text);line-height:1.6}
:focus-visible{outline:var(--focus-ring) var(--color-focus-ring);outline-offset:2px}
code,.ac-num{font-family:var(--font-instrument);font-variant-numeric:tabular-nums}
code{font-size:0.95em;background:var(--color-surface-sunken);padding:1px var(--space-1);border:1px solid var(--color-border)}
main#mount{padding:var(--gutter);background:var(--color-surface)}

/* ---- Masthead: the badge, the wordmark, the descriptor ----
   The wordmark is the ONE place the script appears on a surface. It is a mark
   rather than a typeface: it never sets an interface, and it never goes below
   its size floor, because a connected script's joins close up and the word
   becomes a smear. The badge carries every size below that.

   --brand-layer is 1 only on a surface that renders no state ramp. The brand
   roles are already resolved to Ink Black everywhere else by tokenCss, so this
   stylesheet paints var(--color-brand-text) unconditionally and the frame
   decides what that means — the fence is a token, not a convention. */
.ac-mast{padding:var(--space-4) var(--gutter) var(--space-2);background:var(--color-page)}
.ac-mast__lockup{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;
  text-decoration:none;color:inherit}
.ac-badge-mark{display:inline-flex;flex:none}
.ac-badge-mark__svg{display:block}
.ac-wordmark{font-family:var(--font-wordmark);font-size:var(--text-mast);line-height:1;
  color:var(--color-brand-text);padding-right:0.08em}
.ac-wordmark__co{font-family:var(--font-label);font-weight:600;font-size:var(--text-xs);
  letter-spacing:var(--track-widest);text-transform:uppercase;color:var(--color-text-muted)}
.ac-mast__rule{height:4px;background:var(--color-brand);max-width:320px;margin-top:var(--space-2)}

/* ---- Plate head: a titled section is numbered, like a plate ---- */
.ac-plate__head{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2) var(--space-4);padding-bottom:var(--space-2);border-bottom:3px solid var(--color-text);margin-bottom:var(--space-3)}
.ac-plate__no{font-family:var(--font-instrument);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-page);background:var(--color-text);padding:2px var(--space-2)}
.ac-plate__title{font-family:var(--font-display);font-weight:700;font-size:var(--text-xl);letter-spacing:var(--track-normal);text-transform:uppercase;margin:0}

/* ---- StatusPill: rule, fill and word — Form R-4 ----
   The rule is drawn in the state's OWN ink, never in --color-border: a chip's
   rule carries SHAPE, and the border role measures 2.22:1 (errata E-08).
   The fill is transparent in the light stock and oxide on the field ground,
   where hue has stopped working and form is the only channel left. */
.ac-pill{display:inline-flex;align-items:center;gap:var(--space-1);padding:0 var(--space-2);height:calc(var(--control-height) - var(--space-2));border-radius:var(--radius-none);border:1px solid var(--status-color);color:var(--status-color);background:var(--status-fill,transparent);font-family:var(--font-instrument);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;white-space:nowrap}
.ac-pill__glyph{color:var(--status-color)}
.ac-pill[data-status="ok"]{--status-color:var(--color-status-ok)}
.ac-pill[data-status="at_risk"]{--status-color:var(--color-status-at-risk)}
.ac-pill[data-status="breached"]{--status-color:var(--color-status-breached);--status-fill:var(--color-status-breached-fill)}
.ac-pill[data-status="blocked"]{--status-color:var(--color-status-blocked)}

/* ---- PrimaryAction: an arc fill, sized by the density ----
   The label is --color-action-ink at 6.40:1 on the fill, NOT --color-surface:
   the arc fill is 2.09:1 on the header ground and is never a word, so the ink
   that sits on it is its own role. The rule carries the control's shape, which
   is what licenses the fill to be an arc; on the field ground the fill reads
   6.07:1 and the press state is brighter still. */
.ac-action-wrap{display:inline-flex;flex-direction:column;gap:var(--space-1);align-items:flex-start}
.ac-action{min-height:var(--control-height);min-width:var(--control-height);padding:0 var(--space-4);border-radius:var(--radius-none);border:1px solid var(--color-action-text);background:var(--color-action);color:var(--color-action-ink);font-family:var(--font-display);font-size:var(--text-md);font-weight:800;letter-spacing:var(--track-wide);text-transform:uppercase;cursor:pointer}
.ac-action[data-kind="quiet"]{background:transparent;color:var(--color-action-text)}
.ac-action[data-kind="danger"]{background:var(--color-status-breached-fill);border-color:var(--color-status-breached);color:var(--color-status-breached)}
.ac-action:hover{filter:brightness(calc(1 - 0.08 * var(--hover)))}
/* Press feedback is :active, not :hover — errata E-06. A tablet has no cursor.
   The INK moves with the fill. It did not, and color.action-pressed is
   color.action-text by value, so a quiet button — every secondary route on a
   RefusalCard — pressed its own label to 1.00:1 and the danger variant to
   1.24:1. A variant that sets a resting colour keeps it unless the press sets
   one too; ON_FILL measures both pairs now. */
.ac-action:active{background:var(--color-action-pressed);border-color:var(--color-action-pressed);color:var(--color-action-ink)}
/* Danger inverts rather than filling with the arc: a destructive control does
   not borrow the primary's ink to say "pressed". 6.23:1 on the light stock,
   16.34:1 on the plate. */
.ac-action[data-kind="danger"]:active{background:var(--color-status-breached);border-color:var(--color-status-breached);color:var(--color-page)}
.ac-action[aria-disabled="true"]{opacity:0.55;cursor:not-allowed}
.ac-action__reason{color:var(--color-text-muted);font-size:var(--text-sm)}

/* ---- DataGrid: a railway working timetable ----
   Ruled, dense, figures in columns, state in codes. The head sits on the
   darkest ground in the stock, which is why every ink is measured against it. */
.ac-grid{border-collapse:collapse;width:100%;font-size:var(--body-text)}
.ac-grid__caption{text-align:start;font-family:var(--font-instrument);font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted);padding:var(--space-1) 0}
.ac-grid__th,.ac-grid__td{height:var(--row-height);padding:0 var(--space-3);border-bottom:1px solid var(--color-border);text-align:start;vertical-align:middle}
.ac-grid__th[data-align="end"],.ac-grid__td[data-align="end"]{text-align:end}
/* A numeric column is the instrument face, declared once per column rather than
   hoped for: .ac-num existed and nothing rendered it, so every SLA timer and
   invoice total in the system was proportional serif. Column.numeric sets this. */
.ac-grid__td[data-numeric="true"]{font-family:var(--font-instrument);font-variant-numeric:tabular-nums}
.ac-grid__th{position:sticky;top:0;background:var(--color-surface-sunken);color:var(--color-text-muted);font-family:var(--font-instrument);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;white-space:nowrap;border-bottom:3px solid var(--color-text)}
/* NOT all:unset. It ties :focus-visible on specificity and wins on source
   order — the cascade is resolved per property, not per state — so the outline
   above became none on the dispatch board's only keyboard control. Measured
   in Chromium: outline-style none on a focused sort button. Reset what a button
   actually brings and nothing else. */
.ac-grid__sort{appearance:none;-webkit-appearance:none;background:none;border:0;margin:0;padding:0;text-align:inherit;cursor:pointer;color:inherit;font:inherit}
.ac-grid__row[tabindex]{cursor:pointer}
.ac-grid__row:hover{background:color-mix(in srgb,var(--color-surface-sunken) calc(100% * var(--hover)),transparent)}
.ac-grid__row[data-selected="true"]{background:var(--color-surface-sunken);box-shadow:inset 3px 0 0 var(--color-action)}
.ac-grid__empty td{color:var(--color-text-muted);text-align:center}

/* ---- ComplianceBadge (console only) ---- */
.ac-badge{display:inline-flex;align-items:center;gap:var(--space-1);padding:0 var(--space-2);border-radius:var(--radius-none);border:1px solid var(--badge-color,var(--color-border));color:var(--badge-color,inherit);font-family:var(--font-instrument);font-size:var(--text-xs);letter-spacing:var(--track-normal);text-transform:uppercase}
.ac-badge[data-cleared="true"]{--badge-color:var(--color-status-ok)}
.ac-badge[data-cleared="false"]{--badge-color:var(--color-status-breached)}
.ac-badge__glyph{color:var(--badge-color)}
/* The gate's reason, rendered rather than hidden in a title attribute. */
.ac-badge__detail{color:var(--color-text-muted);text-transform:none;letter-spacing:var(--track-tight)}

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
.ac-refusal__axis{margin:0 0 var(--space-3);font-family:var(--font-label);font-style:italic;color:var(--color-text-muted)}
.ac-refusal__routes{display:flex;flex-wrap:wrap;gap:var(--space-2)}

/* ---- DegradedBanner / <ac-degraded> ----
   A frozen board with a visible staleness clock beats a board that quietly
   lies, so this is a rule across the top of the page, not a toast. */
.ac-degraded,ac-degraded{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:baseline;padding:var(--space-2) var(--gutter);background:var(--color-surface-sunken);border-bottom:3px solid var(--color-status-breached);font-size:var(--text-sm)}
ac-degraded[hidden]{display:none}
/* The mark carries the FILL, the way the breached chip does. On the plate ground
   color.status-breached IS color.text — that is the whole point of Plate 4,
   hue has stopped working — so a banner drawn only in the word role renders its
   alarm in body-copy cream on the one surface read in sunlight. Form R-4 says
   the fill carries salience; this is the fill. Transparent on the light stock,
   where a fault is an outline, and oxide at 6.63:1 on the plate. */
.ac-degraded__mark{color:var(--color-status-breached);background:var(--color-status-breached-fill);padding:0 var(--space-1);line-height:1.4}
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
 * The selectors that render the state ramp. Bulletin 1's copper sat 16.3° from
 * its warning ink and the system did not solve that with a better orange; the
 * arc clears the same gate at 38.41° from jade, and the invariant did not
 * relax when the accent changed. It is structural, not a hue budget: every
 * state carries a word, and THE ACTION ROLE NEVER PAINTS A STATE-BEARING
 * COLUMN — because colour on one artefact is state or category and never both,
 * which an accent that clears the gate would break just as quietly. So the
 * test reads this list and fails any rule here that paints an action role —
 * which it did not do until styles.test.ts grew the check; the comment was the
 * enforcement.
 */
export const STATE_BEARING_SELECTORS = Object.freeze([".ac-pill", ".ac-badge"]);

/**
 * The accent roles that may NEVER appear in a state-bearing rule. The house red
 * is 0.55° from the fault ink and the arc is 38.41° from the nearest state, and
 * neither may decorate a chip: a dispatcher reads the column, not the palette.
 * styles.test.ts fails any rule above that breaks this.
 */
export const ACCENT_ROLES = Object.freeze([
  "--color-brand", "--color-brand-ink", "--color-brand-text",
  "--color-action", "--color-action-ink", "--color-action-text", "--color-action-pressed",
]);
