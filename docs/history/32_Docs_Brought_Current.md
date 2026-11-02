# 32 — Docs brought current (2 November 2026)

## What changed

- `README.md` — build state moved from "late Sept 2026" to now (Arc Foundry Revs A–D, the
  production database on PostgreSQL 18, importer/regions/shifts, the S1 front door, S5's four
  job states, multi-home households) and states the production `ROLLOUT` (S1, S2, S3, S5).
  PostgreSQL 16 → 18. S5 described by its job states, not "device login". S4's 36 figures
  named by their real areas (service, money, network, growth, platform). Brand section says
  what Rev C did (garnet fault, red as instrument accent) instead of "state-bearing surfaces
  render neutral". Dead link to `06_Software_Architecture_Frame.md` removed. Mermaid
  `classDef`s repainted from off-system blues/oranges/greens to light-stock values.
- `docs/assets/architecture-diagram.svg`, `docs/assets/surface-status.svg` — rebuilt in Arc
  Foundry: light stock, Plex faces with fallbacks, IDs in the instrument face, 6px card corners,
  category by form (hairline / hard rule / sunken well) rather than hue, state as mark + word in
  the state inks (● ok, ■ blocked). S1 renamed "Front door" (was "Marketing / Anonymous"),
  PostgreSQL 18, live-in-production column.

## Verified

- Every hex in the two SVGs and the README appears in `docs/generated/BRAND.md` (parsed, not eyeballed).
- `node tools/ci/schema-guard.ts` ok; `npm run guard:test` 500 pass, 0 fail.

## Left / trap

- The org-synced **`rankine-house-style`** skill (outside this repo) calls itself "Rev. E" but
  carries Bulletin 2 *as issued*: cyan instrument accent, oxide fault `#A32318`, 0px corners, a
  dark field ground. The tokens are Rev D: red accent, garnet fault `#9C1F6E`, 4/6px corners,
  S5 on the light stock. Anything generated outside the repo from that skill is off-brand
  until it is replaced. The repo's own `arc-foundry` skill is correct.
- `docs/OPEN_DECISIONS.md` is dated 2026-09-15; whether D9/D12–D14/OQ1 moved is a partner
  question, not something the code can answer. Left as is.
- Earlier `docs/history/` records cite PostgreSQL 16 because that is what they ran against; not edited.
