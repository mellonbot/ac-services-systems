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
- `apps/gateway` is the sole access path to data. Only
  `apps/gateway/src/pg-tx.ts` imports the database driver. Surface code must
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
  `docs/SURFACES.md` are generated from `packages/contracts/src/surfaces.ts` by
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
