import { html, signal, refusalHeading, PrimaryAction, StatusPill, type VNode, type Router, type Status } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf, PoState } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import type { SCREENS } from "../screens.ts";

export type ScreenContext = {
  readonly shell: Shell;
  readonly store: Store;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S7">;
  readonly degraded: boolean;
};
export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

const refusalBlock = (r: Refusal, onDismiss?: () => void): VNode => html`<section class="s7-refusal" role="alert" data-kind=${r.kind}>
  <h2 class="s7-refusal__heading">${refusalHeading(r)}</h2>
  <p class="s7-refusal__message">${r.message}</p>
  ${onDismiss ? html`<button type="button" class="s7-link s7-link--button" onClick=${onDismiss}>Dismiss</button>` : null}
</section>`;

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
  : out.value.sent ? html`<p class="s7-sent" role="status" id=${id}>${out.value.sent}</p>` : null;

export const submitAction = (ctx: ScreenContext, out: Outcome, label: string, id: string): VNode =>
  PrimaryAction({
    density: ctx.density, label: out.value.busy ? "Sending…" : label, type: "submit", id,
    ...(ctx.degraded ? { disabledReason: `Rankine's system is unreachable — ${ctx.shell.degradedMode}` } : {}),
  }) ?? html``;

export const formValues = (form: HTMLFormElement): Record<string, string> => {
  const o: Record<string, string> = {};
  new FormData(form).forEach((v, k) => { if (typeof v === "string") o[k] = v.trim(); });
  return o;
};

export const linkTo = (ctx: ScreenContext, screen: keyof typeof SCREENS, params: Params, label: string, cls = "s7-link"): VNode =>
  html`<a class=${cls} href=${ctx.router.href(screen, params)} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate(screen, params); }}>${label}</a>`;

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

export const qty = (milli: string): string => {
  const n = BigInt(milli), whole = n / 1000n, frac = n % 1000n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(3, "0").replace(/0+$/, "")}`;
};
export const toMilli = (typed: string): string => {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(typed.trim());
  if (!m) throw new Error(`"${typed}" is not a quantity`);
  return (BigInt(m[1]!) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0") || "0")).toString();
};
export const money = (minor: string, currency = "USD"): string => {
  const n = BigInt(minor), whole = n / 100n, cents = (n % 100n).toString().padStart(2, "0");
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents} ${currency}`;
};
export const toMinor = (typed: string): string => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!m) throw new Error(`"${typed}" is not an amount — use digits and at most two decimals`);
  return (BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0")).toString();
};
/** Minor units → "42.50", for prefilling a price field. */
export const plain = (minor: string): string => { const n = BigInt(minor); return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`; };
export const today = (): string => new Date().toISOString().slice(0, 10);
