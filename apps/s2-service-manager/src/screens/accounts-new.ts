import { html, signal, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, CreateAccountInput, Refusal, RegionWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, formValues, linkTo, type Screen, type ScreenContext } from "./common.ts";

/**
 * C1 — author a node. Three tiers, one form, with the shape the catalogue
 * admits: a region node binds to one of OUR regions (the only tier where
 * region is an input); a location or site names its parent and the region
 * follows the edge — the form does not even offer a region field below the
 * region tier, because offering one would be offering the refusal.
 *
 * A refusal renders as a decision (RefusalCard): the trigger's words for a
 * ladder violation, `supply_below_density` as commercial with a route to
 * the person who prices it. A D14 caveat is admitted and shown as a banner on
 * the tree, not a modal here.
 */
const outcome = signal<{ readonly key: string; readonly refusal: Refusal | null; readonly busy: boolean }>({ key: "", refusal: null, busy: false });

const TIERS = ["region", "location", "site"] as const;
type Tier = (typeof TIERS)[number];
const isTier = (s: string | undefined): s is Tier => (TIERS as readonly string[]).includes(s ?? "");

export const accountsNew: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const orgId = params.orgId!;
  const tier = params.tier;
  const parentId = params.parentId;
  const key = `${orgId}/${tier}/${parentId ?? ""}`;
  if (outcome.value.key !== key) outcome.value = { key, refusal: null, busy: false };

  if (!isTier(tier)) return html`<p class="s2-empty">Unknown tier "${tier}". ${linkTo(ctx, "accounts.tree", { orgId }, "Back to the tree")}</p>`;
  if (tier !== "region" && !parentId) return html`<p class="s2-empty">A ${tier} needs a parent. Pick one in ${linkTo(ctx, "accounts.tree", { orgId }, "the tree")}.</p>`;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || outcome.value.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    const input: CreateAccountInput = {
      orgId, tier, name: v.name ?? "",
      ...(tier === "region" ? { regionId: v.regionId ?? "" } : { parentId: parentId! }),
      ...(v.customerGroup ? { customerGroup: v.customerGroup } : {}),
      ...(v.externalRef ? { externalRef: v.externalRef } : {}),
      ...(v.timezone ? { timezone: v.timezone } : {}),
    };
    outcome.value = { key, refusal: null, busy: true };
    try {
      const out = await shell.gateway.createAccount(input);
      store.invalidate(keyOf("accounts.list", { orgId }));
      store.invalidate("organizations.list");
      store.notice.value = [`Created ${tier} "${input.name}".`, ...out.caveats.map((c) => `Admitted with a caveat: ${c}.`)];
      ctx.router.navigate("accounts.tree", { orgId });
    } catch (err) {
      outcome.value = { key, refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  const regionField = (regions: readonly RegionWire[]): VNode => html`<label class="s2-field">
    <span>Our service region</span>
    <select name="regionId" required class="s2-input">
      ${regions.filter((r) => r.active).map((r) => html`<option value=${r.id}>${r.name} (${r.code})</option>`)}
    </select>
    <small>The region node is where this customer's tree meets one of our regions. Everything under it is dispatched from here.</small>
  </label>`;

  const parentLine = (nodes: readonly AccountWire[], regions: readonly RegionWire[]): VNode => {
    const p = nodes.find((n) => n.id === parentId);
    if (!p) return html`<p class="s2-empty">Parent ${parentId} is not in this tree.</p>`;
    const region = regions.find((r) => r.id === p.regionId);
    return html`<p class="s2-parent">Under <strong>${p.name}</strong> (${p.tier}) — dispatched from <strong>${region?.name ?? p.regionId}</strong>. The region follows the edge; it is not chosen here.</p>`;
  };

  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const tree = parentId ? store.read(keyOf("accounts.list", { orgId }), () => shell.gateway.listAccounts({ orgId })) : null;

  return html`<section class="s2-form-screen">
    <h2 class="s2-h2">New ${tier}</h2>
    ${tree ? whenReady(ctx, tree.value, (t) => whenReady(ctx, regions.value, (r) => parentLine(t.nodes, r.regions))) : null}
    <form class="s2-form" onSubmit=${submit} id="account-form">
      <label class="s2-field"><span>Name</span><input class="s2-input" name="name" required autocomplete="off" /></label>
      ${tier === "region" ? whenReady(ctx, regions.value, (r) => regionField(r.regions)) : null}
      ${tier !== "region" ? html`
        <label class="s2-field"><span>Customer's own grouping</span><input class="s2-input" name="customerGroup" placeholder="e.g. Mountain — an attribute, never structure" /></label>
        <label class="s2-field"><span>Customer's site / store code</span><input class="s2-input" name="externalRef" /></label>
        <label class="s2-field"><span>Timezone (IANA)</span><input class="s2-input" name="timezone" placeholder="America/Chicago" /></label>` : null}
      <div class="s2-form__actions">
        ${submitAction(ctx, outcome.value.busy ? "Creating…" : `Create ${tier}`, "create")}
        ${linkTo(ctx, "accounts.tree", { orgId }, "Cancel")}
      </div>
    </form>
    ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, refusalRoutes(ctx, outcome.value.refusal, orgId, tier, parentId)) : null}
  </section>`;
};

/** Where a refusal can go from here — the route is part of the decision (09 §3.8). */
export const refusalRoutes = (ctx: ScreenContext, r: Refusal, orgId: string, tier: Tier, parentId: string | undefined) => {
  const routes: { label: string; onSelect: () => void; primary?: boolean }[] = [];
  if (r.kind === "admission" && r.code === "supply_below_density") {
    // Phase 1: the commercial route opens the account owner's contact with the refusal text; `commercial_review` is a later catalogue row.
    routes.push({ label: "Request commercial review", onSelect: () => { ctx.store.notice.value = [`Commercial review requested: ${r.message}`]; ctx.router.navigate("accounts.tree", { orgId }); }, primary: true });
  }
  if (r.kind === "admission" && r.code === "ac_accounts_derive_region" && tier === "site" && parentId) {
    routes.push({ label: "Add a location here instead", onSelect: () => ctx.router.navigate("accounts.new", { orgId, tier: "location", parentId }), primary: true });
  }
  routes.push({ label: "Back to the tree", onSelect: () => ctx.router.navigate("accounts.tree", { orgId }) });
  return routes;
};
