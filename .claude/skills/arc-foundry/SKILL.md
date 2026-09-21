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

## The two accent layers — settle this before choosing any colour

|  | Brand layer | Instrument layer |
|---|---|---|
| Accent | `--color-brand` `#D91F11` | `--color-action` `#00A3D9` |
| Where | Wordmark, livery, badge, app icon, S1 marketing, a poster with no state legend | Every console, dashboard, portal and tablet surface (S2–S8), and any chart or diagram carrying status |
| Renders a state ramp | No | Yes |
| Declared by | `stateRamp: false` in the surface registry | the default |

Brand red measures **0.55°** from the fault ink `#A32318`. No bright red clears the accent
gate's 30°, and there is nowhere to move it: the band between the fault at 4.75° and the
warning at 39.52° is 34.78° wide. So red is not rejected — **the slot is.** Red is admitted
exactly where a colliding tenant accent is admitted, and barred everywhere a state ramp
renders, where `tokenCss` resolves the brand roles to Ink Black.

A surface that forgets to declare renders in the neutral: the unsafe direction requires an
explicit opt-in. We do not hold a tenant to a rule the house exempts itself from.

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
| `--color-action` | `#00A3D9` | the arc **fill**, 2.09:1. Never a word |
| `--color-action-ink` | `#0E1418` | the label on an arc fill, 6.40:1 — fixed in both themes because the fill is fixed |
| `--color-action-text` | `#0A4F66` | every arc word under 24px, every rule, 6.52:1 |
| `--color-action-pressed` | `#7FE9FF` | a press brightens toward the core |
| `--color-focus-ring` | `#0A4F66` | never themeable |
| `--color-brand` | `#D91F11` | brand layer only |
| `--color-brand-ink` | `#FFFFFF` | |
| `--color-brand-text` | `#A81208` | any red word under 24px, brand layer only |
| `--color-status-ok` | `#0E6A46` | **state only** — never emphasis, never a chart series |
| `--color-status-at-risk` | `#7E5300` | state only |
| `--color-status-breached` | `#A32318` | state only |
| `--color-status-blocked` | `#3C4A55` | state only |
| `--color-status-breached-fill` | `transparent` | in the light stock a fault is an outline chip |

The arc is three steps at **one hue** — envelope, fill, core — because an arc has a cooler
envelope and a hot core. That is the phenomenon, not decoration: three steps without breaking
Rule One, which a second decorative hue would have broken.

## Field ground — fixed, never themed

Not a dark theme. A **second substrate**: the tablet is read on a roof at 2pm in July, so
this ground does not follow the viewer's preference, and it is computed rather than
re-pointed because a light ramp measured here fails outright — and the worst failure is
always the most urgent state.

page `#080D11` · surface `#111A20` · sunken `#050A0D` · border `#253039` ·
border-hard `#55636F` · text `#E4ECF2` · text-muted `#91A1AE` (labels and units only, never
a value) · action `#00A3D9` · action-ink `#0E1418` · action-text and focus ring `#7FE9FF`
(12.58:1 — the accent here) · brand-text `#F4796C` · ok `#5FD39B` · at-risk `#E8B23C` ·
breached `#E4ECF2` (the **word**) · breached-fill `#7A2A2E`, the tier's only solid chip.

State is encoded in **form** first — outline-mute nominal, outline-bright warning, solid
fault — and hue only confirms. Greyscale the tier and the order still reads. E-14: the
breached word here is the same cream as body copy, correctly, because state has moved into
form; a banner that draws its mark and rule in that role and carries **no fill** renders its
alarm in body-copy cream on the one surface read in sunlight. Use all three channels.

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
hue family and check each against the gate before use. Do not reach for a rainbow.

## The four rules that make it safe

1. **Colour is state or category, never both on one artefact's legend.** If a legend entry
   reads like a state — breached, overdue, healthy — it is one. Use the state ink.
2. **A fill colour never sets a word.** An arc word takes `--color-action-text`; a red word
   under 24px takes `--color-brand-text`; the label on an arc fill takes
   `--color-action-ink`. A variant that repaints its fill on `:active` without repainting its
   ink pressed its own label to 1.00:1 (E-11) — carry both or neither.
3. **Colour never carries alone.** Every state carries a word; every category carries a
   second channel — a number, a label, or a line form. The marks are `● ▲ ■ ✕`, and they must
   be in the subset (E-13).
4. **Brand red never enters a state-bearing artefact**, and `--color-action` is never body
   text.

## Type

One family, four cuts, plus a script with exactly one job.

| Role | Face | Where |
|---|---|---|
| Wordmark | **Yellowtail** | The masthead lockup and nothing else. 28px floor. Never in an interface |
| Display | **IBM Plex Sans Condensed** | Plate titles, buttons, headings |
| Label | **IBM Plex Sans** | Descriptors, eyebrows, the company line — caps at `--track-wide` `0.14em` and up |
| Text | **IBM Plex Sans** | Body copy, prose, contracts |
| Instrument | **IBM Plex Mono** | Every numeral in the company, without exception |

The one rule that does most of the work: **every number in the company** — SLA timers,
staleness clocks, job numbers, gauge readings, invoice totals, tonnage, CFM — is set in the
instrument face with tabular figures. Digits that hold their column are the entire effect.

The script is a **mark, not a typeface**; the `°R` monogram is the badge, favicon, app icon
and patch, and carries every size the script cannot. `°R` is a real unit of measurement —
degrees Rankine — so it is a credential, not an ornament, and the ring precedes the letter
because `°R` is one indivisible symbol. `badgeSvg()` names **no** font family: a favicon is
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
| Console | S2, S3, S4 | 36px | 28px | 13px | 2px | yes | light |
| Comfort | S1, S6, S7, S8 | 44px | 40px | 15px | 2px | yes | light |
| Field | S5, the tablet | 56px | 56px | 18px | 3px | **no** | dark |

Three densities because there are three ergonomics problems. A dispatcher scanning forty rows
with a mouse and a technician tapping with gloves in direct sun are opposite requirements;
averaging them serves neither, and the component library that pretends otherwise produces a
field app crews work around with paper.

**The type scale is part of the density, not a constant the densities share** (E-12). A
bigger hit box around console type is just a console button with a bigger hit box. Field
floors at 15px — the smallest uppercase instrument label that survives a roof at 2pm. In the
field tier there is no cursor, so a hover-only affordance is an invisible control: press is
`:active`.

**Corners: none.** `--radius-none` is `0px` and the system draws no rounded corner anywhere.
The other two radii exist only because an OS app icon has its own substrate rules —
`icon` 8px, `app` 16px. Do not import a pill, a rounded card or a 5px control from another
system.

Accent rules are 3px and sit on the **top** edge; a coloured left border is not part of this
system. No backdrop blur, no gradient meshes, no blurred blobs, no emoji. Motion
110/170/260ms on `cubic-bezier(.2,.6,.3,1)`; no entrance animation on data.

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
| Corners | 2 / 3 / 5 / 8px | **0px everywhere**; 8px and 16px are app-icon only |
| Red ↔ fault separation | 1.2° | 0.55° — `1.2` was a hand-carried figure, corrected by E-21 (commit 157b0bb). The skill predates it. |
| Field row height | 48px | 56px |
| Variable names | `--stock`, `--panel`, `--arc`, `--ink` | `--color-*`, from `cssVar()` |
