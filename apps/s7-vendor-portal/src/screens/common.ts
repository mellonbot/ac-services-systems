import { html, signal, RefusalNotice, PrimaryAction, StatusPill, type VNode, type Router, type Status } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import { densityOf, type Refusal, type DensityOf, type PoState } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import type { SCREENS } from "../screens.ts";
export { formValues, linkTo } from "../../../../packages/ui/src/screen-helpers.ts";
export { formatQuantity as qty, parseQuantity as toMilli, formatMoney as money } from "../../../../packages/ui/src/fixed-units.ts";
import { parseMoney } from "../../../../packages/ui/src/fixed-units.ts";

export type ScreenContext = {
  readonly shell: Shell;
  readonly store: Store;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S7">;
  readonly degraded: boolean;
};
export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

const refusalBlock = (r: Refusal, onDismiss?: () => void): VNode =>
  RefusalNotice({ density: densityOf("S7"), refusal: r, ...(onDismiss ? { onDismiss } : {}) }) ?? html``;

export const whenReady = <T>(_ctx: ScreenContext, r: Resource<T>, view: (v: T) => VNode): VNode => {
  switch (r.state) {
    case "loading": return html`<p class="s7-loading" role="status">Loading…</p>`;
    case "ready": return view(r.value);
    case "refused": return refusalBlock(r.refusal);
  }
};

/** One outcome per screen: busy, the last success in words, or the gateway's refusal in its words. */
export const outcomeSignal = () => signal<{ readonly refusal: Refusal | null; readonly sent: string | null; readonly busy: boolean }>({ refusal: null, sent: null, busy: false });
export type Outcome = ReturnType<typeof outcomeSignal>;

export const act = async (ctx: ScreenContext, out: Outcome, fn: () => Promise<string>, invalidate: readonly string[]): Promise<void> => {
  if (ctx.degraded || out.value.busy) return;
  out.value = { refusal: null, sent: null, busy: true };
  try {
    const msg = await fn();
    for (const k of invalidate) ctx.store.invalidate(k);
    out.value = { refusal: null, sent: msg, busy: false };
  } catch (err) {
    out.value = { refusal: ctx.shell.refusalOf(err) ?? { kind: "bad_request", message: err instanceof Error ? err.message : String(err) }, sent: null, busy: false };
  }
};
export const outcomeView = (out: Outcome, id: string): VNode | null =>
  out.value.refusal ? refusalBlock(out.value.refusal, () => { out.value = { refusal: null, sent: null, busy: false }; })
  : out.value.sent ? html`<p class="ac-notice" data-tone="ok" role="status" id=${id}>${out.value.sent}</p>` : null;

export const submitAction = (ctx: ScreenContext, out: Outcome, label: string, id: string): VNode =>
  PrimaryAction({
    density: ctx.density, label: out.value.busy ? "Sending…" : label, type: "submit", id,
    ...(ctx.degraded ? { disabledReason: `Rankine's system is unreachable — ${ctx.shell.degradedMode}` } : {}),
  }) ?? html``;

/** An order in the vendor's words. Waiting on the vendor is the one state that asks something of them. */
export const PO_WORD: Readonly<Record<PoState, { status: Status; word: string }>> = {
  draft: { status: "blocked", word: "Draft" },
  issued: { status: "at_risk", word: "Needs your acknowledgement" },
  acknowledged: { status: "ok", word: "Acknowledged" },
  received: { status: "ok", word: "Received in full" },
  cancelled: { status: "blocked", word: "Cancelled" },
};
export const poPill = (ctx: ScreenContext, s: PoState): VNode => StatusPill({ density: ctx.density, status: PO_WORD[s].status, label: PO_WORD[s].word }) ?? html``;
export const TIER_WORD = { location_stock: "Location stock", regional_hub: "Regional hub", national: "National warehouse" } as const;

export const toMinor = (typed: string): string => parseMoney(typed, `"${typed}" is not an amount — use digits and at most two decimals`);
/** Minor units → "42.50", for prefilling a price field. */
export const plain = (minor: string): string => { const n = BigInt(minor); return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`; };
export const today = (): string => new Date().toISOString().slice(0, 10);
