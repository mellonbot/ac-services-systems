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
 * Bulletin No. 2 Rev A (2026-09-27) adopted the field-ops reference layout —
 * page heads, stat tiles, content in panels, tables inside panels, a segmented
 * control for navigation — with three radii and one soft elevation, all
 * tokens (--radius-control/card/pill, --elevation-card/raised). Every colour
 * is still a role; a soft fill is a role mixed toward the surface, never a new
 * ink. Every numeral is still `tabular-nums` whether its face loaded or not.
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
main#mount{padding:var(--space-2) var(--gutter) var(--space-12);max-width:1400px;margin:0 auto}

/* ---- Masthead: the badge, the wordmark, the descriptor ----
   The wordmark is the ONE place the script appears on a surface. It is a mark
   rather than a typeface: it never sets an interface, and it never goes below
   its size floor, because a connected script's joins close up and the word
   becomes a smear. The badge carries every size below that.

   THE LOCKUP IS FENCED BY ELEMENT, NOT BY SURFACE — and the reason is visible
   on any console frame built before this change. The brand fence is a token:
   tokenCss resolves --color-brand* to Ink Black wherever a state ramp renders,
   and this sheet painted var(--color-brand-text) unconditionally and let the
   frame decide what that meant. Correct for a control. Wrong here — because
   BADGE.treatment reads P.brand.fill directly and is not resolved by anything,
   so the masthead rendered a brand-red badge beside an Ink Black wordmark. One
   lockup, two identities, on six of eight surfaces.

   The surface fence answers "may a CONTROL be red here", and the masthead is
   not a control, not a chip, and not inside the data region: it is the plate the
   instrument is screwed to. So the lockup takes --color-livery, which tokenCss
   never neutralises, and the fence that keeps it honest is the element it may
   appear on — checked in styles.test.ts, not remembered.

   Measured: the house red clears the 3:1 large-text floor on every ground in
   both stocks, worst case 3.48:1 on the plate ground, and the wordmark never
   renders below WORDMARK_FLOOR so it is always large text. The badge's own
   pair, ink.black on the red ground, is 3.67:1 — the non-text floor, because
   the letter is a MARK and not a word anyone reads. (No hex in this file: the
   sheet names roles, and styles.test.ts fails a colour even in a comment.) */
.ac-mast{padding:var(--space-4) var(--gutter) var(--space-2);background:var(--color-page);max-width:1400px;margin:0 auto}
.ac-mast__lockup{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;
  text-decoration:none;color:inherit}
.ac-badge-mark{display:inline-flex;flex:none}
.ac-badge-mark__svg{display:block}
.ac-wordmark{font-family:var(--font-wordmark);font-size:var(--text-mast);line-height:1;
  color:var(--color-livery);padding-right:0.08em}
.ac-wordmark__co{font-family:var(--font-label);font-weight:600;font-size:var(--text-xs);
  letter-spacing:var(--track-widest);text-transform:uppercase;color:var(--color-text-muted)}
.ac-mast__rule{height:4px;background:var(--color-livery);max-width:320px;margin-top:var(--space-2)}

/* ---- Plate head: a titled section is numbered, like a plate ---- */
.ac-plate__head{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2) var(--space-4);padding-bottom:var(--space-2);border-bottom:3px solid var(--color-text);margin-bottom:var(--space-3)}
.ac-plate__no{font-family:var(--font-instrument);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-page);background:var(--color-text);padding:2px var(--space-2)}
.ac-plate__title{font-family:var(--font-display);font-weight:700;font-size:var(--text-xl);letter-spacing:var(--track-normal);text-transform:uppercase;margin:0}

/* ---- StatusPill: glyph, soft fill and word — Form R-4, Rev A shape ----
   A pill now (--radius-pill) with a soft fill: the state's own ink mixed
   toward the surface, so the word keeps its ink and the fill adds salience
   without adding a hue. FORM still carries the order before hue does: ok is
   fill only, at-risk adds an outline in its ink, breached adds a solid
   outline and the strongest fill — and on the field ground the breached fill
   is oxide (--color-status-breached-fill), the tier's only solid chip. The
   glyph stays: colour never carries alone. An outline is drawn in the state's
   OWN ink, never in --color-border: a chip's rule carries SHAPE, and the border
   role measures 2.22:1 (errata E-08). */
.ac-pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;min-height:24px;border-radius:var(--radius-pill);border:1px solid var(--status-rule,transparent);color:var(--status-color);background:var(--status-fill,color-mix(in srgb,var(--status-color) 11%,var(--color-surface)));font-family:var(--font-label);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-tight);white-space:nowrap;line-height:1.3}
.ac-pill__glyph{color:var(--status-color);font-size:0.85em}
.ac-pill[data-status="ok"]{--status-color:var(--color-status-ok)}
.ac-pill[data-status="at_risk"]{--status-color:var(--color-status-at-risk);--status-rule:color-mix(in srgb,var(--color-status-at-risk) 45%,transparent)}
.ac-pill[data-status="breached"]{--status-color:var(--color-status-breached);--status-rule:var(--color-status-breached);--status-fill:color-mix(in srgb,var(--color-status-breached) 15%,var(--color-surface))}
[data-density="field"] .ac-pill[data-status="breached"]{--status-fill:var(--color-status-breached-fill)}
.ac-pill[data-status="blocked"]{--status-color:var(--color-status-blocked)}

/* ---- PrimaryAction: an arc fill, sized by the density ----
   The label is --color-action-ink at 6.40:1 on the fill, NOT --color-surface:
   the arc fill is 2.09:1 on the header ground and is never a word, so the ink
   that sits on it is its own role. The rule carries the control's shape, which
   is what licenses the fill to be an arc; on the field ground the fill reads
   6.07:1 and the press state is brighter still. */
.ac-action-wrap{display:inline-flex;flex-direction:column;gap:var(--space-1);align-items:flex-start}
.ac-action{min-height:var(--control-height);min-width:var(--control-height);padding:0 var(--space-4);border-radius:var(--radius-control);border:1px solid var(--color-action-text);background:var(--color-action);color:var(--color-action-ink);font-family:var(--font-label);font-size:var(--text-md);font-weight:700;letter-spacing:var(--track-tight);cursor:pointer}
.ac-action[data-kind="quiet"]{background:var(--color-surface);color:var(--color-action-text);border-color:var(--color-border-hard)}
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
.ac-grid{border-collapse:separate;border-spacing:0;width:100%;font-size:var(--body-text);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);overflow:hidden}
.ac-grid__caption{text-align:start;font-family:var(--font-display);font-size:var(--text-md);font-weight:700;color:var(--color-text);padding:0 0 var(--space-2)}
.ac-grid__th,.ac-grid__td{height:var(--row-height);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--color-border);text-align:start;vertical-align:middle}
.ac-grid tbody tr:last-child .ac-grid__td{border-bottom:0}
.ac-grid__th[data-align="end"],.ac-grid__td[data-align="end"]{text-align:end}
/* A numeric column is the instrument face, declared once per column rather than
   hoped for: .ac-num existed and nothing rendered it, so every SLA timer and
   invoice total in the system was proportional serif. Column.numeric sets this. */
.ac-grid__td[data-numeric="true"]{font-family:var(--font-instrument);font-variant-numeric:tabular-nums}
.ac-grid__th{position:sticky;top:0;background:color-mix(in srgb,var(--color-surface-sunken) 45%,var(--color-surface));color:var(--color-text-muted);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;white-space:nowrap;border-bottom:1px solid var(--color-border-hard)}
/* NOT all:unset. It ties :focus-visible on specificity and wins on source
   order — the cascade is resolved per property, not per state — so the outline
   above became none on the dispatch board's only keyboard control. Measured
   in Chromium: outline-style none on a focused sort button. Reset what a button
   actually brings and nothing else. */
.ac-grid__sort{appearance:none;-webkit-appearance:none;background:none;border:0;margin:0;padding:0;text-align:inherit;cursor:pointer;color:inherit;font:inherit}
.ac-grid__row[tabindex]{cursor:pointer}
.ac-grid__row:hover{background:color-mix(in srgb,var(--color-surface-sunken) calc(100% * var(--hover)),transparent)}
.ac-grid__row[data-selected="true"]{background:color-mix(in srgb,var(--color-surface-sunken) 60%,var(--color-surface));box-shadow:inset 3px 0 0 var(--color-action)}
.ac-grid__empty td{color:var(--color-text-muted);text-align:center}

/* ---- ComplianceBadge (console only) ---- */
.ac-badge{display:inline-flex;align-items:center;gap:var(--space-1);padding:1px var(--space-2);border-radius:var(--radius-pill);border:1px solid var(--badge-color,var(--color-border));color:var(--badge-color,inherit);font-family:var(--font-instrument);font-size:var(--text-xs);letter-spacing:var(--track-normal);text-transform:uppercase}
.ac-badge[data-cleared="true"]{--badge-color:var(--color-status-ok)}
.ac-badge[data-cleared="false"]{--badge-color:var(--color-status-breached)}
.ac-badge__glyph{color:var(--badge-color)}
/* The gate's reason, rendered rather than hidden in a title attribute. */
.ac-badge__detail{color:var(--color-text-muted);text-transform:none;letter-spacing:var(--track-tight)}

/* ---- RefusalCard: the axis, the message verbatim, the routes ---- */
.ac-refusal{border:1px solid color-mix(in srgb,var(--refusal-color) 45%,var(--color-border));border-top:3px solid var(--refusal-color);border-radius:var(--radius-card);padding:var(--space-3) var(--space-4);max-width:64ch;background:var(--color-surface);box-shadow:var(--elevation-card)}
.ac-refusal[data-axis="structural"]{--refusal-color:var(--color-status-blocked)}
.ac-refusal[data-axis="commercial"]{--refusal-color:var(--color-status-at-risk)}
.ac-refusal[data-kind="token"],.ac-refusal[data-kind="transport"]{--refusal-color:var(--color-status-breached)}
.ac-refusal[data-kind="scope"],.ac-refusal[data-kind="bad_request"],.ac-refusal[data-kind="no_route"],.ac-refusal[data-kind="phase_disabled"]{--refusal-color:var(--color-status-blocked)}
.ac-refusal__heading{margin:0 0 var(--space-2);font-family:var(--font-display);font-size:var(--text-lg);font-weight:700;letter-spacing:var(--track-tight)}
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
/* ---- Rev A page structure — shared by every surface ----
   A page head (the screen's name and one plain sentence), a stat strip where
   figures lead, content in panels, and navigation as a segmented control. */
.ac-page-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:var(--space-3) var(--space-4);margin:var(--space-2) 0 var(--space-4)}
.ac-page-head__title{margin:0;font-family:var(--font-display);font-size:var(--text-display);font-weight:800;letter-spacing:var(--track-tight);line-height:1.15;text-wrap:balance}
.ac-page-head__lede{margin:var(--space-1) 0 0;color:var(--color-text-muted);font-size:var(--text-sm);max-width:62ch}
.ac-page-head__side{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
.ac-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17ch),1fr));gap:var(--space-3);margin:0 0 var(--space-4)}
.ac-stat{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);padding:var(--space-3) var(--space-4);display:flex;flex-direction:column;gap:2px;min-width:0}
.ac-stat__n{font-family:var(--font-display);font-size:var(--text-display);font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--stat-ink,var(--color-text))}
.ac-stat__l{font-family:var(--font-label);font-size:var(--text-xs);font-weight:600;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.ac-stat__s{font-size:var(--text-xs);color:var(--color-text-muted)}
.ac-stat[data-tone="ok"]{--stat-ink:var(--color-status-ok)}
.ac-stat[data-tone="at_risk"]{--stat-ink:var(--color-status-at-risk)}
.ac-stat[data-tone="breached"]{--stat-ink:var(--color-status-breached)}
.ac-stat[data-tone="info"]{--stat-ink:var(--color-action-text)}
.ac-panel{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);box-shadow:var(--elevation-card);padding:var(--space-4)}
.ac-panel__head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:var(--space-2);margin:0 0 var(--space-3)}
.ac-panel__title{margin:0;font-family:var(--font-display);font-size:var(--text-lg);font-weight:700}
.ac-panel__sub{margin:2px 0 0;color:var(--color-text-muted);font-size:var(--text-sm)}
.ac-seg{display:inline-flex;flex-wrap:wrap;gap:4px;padding:4px;background:color-mix(in srgb,var(--color-surface-sunken) 50%,var(--color-surface));border:1px solid var(--color-border);border-radius:var(--radius-card)}
.ac-seg__item{display:inline-flex;align-items:center;gap:6px;padding:var(--space-2) var(--space-4);border-radius:var(--radius-control);color:var(--color-text-muted);font-weight:600;font-size:var(--text-sm);text-decoration:none;white-space:nowrap}
.ac-seg__item[data-current="true"]{background:var(--color-surface);color:var(--color-action-text);box-shadow:var(--elevation-raised)}
.ac-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--radius-pill);border:1px solid var(--color-border-hard);background:var(--color-surface);color:var(--color-text);font-size:var(--text-sm);font-weight:600;text-decoration:none;cursor:pointer}
.ac-chip[aria-pressed="true"]{background:color-mix(in srgb,var(--color-action) 14%,var(--color-surface));border-color:color-mix(in srgb,var(--color-action-text) 45%,transparent);color:var(--color-action-text)}
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
  // The livery is the same red, exempt from the SURFACE fence and not from this one:
  // a lockup role decorating a chip is the exact failure the exemption was argued past.
  "--color-livery", "--color-livery-ink",
  "--color-action", "--color-action-ink", "--color-action-text", "--color-action-pressed",
]);

/**
 * THE LOCKUP ROLES, and the only selectors they may appear on.
 *
 * tokenCss never neutralises these, so nothing downstream will catch them if they
 * escape — which makes this list the whole fence. An element fence that is not checked
 * is a convention, and a convention is what produced the two-identity masthead.
 */
export const LIVERY_ROLES = Object.freeze(["--color-livery", "--color-livery-ink"]);
export const LIVERY_SELECTORS = Object.freeze([".ac-mast", ".ac-wordmark", ".ac-badge-mark"]);
