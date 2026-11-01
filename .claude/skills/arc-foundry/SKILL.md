---
name: arc-foundry
description: The design system for this repository. Use for ANY visual or front-end work here — a surface in apps/s1–s8, a component in packages/ui, a token in packages/tokens, a chart, diagram, deck, poster, screenshot or doc produced for Rankine Operating Company / AC Services. Covers the two accent layers, the accent gate, grounds and inks, type, density and the pre-handover audit. Overrides every generic design skill.
---

# Arc Foundry — the design system for `ac-services-systems`

Rankine Operating Company, Identity Standards **Bulletin No. 2, "Arc Foundry"**. It
supersedes Bulletin No. 1 (paper stock, copper, didone display): anything specifying those is
out of date. It applies to **every** visual artefact in or for this repo, including "quick" and
"internal" ones.

## Precedence

1. **`packages/tokens/`** is the source of truth, measured by `css.test.ts` and
   `figures.test.ts`. If this file disagrees, the tokens win and this file is the bug.
2. **`docs/generated/BRAND.md`** is generated from the tokens and lists **every colour value** for both
   grounds. Never hand-edit it; change a token and run `node tools/ci/emit-surfaces.ts`.
3. This skill outranks the generic design skills. Take method from them, never a colour,
   type, radius or spacing value.
4. The personal `rankine-house-style` skill has drifted (old corners, tracking, oxide fault,
   cyan accent, `--stock`/`--arc` names). Inside this repo, ignore its values.

## Never hard-code a value

Nothing outside tier 2 references `PRIMITIVES`; a hard-coded colour cannot be re-pointed for a
white-label tenant. Consume semantic roles as CSS variables: `cssVar()` turns
`color.status-breached` into `var(--color-status-breached)`. `--stock`, `--panel`, `--arc`
and `--ink` do not exist here.

## Accents — red on both layers (Rev C)

- **Brand layer** (`--color-brand*`): wordmark, livery, badge, app icon, S1 marketing, a
  poster with no state legend. Declared with `stateRamp: false` in the surface registry;
  `tokenCss` resolves brand roles to Ink Black where a state ramp renders.
- **Instrument layer** (`--color-action*`): every control and highlight on S1–S8, and any
  chart or diagram carrying status. The default.
- **The fault is garnet** (`--color-status-breached`), 42° from the red, so red clears the
  gate everywhere.

## Grounds — values in `docs/generated/BRAND.md`

**Light stock** is every surface, including S5 since Rev D. What the tables don't say:

- Measure every ink against `--color-surface-sunken`, not white.
- `--color-border` and `--color-border-hard` are decorative and never carry shape (E-08); a
  chip's rule is drawn in the state's own ink.
- `--color-action` is the red **fill** — never a word under 24px. Red words under 24px and red
  rules take `--color-action-text` (`--color-brand-text` on the brand layer); the label on a
  red fill takes `--color-action-ink`.
- `--color-status-*` are **state only** — never emphasis, never a chart series. In the light
  stock a fault is an outline chip.
- The focus ring (the arc, `#0A4F66` / `#7FE9FF`) is never themeable and no control is painted
  in its hue.

**The plate** (`data-ground="plate"`) is a dark region inside a light frame — the dispatch
board's header bar — measured by `contrastFailures("plate")`. It is not a theme and a surface
never switches to it wholesale. `text-muted` there is for labels and units, never a value.
State is in **form** first — outline-mute nominal, outline-bright warning, solid garnet fault —
and hue only confirms; greyscale it and the order still reads. The breached word is body-copy
cream, so a fault must carry its fill (E-14): use all three channels.

## The accent gate

Any accent, house or tenant, is **≥30° in hue from every state ink**, in both grounds.
Implemented in `packages/tokens/src/whitelabel.ts`; the state ramp, focus ring and structural
tokens are not in `BRAND_OVERRIDABLE`. Check `isAchromatic` before trusting `hueOf` (greys
return 0°, E-16), and gate a fill at the fill's threshold, not 4.5:1 (E-15). Extra category
colours come from the arc's blue family, each checked against the gate — never a rainbow.

## Four rules

1. **Colour is state or category, never both on one legend.** An entry that reads like a state
   is one — use the state ink.
2. **A fill colour never sets a word.** A variant that repaints its fill on `:active` repaints
   its ink too (E-11).
3. **Colour never carries alone.** Every state has a word; every category a number, label or
   line form. The marks `● ▲ ■ ✕` come from `ac-marks.woff2` (declared under every Plex
   family), never a fallback font (E-13).
4. **Red never decorates a state chip**, brand roles stay on the brand layer, and
   `--color-action` is never body text.

## Type

Faces are in `docs/generated/BRAND.md`: Yellowtail (wordmark only, 28px floor, never in an interface),
Plex Sans Condensed (display), Plex Sans (label, text), Plex Mono (instrument).

- **Every number** — timers, job numbers, readings, totals — is Plex Mono with tabular figures.
- Caps only on a fixed label, never on a title carrying a name. Labels track at
  `--track-wide` `0.14em` and up.
- Declare `font-variant-numeric: tabular-nums` at the root, and never set `body` with the
  `font` shorthand, which resets it (E-12/E-09). End the mono stack
  `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- **Self-host, subset, pin — never a CDN.** `tools/ci/schema-guard.ts` fails a third-party
  font host.
- The `°R` monogram is the app icon and patch; `badgeSvg()` names no font family (E-17). The
  favicon and masthead mark are a different thing: a yard model turning in a red glow, driven
  by `packages/ui/src/favicon.ts` (`FAVICON`, `faviconArtFor` in `brand.ts`), each with a
  180px `apple-touch-icon.png`.

## Density

| Tier | Where | Control | Row | Body | Focus | Hover |
|---|---|---|---|---|---|---|
| Console | S2, S3, S4 | 36px | 32px | 14px | 2px | yes |
| Comfort | S1, S6, S7, S8 | 44px | 40px | 15px | 2px | yes |
| Field | S5, the tablet | 56px | 56px | 18px | 3px | **no** — press is `:active` |

The type scale moves with the tier (E-12): use `TYPE_SCALE` in
`packages/tokens/src/density.ts`, never one scale for all three. Field floors at 15px.

**Shape (Rev B).** `--radius-control` 4px (inputs, buttons, segments), `--radius-card` 6px
(panels, tiles, cards, table containers), `--radius-pill` (chips only), `--radius-none` (rules,
table heads). `--elevation-card` is a 1px edge, `--elevation-raised` the selected segment; a
shadow is `--color-text` mixed to ~10%. No fourth radius, no second shadow.

**Widths.** Use `--measure-*` (in `ch`: cell 30, narrow 40, short 48, text 64), `--page-max`,
`--column-side`, `--column-rail`, `--label-min`, `--tile-min` / `--tile-wide`. `sheet-audit`
fails a literal `max-width` or tile minimum. Breakpoints stay literal.

**Page structure (Rev A).** A page head (name plus one sentence), a stat strip where figures
lead, content in panels, tables inside panels, navigation as a segmented control. Accent rules
are 3px on the **top** edge — no coloured left border, no blur, no gradient meshes, no emoji.

**Motion.** Transitions name `--motion-fast` / `-base` / `-slow` on `--ease`, never a number.
Controls move, data doesn't (no entrance animation, no keyframes), and
`prefers-reduced-motion` stills everything, including the turning favicon.

Never `all: unset` on a control — it kills `:focus-visible` (E-10, WCAG 2.4.7).

## Audit before handing over — parse, don't eyeball

- Every hex appears in `docs/generated/BRAND.md`; anything else is an unsanctioned ink.
- No fill role setting a word; no `--color-action` / `--color-brand` word under 24px.
- Body ≥4.5:1, marks and rules ≥3:1 against `--color-surface-sunken`, in every ground offered.
- Every accent ≥30° from every state hue, `isAchromatic` checked first.
- Greyscale: the state order still reads.
- `brandCss` emits a **scoped** block, never bare `:root{}` (E-16).
- Print: no dark floods, no vanishing hairlines, body ≥12pt.
- `sheetViolations` (`packages/tokens/src/audit.ts`) parses every surface sheet and `UI_CSS`. A
  surface arranges `packages/ui` chrome (`.ac-nav`, `.ac-link`, `.ac-form`, `.ac-field`,
  `.ac-input`, `.ac-notice`, `.ac-facts`) and never redraws it; a refusal outside the console
  is `RefusalNotice`.
- Run `npm run guard:all`, `npm run test:ui`, `npm run surfaces:check`.
- Say in one line what you matched, and name any derived value with its measurement.
