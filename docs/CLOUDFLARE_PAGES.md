# Cloudflare Pages

The unified site serves S1 at `/` and each enabled portal under its own path.
The `deploy` job in `.github/workflows/guard.yml` publishes it to Cloudflare
Pages after the `full` and `migrate` CI jobs pass on `main`. GitHub's
`production` environment records the deployment.

## One-time setup

Create or retain a Cloudflare Pages project for the unified site, bind
`acservice.systems` and `www.acservice.systems` to it, and set its production
branch to `main`. Disable Cloudflare Pages Git integration so GitHub Actions is
the only publisher. Remove both custom domains from the clickable demo Worker
before binding them to Pages; `tools/demo/wrangler.jsonc` intentionally no
longer assigns the production domains to that Worker.

Create a GitHub Actions environment named `production` and configure:

| Name | Type | Value |
| --- | --- | --- |
| `AC_GATEWAY` | Variable | HTTPS origin of the separately hosted gateway, e.g. `https://api.example.com` |
| `CLOUDFLARE_PAGES_PROJECT` | Variable | Exact name of the Pages project |
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare API token with Pages Edit permission for the account |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare account ID containing the Pages project |

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

This deploy publishes static frontends only. The gateway, database, DNS, and
gateway CORS/cookie settings must already be configured separately.
