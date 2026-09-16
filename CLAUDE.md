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
