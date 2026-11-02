# 34 — "Marketing" wording retired from the token package

Date: 2026-11-02. Follows `33_S1_Offline_Shift_Entry.md`. Branch: `dev`.

## Done

S1 stopped being a marketing surface in `30_S1_Front_Door.md`; the brand layer's reason is now
"S1 renders no state ramp". Prose in `packages/tokens` still said marketing. Reworded:

- `brand.ts` motto comment: the front door prints no availability figure.
- `css.ts` `neutralBrand` comment and the `css.test.ts` layer-fence test title.
- `whitelabel.ts` gate comment and the one runtime note string ("admitted for logo, masthead and
  brand-layer surfaces only"), with its guard regex in `whitelabel.test.ts`.

No token value, role or generated file changed. The note string is not emitted into `BRAND.md`.

## Not changed on purpose

`whitelabel.ts` still says "a customer's marketing department": that is a tenant's staff, not S1.
`styles.ts` keeps its Bulletin 1 copper comment: it is the history of why the gate exists, and
the "copper fill" sentence the theme doc cites is already gone.

## Verified

schema-guard, guard:test, test:ui (352), packages/tokens tests (63), typecheck, guard:lint,
sdk:check, surfaces:check all green.

## Left

Everything under "Left" in `31_Disabled_Contrast_and_Layer_Wording.md` that is outside the repo.
