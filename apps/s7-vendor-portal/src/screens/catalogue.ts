import { html, pageHead, DataGrid, StatusPill } from "../../../../packages/ui/src/index.ts";
import type { CatalogItemWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, act, outcomeSignal, outcomeView, submitAction, formValues, money, toMinor, today, type Screen } from "./common.ts";

/**
 * CATALOGUE — the vendor's items as Rankine holds them, the price in effect
 * today, and the proposals waiting on Rankine. A proposal applies to a new
 * order only once the office accepts it; an open order keeps the price it was
 * raised at (0011).
 */
const out = outcomeSignal();

export const catalogue: Screen = (ctx) => {
  const list = ctx.store.read(keyOf("catalog.list", {}), () => ctx.shell.gateway.listCatalog({}));
  const propose = (e: Event) => {
    e.preventDefault();
    const v = formValues(e.currentTarget as HTMLFormElement);
    void act(ctx, out, async () => {
      await ctx.shell.gateway.proposePrice({ itemId: v.itemId ?? "", priceMinor: toMinor(v.price ?? ""), currency: "USD", effectiveFrom: v.effectiveFrom ?? "" });
      return "Price proposed. Rankine's office accepts or rejects it; you will see the decision here.";
    }, ["catalog.list"]);
  };
  const withdraw = (priceId: string) => void act(ctx, out, async () => {
    await ctx.shell.gateway.withdrawPrice({ priceId });
    return "Proposal withdrawn.";
  }, ["catalog.list"]);

  return html`<section class="s7-catalogue">
    ${pageHead("Catalogue", "Your items as Rankine orders them. Propose a new price from a day; it applies once Rankine accepts it, and orders already raised keep their price.")}
    ${whenReady(ctx, list.value, (c) => html`
      <div class="s7-scroll">${DataGrid({
        density: ctx.density, caption: "Items", rows: c.items, rowKey: (r: CatalogItemWire) => r.id, emptyText: "Rankine has not added any of your items yet.",
        columns: [
          { key: "sku", header: "Your SKU", cell: (r: CatalogItemWire) => r.vendorSku },
          { key: "item", header: "Item", cell: (r: CatalogItemWire) => `${r.description} (${r.uom})` },
          { key: "current", header: "Price today", align: "end", numeric: true, cell: (r: CatalogItemWire) => (r.current ? html`<span class="s7-num">${money(r.current.priceMinor, r.current.currency)}</span>` : html`<span class="s7-muted">none accepted</span>`) },
          { key: "proposed", header: "Your proposals", cell: (r: CatalogItemWire) => (r.proposals.length === 0 ? html`<span class="s7-muted">—</span>` : html`${r.proposals.map((p) => html`<div class="s7-row">
              ${StatusPill({ density: ctx.density, status: "at_risk", label: "Waiting on Rankine" })}
              <span class="s7-num">${money(p.priceMinor, p.currency)}</span><span>from ${p.effectiveFrom}</span>
              <button type="button" class="s7-link s7-link--button" onClick=${() => withdraw(p.id)}>Withdraw</button>
            </div>`)}`) },
        ],
      })}</div>
      ${c.items.length ? html`<h2 class="s7-h2">Propose a price</h2>
        <form class="s7-form s7-form--row" onSubmit=${propose} id="propose-form">
          <label class="s7-field"><span>Item</span><select class="s7-input" name="itemId" required>${c.items.map((i) => html`<option value=${i.id}>${i.vendorSku} — ${i.description}</option>`)}</select></label>
          <label class="s7-field"><span>Unit price (USD)</span><input class="s7-input" name="price" inputmode="decimal" required placeholder="42.50" /></label>
          <label class="s7-field"><span>From</span><input class="s7-input" type="date" name="effectiveFrom" min=${today()} defaultValue=${today()} required /></label>
          ${submitAction(ctx, out, "Propose", "propose-price")}
        </form>` : null}`)}
    ${outcomeView(out, "propose-outcome")}
  </section>`;
};
