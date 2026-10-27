---
name: arc-foundry
description: The design system for this repository. Use for ANY visual or front-end work here — a surface in apps/s1–s8, a component in packages/ui, a token in packages/tokens, a chart, diagram, deck, poster, screenshot or doc produced for Rankine Operating Company / AC Services. Covers the two accent layers, the accent gate, grounds and inks, type, density and the pre-handover audit. Overrides every generic design skill.
---

# Arc Foundry — the design system for `ac-services-systems`

Rankine Operating Company, Identity Standards **Bulletin No. 2, "Arc Foundry"**, which
supersedes Bulletin No. 1 Rev. B (warm paper stock, copper, the Wayfinding Ramp, didone
display, serif body). If a prompt, document or old artefact specifies paper stock or copper,
it is out of date — use this.

Applies to **every** visual artefact produced in or for this repo: the eight surfaces, the
component library, marketing pages, dashboards, diagrams, decks, partner screenshots. No
exemption for "quick" or "internal" work — the point of a livery is that it is not
re-decided per artefact.

## Precedence — read this first

1. **`packages/tokens/` is the source of truth.** Every value in it is measured by
   `packages/tokens/src/css.test.ts` and `figures.test.ts` against every ground it is
   permitted on. If this file and the tokens disagree, **the tokens win** and this file is
   the bug — fix it here and re-run `node tools/ci/emit-surfaces.ts`.
2. **`docs/BRAND.md` is generated.** Never hand-edit it. Edit the tokens, run the emitter.
3. **This skill outranks the generic design skills** — `ui-ux-pro-max:design-system`,
   `design:design-system`, `frontend-design`, `bencium-innovative-ux-designer`,
   `anthropic-skills:theme-factory` and the like. Use them for method if you want; take no
   colour, type, radius or spacing value from them. There is no second palette in this repo.
4. The personal-scope `rankine-house-style` skill is the same bulletin written for artefacts
   outside this repo. It has drifted from the tokens — see **Drift** at the bottom. Inside
   this repo, this file and the tokens govern.

## Never hard-code a value

Tier 1 primitives are referenced by **nothing** outside tier 2. A component that reaches into
`PRIMITIVES` has hard-coded a colour, and a hard-coded colour cannot be re-pointed for a
white-label tenant. Consume the semantic roles as CSS custom properties.

`cssVar()` maps a token to its variable by replacing dots with dashes, so
`color.status-breached` → `var(--color-status-breached)`. A reviewer can go from any
stylesheet back to `semantic.ts` without a lookup table. Use these names — `--stock`,
`--panel`, `--arc` and `--ink` are **not** variables in this repo.

## The two accent layers — both red since Rev C (2026-10-22)

|  | Brand layer | Instrument layer |
|---|---|---|
| Accent | `--color-brand` `#D91F11` | `--color-action` `#D91F11` |
| Where | Wordmark, livery, badge, app icon, S1 marketing, a poster with no state legend | Every control and highlight on every surface (S1–S8), and any chart or diagram carrying status |
| Renders a state ramp | No | Yes |
| Declared by | `stateRamp: false` in the surface registry | the default |

**The fault is garnet, not red.** Bulletin 2 as issued drew the fault in oxide `#A32318`,
0.55° from the house red, so red was barred from every surface that showed state and the
interface ran on a cyan arc. Rev C moved the **fault**: `--color-status-breached` is garnet
`#9C1F6E`. Red now measures **42.12°** from it and **35.32°** from its nearest state hue, the
warning amber — clear of the 30° gate — so it is the instrument accent everywhere.

The brand roles keep their surface fence (`tokenCss` resolves them to Ink Black where a state
ramp renders): it is the mechanism a tenant accent that fails the gate still falls behind,
and the house goes through the same gate. A surface that forgets to declare renders in the
neutral.

## Light stock

| Role | Value | Note |
|---|---|---|
| `--color-page` | `#E6EBF0` | page ground; panels sit on it |
| `--color-surface` | `#F3F6F9` | panels, rows |
| `--color-surface-sunken` | `#D4DCE4` | table heads, status bars, wells — **measure every ink against this**, not white |
| `--color-border` | `#B3BFC9` | decorative hairline; does NOT carry shape (E-08) |
| `--color-border-hard` | `#8695A2` | plate heads, the rule under a table head. Still decorative |
| `--color-text` | `#0E1418` | body, rules, marks. A cold near-black, never pure |
| `--color-text-muted` | `#3C4A55` | muted text. `ink.light` is 3.27:1 here and is a non-text rule only (E-07) |
| `--color-action` | `#D91F11` | the red **fill**, 3.65:1. Never a word under 24px |
| `--color-action-ink` | `#FFFFFF` | the label on the red fill, 5.05:1 — fixed in both themes because the fill is fixed |
| `--color-action-text` | `#A81208` | every red word under 24px, every rule, 5.50:1 |
| `--color-action-pressed` | `#A81208` | a press deepens to the text-safe red; the white label reads 7.62:1 on it |
| `--color-focus-ring` | `#0A4F66` | the arc envelope — never themeable, and in a hue no control is painted in |
| `--color-brand` | `#D91F11` | brand layer only |
| `--color-brand-ink` | `#FFFFFF` | |
| `--color-brand-text` | `#A81208` | any red word under 24px, brand layer only |
| `--color-status-ok` | `#0E6A46` | **state only** — never emphasis, never a chart series |
| `--color-status-at-risk` | `#7E5300` | state only |
| `--color-status-breached` | `#9C1F6E` | state only — garnet, 5.35:1 on the sunken ground |
| `--color-status-blocked` | `#3C4A55` | state only |
| `--color-status-breached-fill` | `transparent` | in the light stock a fault is an outline chip |

The arc — envelope `#0A4F66`, core `#7FE9FF` — survives as the focus ring alone. A focus ring
in a hue no control is painted in is easier to find, not harder.

## The plate — the dark schedule, a region not a theme

**Rev D (2026-10-27): the field tier is on the light stock.** S5 keeps every field-density
rule — 56px targets, 18px body, 3px focus, no hover — and wears the light stock's inks, all
measured against `--color-surface-sunken` like every other surface. Dark ink on a light ground
holds up under glare on a glossy tablet; an emissive dark ground washes out to the
reflection. The dark schedule below is now **the plate's alone**: `data-ground="plate"` puts
a region on it inside a light frame (the dispatch board's header bar), and
`contrastFailures("plate")` measures it as a ground of its own. It is not a theme a viewer
picks, and a surface does not switch to it wholesale.

page `#080D11` · surface `#111A20` · sunken `#050A0D` · border `#253039` ·
border-hard `#55636F` · text `#E4ECF2` · text-muted `#91A1AE` (labels and units only, never
a value) · action `#D91F11` (3.48:1, a fill) · action-ink `#FFFFFF` · action-text and
brand-text `#F4796C` (6.54:1 — the red word here) · action-pressed `#A81208` · focus ring
`#7FE9FF` · ok `#5FD39B` · at-risk `#E8B23C` · breached `#E4ECF2` (the **word**) ·
breached-fill `#7A2A5E` garnet, the plate's only solid chip (frost on it 7.58:1).

State is encoded in **form** first — outline-mute nominal, outline-bright warning, solid
fault — and hue only confirms. Greyscale the plate and the order still reads. E-14: the
breached word here is the same cream as body copy, correctly, because state has moved into
form; a banner that draws its mark and rule in that role and carries **no fill** renders its
alarm in body-copy cream. Use all three channels.

## The accent gate — the only test a category colour has to pass

Any accent, house or tenant, clears **≥30° hue separation from every state ink**, in both
themes. Copper failed it and needed a written exemption; that is why it is gone.

A tenant accent inside the state range does not break the theme — it converts decoration into
apparent state, and a dispatcher who has learned that red-ish means breached will read a
tenant logo as an alarm. The gate is implemented in `packages/tokens/src/whitelabel.ts`; the
state ramp, the focus ring and the structural tokens are **not** in `BRAND_OVERRIDABLE`,
because a themeable focus ring is an accessibility regression shipped under someone else's
logo and a themeable state ramp is an instrument a tenant re-keyed.

Two traps the gate has already fallen into: `hueOf` returns 0° for any grey, so check
`isAchromatic` before believing a hue (E-16); and every tier gated at 4.5:1 rejects any fill,
including our own, because the semantic tier spends three roles separating fill from word
(E-15). Gate a fill at the fill's threshold.

When an artefact needs more than one category colour, derive the extra slots from the arc's
blue hue family — the far side of the wheel from red, garnet and amber — and check each against the gate before use. Do not reach for a rainbow.

## The four rules that make it safe

1. **Colour is state or category, never both on one artefact's legend.** If a legend entry
   reads like a state — breached, overdue, healthy — it is one. Use the state ink.
2. **A fill colour never sets a word.** A red word under 24px takes `--color-action-text`
   (or `--color-brand-text` on the brand layer); the label on a red fill takes
   `--color-action-ink`. A variant that repaints its fill on `:active` without repainting its
   ink pressed its own label to 1.00:1 (E-11) — carry both or neither.
3. **Colour never carries alone.** Every state carries a word; every category carries a
   second channel — a number, a label, or a line form. The marks are `● ▲ ■ ✕`, and they must
   be in the subset (E-13).
4. **Red never decorates a state chip** — clearing the gate is not a licence to paint a
   status column — the brand roles stay on the brand layer, and `--color-action` is never
   body text.

## Type

One family, four cuts, plus a script with exactly one job.

| Role | Face | Where |
|---|---|---|
| Wordmark | **Yellowtail** | The masthead lockup and nothing else. 28px floor. Never in an interface |
| Display | **IBM Plex Sans Condensed** | Plate titles, buttons, headings. Caps only on a fixed label (a plate title) — never on a title that carries a name, because `text-transform` changes what is copied and read back |
| Label | **IBM Plex Sans** | Descriptors, eyebrows, the company line — caps at `--track-wide` `0.14em` and up |
| Text | **IBM Plex Sans** | Body copy, prose, contracts |
| Instrument | **IBM Plex Mono** | Every numeral in the company, without exception |

The one rule that does most of the work: **every number in the company** — SLA timers,
staleness clocks, job numbers, gauge readings, invoice totals, tonnage, CFM — is set in the
instrument face with tabular figures. Digits that hold their column are the entire effect.

The script is a **mark, not a typeface**; the `°R` monogram is the app icon and patch, and
carries every size the script cannot. The **favicon and the masthead mark are not the badge**:
both are a yard model turning in a livery-red glow that fades to nothing — no hard edge — the truck on S5, the rooftop unit
on every other surface — turned on one timer by `packages/ui/src/favicon.ts` (`FAVICON` and
`faviconArtFor` in `brand.ts`, art in `packages/tokens/icons/`, rendered from S1's own models
by `tools/icons/`). Each art also ships a 180px `apple-touch-icon.png`, without which iOS
draws a letter tile. `°R` is a real unit of measurement —
degrees Rankine — so it is a credential, not an ornament, and the ring precedes the letter
because `°R` is one indivisible symbol. `badgeSvg()` names **no** font family: an icon is
fetched before any stylesheet, so on a machine without the face the mark silently becomes a
different mark (E-17).

**Self-host, subset and pin — never a CDN.** The tier that most depends on aligned digits is
the tier least likely to have a network, and a failed request degrades silently on the
surface where being wrong costs the most. `tools/ci/schema-guard.ts` fails any surface that
reaches a third-party font host.

Declare `font-variant-numeric: tabular-nums` at the root — and never set `body`'s font with
the **`font` shorthand**, which resets every `font-variant-*` longhand to initial and
inherits `normal` to the whole document (E-12/E-09). End the instrument stack
`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` so columns hold when no face
loads at all.

## Density — three tiers, and the type scale moves with them

| Tier | Where | Control | Row | Body | Focus | Hover | Ground |
|---|---|---|---|---|---|---|---|
| Console | S2, S3, S4 | 36px | 32px | 14px | 2px | yes | light |
| Comfort | S1, S6, S7, S8 | 44px | 40px | 15px | 2px | yes | light |
| Field | S5, the tablet | 56px | 56px | 18px | 3px | **no** | light (Rev D) |

Three densities because there are three ergonomics problems. A dispatcher scanning forty rows
with a mouse and a technician tapping with gloves in direct sun are opposite requirements;
averaging them serves neither, and the component library that pretends otherwise produces a
field app crews work around with paper.

**The type scale is part of the density, not a constant the densities share** (E-12). A
bigger hit box around console type is just a console button with a bigger hit box. Field
floors at 15px — the smallest uppercase instrument label that survives a roof at 2pm. In the
field tier there is no cursor, so a hover-only affordance is an invisible control: press is
`:active`.

**Type ramp — Rev B (2026-10-22).** Each step above body opens by roughly 1.2–1.25, so a
caption, body and a panel title never read as one size. `TYPE_SCALE` in
`packages/tokens/src/density.ts` is the schedule:

| Tier | xs | sm | md (body) | lg | xl | display | mast |
|---|---|---|---|---|---|---|---|
| Console | 11 | 12 | 14 | 16 | 20 | 26 | 36 |
| Comfort | 11 | 13 | 15 | 18 | 22 | 28 | 40 |
| Field | 15 | 17 | 18 | 23 | 28 | 36 | 50 |

The mast step is sized against the company line, not the ramp: the wordmark's lowercase
body (Yellowtail x-height 0.375 em) stands at least **1.75×** the company line's caps (Plex
Sans 600, 0.698 em), so mast ≥ 3.26 × xs on every tier. `css.test.ts` holds it.

Console xs and sm stay 1px apart because xs is set in caps at `--track-wide`: form separates
them where size cannot.

**Corners and elevation — Rev A (2026-09-27), tightened by Rev B (2026-10-22).** The
partners adopted the field-ops reference layout (`Work/AC Services/artifacts/dispatch board
visualuizer.html`) for its page structure and shape, with every colour unchanged. Rev B keeps
that structure and machines the shape: the corners tighten and the soft spread becomes a 1px
edge. The system draws rounded corners at exactly three steps and one tight elevation:

| Token | Value | Where |
|---|---|---|
| `--radius-control` | 4px | inputs, buttons, a segmented tab, a stat tile's inner well |
| `--radius-card` | 6px | a panel, a stat tile, a card, a table's container, the segmented control's track |
| `--radius-pill` | 999px | a status chip, a filter chip — nothing else |
| `--radius-none` | 0px | rules and plates that are straight on purpose: the masthead rule, a table head |
| `--elevation-card` | `0 1px 0` | a panel or tile on the page ground: a 1px edge, no spread |
| `--elevation-raised` | `0 1px 2px` | the selected segment of a segmented control |

A shadow is never a new ink: it is the tier's darkest role mixed to a few per cent
(`color-mix(in srgb, var(--color-text) 10%, transparent)` on the light stock, the sunken well
on the plate). `icon` 8px and `app` 16px stay artwork primitives and are not emitted
to a surface. Do not invent a fourth radius or a second shadow.

**Widths.** A measure is a line length, set in `ch` so it scales with the density's type;
a layout width is the page or a column. Nothing in a surface sheet types either —
`sheet-audit` fails a literal `max-width` or auto-fit tile minimum.

| Token | Value | Where |
|---|---|---|
| `--measure-cell` | 30ch | a one-line preview cut short inside a row (a job's latest note) |
| `--measure-narrow` | 40ch | a sign-in card |
| `--measure-short` | 48ch | a confirmation, a short public line |
| `--measure-text` | 64ch | running text, a form, a refusal, a page-head lede |
| `--page-max` | 1400px | the page and the masthead |
| `--column-side` | 20rem | a list or a job column beside the work |
| `--column-rail` | 14rem | a rail of row labels (the dispatch board's technicians) |
| `--label-min` | 7rem | a label column (a stacked grid's labels, a trace) |
| `--tile-min` / `--tile-wide` | 18ch / 28ch | an auto-fit grid of figures (stat tiles) / of text or charts (facts, trends) |

Breakpoints stay literal, because a media query cannot read a variable. A data column's own
minimum (a date, an amount) sizes to its content and stays where it is.

The page structure that comes with Rev A: a **page head** (the screen's name and one plain
sentence of what it is for), a **stat strip** of tiles where a screen has figures worth
leading with, content in **panels**, tables inside a panel, and navigation as a
**segmented control** (a card-radius track with the current screen raised).

Accent rules are 3px and sit on the **top** edge; a coloured left border is not part of this
system. No backdrop blur, no gradient meshes, no blurred blobs, no emoji.

**Motion is a token.** `--motion-fast` 110ms, `--motion-base` 170ms, `--motion-slow` 260ms, all
on `--ease` `cubic-bezier(.2,.6,.3,1)`, emitted by `tokenCss` to every density. A transition
names those variables and never a number; a control's state change moves and data does not
(no entrance animation, no keyframes); and `prefers-reduced-motion: reduce` stills every
control that moves. The turning favicon and masthead mark are brand-layer artwork, not interface, and are the
one loop the system runs; they obey the same rule and rest on their first frame under reduced motion. `styles.test.ts` checks all three.

Never use `all: unset` on a control. It ties `:focus-visible` on specificity `(0,1,0)`, is
declared later, and the cascade resolves per property rather than per state — which computed
`outline-style: none` on the dispatch board's only keyboard control while it was focused
(E-10, WCAG 2.4.7).

## Audit before handing over — run it, don't eyeball it

Parse the artefact's own markup and check every colour mechanically. On the first sheet built
to the previous style, eyeballing passed while a parse found 43 rule-2 violations and a
generator bug that had rendered a Python tuple into a CSS colour. On this style's own token
set, a parse caught six pairs under threshold that had been ratified by eye.

- Every hex appears in the tables above — anything else is an unsanctioned ink.
- No fill-class colour setting a word; no `--color-action` or `--color-brand` word under 24px.
- Body ≥4.5:1, marks and rules ≥3:1, **measured against `--color-surface-sunken`** — and in
  every theme the artefact offers, not just the one you are looking at.
- Every accent ≥30° from every state hue, both themes, `isAchromatic` checked first.
- Greyscale check: does the state order still read with hue removed?
- `brandCss` emits a **scoped** block — an unscoped `:root{}` applies light-stock overrides
  to the field frame, where `--color-text` is cream (E-16).
- Print: no dark flood fills, no hairlines that vanish, body ≥12pt at reading distance.
- Every surface stylesheet and `UI_CSS` are **parsed** by `sheetViolations`
  (`packages/tokens/src/audit.ts`, run by `tools/ci/sheet-audit.test.ts` under `guard:test`): a
  fill role setting a word, a fill role drawing a rule, type in px under the density's floor,
  and a surface redeclaring the chrome `packages/ui` draws — `.ac-nav`, `.ac-link`, `.ac-form`,
  `.ac-field`, `.ac-input`, `.ac-notice`, `.ac-facts`. A surface arranges these; it does not
  redraw them, and a refusal outside the console is `RefusalNotice`, not markup.
- In-repo: `npm run guard:all`, `npm run test:ui`, `npm run surfaces:check`.
- Say in one line what you matched, and name any value you derived rather than took from the
  bulletin, with its measurement.

## Drift — where the personal `rankine-house-style` skill disagrees

It is written for artefacts outside this repo and has not tracked the tokens. Inside this
repo the tokens govern; these are the known deltas, and a fix belongs in
`packages/tokens/` first.

| | Personal skill | This repo (authoritative) |
|---|---|---|
| Light `border-hard` | `#717D88` | `#8695A2` — **settled, do not change.** E-08 was closed by fencing the role, not by repainting it: a chip's rule is drawn in the state's own ink, and `color.border*` stays openly decorative. The skill fixed the colour; the repo fixed the usage. Repainting it fails `figures.test.ts`. |
| Field `border-hard` | `#5A6873` | `#55636F` |
| A `rule-soft` `#CBD4DC` | present | no such primitive |
| Label tracking | `+0.28em` | `--track-wide` `0.14em` and up |
| Corners | 2 / 3 / 5 / 8px | **Rev B:** 4px control, 6px card, pill for chips only; 0px for rules and plates |
| Red ↔ fault separation | 1.2° | **Rev C:** 42.12° from the garnet fault. (0.55° from the oxide fault before Rev C; `1.2` was a hand-carried figure, corrected by E-21.) |
| Fault ink | oxide `#A32318` | **Rev C:** garnet `#9C1F6E`; field fill `#7A2A5E` |
| Instrument accent | arc `#00A3D9` | **Rev C:** red `#D91F11`; the arc is the focus ring only |
| Field row height | 48px | 56px |
| Console row / body | 28px / 13px | **Rev B:** 32px / 14px |
| Variable names | `--stock`, `--panel`, `--arc`, `--ink` | `--color-*`, from `cssVar()` |
