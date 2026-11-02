# 27 — Arc Foundry Rev A: the reference layout on every surface

2026-09-28. Branch `item-12-reference-redesign` (on top of item 11).

## The brief

Redesign every built surface to the feel of the field-ops reference
(`Work/AC Services/artifacts/dispatch board visualuizer.html`): its page
structure and shape, with every colour unchanged. The partners chose rounded
corners and soft shadows (a written revision of the design system), all
surfaces in one pass, and the repo's IBM Plex faces kept.

## What changed

- **Tokens (`packages/tokens`).** Three drawn radii — `--radius-control` 8px,
  `--radius-card` 12px, `--radius-pill` — beside `--radius-none`, and two
  elevations, `--elevation-card` and `--elevation-raised`. A shadow is never a
  new ink: it is Ink Black mixed to a few per cent on the light stock and the
  sunken well on the field ground. `icon`/`app` radii stay artwork-only.
  `css.test.ts` pins all of it.
- **Design system.** `.claude/skills/arc-foundry/SKILL.md` records Rev A: the
  radius/elevation table, the page structure, and the drift row.
- **Components (`packages/ui`).** Pills are pills with a soft fill of the
  state's own ink (form still orders the states: ok fill only, at-risk
  outlined, breached solid-outlined; oxide on the field ground). Buttons are
  rounded and sentence case. The data grid is a rounded card with a quiet
  head. Refusals are cards with a 3px top rule. New shared rules and helpers:
  `pageHead`, `statStrip`, `.ac-panel`, `.ac-seg`, `.ac-chip`.
- **Surfaces.** Every nav is a segmented control. Landing screens lead with a
  page head (name + one sentence) and, where figures lead, a stat strip: S3
  board (open, unassigned, at risk, crews out — and a Site column), S5 shift,
  S6 sites, S7 orders. Forms, facts and summaries sit in cards. S6 Work shows
  each request as a card with the reference's five-step stepper
  (Requested → Scheduled → In progress → Completed → Invoiced), in the
  customer's words.

## Proof

guard:test 322, test:ui 155 (layout helpers, stepper mapping, updated S6
Work assertions), token tests 43, schema guard, generated files current;
integration 153/153 and the four browser drives on a fresh Postgres 16 — the
S6 drive's two checks that read the old table wording and upper-case button
text were updated to the new ones.
