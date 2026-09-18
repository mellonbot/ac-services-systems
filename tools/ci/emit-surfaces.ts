#!/usr/bin/env node
/**
 * Generates each surface app's boot file, README and FRAME from the registry,
 * plus docs/SURFACES.md.
 *
 *   node tools/ci/emit-surfaces.ts          write everything
 *   node tools/ci/emit-surfaces.ts --check  exit 1 if any emitted file differs (what the guard runs)
 *
 * Generated on purpose: a hand-written README describing a surface's write
 * allowlist is a second source of truth, and the second source of truth is
 * always the one people read and never the one that is enforced.
 *
 * The frame (09 §3.3) is rendered HERE, at build time, not per request by a
 * server: density class, the token CSS as `:root` variables, the degraded slot
 * carrying the registry's declared text, the mount point, the bundle tag. There
 * is no surface-side server process to run, monitor, or turn into a second
 * access path. Zero-install: node: imports and relative .ts imports only, and
 * deterministic output, so the frame is byte-comparable.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACES, SURFACE_IDS, type Surface, type SurfaceId } from "../../packages/contracts/src/index.ts";
import {
  DENSITY, tokenCss, BRAND, faviconDataUri, semanticFor, badgeSvg,
  SEMANTIC, FACES, ACCENT_GATE, BULLETIN_ERRATA, WORDMARK_FLOOR,
} from "../../packages/tokens/src/index.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const renderPackageJson = (s: Surface): string => JSON.stringify({
  name: `@ac/${s.app}`, version: "0.0.0", private: true, type: "module",
  main: "./src/main.ts",
  dependencies: { "@ac/shell": "workspace:*", "@ac/ui": "workspace:*", "@ac/contracts": "workspace:*" },
}, null, 2) + "\n";

/**
 * The white-label entrypoint, for a surface the registry says a tenant may
 * repaint. Kept out of the template above only because it is a template inside
 * a template; it is emitted verbatim into the surface's main.ts.
 *
 * The slot is passed IN rather than looked up here, so the surface layer still
 * names no DOM type and still runs under node --test.
 */
const BRAND_ENTRYPOINT = (s: Surface): string => `
/**
 * White-label. Called FIRST, before connect() — a portal branded only after a
 * successful password looks like someone else's until you are already inside it.
 *
 *   await brand({ baseUrl, fetch, host: location.hostname }, document.getElementById("ac-brand"));
 *
 * It cannot fail in a way that matters: no theme, no answer and an unknown host
 * all leave the page in the plate the frame already carries.
 */
export const brand = (cfg: Omit<BrandConfig, "surfaceId">, slot: BrandSlot | null) =>
  installBrand({ ...cfg, surfaceId: "${s.id}" }, slot);
`;

export const renderMain = (s: Surface): string => `import { createShell, connectShell, type ConnectConfig${s.whiteLabel ? ", installBrand, type BrandConfig, type BrandSlot" : ""} } from "../../../packages/shell/src/index.ts";
import { SURFACES } from "../../../packages/contracts/src/index.ts";
import type { Principal } from "../../../packages/contracts/src/index.ts";

/**
 * ${s.id} — ${s.name}
 *
 * Block ${s.block} · Phase ${s.phase} · ${s.density} density · ${s.enabled ? "enabled" : "NOT ENABLED (phase gate)"}
 *
 * Auth: ${s.authScope}
 * Writes: ${s.writes.length ? s.writes.join(", ") : "NOTHING — read-only by construction"}
 *
 * Degraded mode:
 *   ${s.degraded}
 *
 * This surface owns no data. Every read and every write goes through
 * \`shell.gateway\` — the client generated from the operation catalogue — and
 * nothing else. It cannot resolve a database driver (.npmrc isolation,
 * ac/no-db-in-surface, tools/ci/schema-guard.ts) and it cannot call fetch
 * (ac/no-fetch-in-surface, the same guard). A request that is not in
 * packages/contracts/src/operations.ts has no method here.
 */
export const SURFACE = SURFACES.${s.id};

/** Configuration-only shell — the registry checks, no transport. */
export const boot = (principal: Principal) => createShell({ surfaceId: "${s.id}", principal });

/** Live shell — login, hierarchy context, generated client, event stream, degraded flag. */
export const connect = (cfg: Omit<ConnectConfig, "surfaceId">) => connectShell({ ...cfg, surfaceId: "${s.id}" });
${s.whiteLabel ? BRAND_ENTRYPOINT(s) : ""}`;

/**
 * The shared first cut for surfaces whose product-specific workflow is not
 * built yet. It resumes an existing browser session and makes the surface,
 * scope, phase gate, and gateway state explicit instead of shipping an empty
 * landmark. S2 owns its richer hand-written browser entry.
 */
export const renderStatusApp = (): string => `import { html, mount, signal, effect, applyDegraded, type VNode } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { SURFACE, connect } from "./main.ts";

export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return \`\${doc.location.protocol}//api.\${site}\`;
};

type Phase = { kind: "connecting" } | { kind: "ready"; shell: ConnectedShell } | { kind: "sign-in" };

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number }) => {
  const now = opts.now ?? (() => Date.now());
  const phase = signal<Phase>(SURFACE.enabled ? { kind: "connecting" } : { kind: "sign-in" });
  const degraded = signal(false);
  let lastOkAt: number | null = null;

  const boot = async () => {
    if (!SURFACE.enabled) return;
    try {
      const shell = await connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials: { session: "cookie" } });
      lastOkAt = now();
      phase.value = { kind: "ready", shell };
    } catch {
      phase.value = { kind: "sign-in" };
    }
  };

  const tick = () => {
    if (phase.value.kind !== "ready") return;
    degraded.value = phase.value.shell.isDegraded();
    if (!degraded.value) lastOkAt = now();
  };

  const view = (): VNode => {
    if (!SURFACE.enabled) return html\`<section class="ac-status"><h1>\${SURFACE.name}</h1><p>This surface is scheduled for Phase \${SURFACE.phase} and is not available yet.</p></section>\`;
    if (phase.value.kind === "connecting") return html\`<section class="ac-status" aria-busy="true"><h1>\${SURFACE.name}</h1><p role="status">Connecting to your workspace…</p></section>\`;
    if (phase.value.kind === "sign-in") return html\`<section class="ac-status"><h1>\${SURFACE.name}</h1><p>Your organization account is required to open this workspace.</p><p class="ac-status__scope">Access scope: \${SURFACE.authScope}.</p></section>\`;
    return html\`<section class="ac-status"><h1>\${SURFACE.name}</h1><p>Workspace session is ready for \${phase.value.shell.principal.roles.join(", ")}.</p><p class="ac-status__scope">Access scope: \${SURFACE.authScope}.</p></section>\`;
  };

  return { phase, degraded, boot, tick, view, lastOkAt: () => lastOkAt };
};

if (typeof document !== "undefined" && document.getElementById("mount")) {
  const style = document.createElement("style");
  style.textContent = ".ac-status{max-width:65ch;padding-block:var(--space-6)}.ac-status h1{margin:0 0 var(--space-2);font-family:var(--font-display);font-size:var(--text-xl);letter-spacing:var(--track-normal);text-transform:uppercase}.ac-status p{margin:0 0 var(--space-2)}.ac-status__scope{color:var(--color-text-muted);font-size:var(--text-sm)}";
  document.head.appendChild(style);
  const app = createApp({ baseUrl: gatewayOrigin(document), fetch: globalThis.fetch.bind(globalThis) });
  const slot = document.querySelector("ac-degraded") as HTMLElement | null;
  const Root = () => app.view();
  mount(html\`<\${Root} />\`, document.getElementById("mount")!);
  effect(() => {
    if (slot) applyDegraded(slot, { degraded: app.degraded.value, text: SURFACE.degraded, lastOkAt: app.lastOkAt(), now: Date.now() });
  });
  setInterval(() => app.tick(), 1_000);
  void app.boot();
}
`;

/**
 * Surfaces with a hand-written `src/app.ts` of their own — S2 first, and now
 * item 4's S3 (dispatch board + the one gated door) and S5 (offline-first
 * field screens). Every other surface still gets the shared first cut until
 * its own product-specific workflow is built.
 */
const HAND_WRITTEN_APPS: readonly SurfaceId[] = ["S2", "S3", "S5"];
const GENERATED_STATUS_APPS: readonly SurfaceId[] = SURFACE_IDS.filter((id) => !HAND_WRITTEN_APPS.includes(id));

/**
 * The frame. One file per surface, identical in shape across all eight; what
 * differs is data from the registry. `/ui.css` and `/bundle.js` are what
 * tools/ci/build-surface.ts writes beside it in dist/ — ABSOLUTE paths, because
 * the router pushes real paths (`/accounts/<org>/new/site/<parent>`) and a
 * relative `./bundle.js` would resolve under them. Found the first time a deep
 * link was opened in a browser: the module script came back as the frame itself.
 * A surface is served at its origin's root; the reverse proxy answers every
 * path with the frame and these two files by name.
 *
 * The degraded slot carries the declared text in the HTML itself, so the
 * outage banner does not depend on the bundle having loaded — the bundle only
 * flips `hidden` and appends the age (packages/ui applyDegraded).
 *
 * `<meta name="ac-gateway">` is empty here and stamped by build-surface.ts from
 * AC_GATEWAY — the registry knows no environment. Empty at runtime means
 * "derive from the site": s2.<site> talks to api.<site>.
 */
/**
 * The masthead. The wordmark is the one place the script appears on a surface,
 * and `data-brand-layer` says whether this surface may paint it in brand red —
 * the same flag `tokenCss` used to resolve the brand roles, carried into the
 * markup so a reviewer can see which layer a frame is on without reading CSS.
 *
 * The badge is inline SVG rather than a linked file: it is the mark a surface
 * shows before its stylesheet has loaded, and a masthead that depends on a
 * second request is a masthead that flashes empty on the tablet.
 */
export const renderMasthead = (s: Surface): string =>
  `<header class="ac-mast" data-brand-layer="${s.stateRamp ? "false" : "true"}">
<a class="ac-mast__lockup" href="/" aria-label="${escapeHtml(BRAND.legalName)}">
<span class="ac-badge-mark" aria-hidden="true">${badgeInline()}</span>
<span class="ac-wordmark">${escapeHtml(BRAND.name)}</span>
<span class="ac-wordmark__co">${escapeHtml(BRAND.descriptor)}</span>
</a>
<div class="ac-mast__rule"></div>
</header>`;

/** The badge at masthead size — no optical correction, because nothing here is 16px. */
const badgeInline = (): string => badgeSvg(64).replace(/^<svg /, '<svg class="ac-badge-mark__svg" width="40" height="40" ');

export const renderFrame = (s: Surface): string => `<!doctype html>
<!-- GENERATED from packages/contracts/src/surfaces.ts by tools/ci/emit-surfaces.ts. Do not edit. -->
<html lang="en" data-surface="${s.id}" data-density="${s.density}"${s.enabled ? "" : ` data-enabled="false"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="same-origin">
<meta name="ac-gateway" content="">
<title>${escapeHtml(s.name)} — ${escapeHtml(BRAND.legalName)}</title>
<meta name="theme-color" content="${semanticFor(s.density)["color.surface"]}">
<link rel="icon" href="${faviconDataUri(16)}">
<style>${tokenCss(s.density, { brandLayer: !s.stateRamp })}</style>
<link rel="stylesheet" href="/ui.css">${s.whiteLabel ? `
<!-- The tenant's slot. EMPTY in the file, and the order is the mechanism: the
     plate above is what the page renders with when nothing fills this, so a
     portal with no theme, an unreachable gateway or a host we do not know is
     Rankine's own livery and never an unstyled page. The shell fills it from
     brand.theme with a block packages/tokens already scoped away from the
     field ground. Only a whiteLabel surface has it. -->
<style id="ac-brand"></style>` : ""}
</head>
<body>
<ac-degraded hidden role="alert" data-density="${s.density}">${escapeHtml(s.degraded)}</ac-degraded>
${renderMasthead(s)}
<main id="mount"></main>
<script type="module" src="/bundle.js"></script>
</body>
</html>
`;

export const renderReadme = (s: Surface): string => {
  const d = DENSITY[s.density];
  return `# ${s.id} — ${s.name}

> GENERATED from \`packages/contracts/src/surfaces.ts\`. Edit the registry, run
> \`node tools/ci/emit-surfaces.ts\`. Do not edit this file.

| | |
|---|---|
| Block | ${s.block} |
| Phase | ${s.phase}${s.enabled ? "" : " — not enabled"} |
| Namespace | \`${s.namespace}\` |
| Auth scope | ${s.authScope} |
| Scope binding | \`${s.scopeBinding}\` |
| Density | \`${s.density}\` — ${d.controlHeight} controls, ${d.bodyText} body, ${d.hoverAffordances ? "hover affordances allowed" : "NO hover-dependent affordances"} |
| Realtime | ${s.realtime ? "hard requirement" : "no"} |
| State ramp | ${s.stateRamp ? "yes — the brand accent is barred here and resolves to Ink Black" : "no — this surface wears the brand red"} |
| Offline writes | ${s.offline ? "yes — device holds intent, server holds truth" : "no"} |
| White-label | ${s.whiteLabel ? "yes — a tenant may repaint the accent slots; the state ramp, the focus ring and the structural tokens are not themeable" : "no — Rankine's plate, always"} |

## Writes

${s.writes.length ? s.writes.map((w) => `- \`${w}\``).join("\n") : "**Nothing.** The write allowlist is empty in the registry, and the gateway unit of work checks it on every mutation. This is not a convention anyone has to remember."}

## Degraded mode

${s.degraded}

## Runtime

\`frame.html\` is emitted from the registry (density, tokens as CSS variables,
the degraded slot, the mount point). \`node tools/ci/build-surface.ts ${s.id}\`
bundles \`src/app.ts\` (or, absent, the generated \`src/main.ts\`) with esbuild into \`dist/\` beside the frame and the
component stylesheet. Screens are declared in \`src/screens.ts\` and may use
only operations the catalogue admits for ${s.id}; the guard checks it.

## What this surface must never do

- Own data, or hold a database credential.
- Write an entity outside the list above — \`SurfaceWriteDenied\` on any attempt.
- Filter scope client-side. Scoping is enforced at the gateway or it is not enforced.
- Import the renderer. A surface imports \`@ac/ui\`; preact lives behind it.
`;
};

export const renderSurfacesDoc = (): string => {
  const rows = SURFACE_IDS.map((id) => {
    const s = SURFACES[id];
    return `| ${s.id} | ${s.name} | ${s.block} | ${s.phase} | \`${s.density}\` | ${s.authScope} | ${s.writes.length ? s.writes.map((w) => `\`${w}\``).join(", ") : "—"} |`;
  }).join("\n");
  return `# The eight surfaces

> GENERATED from \`packages/contracts/src/surfaces.ts\`.

Every screen in the platform is one of eight websites. None owns data. Each is a
scoped view onto the same multi-tenant hierarchy, reached only through the API
gateway.

| ID | Surface | Block | Phase | Density | Auth scope | Writes |
|----|---------|-------|-------|---------|-----------|--------|
${rows}

## Build order

1. Backbone contract — schema with \`region_id\` everywhere, gateway, auth with tier claims, event stream, audit log
2. **S0** — the shared shell: operation catalogue → generated client → shell transport (login, hierarchy context, SSE, refusal mapping, degraded flag). Every surface below boots through it
3. **S2** — hierarchy, contracts and the subcontractor registry must exist before anything dispatches against them
4. **S3 + S5 together** — the fallback is what lets the tablet ship without being a single point of failure
5. Yocto tablet — the long pole, de-risked because S5 already carries the field
6. **S6** — required for Amped end-to-end in Phase 1; tier scoping is the acceptance test
7. **S8** — D12 minimum cut: compliance intake + settlement visibility
8. **S1** — off the critical path, ship whenever a hand is free
9. **S4** (Phase 2), **S7** (Phase 4)

## Runtime (09)

Each surface is a build-rendered \`frame.html\` (from this registry) plus one
esbuild bundle of \`src/main.ts\`, served as static files. Preact/htm/signals
live in \`packages/ui\` alone; a surface imports \`@ac/ui\`. Screens are a
registry (\`src/screens.ts\`) checked against the operation catalogue.
`;
};

/**
 * docs/BRAND.md — generated, because a hand-written palette table is a second
 * source of truth and the second source is always the one people read.
 */
export const renderBrandDoc = (): string => {
  const light = semanticFor("comfort"), dark = semanticFor("field");
  return `# ${BRAND.legalName} — brand

> GENERATED from \`packages/tokens/\`. Edit the tokens, run
> \`node tools/ci/emit-surfaces.ts\`. Do not edit this file.

**${BRAND.motto}** · ${BRAND.trade} · Est. ${BRAND.established.roman}, ${BRAND.established.city}, ${BRAND.established.state}

Theme: **Arc Foundry** — the electric arc furnace. Industrial-revolution in
origin, electric in the present. The theme names the palette and the type
schedule; the company is ${BRAND.legalName}.

## Two accent layers

The load-bearing decision. Red measures 1.2° from the fault ink, and there is no
bright red that clears the accent gate's ${ACCENT_GATE.minHueSeparation}°: the band between the fault
and the warning is 34.8° wide. So red is admitted exactly where a colliding
tenant accent is admitted, and barred everywhere a state ramp renders.

| Layer | Where | Resolved by |
|---|---|---|
| Brand — red \`${SEMANTIC["color.brand"]}\` | wordmark, livery, badge, S1 marketing | \`stateRamp: false\` in the surface registry |
| Instrument — arc \`${SEMANTIC["color.action"]}\` | every surface that shows state | the default |

A surface that forgets to declare renders in the neutral: the unsafe direction
requires an explicit opt-in.

## Light stock

| Role | Value | Ground |
|---|---|---|
${(Object.keys(light) as (keyof typeof light)[]).map((k) => `| \`${k}\` | \`${light[k]}\` | light |`).join("\n")}

## Field ground

Not a dark theme — a second substrate. The tablet is read on a roof at 2pm in
July, so this ground does not follow the viewer's preference.

| Role | Value |
|---|---|
${(Object.keys(dark) as (keyof typeof dark)[]).map((k) => `| \`${k}\` | \`${dark[k]}\` |`).join("\n")}

## Type schedule

| Role | Face | Job |
|---|---|---|
${Object.values(FACES).map((f) => `| ${f.role} | ${f.family} | ${f.job} |`).join("\n")}

The wordmark is a mark, not a typeface: it appears once per surface and never
below ${WORDMARK_FLOOR}px. Every numeral in the company is set in the instrument face with
tabular figures, self-hosted — never from a third-party host, which the guard
enforces.

## Errata

| Code | Status | Finding |
|---|---|---|
${BULLETIN_ERRATA.map((e) => `| ${e.code} | ${e.status} | ${e.finding} |`).join("\n")}
`;
};

export type Emitted = { readonly path: string; readonly content: string };

/** Every file the emitter owns, as (repo-relative path, content). The guard and --check compare these. */
export const emitted = (): readonly Emitted[] => {
  const out: Emitted[] = [];
  for (const id of SURFACE_IDS) {
    const s = SURFACES[id];
    const dir = join("apps", s.app);
    out.push({ path: join(dir, "package.json"), content: renderPackageJson(s) });
    out.push({ path: join(dir, "src/main.ts"), content: renderMain(s) });
    if (GENERATED_STATUS_APPS.includes(id)) out.push({ path: join(dir, "src/app.ts"), content: renderStatusApp() });
    out.push({ path: join(dir, "frame.html"), content: renderFrame(s) });
    out.push({ path: join(dir, "README.md"), content: renderReadme(s) });
  }
  out.push({ path: "docs/SURFACES.md", content: renderSurfacesDoc() });
  out.push({ path: "docs/BRAND.md", content: renderBrandDoc() });
  return out;
};

/** Paths whose committed content differs from what the registry emits today. */
export const drifted = (): readonly string[] =>
  emitted().filter((e) => {
    const p = join(ROOT, e.path);
    return !existsSync(p) || readFileSync(p, "utf8") !== e.content;
  }).map((e) => e.path);

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes("--check")) {
    const d = drifted();
    if (d.length) {
      console.error(`emit-surfaces: ${d.length} file(s) have drifted from the registry — run \`node tools/ci/emit-surfaces.ts\` and commit:\n  ${d.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`emit-surfaces: ${emitted().length} emitted files are current`);
  } else {
    for (const e of emitted()) {
      const p = join(ROOT, e.path);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, e.content);
    }
    console.log(`emitted ${SURFACE_IDS.length} surface apps (package.json, src/main.ts, frame.html, README.md; shared status entries except ${HAND_WRITTEN_APPS.join(", ")}) + ${relative(ROOT, join(ROOT, "docs/SURFACES.md"))}`);
  }
}
