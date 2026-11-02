# Agent guide (Claude, Grok, and any other coding agent)

Read `.github/copilot-instructions.md` first: it holds the architecture, layout, commands and
invariants, and it wins over this file. This file covers how agents start, hand off and add code.

## Starting a new session

1. `git status` and `git log --oneline -10`. Never assume the tree is clean or that you are on `main`.
2. Check for other agents' work: `gh pr list --state open` and the newest files in `docs/history/`.
   If an open PR or branch already touches your area, build on it or coordinate. Do not duplicate it.
3. Branch from an up-to-date `main`: `git switch -c <what-it-does> origin/main`. One task, one branch.
4. Run `pnpm install --frozen-lockfile` once, then `node tools/ci/schema-guard.ts` to get a green baseline
   before changing anything.
5. Read the project skill that matches the task (`.claude/skills/*/SKILL.md`: gateway-operation,
   schema-migration, contract-terms, integration-test, browser-drive, arc-foundry, deploy, babysit).
   Skills are plain markdown, so agents that do not load skills by name should read the file.

## Communicating with other agents

Agents do not talk to each other directly. The repository and GitHub are the only channel, so state
must be written down where the next agent will look:

- **Claim work** by opening a draft PR early, titled for what it changes (see the PR title rule in the
  instructions). A draft PR is the "in progress" marker.
- **Hand off** by writing a record in `docs/history/` named `NN_Short_Title.md`, with NN the next number.
  Say what was done, what was verified, what is left, and any trap. Link the PR.
- **Ask or answer** in PR comments (`gh pr comment`) or issue comments, never in untracked local files.
- **Never** force-push, rewrite, or reset another agent's branch. Never edit a PR you did not open
  without saying so in a comment. If two branches collide, rebase your own onto `main`.
- Treat a red guard or CI job you did not cause as someone else's finding: report it, do not bypass it.

## Adding new code

- Put it where the layout says: surfaces in `apps/`, gateway and worker in `services/` (`auth/`, `db/`,
  `http/`, `handlers/`), shared logic in `packages/`, scripts in `tools/ci`, `tools/drive` or `tools/ops`.
- A new gateway operation is one list: catalogue row, wire types, handler, route, SDK, surface admission,
  tests. Follow the `gateway-operation` skill, then `npm run sdk:generate`.
- A schema change follows the `schema-migration` skill: never edit a frozen migration, add a new one.
- Never edit generated files (`apps/s*` shells, `docs/generated/`, the SDK). Change the source, then
  regenerate with `node tools/ci/emit-surfaces.ts` and `npm run sdk:generate`.
- Do not bypass layering: no database driver outside `services/gateway/src/db/pg-tx.ts`, no `fetch` in a
  surface, no raw colours outside `packages/tokens`, no clock/RNG/`node:` in `packages/domain`.
- Every change ships with a test beside the code (`*.test.ts`), or an integration test in
  `test/integration/` when it needs the database or row security.
- TypeScript is erasable-syntax only with relative `.ts` imports.

## Before you hand back

Run, and report the result of each: `node tools/ci/schema-guard.ts`, `npm run guard:test`,
`npm run test:ui`, `pnpm typecheck`, `pnpm guard:lint`, `npm run sdk:check`, `npm run surfaces:check`.
Say plainly which you could not run (for example, no database). Commit with a subject that says what the
change does. Open the PR with a body covering what, why and how it was verified.
