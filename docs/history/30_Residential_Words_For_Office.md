# 30 — A home reads as customer, address and house in S2 and S3

Staff were reading a homeowner through commercial vocabulary. The tree said "region node / location / site".
Every dispatch row said **"Home · Residential"**, because `customers.createResidential` names every house's
site "Home" and S3 drew `siteName`. Decision: keep the one tree (2026-10-21 scope, D2) and change what it is
**called** on the office's screens, by segment.

## Done
- `packages/contracts/src/tiers.ts` — `TIER_WORD` / `tierWord(tier, segment)`. Commercial: Region node / Location / Site.
  Residential: **Customer / Address / House**. This is the only source for these words.
- `JobWire.customerName`, `ServiceRequestWire.customerName` — `organizations.name`, under the same RLS as
  `customerSegment` (null for a firm). Gateway `JOB_SELECT` and `listServiceRequests` select it.
- S3 — `placeName()` in `screens/common.ts`. A home's job or request is named by its customer, and a building's by
  its site. Used on intake, the board (and its timeline), jobs, detail, dispatch and the map's label. The "Site"
  column headers read "Customer / site".
- S2 — the account tree, New / Move node forms and the customer overview use `tierWord`. On a home: Tier column
  "Customer / Address / House", "+ house", "+ Another region" (not "+ Region node"), and a panel note saying what
  each row is. The count line on a home is houses only.

## Verified
schema-guard, guard:test, typecheck, guard:lint, sdk:check, surfaces:check, `npm run test:ui` 338/338. Against local
Postgres 16: migrate 0001→0038, `--assert`, full integration 300/300. This includes a new assertion in
`s2-residential.test.ts` that the office reads a home's request with `customerName` = the org name.

## Left
- S5 (technician) and S4 still show the raw site name for a home ("Home"). Same `placeName` treatment if wanted.
- Existing data still names house sites "Home". Display no longer depends on it, so no rename migration was written.
