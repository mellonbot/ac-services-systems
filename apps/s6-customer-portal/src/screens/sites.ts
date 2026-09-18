import { html, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, JobWire, ServiceRequestWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, readNodes, treeOf, linkTo, TIER_WORD, type Screen, type ScreenContext, type Tree } from "./common.ts";
import { slaStatus, isOpen } from "./work.ts";

/**
 * SITES — S6's home. The customer's own tree as the gateway lets this
 * principal see it: for a facility manager, the location they manage and its
 * sites under the region node they hang from; for the parent, every region
 * node, location and site. Nothing here filters — the difference between the
 * two views is entirely which rows `accounts.list` returned (0006).
 *
 * Each site carries its live work and its open requests, read from the same
 * two operations the Work screen reads, so a site's line and the work list
 * cannot disagree about what is happening there.
 */
export const sites: Screen = (ctx) => {
  const nodes = readNodes(ctx);
  const jobs = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const requests = ctx.store.read(keyOf("serviceRequests.list", {}), () => ctx.shell.gateway.listServiceRequests({}));
  const scope = ctx.shell.principal;

  return html`<section class="s6-sites">
    <h1 class="s6-h1">${ctx.shell.context?.parent.name ?? "Your sites"}</h1>
    <p class="s6-scope">${scopeSentence(ctx)}</p>
    ${whenReady(ctx, nodes.value, (out) => {
      const tree = treeOf(out.nodes);
      const roots = tree.children(null);
      if (roots.length === 0) return html`<p class="s6-empty">No sites are in view for this account yet.</p>`;
      const liveJobs = jobs.value.state === "ready" ? jobs.value.value.jobs : [];
      const openRequests = requests.value.state === "ready" ? requests.value.value.requests.filter((r) => r.jobId === null) : [];
      return html`<ul class="s6-tree" role="tree" aria-label="Sites in view">
        ${roots.map((n) => nodeView(ctx, tree, n, liveJobs, openRequests, scope.scopeId))}
      </ul>`;
    }, () => ctx.store.invalidate("accounts.list"))}
  </section>`;
};

/** One sentence that says what this principal is looking at — the tier and the node, from the context the gateway resolved at login. */
export const scopeSentence = (ctx: ScreenContext): string => {
  const p = ctx.shell.principal;
  const path = ctx.shell.context?.path ?? [];
  const at = path[path.length - 1];
  if (p.scopeTier === "parent") return "Every region, location and site under this agreement.";
  const word = TIER_WORD[p.scopeTier as keyof typeof TIER_WORD] ?? p.scopeTier;
  return `${word}: ${at?.name ?? "—"}. You see this ${word.toLowerCase()} and what is under it.`;
};

const nodeView = (ctx: ScreenContext, tree: Tree, n: AccountWire, jobs: readonly JobWire[], requests: readonly ServiceRequestWire[], scopeId: string): VNode => {
  const kids = tree.children(n.id);
  const isSite = n.tier === "site";
  const here = jobs.filter((j) => j.siteId === n.id && isOpen(j));
  const asked = requests.filter((r) => r.siteId === n.id);
  const worst = here.reduce<"ok" | "at_risk" | "breached">((acc, j) => {
    const s = slaStatus(j, Date.now());
    return s === "breached" || acc === "breached" ? "breached" : s === "at_risk" || acc === "at_risk" ? "at_risk" : "ok";
  }, "ok");
  return html`<li class="s6-node" role="treeitem" aria-expanded=${kids.length ? "true" : undefined} data-tier=${n.tier} data-scope=${n.id === scopeId ? "true" : "false"}>
    <div class="s6-node__row">
      <span class="s6-node__tier">${TIER_WORD[n.tier]}</span>
      <span class="s6-node__name">${n.name}</span>
      ${n.customerGroup ? html`<span class="s6-node__group" title="Your own grouping — reportable, never structure">${n.customerGroup}</span>` : null}
      ${isSite ? html`<span class="s6-node__facts">
        ${here.length ? StatusPill({ density: ctx.density, status: worst, label: `${here.length} open job${here.length === 1 ? "" : "s"}` }) : html`<span class="s6-muted">No open work</span>`}
        ${asked.length ? html`<span class="s6-muted">· ${asked.length} request${asked.length === 1 ? "" : "s"} waiting</span>` : null}
      </span>` : null}
      <span class="s6-node__actions">
        ${linkTo(ctx, "terms", { tier: n.tier, nodeId: n.id }, "Terms")}
        ${isSite ? linkTo(ctx, "request", { siteId: n.id }, "Request service") : null}
      </span>
    </div>
    ${kids.length ? html`<ul class="s6-tree" role="group">${kids.map((k) => nodeView(ctx, tree, k, jobs, requests, scopeId))}</ul>` : null}
  </li>`;
};
