# infra

Non-negotiable #10: infrastructure as code **from the first server**, not after
the third one is already hand-configured and nobody remembers which.

D7 (one named infrastructure owner — Ethan M., 2026-09-14) is closed; the
infrastructure decision it gated was taken on 2026-10-13: **Cloudflare**.

- `cloudflare/` — the gateway and the worker as one container behind a Worker
  on `api.acservice.systems` (`wrangler.jsonc`, `worker.mjs`,
  `entrypoint.mjs`; the image is the `Dockerfile` at the repo root), and the
  static site on Cloudflare Pages. Deployed by `.github/workflows/guard.yml`
  on `main`. Read `docs/CLOUDFLARE_PAGES.md` first.

What is still held elsewhere, and why:

- **database** — PlanetScale Postgres created from the Cloudflare dashboard (or
  any Postgres 16 over TLS). The four roles are `migrations/0002`; the restore
  test (#11) is an operations calendar item with a name attached, not a file
  here, because no file can run a restore for you.
- **monitoring** — external by construction (#12). Monitoring that lives on the
  thing it monitors reports green while the thing is on fire. The gateway's
  `/healthz` (liveness), `/readyz` (the database, as `ac_gateway`) and the
  Worker's cron are what it watches; what watches them is
  not yet chosen.
- **storage** — an R2 bucket (`ac-media`) behind `packages/storage`'s key
  scheme. The gateway speaks R2's S3 API (`s3Store`, SigV4 over `node:crypto`),
  so binding it is a dashboard step plus four secrets on the GitHub
  `production` environment, which every deploy copies to the Worker —
  `docs/CLOUDFLARE_PAGES.md`, 'Photo storage'. Required while a live surface
  takes photos: `deploy-gateway` fails by name until all four are held.
- **network** — regions are the shard boundary. A container per region
  (`AC_REGION_ID`) is a second Durable Object name in `worker.mjs` when Tier 3
  arrives; nothing structural changes.
