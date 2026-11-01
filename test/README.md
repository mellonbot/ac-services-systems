# Tests

- **Unit tests** sit beside the code they cover (`*.test.ts`). The zero-install set runs with
  `npm run guard:test` (packages except `ui`, `services/`, `tools/`, `external/`); the UI set,
  which needs `pnpm install`, runs with `npm run test:ui` (`packages/ui` and `apps/s*`).
  S2 screen tests live in `apps/s2-service-manager/src/screens/__tests__/`.
- **Integration tests** live in `test/integration/`. They spawn a real gateway against a live
  Postgres (`DATABASE_URL`) and run with `npm run test:integration`. See the `integration-test`
  skill for the per-file UUID prefix and seeding rules.
- **Browser drives** (`tools/drive/`) prove built surfaces against a real gateway in Chrome; see
  the `browser-drive` skill.
