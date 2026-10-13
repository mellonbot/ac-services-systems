# Cloudflare Pages

The unified site serves S1 at `/` and each enabled portal under its own path.
Cloudflare Pages Git integration publishes the site when `main` is updated.

## Pages project settings

Connect the existing Pages project to this GitHub repository and set:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` (repository root) |
| Build command | `pnpm install --frozen-lockfile && pnpm build:pages` |
| Build output directory | `dist/pages` |

Add `AC_GATEWAY` as a build environment variable for production and preview
deployments. It must be the HTTPS origin of the separately hosted gateway,
for example `https://api.example.com`. The build fails rather than publishing
bundles that point to an inferred or invalid API host.

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

This deploy publishes static frontends only. The gateway, worker, database,
DNS, and gateway CORS/cookie settings must already be configured separately.
