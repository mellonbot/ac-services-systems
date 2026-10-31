import { html, pageHead, signal, type VNode } from "../../../../packages/ui/src/index.ts";
import type { Refusal, RegionWire, CustomerSegment, AddressWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, noChoice, formValues, linkTo, type Screen } from "./common.ts";

/**
 * C1 — a new customer parent, WITH its first region node. One form, one
 * request, one unit of work: the operation does not exist without the node,
 * and neither does the form.
 *
 * Residential or commercial is chosen here and is fixed for good (R1, 0019).
 * A commercial customer starts as a parent and a region node and grows its
 * locations and sites in the tree; a home is all four at once — the
 * household and the home at its address — through customers.createResidential.
 */
const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: boolean }>({ refusal: null, busy: false });
const segment = signal<CustomerSegment>("commercial");

/** The address fields a home needs, shared with the lead conversion form. */
export const addressFields = (): VNode => html`
  <label class="ac-field"><span>Street address</span><input class="ac-input" name="line1" required autocomplete="off" /></label>
  <label class="ac-field"><span>Unit (optional)</span><input class="ac-input" name="line2" autocomplete="off" /></label>
  <div class="s2-address-row">
    <label class="ac-field"><span>City</span><input class="ac-input" name="city" required /></label>
    <label class="ac-field"><span>State</span><input class="ac-input" name="state" required maxlength="2" /></label>
    <label class="ac-field"><span>ZIP</span><input class="ac-input" name="postal" required inputmode="numeric" /></label>
  </div>`;
export const addressOf = (v: Readonly<Record<string, string>>): AddressWire => ({
  line1: v.line1 ?? "", ...(v.line2 ? { line2: v.line2 } : {}), city: v.city ?? "", state: (v.state ?? "").toUpperCase(), postal: v.postal ?? "", country: "US",
});

export const organizationsNew: Screen = (ctx) => {
  const { shell, store } = ctx;
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || outcome.value.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    outcome.value = { refusal: null, busy: true };
    if (segment.value === "residential") {
      try {
        const out = await shell.gateway.createResidentialCustomer({
          name: v.name ?? "", regionId: v.regionId ?? "", address: addressOf(v),
          ...(v.externalRef ? { externalRef: v.externalRef } : {}),
          ...(v.phone || v.email ? { contact: { name: v.contactName || v.name || "", ...(v.phone ? { phone: v.phone } : {}), ...(v.email ? { email: v.email } : {}) } } : {}),
        });
        store.invalidate("organizations.list");
        store.notice.value = [`Created the home "${v.name}" — the household and the home at ${v.line1}, served from its region.`, ...out.caveats];
        outcome.value = { refusal: null, busy: false };
        ctx.router.navigate("accounts.tree", { orgId: out.orgId });
      } catch (err) {
        outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
      }
      return;
    }
    try {
      const out = await shell.gateway.createOrganization({ segment: "commercial",
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

  const noRegion = (list: readonly RegionWire[]): string | null => list.some((r) => r.assignable) ? null : "No region of ours is active to serve this customer from.";
  const regionSelect = (list: readonly RegionWire[]): VNode => noRegion(list) ? noChoice("Our service region", "No region of ours is active.") : html`<label class="ac-field">
      <span>Our service region</span>
      <select class="ac-input" name="regionId" required>${list.filter((r) => r.assignable).map((r) => html`<option value=${r.id}>${r.name} (${r.code})</option>`)}</select>
    </label>`;
  const kindChoice = (): VNode => html`<fieldset class="s2-fieldset" id="org-segment">
      <legend>Kind of customer</legend>
      ${(["commercial", "residential"] as const).map((k) => html`<label class="s2-radio"><input type="radio" name="segment" value=${k} checked=${segment.value === k} onChange=${() => { segment.value = k; }} />
        <span>${k === "commercial" ? "Commercial — a business with one or more sites" : "Residential — one home"}</span></label>`)}
      <small>Fixed once created. A home that later becomes a portfolio is a new commercial customer.</small>
    </fieldset>`;
  const residentialForm = (list: readonly RegionWire[]): VNode => html`<form class="ac-form" onSubmit=${submit} id="org-form">
    ${kindChoice()}
    <label class="ac-field"><span>Household name</span><input class="ac-input" name="name" required autocomplete="off" placeholder="e.g. Turner residence" /></label>
    <fieldset class="s2-fieldset">
      <legend>The home</legend>
      ${addressFields()}
      ${regionSelect(list)}
    </fieldset>
    <fieldset class="s2-fieldset">
      <legend>Homeowner (optional)</legend>
      <label class="ac-field"><span>Name</span><input class="ac-input" name="contactName" autocomplete="off" /></label>
      <label class="ac-field"><span>Phone</span><input class="ac-input" name="phone" type="tel" /></label>
      <label class="ac-field"><span>Email</span><input class="ac-input" name="email" type="email" /></label>
      <small>Recorded as the household's primary contact when a phone or an email is given — the person a crew calls ahead.</small>
    </fieldset>
    <div class="s2-form__actions">
      ${submitAction(ctx, outcome.value.busy ? "Creating…" : "Create home", "create-org", noRegion(list))}
      ${linkTo(ctx, "accounts.tree", {}, "Cancel")}
    </div>
  </form>`;

  const form = (list: readonly RegionWire[]): VNode => segment.value === "residential" ? residentialForm(list) : html`<form class="ac-form" onSubmit=${submit} id="org-form">
    ${kindChoice()}
    <label class="ac-field"><span>Customer name</span><input class="ac-input" name="name" required autocomplete="off" /></label>
    <label class="ac-field"><span>Customer's reference (optional)</span><input class="ac-input" name="externalRef" /></label>
    <fieldset class="s2-fieldset">
      <legend>First region node</legend>
      ${regionSelect(list)}
      <label class="ac-field"><span>Node name</span><input class="ac-input" name="nodeName" placeholder="e.g. Amped / South" /></label>
      <small>A parent never exists without a place we serve it from. Both rows are written in one transaction, or neither is.</small>
    </fieldset>
    <div class="s2-form__actions">
      ${submitAction(ctx, outcome.value.busy ? "Creating…" : "Create customer", "create-org", noRegion(list))}
      ${linkTo(ctx, "accounts.tree", {}, "Cancel")}
    </div>
  </form>`;

  return html`<section class="s2-form-screen">
    ${pageHead("New customer", "A business with its first region node, or a home with everything it needs — in one step either way.")}
    ${whenReady(ctx, regions.value, (r) => form(r.regions), () => store.invalidate("regions.list"))}
    ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Back", onSelect: () => ctx.router.navigate("accounts.tree", {}) }]) : null}
  </section>`;
};
