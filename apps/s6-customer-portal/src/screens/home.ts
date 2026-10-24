import { html, localDay, pageHead, panel, statStrip, type VNode } from "../../../../packages/ui/src/index.ts";
import { COOL_CLUB, type ContractWire, type EquipmentWire, type JobWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, readNodes, treeOf, linkTo, type Screen, type ScreenContext } from "./common.ts";
import { requestForm, outcomeView } from "./request.ts";
import { KIND_WORD, addressLines, money } from "./site.ts";
import { ordersOf, ordersPanel, stepOf, windowOf } from "./work.ts";

/**
 * YOUR HOME — S6's home for a residential customer (scope 2026-10-21 §5).
 * Same bundle, same operations, same scope rules as the commercial home: a
 * home is a one-branch tree (region → household → home), so there is one
 * site, and the screen says so instead of offering a sites tree, site
 * filters or an account card built for forty buildings.
 *
 * The membership card shows only what is real today. Plan tiers and included
 * visits are not built (R2, R5a), so it names the membership from the
 * contract, PM visits a year from the resolved term where one is set, the
 * planned visits completed this year, and the next one booked — and nothing
 * it would have to invent.
 *
 * Who may ask is the gateway's (R6): a payer-only login is refused a request
 * at the unit of work. The form is not drawn for that login, and the screen
 * says who in the household asks instead of offering a write that will fail.
 */
export const canRequest = (ctx: ScreenContext): boolean => ctx.shell.principal.roles.includes("requester");

const MEMBERSHIP: ContractWire["billingPath"] = "residential_membership";
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Planned visits: completed this calendar year, and the next one still ahead. */
export const plannedVisits = (jobs: readonly JobWire[], nowMs: number) => {
  const year = new Date(nowMs).getFullYear();
  const pm = jobs.filter((j) => j.priority === "pm");
  const done = pm.filter((j) => stepOf({ jobState: j.state }) >= 3 && new Date(j.stateChangedAt).getFullYear() === year).length;
  const next = pm
    .filter((j) => { const at = stepOf({ jobState: j.state }); return at >= 0 && at < 3 && Date.parse(j.serviceWindowEnd) >= nowMs; })
    .sort((a, b) => a.serviceWindowStart.localeCompare(b.serviceWindowStart))[0] ?? null;
  return { done, next };
};

const homeCard = (ctx: ScreenContext, siteId: string | null, address: readonly string[]): VNode => {
  const equipment = siteId ? ctx.store.read(keyOf("equipment.list", { siteId }), () => ctx.shell.gateway.listEquipment({ siteId })) : null;
  return panel(html`<div class="s6-house" id="home-card">
    <p class="s6-house__address">${address.length ? address.map((l, i) => html`${i ? html`<br />` : null}${l}`) : html`<span class="s6-muted">No address on record — the office can add it.</span>`}</p>
    ${equipment ? whenReady(ctx, equipment.value, (out) => unitsView(out.equipment), () => ctx.store.invalidate("equipment.list")) : null}
    ${siteId ? html`<p class="s6-actions">${linkTo(ctx, "site", { siteId }, "Equipment, contacts and invoices")}</p>` : null}
  </div>`, ctx.shell.context?.parent.name ?? "Your home", undefined, undefined, "home");
};

const unitsView = (units: readonly EquipmentWire[]): VNode => {
  const active = units.filter((u) => u.active);
  if (active.length === 0) return html`<p class="s6-muted" id="home-units">No equipment on record yet — the technician records it on the first visit.</p>`;
  return html`<ul class="s6-units" id="home-units">${active.map((u) => html`<li class="s6-unit">
    <span class="s6-unit__name">${u.label ?? KIND_WORD[u.kind]}</span>
    <span class="s6-muted">${[u.label ? KIND_WORD[u.kind] : null, [u.manufacturer, u.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</span>
    <span class="s6-muted">${u.lastServicedAt ? html`Serviced <span class="ac-num">${day(u.lastServicedAt)}</span>` : "Not yet serviced by us"}</span>
  </li>`)}</ul>`;
};

/** What the plan is, in one line: the price, the visits, and what else it includes. */
const planLine = [
  `${money(String(COOL_CLUB.feeMinor))} a ${COOL_CLUB.period}${COOL_CLUB.taxable ? " plus tax" : ""}`,
  `${COOL_CLUB.pmVisitsPerYear} preventive maintenance visits`,
  ...COOL_CLUB.includes,
].join(" · ") + ".";

const membershipCard = (ctx: ScreenContext, siteId: string | null, contracts: readonly ContractWire[], jobs: readonly JobWire[], nowMs: number): VNode => {
  const member = contracts.find((c) => c.state === "active" && c.billingPath === MEMBERSHIP) ?? null;
  if (!member) {
    return panel(html`<div id="membership">
      <p class="s6-muted">No membership — each visit is billed on its own.</p>
      <p>${COOL_CLUB.name}: ${planLine} Ask the office to sign you up.</p>
    </div>`, "Membership", undefined, undefined, "membership-card");
  }
  const asOf = localDay(new Date(nowMs));
  const terms = siteId ? ctx.store.read(keyOf("terms.resolved", { tier: "site", nodeId: siteId, asOf }), () => ctx.shell.gateway.resolvedTerms({ tier: "site", nodeId: siteId, asOf })) : null;
  // The agreed term wins where the office set one; otherwise the plan's own count.
  const agreed = terms?.value.state === "ready" ? terms.value.value.resolved["pm_visits_per_year"]?.value : undefined;
  const perYear = typeof agreed === "number" ? agreed : COOL_CLUB.pmVisitsPerYear;
  const { done, next } = plannedVisits(jobs, nowMs);
  return panel(html`<div id="membership">
    ${statStrip([
      { n: done, label: "Planned visits this year", sub: `of ${perYear} a year`, tone: "ok" },
    ], "membership-stats")}
    <p class="s6-order__note">${next
      ? html`Next planned visit <strong class="ac-num">${windowOf(next.serviceWindowStart, next.serviceWindowEnd)}</strong>.`
      : "No planned visit booked yet — the office schedules it and it appears here."}</p>
    <p>${planLine}</p>
    <p class="s6-muted">Member since <span class="ac-num">${day(member.effectiveFrom)}</span>${member.effectiveTo ? html`, through <span class="ac-num">${day(member.effectiveTo)}</span>` : null}.</p>
  </div>`, COOL_CLUB.name, undefined, undefined, "membership-card");
};

export const home: Screen = (ctx) => {
  const nodes = readNodes(ctx);
  const jobs = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const requests = ctx.store.read(keyOf("serviceRequests.list", {}), () => ctx.shell.gateway.listServiceRequests({}));
  const invoices = ctx.store.read(keyOf("invoices.list", {}), () => ctx.shell.gateway.listInvoices({}));
  const contracts = ctx.store.read(keyOf("contracts.list", {}), () => ctx.shell.gateway.listContracts({ orgId: ctx.shell.principal.orgId }));
  const now = Date.now();

  const jobRows = jobs.value.state === "ready" ? jobs.value.value.jobs : [];
  const invoiceRows = invoices.value.state === "ready" ? invoices.value.value.invoices : [];
  const site = nodes.value.state === "ready" ? treeOf(nodes.value.value.nodes).ofTier("site")[0] ?? null : null;
  const asks = canRequest(ctx);

  return html`<section class="s6-work s6-work--home">
    ${pageHead("Your home", asks ? "Request service and follow every visit to its invoice." : "Every visit at your home, from request to invoice.")}

    ${jobs.value.state === "refused" ? null : whenReady(ctx, requests.value, (out) => {
      const orders = ordersOf(out.requests, jobRows);
      const n = (k: number) => orders.filter((o) => stepOf(o) === k).length;
      const due = invoiceRows.filter((i) => (i.status === "open" || i.status === "partially_paid") && i.dueAt && Date.parse(i.dueAt) >= now).length;
      return statStrip([
        { n: n(0), label: "Open requests" },
        { n: n(1), label: "Scheduled" },
        { n: n(2), label: "In progress" },
        { n: due, label: "Invoices due", sub: "due date still ahead" },
      ], "work-stats");
    })}

    <div class="s6-house-row">
      ${homeCard(ctx, site?.id ?? null, addressLines(site?.address ?? null))}
      ${whenReady(ctx, contracts.value, (out) => membershipCard(ctx, site?.id ?? null, out.contracts, jobRows, now), () => ctx.store.invalidate("contracts.list"))}
    </div>

    <div class="s6-home">
      ${asks
        ? panel(requestForm(ctx, site?.id ?? ""), "Request service", "Goes straight to the office — no phone tag.", undefined, "request-panel")
        : panel(html`<p class="s6-muted" id="request-not-yours">Your login pays the balance. Service is requested by someone in your household who asks for work — the office can give your login both jobs.</p>`, "Request service", undefined, undefined, "request-panel")}
      <div class="s6-home__orders">
        ${outcomeView(ctx)}
        ${ordersPanel(ctx, jobs.value, requests.value, invoiceRows, now, false)}
      </div>
    </div>
  </section>`;
};
