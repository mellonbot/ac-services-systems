import { html, pageHead, signal, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, noChoice, formValues, linkTo, type Screen } from "./common.ts";

/**
 * C1 — move a node. The form offers only parents of the right tier (a
 * location moves under a region node; a site under a location) and never a
 * descendant of the node itself. The trigger holds the same rules; the form
 * simply does not offer the refusal. After the move the notice says what
 * followed: the region, and how many descendants came along.
 */
const outcome = signal<{ readonly key: string; readonly refusal: Refusal | null; readonly busy: boolean }>({ key: "", refusal: null, busy: false });

export const parentCandidates = (nodes: readonly AccountWire[], node: AccountWire): readonly AccountWire[] => {
  const wanted = node.tier === "location" ? "region" : node.tier === "site" ? "location" : null;
  if (!wanted) return [];
  return nodes.filter((n) => n.tier === wanted && n.id !== node.parentId && !n.path.includes(node.id) && n.active);
};

export const accountsMove: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const orgId = params.orgId!, id = params.id!;
  const key = `${orgId}/${id}`;
  if (outcome.value.key !== key) outcome.value = { key, refusal: null, busy: false };

  const tree = store.read(keyOf("accounts.list", { orgId }), () => shell.gateway.listAccounts({ orgId }));
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());

  const submit = (node: AccountWire) => async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || outcome.value.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    outcome.value = { key, refusal: null, busy: true };
    try {
      const out = await shell.gateway.moveAccount({ accountId: node.id, newParentId: v.newParentId ?? "" });
      store.invalidate(keyOf("accounts.list", { orgId }));
      const regionName = regions.value.state === "ready" ? regions.value.value.regions.find((r) => r.id === out.regionId)?.name ?? out.regionId : out.regionId;
      store.notice.value = [`Moved "${node.name}" — now dispatched from ${regionName}${out.movedDescendants ? `; ${out.movedDescendants} descendant${out.movedDescendants === 1 ? "" : "s"} followed` : ""}.`];
      ctx.router.navigate("accounts.tree", { orgId });
    } catch (err) {
      outcome.value = { key, refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  const form = (nodes: readonly AccountWire[], regionName: (id: string) => string): VNode => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return html`<p class="s2-empty">Node ${id} is not in this tree. ${linkTo(ctx, "accounts.tree", { orgId }, "Back")}</p>`;
    if (node.tier === "region") return html`<p class="s2-empty">"${node.name}" is a region node — the meeting point with one of our regions. It is not moved; redrawing a region is an infrastructure event. ${linkTo(ctx, "accounts.tree", { orgId }, "Back")}</p>`;
    const candidates = parentCandidates(nodes, node);
    const parentWord = node.tier === "location" ? "region node" : "location";
    const descendants = nodes.filter((n) => n.path.includes(node.id) && n.id !== node.id).length;
    return html`<section class="s2-form-screen">
      ${pageHead(`Move ${node.tier} "${node.name}"`, "Move this node under another parent of the right tier; its region and everything beneath it follow.")}
      <p class="s2-parent">Currently dispatched from <strong>${regionName(node.regionId)}</strong>${descendants ? html` with <strong>${descendants}</strong> node${descendants === 1 ? "" : "s"} beneath it, which will follow` : ""}.</p>
      <form class="ac-form" onSubmit=${submit(node)} id="move-form">
        ${candidates.length === 0
          ? noChoice(`New parent (${parentWord})`, `There is no other ${parentWord} in this tree to move under.`, linkTo(ctx, "accounts.tree", { orgId }, "Add one in the tree"))
          : html`<label class="ac-field">
          <span>New parent (${parentWord})</span>
          <select class="ac-input" name="newParentId" required>
            ${candidates.map((c) => html`<option value=${c.id}>${c.name} — ${regionName(c.regionId)}</option>`)}
          </select>
          <small>The region follows the edge. Moving under a node in another region moves the shard key of this node and everything under it.</small>
        </label>`}
        <div class="s2-form__actions">
          ${submitAction(ctx, outcome.value.busy ? "Moving…" : "Move", "move", candidates.length === 0 ? `There is no other ${parentWord} to move under.` : null)}
          ${linkTo(ctx, "accounts.tree", { orgId }, "Cancel")}
        </div>
      </form>
      ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Back to the tree", onSelect: () => ctx.router.navigate("accounts.tree", { orgId }) }]) : null}
    </section>`;
  };

  return whenReady(ctx, tree.value, (t) => whenReady(ctx, regions.value, (r) => form(t.nodes, (rid) => r.regions.find((x) => x.id === rid)?.name ?? rid)), () => store.invalidate(keyOf("accounts.list", { orgId })));
};
