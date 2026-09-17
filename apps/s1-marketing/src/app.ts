import { html, mount, signal, effect, applyDegraded, type VNode } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { SURFACE, connect } from "./main.ts";

export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
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
    if (!SURFACE.enabled) return html`<section class="ac-status"><h1>${SURFACE.name}</h1><p>This surface is scheduled for Phase ${SURFACE.phase} and is not available yet.</p></section>`;
    if (phase.value.kind === "connecting") return html`<section class="ac-status" aria-busy="true"><h1>${SURFACE.name}</h1><p role="status">Connecting to your workspace…</p></section>`;
    if (phase.value.kind === "sign-in") return html`<section class="ac-status"><h1>${SURFACE.name}</h1><p>Your organization account is required to open this workspace.</p><p class="ac-status__scope">Access scope: ${SURFACE.authScope}.</p></section>`;
    return html`<section class="ac-status"><h1>${SURFACE.name}</h1><p>Workspace session is ready for ${phase.value.shell.principal.roles.join(", ")}.</p><p class="ac-status__scope">Access scope: ${SURFACE.authScope}.</p></section>`;
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
  mount(html`<${Root} />`, document.getElementById("mount")!);
  effect(() => {
    if (slot) applyDegraded(slot, { degraded: app.degraded.value, text: SURFACE.degraded, lastOkAt: app.lastOkAt(), now: Date.now() });
  });
  setInterval(() => app.tick(), 1_000);
  void app.boot();
}
