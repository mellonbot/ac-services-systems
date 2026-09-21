import { html, StatusPill, DataGrid, PrimaryAction, type VNode } from "../../../../packages/ui/src/index.ts";
import type {
  AccountWire, AddressWire, EquipmentWire, EquipmentKind, ContactWire, ContactRole, InvoiceWire, JobWire, ServiceRequestWire, SiteImageryOutput,
} from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Resource } from "../state.ts";
import { whenReady, readNodes, treeOf, linkTo, when, TIER_WORD, type Screen, type ScreenContext } from "./common.ts";
import { slaStatus, isOpen, STATE_WORD } from "./work.ts";

/**
 * THE SITE CARD — what a site IS, on one page: where it is, what runs on its
 * roof, who is there, and everything that has happened to it in one clock.
 * Reached from a site's line on the Sites tree and from a job's site on Work.
 *
 * Seven reads, one screen, no filter: `accounts.list` for the node and its
 * breadcrumb, `equipment.list`, `contacts.list`, `invoices.list`, `jobs.list`
 * and `serviceRequests.list` for the ledger, `sites.imagery` for the roof.
 * Every row on this page is a row 0009 (and 0006 before it) let this
 * principal have; a facility manager and the executive run the same code
 * and read different cards because the gateway returned different rows.
 *
 * Two things are deliberate about the LEDGER. It is one list, not three —
 * a request, the job the office opened against it and the invoice that
 * billed the job are one story, and a customer reads stories in date order.
 * And it is the customer's words: a state is `STATE_WORD`, a job's response
 * is the same three-state pill the dispatcher's board derives from the same
 * numbers, and money is printed from integer minor units, never a float.
 *
 * The imagery is the gateway's answer, whatever it is. `unavailable` is an
 * ordinary state the card draws — the address is the fact, the picture is
 * a courtesy — so a portal with no provider configured is complete, not broken.
 */
export const KIND_WORD: Readonly<Record<EquipmentKind, string>> = {
  rtu: "Rooftop unit", split: "Split system", package: "Package unit", ahu: "Air handler", chiller: "Chiller", boiler: "Boiler",
  heat_pump: "Heat pump", mini_split: "Mini-split", vrf: "VRF", exhaust: "Exhaust fan", mau: "Make-up air", controls: "Controls", other: "Other equipment",
};
/** The short form for the count line — "3 RTU · 1 AHU". */
export const KIND_ABBR: Readonly<Record<EquipmentKind, string>> = {
  rtu: "RTU", split: "Split", package: "Pkg", ahu: "AHU", chiller: "Chiller", boiler: "Boiler", heat_pump: "HP", mini_split: "Mini-split",
  vrf: "VRF", exhaust: "Exhaust", mau: "MAU", controls: "Controls", other: "Other",
};
export const ROLE_WORD: Readonly<Record<ContactRole, string>> = {
  site_manager: "On-site manager", facilities: "Facilities", accounts_payable: "Accounts payable", security: "Security desk", other: "Contact",
};

/** Integer minor units → "$1,234.56". No float anywhere: the split is string arithmetic on the bigint. */
export const money = (minor: string, currency = "USD"): string => {
  const n = BigInt(minor);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100n).toString().padStart(2, "0");
  const sym = currency === "USD" ? "$" : `${currency} `;
  return `${neg ? "−" : ""}${sym}${whole}.${cents}`;
};

/** Integer thousandths of a ton → "7.5" — bigint string arithmetic, the same way money is printed; no float near a *_milli. */
export const tons = (milli: string | null): string => {
  if (milli === null) return "—";
  const n = BigInt(milli);
  const frac = (n % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return frac ? `${n / 1000n}.${frac}` : `${n / 1000n}`;
};

export const addressLines = (a: AddressWire | null): readonly string[] => {
  if (!a) return [];
  const cityLine = [a.city, [a.state, a.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.line1, a.line2, cityLine, a.country].filter((s): s is string => Boolean(s && s.trim()));
};

/** One row of the ledger, whatever it came from. Newest first. */
export type LedgerEntry = {
  readonly key: string; readonly at: string;
  readonly kind: "request" | "job" | "invoice";
  readonly title: string; readonly detail: string;
  readonly status?: VNode | null;
  readonly amount?: string;
};

export const ledgerOf = (jobs: readonly JobWire[], requests: readonly ServiceRequestWire[], invoices: readonly InvoiceWire[], nowMs: number, density: ScreenContext["density"]): readonly LedgerEntry[] => {
  const entries: LedgerEntry[] = [];
  for (const r of requests) entries.push({
    key: `r:${r.id}`, at: r.createdAt, kind: "request",
    title: `Service requested — ${r.priority}`, detail: r.description,
    status: r.jobState ? html`<span class="s6-muted">Job opened: ${STATE_WORD[r.jobState]}</span>` : html`<span class="s6-muted">Waiting for the office</span>`,
  });
  // A job sits in the ledger on the day of the VISIT, not the day the office
  // typed it in: a PM scheduled three months out is a future entry, and a PM
  // done in June sits in June whenever it was opened.
  for (const j of jobs) entries.push({
    key: `j:${j.id}`, at: j.serviceWindowStart, kind: "job",
    title: `${j.serviceCode} — ${STATE_WORD[j.state]}`,
    detail: `Window ${when(j.serviceWindowStart)} – ${when(j.serviceWindowEnd)} · opened ${when(j.openedAt)}`,
    // A closed job's response is history: responded when it was, or nothing to
    // say — never "due", whatever a timer row still reads.
    status: StatusPill({ density, status: isOpen(j) ? slaStatus(j, nowMs) : "ok",
      label: j.slaSatisfiedAt ? `Responded ${when(j.slaSatisfiedAt)}` : !isOpen(j) ? STATE_WORD[j.state] : j.slaDueAt ? `Response due ${when(j.slaDueAt)}` : "No commitment on file" }),
  });
  for (const inv of invoices) entries.push({
    key: `i:${inv.id}`, at: inv.issuedAt ?? inv.periodEnd ?? inv.periodStart ?? "", kind: "invoice",
    title: inv.issuedAt ? `Invoice issued${inv.periodStart ? ` — ${inv.periodStart} to ${inv.periodEnd ?? "…"}` : ""}` : "Invoice drafted",
    detail: inv.lines.map((l) => l.description).join(" · "),
    amount: money(inv.subtotalMinor, inv.currency),
    status: inv.dueAt ? html`<span class="s6-muted">Due ${when(inv.dueAt)}</span>` : null,
  });
  return entries.sort((a, b) => b.at.localeCompare(a.at));
};

export const site: Screen = (ctx, params) => {
  const siteId = params.siteId ?? "";
  const nodes = readNodes(ctx);
  const equipment = ctx.store.read(keyOf("equipment.list", { siteId }), () => ctx.shell.gateway.listEquipment({ siteId }));
  const contacts = ctx.store.read(keyOf("contacts.list", { accountId: siteId }), () => ctx.shell.gateway.listContacts({ accountId: siteId }));
  const invoices = ctx.store.read(keyOf("invoices.list", { siteId }), () => ctx.shell.gateway.listInvoices({ siteId }));
  const jobs = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const requests = ctx.store.read(keyOf("serviceRequests.list", {}), () => ctx.shell.gateway.listServiceRequests({}));
  const imagery = ctx.store.read(keyOf("sites.imagery", { siteId }), () => ctx.shell.gateway.siteImagery({ siteId }));
  const now = Date.now();

  return whenReady(ctx, nodes.value, (out) => {
    const tree = treeOf(out.nodes);
    const node: AccountWire | undefined = tree.byId.get(siteId);
    if (!node || node.tier !== "site") return html`<section class="s6-site"><h1 class="s6-h1">Site</h1><p class="s6-empty" id="site-missing">No site with this id is in view for this account.</p><p class="s6-actions">${linkTo(ctx, "sites", {}, "Back to sites")}</p></section>`;
    const crumbs = tree.crumbs(node.id).slice(0, -1);
    const siteJobs = jobs.value.state === "ready" ? jobs.value.value.jobs.filter((j) => j.siteId === node.id) : [];
    const openJobs = siteJobs.filter(isOpen);
    const siteRequests = requests.value.state === "ready" ? requests.value.value.requests.filter((r) => r.siteId === node.id) : [];

    return html`<article class="s6-site" id="site-card" data-site=${node.id}>
      <header class="s6-site__head">
        <p class="s6-crumbs" id="site-crumbs">${crumbs.map((c, i) => html`${i ? " › " : ""}<span>${c}</span>`)}</p>
        <div class="s6-site__title">
          <span class="s6-node__tier">${TIER_WORD.site}</span>
          <h1 class="s6-h1" id="site-name">${node.name}</h1>
          ${node.customerGroup ? html`<span class="s6-node__group" title="Your own grouping — reportable, never structure">${node.customerGroup}</span>` : null}
          ${node.externalRef ? html`<span class="s6-node__group" title="Your site code">${node.externalRef}</span>` : null}
        </div>
        <div class="s6-site__acts">
          ${PrimaryAction({ density: ctx.density, label: "Request service here", id: "site-request", onClick: () => ctx.router.navigate("request", { siteId: node.id }) })}
          ${linkTo(ctx, "terms", { tier: "site", nodeId: node.id }, "Terms at this site")}
        </div>
      </header>

      <div class="s6-site__grid">
        <section class="s6-panel s6-panel--where" aria-labelledby="site-where">
          <h2 class="s6-h2 s6-panel__h" id="site-where">Where</h2>
          ${imageryView(ctx, imagery.value, node)}
          ${addressView(node.address, node.timezone)}
        </section>

        <section class="s6-panel s6-panel--who" aria-labelledby="site-who">
          <h2 class="s6-h2 s6-panel__h" id="site-who">Who is there</h2>
          ${whenReady(ctx, contacts.value, (c) => contactsView(c.contacts, node.id), () => ctx.store.invalidate("contacts.list"))}
        </section>

        <section class="s6-panel s6-panel--now" aria-labelledby="site-now">
          <h2 class="s6-h2 s6-panel__h" id="site-now">Right now</h2>
          <dl class="s6-facts" id="site-facts">
            <div><dt>Open jobs</dt><dd class="ac-num">${openJobs.length}</dd></div>
            <div><dt>Requests waiting</dt><dd class="ac-num">${siteRequests.filter((r) => r.jobId === null).length}</dd></div>
            <div><dt>Units on record</dt><dd class="ac-num">${equipment.value.state === "ready" ? equipment.value.value.equipment.filter((e) => e.active).length : "…"}</dd></div>
            <div><dt>Site clock</dt><dd>${node.timezone ?? "—"}</dd></div>
          </dl>
        </section>
      </div>

      <section class="s6-panel" aria-labelledby="site-equipment">
        <h2 class="s6-h2 s6-panel__h" id="site-equipment">Equipment</h2>
        ${whenReady(ctx, equipment.value, (e) => equipmentView(ctx, e.equipment), () => ctx.store.invalidate("equipment.list"))}
      </section>

      <section class="s6-panel" aria-labelledby="site-ledger">
        <h2 class="s6-h2 s6-panel__h" id="site-ledger">History at this site</h2>
        ${ledgerView(ctx, siteJobs, siteRequests, invoices.value.state === "ready" ? invoices.value.value.invoices : [], now, [jobs.value.state, requests.value.state, invoices.value.state])}
      </section>

      <p class="s6-actions">${linkTo(ctx, "sites", {}, "Back to sites")} ${linkTo(ctx, "work", {}, "All work")}</p>
    </article>`;
  }, () => ctx.store.invalidate("accounts.list"));
};

const imageryView = (ctx: ScreenContext, r: Resource<SiteImageryOutput>, node: AccountWire): VNode => {
  if (r.state === "loading") return html`<div class="s6-roof s6-roof--empty" role="img" aria-label="Loading imagery"><span class="s6-muted">Loading…</span></div>`;
  if (r.state === "refused") return html`<div class="s6-roof s6-roof--empty" role="note" id="site-roof"><span class="s6-muted">${r.refusal.message}</span></div>`;
  const v = r.value;
  if (v.image) return html`<figure class="s6-roof" id="site-roof">
    <img class="s6-roof__img" src=${v.image} alt=${`Overhead view of ${node.name}`} width="640" height="360" />
    ${v.attribution ? html`<figcaption class="s6-roof__credit">${v.attribution}</figcaption>` : null}
  </figure>`;
  const why = v.unavailable === "not_configured" ? "Overhead imagery is not enabled for this portal."
    : v.unavailable === "no_coordinates" ? "No coordinates are on record for this site yet."
    : "The imagery provider did not answer.";
  return html`<div class="s6-roof s6-roof--empty" role="note" id="site-roof" data-unavailable=${v.unavailable ?? ""}>
    ${locatorGlyph()}
    <span class="s6-muted">${why}</span>
    ${v.lat !== null && v.lng !== null ? html`<span class="ac-num s6-roof__coords">${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}</span>` : null}
  </div>`;
};

/** A neutral mark for "a place" — a plan symbol in text ink, not a picture pretending to be a map. */
const locatorGlyph = (): VNode => html`<svg class="s6-roof__glyph" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
  <rect x="6" y="14" width="36" height="24" fill="none" stroke="currentColor" stroke-width="2" />
  <rect x="14" y="20" width="8" height="6" fill="none" stroke="currentColor" stroke-width="2" />
  <rect x="26" y="20" width="8" height="6" fill="none" stroke="currentColor" stroke-width="2" />
  <path d="M6 14 L24 6 L42 14" fill="none" stroke="currentColor" stroke-width="2" />
</svg>`;

const addressView = (a: AddressWire | null, tz: string | null): VNode => {
  const lines = addressLines(a);
  if (lines.length === 0) return html`<p class="s6-muted" id="site-address">No address on record for this site.</p>`;
  const geo = a && typeof a.lat === "number" && typeof a.lng === "number" ? `geo:${a.lat},${a.lng}` : null;
  return html`<address class="s6-address" id="site-address">
    ${lines.map((l) => html`<span>${l}</span>`)}
    ${geo ? html`<a class="s6-link" href=${geo}>Open in your maps app</a>` : null}
    ${tz ? html`<span class="s6-muted">${tz}</span>` : null}
  </address>`;
};

const contactsView = (contacts: readonly ContactWire[], siteId: string): VNode => {
  if (contacts.length === 0) return html`<p class="s6-muted" id="site-contacts">No contacts on record. Your account manager can add the on-site manager.</p>`;
  return html`<ul class="s6-contacts" id="site-contacts">
    ${contacts.map((c) => html`<li class="s6-contact" data-inherited=${c.accountId === siteId ? "false" : "true"} data-primary=${c.isPrimary ? "true" : "false"}>
      <span class="s6-contact__role">${ROLE_WORD[c.role]}${c.accountId !== siteId ? html` <span class="s6-muted">· ${TIER_WORD[c.accountTier]}: ${c.accountName}</span>` : null}</span>
      <span class="s6-contact__name">${c.name}</span>
      <span class="s6-contact__reach">
        ${c.phone ? html`<a class="s6-link ac-num" href=${`tel:${c.phone.replace(/[^\d+]/g, "")}`}>${c.phone}</a>` : null}
        ${c.email ? html`<a class="s6-link" href=${`mailto:${c.email}`}>${c.email}</a>` : null}
      </span>
      ${c.note ? html`<span class="s6-muted s6-contact__note">${c.note}</span>` : null}
    </li>`)}
  </ul>`;
};

const equipmentView = (ctx: ScreenContext, units: readonly EquipmentWire[]): VNode => {
  const active = units.filter((u) => u.active);
  if (units.length === 0) return html`<p class="s6-muted" id="site-units">No equipment on record for this site yet.</p>`;
  const counts = new Map<EquipmentKind, number>();
  for (const u of active) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
  return html`<div id="site-units">
    <p class="s6-units__count" id="site-units-count"><span class="ac-num">${active.length}</span>${active.length === 1 ? " unit — " : " units — "}${[...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n], i) => html`${i ? " · " : ""}<span class="ac-num">${n}</span>${" "}${KIND_ABBR[k]}`)}</p>
    ${DataGrid<EquipmentWire>({
      density: ctx.density,
      caption: "Equipment at this site",
      rows: units,
      rowKey: (u) => u.id,
      columns: [
        { key: "label", header: "Unit", cell: (u) => html`${u.label ?? html`<span class="s6-muted">—</span>`}${u.active ? null : html` <span class="s6-muted">(retired)</span>`}` },
        { key: "kind", header: "Kind", cell: (u) => KIND_WORD[u.kind] },
        { key: "model", header: "Make / model", cell: (u) => [u.manufacturer, u.model].filter(Boolean).join(" ") },
        { key: "serial", header: "Serial", numeric: true, cell: (u) => u.serial ?? "—" },
        { key: "tonnageMilli", header: "Tons", numeric: true, align: "end", cell: (u) => tons(u.tonnageMilli) },
        { key: "installedOn", header: "Installed", numeric: true, cell: (u) => u.installedOn ?? "—" },
        {
          key: "lastServicedAt", header: "Last serviced", numeric: true,
          cell: (u) => (u.lastServicedAt
            ? html`${when(u.lastServicedAt)} <span class="s6-muted">${u.lastServicedServiceCode ?? ""}</span>`
            : html`<span class="s6-muted">${u.jobCount ? "Work open, none complete" : "Not yet serviced by us"}</span>`),
        },
      ],
    }) ?? html``}
  </div>`;
};

const ledgerView = (ctx: ScreenContext, jobs: readonly JobWire[], requests: readonly ServiceRequestWire[], invoices: readonly InvoiceWire[], nowMs: number, states: readonly string[]): VNode => {
  const entries = ledgerOf(jobs, requests, invoices, nowMs, ctx.density);
  const loading = states.includes("loading");
  if (entries.length === 0) return html`<p class="s6-muted" id="site-history">${loading ? "Loading…" : "Nothing has happened at this site yet."}</p>`;
  return html`<ol class="s6-ledger" id="site-history" aria-label="History at this site, newest first">
    ${entries.map((e) => html`<li class="s6-ledger__row" data-kind=${e.kind}>
      <span class="s6-ledger__when ac-num">${e.at ? when(e.at) : "—"}</span>
      <span class="s6-ledger__what">
        <span class="s6-ledger__title">${e.title}</span>
        <span class="s6-ledger__detail s6-muted">${e.detail}</span>
      </span>
      <span class="s6-ledger__status">${e.status ?? null}</span>
      <span class="s6-ledger__amount ac-num">${e.amount ?? ""}</span>
    </li>`)}
    ${loading ? html`<li class="s6-muted">Loading…</li>` : null}
  </ol>`;
};
