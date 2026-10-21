import { COOL_CLUB, type AddressWire, type BillingPath, type CustomerSegment, type EquipmentKind } from "../../../contracts/src/index.ts";
import { CustomerCardSpec } from "../component.ts";
import { component, html } from "../render.ts";

/** The words a customer reads for what we service and what they are on — one place, so the portal and the console never disagree. */
export const KIND_WORD: Readonly<Record<EquipmentKind, string>> = {
  rtu: "Rooftop unit", split: "Split system", package: "Package unit", ahu: "Air handler", chiller: "Chiller", boiler: "Boiler",
  heat_pump: "Heat pump", mini_split: "Mini-split", vrf: "VRF", exhaust: "Exhaust fan", mau: "Make-up air", controls: "Controls", other: "Other equipment",
};
export const PLAN_WORD: Readonly<Record<BillingPath, string>> = {
  enterprise_sla: "Enterprise SLA", residential_membership: COOL_CLUB.name, project: "Project", one_time: "One-time service",
};
export const addressLines = (a: AddressWire | null): readonly string[] => {
  if (!a) return [];
  const cityLine = [a.city, [a.state, a.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.line1, a.line2, cityLine, a.country].filter((s): s is string => Boolean(s && s.trim()));
};

export type CustomerCardUnit = { readonly name: string; readonly detail: string; readonly servicedOn: string | null };

export type CustomerCardProps = {
  readonly id?: string;
  readonly name: string;
  readonly segment: CustomerSegment | null;
  readonly sites: number;
  readonly locations: number;
  /** Active agreements, as plan words (PLAN_WORD). */
  readonly plans: readonly string[];
  /** A residential customer's one home: its address, the units there (null while they load), and the membership. */
  readonly home?: {
    readonly address: readonly string[];
    readonly units: readonly CustomerCardUnit[] | null;
    readonly membership: { readonly name: string; readonly since: string; readonly through: string | null } | null;
  };
};

/**
 * The customer card — S6's account card (a commercial customer: sites across
 * locations, the plans they are on) and its "Your home" card (a homeowner: the
 * address, the units there, the membership), drawn once. S2 shows it when a
 * customer in the Accounts list is hovered or focused, so the office sees what
 * the customer sees. Read-only: no action is offered on it.
 */
export const CustomerCard = component<typeof CustomerCardSpec, CustomerCardProps>(CustomerCardSpec, (p) => {
  const plural = (n: number, word: string) => html`<span class="ac-num">${n}</span> ${word}${n === 1 ? "" : "s"}`;
  return html`<article class="ac-customer-card" id=${p.id} data-segment=${p.segment ?? "unknown"} data-density=${p.density}>
    <header class="ac-customer-card__head">
      <h3 class="ac-customer-card__name">${p.name}</h3>
      <p class="ac-customer-card__sub">${p.segment === "residential" ? "Residential" : p.segment === "commercial" ? "Commercial" : "Customer"}
        ${p.home ? null : html` · ${plural(p.sites, "site")} across ${plural(p.locations, "location")}`}</p>
    </header>
    ${p.home
      ? html`
        <p class="ac-customer-card__address">${p.home.address.length ? p.home.address.map((l, i) => html`${i ? html`<br />` : null}${l}`) : html`<span class="ac-customer-card__muted">No address on record.</span>`}</p>
        ${p.home.units === null
          ? html`<p class="ac-customer-card__muted" role="status">Loading equipment…</p>`
          : p.home.units.length
            ? html`<ul class="ac-customer-card__units">${p.home.units.map((u) => html`<li>
                <span class="ac-customer-card__unit">${u.name}</span>
                ${u.detail ? html`<span class="ac-customer-card__muted">${u.detail}</span>` : null}
                <span class="ac-customer-card__muted">${u.servicedOn ? html`Serviced <span class="ac-num">${u.servicedOn}</span>` : "Not yet serviced by us"}</span>
              </li>`)}</ul>`
            : html`<p class="ac-customer-card__muted">No equipment on record yet.</p>`}
        <p class="ac-customer-card__membership">${p.home.membership
          ? html`<strong>${p.home.membership.name}</strong> · member since <span class="ac-num">${p.home.membership.since}</span>${p.home.membership.through ? html`, through <span class="ac-num">${p.home.membership.through}</span>` : null}`
          : html`<span class="ac-customer-card__muted">No membership — each visit is billed on its own.</span>`}</p>`
      : p.plans.length
        ? html`<div class="ac-customer-card__plans">${p.plans.map((w) => html`<span class="ac-customer-card__plan">${w}</span>`)}</div>`
        : html`<p class="ac-customer-card__muted">No active agreement.</p>`}
  </article>`;
});
