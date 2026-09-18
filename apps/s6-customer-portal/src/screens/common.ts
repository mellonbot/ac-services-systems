import { html, refusalHeading, PrimaryAction, type VNode, type Router } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf, AccountWire, AccountTierWire } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import type { SCREENS } from "../screens.ts";

/** What every S6 screen receives. A screen is a function of this and its route params — nothing else. */
export type ScreenContext = {
  readonly shell: Shell;
  readonly store: Store;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S6">;
  readonly degraded: boolean;
};

export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

/** Render a resource: the value when ready, a quiet line while loading, the refusal as a decision otherwise. */
export const whenReady = <T>(ctx: ScreenContext, r: Resource<T>, view: (v: T) => VNode, retry?: () => void): VNode => {
  switch (r.state) {
    case "loading": return html`<p class="s6-loading" role="status">Loading…</p>`;
    case "ready": return view(r.value);
    case "refused": return refusalView(ctx, r.refusal, retry ? [{ label: "Try again", onSelect: retry, primary: true }] : []);
  }
};

/**
 * A refusal, as a customer reads it. NOT RefusalCard: that component is
 * console-only by spec ("the people who can act on a refusal sit at a
 * console") — it renders the admission axis, the permitted authoring tiers,
 * the code. None of that is a customer's to act on. What a customer needs is
 * the same heading the console uses, the gateway's message verbatim, and a
 * way forward. The same discipline S5 follows in field density.
 */
export const refusalView = (ctx: ScreenContext, refusal: Refusal, routes: readonly { label: string; onSelect: () => void; primary?: boolean }[] = []): VNode =>
  html`<section class="s6-refusal" role="alert" data-kind=${refusal.kind} data-density=${ctx.density}>
    <h2 class="s6-refusal__heading">${refusalHeading(refusal)}</h2>
    <p class="s6-refusal__message">${refusal.message}</p>
    ${routes.length ? html`<div class="s6-refusal__routes">
      ${routes.map((r) => html`<button type="button" class="ac-action" data-kind=${r.primary ? "primary" : "quiet"} data-density=${ctx.density} onClick=${r.onSelect}>${r.label}</button>`)}
    </div>` : null}
  </section>`;

/**
 * The one mutation button this surface has. Disabled with the declared reason
 * while the gateway is unreachable (SURFACES.S6.degraded): a request that
 * looks accepted and was never received is worse than one refused.
 */
export const submitAction = (ctx: ScreenContext, label: string, id?: string, busy = false): VNode =>
  PrimaryAction({
    density: ctx.density, label, type: "submit",
    ...(id ? { id } : {}),
    ...(ctx.degraded ? { disabledReason: `Gateway unreachable — ${ctx.shell.degradedMode}` } : busy ? { disabledReason: "Sending…" } : {}),
  }) ?? html``;

export const linkTo = (ctx: ScreenContext, screen: keyof typeof SCREENS, params: Params, label: string, cls = "s6-link"): VNode =>
  html`<a class=${cls} href=${ctx.router.href(screen, params)} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate(screen, params); }}>${label}</a>`;

/** The org's nodes, as RLS narrowed them: for a facility manager, the breadcrumb above and the subtree below; for the parent, everything. */
export const nodesKey = "accounts.list";
export const readNodes = (ctx: ScreenContext) =>
  ctx.store.read(nodesKey, () => ctx.shell.gateway.listAccounts({ orgId: ctx.shell.principal.orgId }));

export type Tree = {
  readonly byId: ReadonlyMap<string, AccountWire>;
  readonly children: (id: string | null) => readonly AccountWire[];
  readonly ofTier: (tier: AccountTierWire) => readonly AccountWire[];
  /** The node's ancestry as names, region node first — the customer's own breadcrumb. */
  readonly crumbs: (id: string) => readonly string[];
};

/**
 * The visible subtree, indexed. A node whose parent is not visible (the
 * scope's own region node, whose parent is the organization) is a root here;
 * for a facility manager that is the region node above them, and the
 * location they manage hangs from it — the breadcrumb 0006 made visible.
 */
export const treeOf = (nodes: readonly AccountWire[]): Tree => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string | null, AccountWire[]>();
  for (const n of nodes) {
    const parent = n.parentId !== null && byId.has(n.parentId) ? n.parentId : null;
    const list = kids.get(parent) ?? [];
    list.push(n);
    kids.set(parent, list);
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return {
    byId,
    children: (id) => kids.get(id) ?? [],
    ofTier: (tier) => nodes.filter((n) => n.tier === tier).sort((a, b) => a.name.localeCompare(b.name)),
    crumbs: (id) => (byId.get(id)?.path ?? []).map((p) => byId.get(p)?.name ?? "…"),
  };
};

export const TIER_WORD: Readonly<Record<AccountTierWire, string>> = { region: "Region", location: "Location", site: "Site" };
export const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : "—");
