# Cloudflare: the gateway container and the Pages site

Production is two Cloudflare deployments from one `main` push, in this order:

1. **The gateway** — `apps/gateway` and `apps/worker` as one container
   (`Dockerfile` at the repo root, PID 1 `infra/cloudflare/entrypoint.mjs`)
   behind a Worker (`infra/cloudflare/worker.mjs`) on
   `https://api.acservice.systems`. The `deploy-gateway` job in
   `.github/workflows/guard.yml` migrates the production database, then runs
   `wrangler deploy -c infra/cloudflare/wrangler.jsonc`, which builds and
   pushes the image, and waits for `/healthz` to answer on the domain.
2. **The site** — S1 at `/` and each enabled portal under its own path, on
   Cloudflare Pages. The `deploy` job publishes it after the gateway is up,
   because the build stamps the gateway origin into every frame.

Both run after the `full` and `migrate` CI jobs pass on `main`; GitHub's
`production` environment records each deployment.

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
npx wrangler@4 secret put DATABASE_URL       -c infra/cloudflare/wrangler.jsonc   # paste the connection string
rm /tmp/ac-signing.pem
```

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
| `AC_GATEWAY` | Variable | `https://api.acservice.systems` — the gateway container's domain |
| `CLOUDFLARE_PAGES_PROJECT` | Variable | Exact name of the Pages project |
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare API token for the account: Workers Scripts **Edit**, Cloudflare Pages **Edit**, Containers **Edit**, Workers Routes/Custom Domains **Edit** on the zone, Account Settings **Read** |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare account ID |
| `DATABASE_URL` | Secret | The production connection string, for migrations (the same value the Worker holds) |

The build fails unless `AC_GATEWAY` is a valid HTTPS origin. Production
deployments run automatically for successful pushes to `main`; use **Actions →
guard → Run workflow** on `main` to deploy manually.

## Published routes

| Surface | Path | Sign-in audience |
| --- | --- | --- |
| S1 Marketing / lead-gen | `/` | Public |
| S2 Service Manager | `/service-manager/` | Staff |
| S3 Dispatch Console | `/dispatch/` | Staff |
| S4 HQ Ops Dashboard | `/hq/` | Staff |
| S5 Technician web fallback | `/technician/` | Technicians (device ID required) |
| S6 Customer Portal | `/customer/` | Customers |
| S8 Subcontractor Portal | `/subcontractor/` | Subcontractor firms |

Disabled surfaces are not published or linked. S1 provides a directory of the
enabled portal sign-ins; each portal retains its own authentication flow and
gateway-enforced scope. `_redirects` serves deep links through the correct
surface entry point, and each app's router confines navigation to its mount
path.

The Pages deploy publishes static frontends only; the gateway is the
container above. CORS and cookies need no configuration: the gateway derives
its browser origins from `SURFACES` under `AC_SITE` — the apex and `www`,
where Pages serves every portal, plus one subdomain per enabled surface — and
`api.<site>` is same-site with them, so the session cookie stays
`SameSite=Strict`.
