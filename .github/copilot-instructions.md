# Working in this repository

## Platform architecture

- This is a Node 22.18+ TypeScript monorepo. TypeScript runs directly under
  Node's type stripping: use erasable syntax only (no enums, parameter
  properties, namespaces, or JSX), and use relative `.ts` imports within the
  repository.
- `packages/contracts` is the source of truth for policy and topology:
  `operations.ts` defines the operation catalogue, and `surfaces.ts` defines
  all surface metadata. The gateway route table and generated SDK derive from
  the operation catalogue.
- `services/gateway` is the sole access path to data. Only
  `services/gateway/src/db/pg-tx.ts` imports the database driver. Surface code must
  use `packages/shell`, whose gateway client is the generated SDK; never add
  direct `fetch`, database, or wire-library access in a surface, shell, or UI
  package.
- `packages/domain` is pure decision logic: it must not read the clock, RNG,
  or a `node:` module. Pass the evaluation instant explicitly. Represent money
  as minor-unit `bigint` (as strings across JSON) and quantities as integer
  thousandths.
- `packages/ui` is the renderer boundary. It alone imports Preact, htm, and
  signals. Surface templates use `html` tagged templates from `@ac/ui`, with
  components called as functions so their density contracts remain type-checked.
  Use semantic `var(--color-*)` roles; raw colour values belong only in
  `packages/tokens/src/primitives.ts`.

## Surface generation and build

- `apps/s*/{package.json,src/main.ts,frame.html,README.md}` and
  `docs/generated/SURFACES.md` are generated from `packages/contracts/src/surfaces.ts` by
  `tools/ci/emit-surfaces.ts`. Edit the registry or emitter, never a generated
  file; regenerate with `node tools/ci/emit-surfaces.ts` and confirm with
  `npm run surfaces:check`.
- An empty `<main id="mount">` in a generated frame is intentional. The bundle
  mounts into it after `node tools/ci/build-surface.ts <S#>` produces
  `apps/<surface>/dist/{index.html,bundle.js,ui.css}`. S2 owns the richer
  hand-written UI; the other surfaces use the generated status application
  until their workflows are implemented.
- For surface work, start with the surface registry, emitter, and selected
  app. Use `enabled` and `phase` to distinguish deployed behavior from a
  planned surface. Only perform cross-surface checks when the task actually
  spans all surfaces.

## Commands and validation

- Zero-install structural checks: `node tools/ci/schema-guard.ts` and
  `npm run guard:test`. Run one Node test with
  `node --test path/to/file.test.ts`.
- Install the toolchain with `pnpm install` before any UI test, type check,
  lint, or surface build. Then use `npm run test:ui` (or
  `node --test path/to/ui.test.ts`), `pnpm typecheck`, and `pnpm guard:lint`.
- Regenerate the SDK after editing the operation catalogue with
  `npm run sdk:generate`; use `npm run sdk:check` to detect drift.
- Build one surface with `node tools/ci/build-surface.ts S2`, or all minified
  surfaces with `node tools/ci/build-surface.ts --all --minify`. Set
  `AC_GATEWAY=http://127.0.0.1:8080` when a development frame needs an
  explicit gateway origin.
- Database integration requires `DATABASE_URL`: run migrations with
  `node tools/ci/migrate.ts`, verify live-schema invariants with
  `node tools/ci/migrate.ts --assert`, and run
  `npm run test:integration`.

## Repository-specific invariants

- Preserve the gateway, SDK, shell, and surface layering. The guards and
  scoped ESLint rules deliberately make architectural erosion visible in a
  named diff; do not bypass them with new dependencies, imports, or direct
  access paths.
- Treat registry declarations as product and security policy. In particular,
  surface `writes`, scope bindings, density, degraded behavior, `stateRamp`,
  and `whiteLabel` are enforced across multiple layers and must remain
  coherent.
- Generated artifacts are checked byte-for-byte. If a source-of-truth change
  affects emitted files, regenerate all relevant artifacts before finishing.

## Repository layout

- `apps/s1`–`s8` — the surfaces (generated shells; S2 hand-written). `apps/*` holds nothing else.
- `services/gateway`, `services/worker` — the sole data access path and the background worker.
  The gateway's `src/` is grouped into `auth/`, `db/` and `http/`, with `handlers/` beside them.
- `packages/*` — contracts, sdk, shell, ui, domain, schema, tokens, and the rest.
- `tools/ci` guards, emitters, migrate and build; `tools/drive` browser end-to-end drives;
  `tools/ops` production scripts and test-login seeding; `tools/demo`, `tools/eslint-plugin-ac`.
- `external/` — apps outside the pnpm workspace (the Electron logins app, own lockfile).
- `docs/generated/` is emitted (never hand-edit); `docs/assets/` holds diagrams;
  `docs/history/` holds per-item build records; `docs/superpowers/` holds plans and specs.

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
3. `docs/generated/BRAND.md` — **generated**. Never hand-edited. Change a token, then run
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
