import { html, pageHead, panel, signal, DataGrid, type Column, type VNode } from "../../../../packages/ui/src/index.ts";
import type { LeadWire, Refusal, RegionWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, noChoice, afterRender, formValues, type Screen, type ScreenContext } from "./common.ts";
import { addressFields, addressOf } from "./organizations-new.ts";

/**
 * LEADS — what S1 captured, and the office turning one into a home it serves
 * (arc 1's second half). A lead is read here by 0008's policy (ours only);
 * converting it is customers.createResidential with the lead's name and
 * contact, plus the lead remembering the home it became — once.
 */
type Show = "waiting" | "all";
const show = signal<Show>("waiting");
const converting = signal<{ readonly leadId: string; readonly busy: boolean; readonly refusal: Refusal | null } | null>(null);
export const resetLeads = () => { show.value = "waiting"; converting.value = null; };

const received = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const convertPanel = (ctx: ScreenContext, lead: LeadWire, regions: readonly RegionWire[]): VNode => {
  const c = converting.value!;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || c.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    converting.value = { leadId: lead.id, busy: true, refusal: null };
    try {
      const out = await ctx.shell.gateway.convertLead({ leadId: lead.id, regionId: v.regionId ?? "", address: addressOf(v), ...(v.name ? { name: v.name } : {}) });
      converting.value = null;
      ctx.store.invalidate("leads.list");
      ctx.store.invalidate("organizations.list");
      ctx.store.notice.value = [`${lead.contact.name} is now a residential customer — the household and the home at ${v.line1}.`, ...out.caveats];
      ctx.router.navigate("accounts.tree", { orgId: out.orgId });
    } catch (err) {
      converting.value = { leadId: lead.id, busy: false, refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } };
    }
  };
  const active = regions.filter((r) => r.active);
  return panel(html`<form class="ac-form" id="lead-convert-form" onSubmit=${submit}>
      <label class="ac-field"><span>Household name</span><input class="ac-input" name="name" defaultValue=${`${lead.contact.name} residence`} required /></label>
      ${addressFields()}
      ${active.length === 0 ? noChoice("Our service region", "No region of ours is active.") : html`<label class="ac-field"><span>Our service region</span>
        <select class="ac-input" name="regionId" required>${active.map((r) => html`<option value=${r.id}>${r.name} (${r.code})</option>`)}</select>
      </label>`}
      <small>${lead.contact.phone || lead.contact.email ? "Their phone and email become the household's primary contact." : "The lead left no phone or email, so no contact is recorded."}</small>
      <div class="s2-form__actions">
        ${submitAction(ctx, c.busy ? "Converting…" : "Convert to residential customer", "lead-convert-submit", active.length === 0 ? "No region of ours is active to serve them from." : null)}
        <button type="button" class="ac-link ac-link--button" id="lead-convert-cancel" onClick=${() => { converting.value = null; afterRender((d) => d.getElementById(`convert-${lead.id}`)?.focus()); }}>Cancel</button>
      </div>
      ${c.refusal ? refusalView(ctx, c.refusal) : null}
    </form>`, `Convert ${lead.contact.name}`, lead.requestedMetro ? `Asked about ${lead.requestedMetro}` : undefined, undefined, "lead-convert");
};

export const leads: Screen = (ctx) => {
  const list = ctx.store.read(keyOf("leads.list", { include: show.value }), () => ctx.shell.gateway.listLeads({ include: show.value }));
  const regions = ctx.store.read(keyOf("regions.list"), () => ctx.shell.gateway.listRegions());

  const columns: readonly Column<LeadWire>[] = [
    { key: "received", header: "Received", numeric: true, cell: (l) => received(l.createdAt) },
    { key: "name", header: "Name", cell: (l) => html`<strong>${l.contact.name}</strong>` },
    { key: "reach", header: "Reach them", cell: (l) => html`${l.contact.phone ? html`<a class="ac-link" href=${`tel:${l.contact.phone}`}>${l.contact.phone}</a>` : null}${l.contact.phone && l.contact.email ? html`<br />` : null}${l.contact.email ? html`<a class="ac-link" href=${`mailto:${l.contact.email}`}>${l.contact.email}</a>` : null}${!l.contact.phone && !l.contact.email ? "—" : null}` },
    { key: "metro", header: "Area", cell: (l) => l.requestedMetro ?? "—" },
    { key: "note", header: "They said", cell: (l) => l.contact.note ?? "—" },
    { key: "source", header: "Came from", cell: (l) => l.source },
    { key: "status", header: "", cell: (l) => l.convertedAccountId
      ? html`<span class="s2-muted">Converted</span>`
      : html`<button type="button" class="ac-link ac-link--button" id=${`convert-${l.id}`} aria-label=${`Convert ${l.contact.name}`} disabled=${ctx.degraded}
          onClick=${() => {
            converting.value = { leadId: l.id, busy: false, refusal: null };
            // The form opens above the list, out of reach of the row that asked for it: take the keyboard there.
            afterRender((d) => d.querySelector<HTMLInputElement>("#lead-convert-form input")?.focus());
          }}>Convert</button>` },
  ];

  return html`<section class="s2-leads">
    ${pageHead("Leads", "People who asked us to call them from the website. When one becomes a customer, convert it — the home is made in one step, with their contact on it.")}
    ${whenReady(ctx, list.value, (out) => {
      const open = converting.value ? out.leads.find((l) => l.id === converting.value!.leadId && !l.convertedAccountId) : undefined;
      return html`
        ${open ? whenReady(ctx, regions.value, (r) => convertPanel(ctx, open, r.regions)) : null}
        ${panel(DataGrid({ density: "console", columns, rows: out.leads, rowKey: (l: LeadWire) => l.id, emptyText: show.value === "waiting" ? "No leads waiting." : "No leads yet.", stack: true }) ?? html``,
          "Leads", show.value === "waiting" ? "Waiting to be converted, newest first" : "Every lead, newest first",
          html`<div class="s2-chips" role="group" aria-label="Show">
            ${(["waiting", "all"] as const).map((k) => html`<button type="button" class="ac-chip" aria-pressed=${show.value === k ? "true" : "false"} onClick=${() => { show.value = k; }}>${k === "waiting" ? "Waiting" : "All"}</button>`)}
          </div>`, "leads-list")}`;
    }, () => ctx.store.invalidate("leads.list"))}
  </section>`;
};
