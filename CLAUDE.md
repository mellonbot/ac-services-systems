# Working in this repository

## Name a pull request after what it changes

A PR title is the only part of a change most people ever read. Write one that
says what the change does, in the same voice as the commit subjects:

- **Good** — `Brand: Bulletin No. 2 — Arc Foundry: cold palette, two accent layers`
- **Bad** — `Claude/site design branding rksmnj`, `Update files`, `WIP`

Never let GitHub title a PR for you. When a branch has more than one commit
GitHub falls back to the **branch name**, and a change nobody can identify is a
change nobody reviews — a full rebrand once sat unmerged behind exactly that
title while `main` moved past it and the branch went red.

Give every PR a body too: what changes, why, and how it was verified.

`.github/workflows/pr-title.yml` repairs a machine-written title after the fact,
but it is a safety net and not a substitute. It rewrites a title **only** when
GitHub wrote it — the branch name spelled out, a subject truncated at 72
characters, or an empty title — and never touches one a person typed. If a
title is deliberately not a summary of its commits, it is left alone; see the
`DEMO:` pull requests, where an innocuous commit subject is the point.

## Arc Foundry is the design system — there is no second palette

Every visual decision in this repository comes from **Arc Foundry**, Identity Standards
Bulletin No. 2. Before any front-end or visual work — a surface in `apps/s1`–`s8`, a
component in `packages/ui`, a token, a chart, a diagram, a deck, a screenshot for a partner —
read `.claude/skills/arc-foundry/SKILL.md`. It is a skill, so it loads by name: **arc-foundry**.

The order of authority, when two sources disagree:

1. `packages/tokens/` — the values, measured by `css.test.ts` against every ground they are
   permitted on. This wins over everything, including the skill.
2. `.claude/skills/arc-foundry/SKILL.md` — the rules the values exist to serve: the two
   accent layers, the accent gate, form-before-hue, the type and density schedules.
3. `docs/BRAND.md` — **generated**. Never hand-edited. Change a token, then run
   `node tools/ci/emit-surfaces.ts`.

The generic design skills — `ui-ux-pro-max:design-system`, `design:design-system`,
`frontend-design`, `bencium-innovative-ux-designer`, `theme-factory` — are subordinate here.
Borrow method from them if it helps; take **no** colour, type, radius or spacing value. A
value that arrives from anywhere but `packages/tokens/` is an unsanctioned ink, and the
audit at the end of the skill exists to catch it before a reviewer does.

Two consequences worth stating on their own, because both have already cost us a surface:
a component that reaches into `PRIMITIVES` has hard-coded a colour, and a hard-coded colour
cannot be re-pointed for a white-label tenant — consume the semantic roles. And nothing is
signed off by eye: parse the artefact and measure it, against `--color-surface-sunken` and in
every theme it offers.
