---
name: gateway-operation
description: Adding or changing a gateway operation in this repository — the catalogue row, wire types, handler, route, generated SDK, surface admission and tests, as one list that the guard proves is one list. Use whenever a surface needs a new read or write, an operation is admitted to another surface, or an operation's input/output shape changes.
---

# Adding a gateway operation

Non-negotiable #14: **the operation catalogue, the generated client and the gateway's route
table are one list.** `schema-guard` §4b and `typecheck` both enforce it. A surface never
calls `fetch`; it calls `packages/sdk/src/generated/client.ts`, which is emitted from the
catalogue.

## The chain, in order

| # | File | What goes there |
|---|---|---|
| 1 | `packages/contracts/src/operations/wire/<area>.ts` | `XInput` / `XOutput` types. Plain JSON shapes. |
| 2 | `packages/contracts/src/operations/catalogue.ts` | `"area.verb": op<Wire.XInput, Wire.XOutput>()({ id, method, path, kind, auth, surfaces, carrier, sdkMethod, summary })`. Group under a `// ---- 00NN: ... ----` comment when it ships with a migration. |
| 3 | `services/gateway/src/handlers/<area>.ts` | The handler. Takes the tx, never opens one. |
| 4 | `services/gateway/src/http/routes.ts` | One entry in `handlers`: `openTx(req, id, "uow" \| "read", ...)` for scoped domain work, `openSelf(req, id, write, ...)` for the caller's own rows. |
| 5 | `npm run sdk:generate` | Regenerates the client. Commit it. |
| 6 | the surface in `apps/sN-*` | Call the SDK method. Visual work → load **arc-foundry**. |

## Decisions the catalogue row forces

- **`kind`** — `query` (GET, no side effects), `mutation` (POST, writes audit + outbox in
  the unit of work), `stream`, `login`, `system`.
- **`carrier`** — `query` for GET inputs, `body` for POST, `none` for no input.
- **`surfaces`** — the narrowest list that is true. Use `COMPANY`, `AUTHENTICATED`,
  `PASSWORD_LOGIN` from `define.ts` when they say exactly what you mean. Admitting an existing
  operation to a new surface is a catalogue change *and* usually a policy change (see
  `0037_customer_own_contacts.sql`: `contacts.set` admitted to S6 needed the RLS policy too).
- **Surface writes** — if the operation writes an entity, the surface must declare it in
  `packages/contracts/src/surfaces.ts` `writes`, from `WRITE_ENTITIES`. The guard holds:
  S4 writes nothing; `account`, `contract`, `subcontractor_firm`, `rate_card` are S2 only;
  `assignment` is S3 only (the compliance gate is one door).
- **`summary`** — one or two sentences for the person reading the client: who sees what,
  and who is excluded.

## Refusals

A "no" is never a 500. Raise it where the rule lives:
- a row rule → the database (trigger/constraint; see the **schema-migration** skill), mapped
  by `services/gateway/src/http/refusals.ts`;
- an input the handler cannot resolve (node not in scope, job not visible) → the handler's
  typed refusal, same file;
- a contract-term admission → `packages/contracts/src/refusals.ts` axis
  (`structural` / `commercial` / `incomplete`), which S2 must render as a decision with a route.

Don't leak existence: FK/unique refusals go out in general words with the constraint as
`code`.

## Production posture

`AC_ROLLOUT=1` in production serves only `ROLLOUT` surfaces (`surfaces.ts`). An operation
admitted only to a non-rollout surface is unreachable live — say so in the PR.

## Verify

```bash
node tools/ci/schema-guard.ts      # one list, SDK current, write allowlists
pnpm typecheck && pnpm guard:lint
npm run guard:test                 # handler unit tests sit beside the handler
npm run test:integration           # with DATABASE_URL; new file needs a free UUID prefix
```

Add a handler `*.test.ts` for the shape and the refusal, and an integration test through a
real gateway for the RLS line. If the operation is reachable from a browser flow that a drive
covers, extend that drive (**browser-drive** skill).
