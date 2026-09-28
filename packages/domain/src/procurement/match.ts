/**
 * ITEM 11 — THE THREE-WAY MATCH. A vendor's invoice against what we ordered
 * and what we received. Pure: the handler reads the three sides and stores
 * the verdict; nothing here touches a database.
 *
 * A line matches when its price is the order line's price — the accepted
 * catalogue price frozen at raise, to the minor unit, no tolerance — and its
 * quantity, together with every earlier invoice's quantity for the same line,
 * does not exceed what has been RECEIVED. An invoice matches when every line
 * does and it names every line at most once. Anything else is held, with one
 * note per disagreement, in words the office and the vendor can both act on.
 * Paying is not modelled; "matched" means ready to pay, not paid.
 */
export type OrderedLine = {
  readonly poLineId: string;
  readonly lineNo: number;
  readonly unitPriceMinor: bigint;
  readonly receivedMilli: bigint;
  /** Quantity already billed on earlier MATCHED invoices for this line. A held invoice is not a claim anyone accepted, so it does not use up the receipt. */
  readonly invoicedMilli: bigint;
};
export type InvoicedLine = { readonly poLineId: string; readonly quantityMilli: bigint; readonly unitPriceMinor: bigint };
export type MatchNote = { readonly poLineId: string | null; readonly code: "unknown_line" | "duplicate_line" | "price" | "over_received" | "empty"; readonly message: string };
export type MatchVerdict = { readonly state: "matched" | "held"; readonly notes: readonly MatchNote[] };

const qty = (milli: bigint): string => {
  const whole = milli / 1000n, frac = milli % 1000n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(3, "0").replace(/0+$/, "")}`;
};
const money = (minor: bigint): string => `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;

export const threeWayMatch = (ordered: readonly OrderedLine[], invoiced: readonly InvoicedLine[]): MatchVerdict => {
  const notes: MatchNote[] = [];
  if (invoiced.length === 0) notes.push({ poLineId: null, code: "empty", message: "the invoice has no lines" });
  const byId = new Map(ordered.map((l) => [l.poLineId, l]));
  const seen = new Set<string>();
  for (const inv of invoiced) {
    const o = byId.get(inv.poLineId);
    if (!o) { notes.push({ poLineId: inv.poLineId, code: "unknown_line", message: `line ${inv.poLineId} is not on this purchase order` }); continue; }
    if (seen.has(inv.poLineId)) { notes.push({ poLineId: inv.poLineId, code: "duplicate_line", message: `line ${o.lineNo} is billed twice on one invoice` }); continue; }
    seen.add(inv.poLineId);
    if (inv.unitPriceMinor !== o.unitPriceMinor) {
      notes.push({ poLineId: inv.poLineId, code: "price", message: `line ${o.lineNo}: billed at ${money(inv.unitPriceMinor)}, ordered at ${money(o.unitPriceMinor)}` });
    }
    const after = o.invoicedMilli + inv.quantityMilli;
    if (after > o.receivedMilli) {
      notes.push({ poLineId: inv.poLineId, code: "over_received", message: `line ${o.lineNo}: ${qty(after)} billed in all, ${qty(o.receivedMilli)} received` });
    }
  }
  return { state: notes.length === 0 ? "matched" : "held", notes };
};
