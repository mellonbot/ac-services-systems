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
  `/healthz` and the Worker's cron are what it watches; what watches them is
  not yet chosen.
- **storage** — object storage behind `packages/storage`'s key scheme. The
  gateway speaks R2's S3 API (`s3Store`, SigV4 over `node:crypto`), so binding
  it is a dashboard step plus four Worker secrets: create a bucket and an R2
  API token scoped to it, then `wrangler secret put` `AC_STORAGE_ENDPOINT`
  (`https://<account>.r2.cloudflarestorage.com`), `AC_STORAGE_BUCKET`,
  `AC_STORAGE_KEY_ID`, `AC_STORAGE_SECRET`. Until then photo uploads are
  refused as `storage_not_configured`; the request itself is still taken.
- **quickbooks** — QuickBooks Online is the ledger of record; the worker
  mirrors its invoices and payments every five minutes (`apps/worker/src/ledger.ts`,
  migration 0018). Create an app in the Intuit Developer portal (scope
  `com.intuit.quickbooks.accounting`), authorize it on the company once — the
  OAuth Playground hands back a refresh token — then `wrangler secret put`
  `AC_QBO_ENV` (`sandbox` or `production`), `AC_QBO_CLIENT_ID`,
  `AC_QBO_CLIENT_SECRET`, `AC_QBO_REALM_ID` (the company id),
  `AC_QBO_REFRESH_TOKEN` and `AC_QBO_TOKEN_KEY` (`openssl rand -base64 32`;
  it encrypts the rotated token at rest). The worker stores each rotated token
  itself; set `AC_QBO_REFRESH_TOKEN` again only to reconnect. Until all six
  are set the sync is off and the Manager Dashboard says so.
- **network** — regions are the shard boundary. A container per region
  (`AC_REGION_ID`) is a second Durable Object name in `worker.mjs` when Tier 3
  arrives; nothing structural changes.
