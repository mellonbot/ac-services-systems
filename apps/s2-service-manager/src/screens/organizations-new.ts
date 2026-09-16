import { html, signal, type VNode } from "../../../../packages/ui/src/index.ts";
import type { Refusal, RegionWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, formValues, linkTo, type Screen } from "./common.ts";

/**
 * C1 — a new customer parent, WITH its first region node. One form, one
 * request, one unit of work: the operation does not exist without the node,
 * and neither does the form.
 */
const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: boolean }>({ refusal: null, busy: false });

export const organizationsNew: Screen = (ctx) => {
  const { shell, store } = ctx;
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || outcome.value.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    outcome.value = { refusal: null, busy: true };
    try {
      const out = await shell.gateway.createOrganization({
        name: v.name ?? "", ...(v.externalRef ? { externalRef: v.externalRef } : {}),
        firstRegionNode: { regionId: v.regionId ?? "", name: v.nodeName || `${v.name ?? ""} / ${v.regionLabel ?? ""}`.trim() },
      });
      store.invalidate("organizations.list");
      store.notice.value = [`Created customer "${v.name}" with its first region node.`];
      outcome.value = { refusal: null, busy: false };
      ctx.router.navigate("accounts.tree", { orgId: out.orgId });
    } catch (err) {
      outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  const form = (list: readonly RegionWire[]): VNode => html`<form class="s2-form" onSubmit=${submit} id="org-form">
    <label class="s2-field"><span>Customer name</span><input class="s2-input" name="name" required autocomplete="off" /></label>
    <label class="s2-field"><span>Customer's reference (optional)</span><input class="s2-input" name="externalRef" /></label>
    <fieldset class="s2-fieldset">
      <legend>First region node</legend>
      <label class="s2-field">
        <span>Our service region</span>
        <select class="s2-input" name="regionId" required>${list.filter((r) => r.active).map((r) => html`<option value=${r.id}>${r.name} (${r.code})</option>`)}</select>
      </label>
      <label class="s2-field"><span>Node name</span><input class="s2-input" name="nodeName" placeholder="e.g. Amped / South" /></label>
      <small>A parent never exists without a place we serve it from. Both rows are written in one transaction, or neither is.</small>
    </fieldset>
    <div class="s2-form__actions">
      ${submitAction(ctx, outcome.value.busy ? "Creating…" : "Create customer", "create-org")}
      ${linkTo(ctx, "accounts.tree", {}, "Cancel")}
    </div>
  </form>`;

  return html`<section class="s2-form-screen">
    <h2 class="s2-h2">New customer</h2>
    ${whenReady(ctx, regions.value, (r) => form(r.regions), () => store.invalidate("regions.list"))}
    ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Back", onSelect: () => ctx.router.navigate("accounts.tree", {}) }]) : null}
  </section>`;
};
