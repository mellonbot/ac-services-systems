# Cloudflare: the gateway container and the Pages site

Production is two Cloudflare deployments from one `main` push, in this order:

1. **The gateway** — `services/gateway` and `services/worker` as one container
   (`Dockerfile` at the repo root, PID 1 `infra/cloudflare/entrypoint.mjs`)
   behind a Worker (`infra/cloudflare/worker.mjs`) on
   `https://api.acservice.systems`. The `deploy-gateway` job in
   `.github/workflows/guard.yml` migrates the production database, then runs
   `wrangler deploy -c infra/cloudflare/wrangler.jsonc`, which builds and
   pushes the image, and waits for `/healthz` and then `/readyz` to answer
   on the domain. Until
   `DATABASE_URL` is set on the GitHub `production` environment the job
   records a notice and skips, and the site publishes alone; once it is set,
   a Worker missing either of its secrets fails the job by name before the
   image is built.
2. **The site** — S1 at `/` and each enabled portal under its own path, on
   Cloudflare Pages. The `deploy` job publishes it after the gateway is up,
   because the build stamps the gateway origin into every frame.

Both run after the `zero-install-guard`, `full`, `migrate` and `drive` CI jobs
pass on `main`, and only when the commit is still `main`'s head — a re-run of
an older commit stops at the `latest` job instead of rolling production back.
GitHub's `production` environment records each deployment.

## Why a container and not a Worker

The gateway is one Node process proven over the wire by every integration
test in this repository: `node:http`, an SSE fan-out fed by one Postgres
`LISTEN` client, `SET LOCAL ROLE` and a scope binding per transaction. A
Worker would change the runtime under all of that; a container runs the same
bytes. It also means no Hyperdrive: a pooling proxy breaks `LISTEN`/`NOTIFY`
and would sit between the transaction and the role it sets. The container
connects to Postgres directly, over TLS.

One instance. The relay, SLA cascade and expiry sweep assume one unregioned
worker, and the SSE feed is per process. Tier 3 (a container per region with
`AC_REGION_ID`) is a second name in `worker.mjs`, nothing else. A cron
every five minutes keeps the container from idling out, so the sweeps run
whether or not a browser is open.

## The database

Cloudflare hosts no Postgres of its own. The production database is
**PlanetScale Postgres created from the Cloudflare dashboard** (billed on the
Cloudflare invoice at PlanetScale's rates) or any Postgres 16 reachable over
TLS. Whichever it is, its connection string is the `DATABASE_URL` secret in
two places: the Worker (for the container) and the GitHub `production`
environment (for migrations). Append `?sslmode=require`.

Restore tests are non-negotiable #11 and are not a Cloudflare feature: the
provider's point-in-time restore is exercised on a calendar, by a named
person (D7), into a scratch database the integration suite is then run against.

## One-time setup

The account needs the **Workers Paid** plan (Containers are not on Free).

### The gateway

From a laptop logged into wrangler, once:

```bash
# An Ed25519 signing key. Rotating it is rotating this secret (AC_SIGNING_KID names the generation).
node -e 'const {generateKeyPairSync}=require("node:crypto");process.stdout.write(generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"pem"}))' > /tmp/ac-signing.pem
npx wrangler@4 secret put AC_SIGNING_KEY_PEM -c infra/cloudflare/wrangler.jsonc < /tmp/ac-signing.pem
rm /tmp/ac-signing.pem
```

Optional — S2's home map (Accounts → a residential customer). One MapTiler
key gives it both its tiles and the address lookup that places a typed
address on them (the first time a home's map opens, the gateway geocodes it
once and writes the point onto the site's address — an audited
`accounts.update`). The key lives here and never in a bundle. Use a key with
**no allowed-origin restriction** — the gateway sends no browser Origin:

```bash
npx wrangler@4 secret put AC_MAPTILER_KEY -c infra/cloudflare/wrangler.jsonc   # paste the key alone
```

That fills satellite-with-labels 256px tiles and US address geocoding. For
another style or provider, set `AC_MAP_TILE_URL` (`{z}/{x}/{y}`) or
`AC_GEOCODE_URL` (`{q}`) as full URL templates; either wins over the key.
`AC_MAP_ATTRIBUTION` is already a plain var in `wrangler.jsonc`. Unset, the
map says no provider is configured. A secret reaches the container when it
next starts — the next deploy.

### Photo storage

Required while any live surface takes photos (today S5: a wrap-up needs at
least two photos and a signature). Without it every upload is refused as
`storage_not_configured`, no technician can complete a job, and the
`deploy-gateway` job fails by name until it is set. The gateway speaks R2's
S3 API (`packages/storage`); bytes never go in Postgres.

In the Cloudflare dashboard, once:

1. **R2 → enable R2** for the account (accept the R2 plan; storage and
   operations are billed on the Cloudflare invoice).
2. **R2 → Create bucket** — name `ac-media`, location Automatic. Leave public
   access off: the gateway reads and serves every photo itself, scoped to the
   job's region, so the bucket is never reached from a browser.
3. **R2 → Manage R2 API tokens → Create API token** — permission
   **Object Read & Write**, applied to **`ac-media` only**, no expiry (or put
   its rotation on the calendar). Copy the **Access Key ID** and **Secret Access
   Key**; the secret is shown once. Note the account's S3 endpoint shown on the
   same page: `https://<account-id>.r2.cloudflarestorage.com`.

Then from a laptop logged into wrangler (paste each value when asked):

```bash
npx wrangler@4 secret put AC_STORAGE_ENDPOINT -c infra/cloudflare/wrangler.jsonc   # https://<account-id>.r2.cloudflarestorage.com
npx wrangler@4 secret put AC_STORAGE_BUCKET   -c infra/cloudflare/wrangler.jsonc   # ac-media
npx wrangler@4 secret put AC_STORAGE_KEY_ID   -c infra/cloudflare/wrangler.jsonc   # the token's Access Key ID
npx wrangler@4 secret put AC_STORAGE_SECRET   -c infra/cloudflare/wrangler.jsonc   # the token's Secret Access Key
```

All four or none: a half-configured bucket stops the gateway at start rather
than failing uploads one at a time. A secret reaches the container when it
next starts, so finish with **Actions → guard → Run workflow** on `main`. The
`deploy-gateway` job's "the Worker holds its secrets" step going green is the
confirmation that all four are held; "The gateway reaches its database and
photo storage" going green is the confirmation that they work. `/readyz`
makes a signed read of a key that is never written: only `404 NoSuchKey` is
proof. A wrong key id or secret, or a token scoped to another bucket, answers
`403`; a misspelt bucket `404 NoSuchBucket`; a wrong endpoint does not answer.
Each is a 503 from `/readyz`, with the status and S3 error code on a
`readyz: storage:` line in `wrangler tail`.

Paste the connection string exactly as the provider shows it for psql.
PlanetScale's ends in `sslmode=verify-full&sslrootcert=system`; the gateway
reads libpq's `sslrootcert=system` as what node `pg` does by default and
drops it (`services/gateway/src/db/pg-url.ts`). If the gateway container starts
and exits, **Actions → db-check → Run workflow** connects to the production
database with the same library and prints what it sees, naming no secret.

The Worker's `DATABASE_URL` is **copied from the GitHub `production`
environment on every deploy** (the `deploy-gateway` job's "the Worker holds
its secrets" step), so GitHub is the one place to set or rotate it; an edit on
the Worker is overwritten by the next deploy. It must be the migrating
login: migration 0012 grants that login `SET ROLE` on `ac_gateway` and
`ac_worker`, which a Postgres 16+ role creator does not get by default. A
gateway connecting as any other login answers 500 on every request while
`/healthz` stays green — `/healthz` is liveness and never touches the
database. `/readyz` connects and takes `ac_gateway`, and probes photo
storage when it is configured (see 'Photo storage'), answering 503 when it
cannot, and the deploy waits for it after `/healthz`; `db-check` shows the
refusal by name.

Without `AC_SIGNING_KEY_PEM` the gateway mints an ephemeral key and every
session dies with the container; the Worker refuses to start it. The custom
domain `api.acservice.systems` is created by the first deploy from the
`routes` entry — do not create a DNS record for it by hand.

Then, for OPEN-S1-ABUSE, one WAF rate-limiting rule on the zone before the
site goes public: `POST` to `api.acservice.systems` on `/auth/anonymous`
and `/s1/leads`, per IP, a handful a minute. The gateway has no rate limiter
and is not meant to grow one.

### The site

Create or retain a Cloudflare Pages project for the unified site, bind
`acservice.systems` and `www.acservice.systems` to it, and set its production
branch to `main`. Disable Cloudflare Pages Git integration so GitHub Actions is
the only publisher. Remove both custom domains from the clickable demo Worker
before binding them to Pages; `tools/demo/wrangler.jsonc` intentionally no
longer assigns the production domains to that Worker.

Create a GitHub Actions environment named `production` and configure:

| Name | Type | Value |
| --- | --- | --- |
| `AC_GATEWAY` | Optional variable | Override for the gateway origin; defaults to `https://api.acservice.systems` |
| `CLOUDFLARE_PAGES_PROJECT` | Variable | Exact name of the Pages project |
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare API token for the account: Workers Scripts **Edit**, Cloudflare Pages **Edit**, Containers **Edit**, Workers Routes/Custom Domains **Edit** on the zone, Account Settings **Read** |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare account ID |
| `DATABASE_URL` | Secret | The production connection string, for migrations (the same value the Worker holds). Setting it is what turns the `deploy-gateway` job on |

If set, `AC_GATEWAY` must be a valid HTTPS origin. Production deployments run
automatically for successful pushes to `main`; use **Actions → guard → Run
workflow** on `main` to deploy manually.

## Published routes

Production publishes only the surfaces in `ROLLOUT`
(`packages/contracts/src/surfaces.ts`). The first rollout is the front page
and the three staff surfaces:

| Surface | Path | Sign-in audience | Live |
| --- | --- | --- | --- |
| S1 Marketing / lead-gen | `/` | Public | **yes** — the first page; every other portal shows taped off, "Section not open yet" |
| S2 Service Manager | `/service-manager/` | Staff | **yes** |
| S3 Dispatch Console | `/dispatch/` | Staff | **yes** |
| S4 HQ Ops Dashboard | `/hq/` | Staff | no |
| S5 Technician web fallback | `/technician/` | Technicians (device ID required) | **yes** |
| S6 Customer Portal | `/customer/` | Customers | no |
| S8 Subcontractor Portal | `/subcontractor/` | Subcontractor firms | no |

A surface outside `ROLLOUT` is enabled — built, tested, driven in CI and in the
demo — but is not published, and the production gateway (`AC_ROLLOUT=1` in
`infra/cloudflare/wrangler.jsonc`) mints no session and takes no request for
it: `SurfaceNotLive`, 404. Publishing one is adding its id to `ROLLOUT`, which
also takes the tape off its plate on S1. S1 being live means its lead form is
live: the WAF rules below must exist first. Each portal retains its own
authentication flow and gateway-enforced scope. `_redirects` serves deep links through the correct
surface entry point, and each app's router confines navigation to its mount
path.

The Pages deploy publishes static frontends only; the gateway is the
container above. CORS and cookies need no configuration: the gateway derives
its browser origins from `SURFACES` under `AC_SITE` — the apex and `www`,
where Pages serves every portal, plus one subdomain per enabled surface — and
`api.<site>` is same-site with them, so the session cookie stays
`SameSite=Strict`.


## Rate limiting the public intake (OPEN-S1-ABUSE)

`leads.submit` and `auth.anonymousSession` are the first mutations a stranger
can reach. The chosen protection is a Cloudflare WAF rate-limiting rule on the
zone (not a counter inside the gateway).

Create one rule for each path:

| Path | Method | Limit | Period | Action |
|------|--------|-------|--------|--------|
| `/auth/anonymous` | POST | 10 | 1 minute | Block for 10 minutes |
| `/s1/leads` | POST | 20 | 1 minute | Block for 10 minutes |

Key by IP. These numbers are conservative for a marketing form and an
anonymous session mint; raise them if real traffic hits them. The rule is a
dashboard or API object on the zone — not a file in this repository. S1 should
not be public until the rules exist.

