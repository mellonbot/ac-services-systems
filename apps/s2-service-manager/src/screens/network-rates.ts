import { html, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import type { RateCardWire, FirmWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, formValues, linkTo, type Screen } from "./common.ts";

/**
 * C4 — a firm's rate card, as a timeline rather than a value.
 *
 * A rate is not a number on a firm; it is a number over a period, and the
 * question settlement asks is "what did this service code cost on the day the
 * job was done". So the screen lists every row with its window and marks the
 * one in effect today, and the form sets a rate FROM a day — it does not edit
 * the current one. Setting one closes the row in effect at that day and opens
 * the new one, which is two audited mutations and one price line a reader can
 * follow backwards.
 *
 * Money is a digits-only text field, never `type="number"`: a JSON number is an
 * IEEE-754 double, and the money path is integer minor units all the way down
 * (lint holds the same rule in the domain). The field is labelled in minor
 * units and the row prints the major-unit reading beside it, because "9500" is
 * ambiguous to a human and unambiguous to the ledger.
 */
const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: boolean }>({ refusal: null, busy: false });

/** Minor units → a reading, for the eye only. Two decimal places is USD's; the currency's own minor_units lives in the database and is not fetched for a label. */
export const readable = (minor: string, currency: string): string =>
  `${currency} ${(Number(minor) / 100).toFixed(2)}`;

/** Empty named fields by name. The fields a default belongs to are left alone. */
const clear = (form: HTMLFormElement, names: readonly string[]): void => {
  for (const n of names) { const el = form.elements.namedItem(n); if (el instanceof HTMLInputElement) el.value = ""; }
};

export const inEffect = (r: RateCardWire, today: string): boolean => r.effectiveFrom <= today && (r.effectiveTo === null || r.effectiveTo > today);

export const networkRates: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const firmId = params.firmId!;
  const today = new Date().toISOString().slice(0, 10);
  const firms = store.read(keyOf("firms.list"), () => shell.gateway.listFirms({}));
  const cards = store.read(keyOf("rateCards.list", { firmId }), () => shell.gateway.listRateCards({ firmId }));

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || outcome.value.busy) return;
    const form = e.currentTarget as HTMLFormElement;
    const v = formValues(form);
    outcome.value = { refusal: null, busy: true };
    try {
      const out = await shell.gateway.setRateCard({
        firmId,
        serviceCode: v.serviceCode ?? "",
        rateMinor: v.rateMinor ?? "",
        currency: v.currency ?? "USD",
        effectiveFrom: v.effectiveFrom ?? "",
        ...(v.effectiveTo ? { effectiveTo: v.effectiveTo } : {}),
      });
      store.invalidate(keyOf("rateCards.list", { firmId }));
      store.notice.value = [out.closedId ? "Rate set. The row that was in effect was closed at the new first day." : "Rate set."];
      outcome.value = { refusal: null, busy: false };
      // NOT form.reset(). A reset restores each field to its ATTRIBUTE value,
      // and the renderer sets `value` as a DOM PROPERTY — so a reset emptied
      // the currency field, HTML5 validation then blocked the next submit with
      // no message, and the second rate of the session silently never reached
      // the gateway. Found by driving two rates in a row in a real browser; a
      // string render cannot see it, because the markup is identical either way.
      // Clearing the fields that should clear also keeps the currency and the
      // service code for the next row, which is what setting rates actually is.
      clear(form, ["rateMinor", "effectiveFrom", "effectiveTo"]);
    } catch (err) {
      outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  const grid = (list: readonly RateCardWire[]): VNode =>
    DataGrid({
      density: ctx.density, caption: "Rates over time",
      columns: [
        { key: "serviceCode", header: "Service code" },
        { key: "rateMinor", header: "Rate", align: "end", numeric: true, cell: (r: RateCardWire) => html`<span>${r.rateMinor} <small class="s2-muted">${readable(r.rateMinor, r.currency)}</small></span>` },
        { key: "effectiveFrom", header: "In effect", cell: (r: RateCardWire) => `${r.effectiveFrom} → ${r.effectiveTo ?? "open"}` },
        { key: "now", header: "", cell: (r: RateCardWire) => inEffect(r, today) ? html`<span class="s2-state" data-tone="live">today</span>` : null },
      ],
      rows: list, rowKey: (r: RateCardWire) => r.id,
      emptyText: "No rates recorded for this firm yet.",
    });

  return html`<section class="s2-form-screen">
    ${whenReady(ctx, firms.value, (f) => {
      const firm = f.firms.find((x: FirmWire) => x.id === firmId);
      return html`<header class="s2-tree__head">
        <h2 class="s2-h2">${firm?.legalName ?? "Firm"} — rate card</h2>
        ${linkTo(ctx, "network", { firmId }, "Back to the firm")}
      </header>`;
    })}
    ${whenReady(ctx, cards.value, (c) => grid(c.rateCards))}
    <h3 class="s2-h2">Set a rate from a day</h3>
    <form class="s2-form" onSubmit=${submit} id="rate-form">
      <label class="s2-field"><span>Service code</span><input class="s2-input" name="serviceCode" required placeholder="HVAC_REPAIR" /></label>
      <label class="s2-field">
        <span>Rate (minor units)</span>
        <input class="s2-input" name="rateMinor" required inputmode="numeric" pattern="[0-9]*" placeholder="9500" />
        <small>Integer minor units — 9500 is ninety-five dollars. Never a decimal: the money path carries no floats.</small>
      </label>
      <label class="s2-field"><span>Currency</span><input class="s2-input" name="currency" defaultValue="USD" required /></label>
      <label class="s2-field"><span>Effective from</span><input class="s2-input" type="date" name="effectiveFrom" required /><small>The row in effect that day is closed at it. Both are audited.</small></label>
      <label class="s2-field"><span>Effective to</span><input class="s2-input" type="date" name="effectiveTo" /><small>Leave empty for open-ended. A window that would sit on top of a later row is refused — two prices on one day is a settlement nobody can check.</small></label>
      <div class="s2-form__actions">
        ${submitAction(ctx, outcome.value.busy ? "Setting…" : "Set rate", "set-rate")}
      </div>
    </form>
    ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Dismiss", onSelect: () => { outcome.value = { refusal: null, busy: false }; } }]) : null}
  </section>`;
};
