import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type {
  ListEquipmentInput, ListEquipmentOutput, EquipmentWire, EquipmentKind, RegisterEquipmentInput, RegisterEquipmentOutput,
  ListContactsInput, ListContactsOutput, ContactWire, ContactRole, SetContactInput, SetContactOutput,
  ListInvoicesInput, ListInvoicesOutput, InvoiceWire, InvoiceLineWire, BillingPath, AccountTierWire,
} from "../../../../packages/contracts/src/operations.ts";
import { EQUIPMENT_KINDS, CONTACT_ROLES } from "../../../../packages/schema/src/tables/hierarchy.ts";

/**
 * ITEM 9 — THE SITE RECORD. What a site IS, as opposed to what is happening
 * there: the units on its roof, the people at it, what it has been billed.
 * Three reads S6's site card composes, and the two writes the office records
 * them with.
 *
 * The division of labour is C1's and item 6's, and is not restated per
 * function: this file decides INPUTS — a kind from the closed list, a name
 * that is a name, a site that is a site — and migration 0009 decides what
 * the principal may see. "Which site may this customer read units at" is not
 * a WHERE clause here. An invisible site is `unknown_site`, not `forbidden`,
 * because from inside the customer's scope the row is not there.
 *
 * Two things are derived on purpose rather than stored:
 *
 *   - a unit's LAST SERVICED is the latest completed job that named it
 *     (`job_equipment`, written by jobs.create). A stored date is a date
 *     somebody has to remember to update, and the site card would then be
 *     the surface that lies most confidently about the thing the customer
 *     cares about most.
 *   - an invoice's SUBTOTAL at a node is the sum of the lines RLS let this
 *     principal see. A location-scoped manager reading a consolidated parent
 *     invoice sees its own location's lines and their sum; the header total
 *     is on the same row, and the gap between the two IS the consolidation.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const requireText = (v: unknown, field: string, max = 200): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new BadInput(`${field} is required`);
  const t = v.trim();
  if (t.length > max) throw new InputRefused(`${field} is ${t.length} characters; ${max} is the most it carries`, `${field}_too_long`);
  return t;
};
const optionalText = (v: unknown, field: string, max = 200): string | null => (v === undefined || v === null || v === "" ? null : requireText(v, field, max));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * An instant on the wire is UTC and says so. `to_char` on a timestamptz
 * formats in the SESSION's zone, so on any cluster not running UTC the old
 * pattern — the wall clock with a "Z" glued on — was wrong by the cluster's
 * offset. Found by test/integration/s6-site-card.test.ts on a Chicago
 * cluster; the same fix is applied to jobs, devices, service requests and
 * settlements, whose timers it also mislabelled.
 */
const TS = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

type SiteRow = { id: string; tier: AccountTierWire; org_id: string; region_id: string; active: boolean; path: string[] };
const visibleNode = async (uow: UnitOfWork, id: string, field: string): Promise<SiteRow> => {
  const row = (await uow.tx.query<SiteRow>(`SELECT id, tier, org_id, region_id, active, path FROM accounts WHERE id = $1`, [id]))[0];
  if (!row) throw new InputRefused(`no node ${id} visible in this scope`, field === "siteId" ? "unknown_site" : "unknown_scope");
  return row;
};
const visibleSite = async (uow: UnitOfWork, id: string): Promise<SiteRow> => {
  const row = await visibleNode(uow, id, "siteId");
  if (row.tier !== "site") throw new InputRefused(`"${id}" is a ${row.tier}, not a site — equipment lives at a site`, "not_a_site");
  return row;
};

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------
type EquipmentRow = {
  id: string; site_id: string; kind: EquipmentKind; label: string | null; manufacturer: string | null; model: string; serial: string | null;
  installed_on: string | null; tonnage_milli: string | null; active: boolean;
  last_serviced_at: string | null; last_serviced_job_id: string | null; last_serviced_service_code: string | null; job_count: string;
};

/**
 * The units at a site, each with its service history folded to one fact.
 * The LATERAL reads jobs under `jobs`' own policy, so a customer's "last
 * serviced" is computed over the jobs it may see — which, at its own site,
 * is all of them. Ordered as the closed list orders kinds (the big iron
 * first), then by the customer's own label.
 */
export const listEquipment = async (uow: UnitOfWork, input: ListEquipmentInput): Promise<ListEquipmentOutput> => {
  const siteId = requireUuid(input.siteId, "siteId");
  await visibleSite(uow, siteId);
  const rows = await uow.tx.query<EquipmentRow>(
    `SELECT e.id, e.site_id, e.kind, e.label, m.name AS manufacturer, e.model, e.serial,
            to_char(e.installed_on, 'YYYY-MM-DD') AS installed_on, e.tonnage_milli::text AS tonnage_milli, e.active,
            ${TS("last.we")} AS last_serviced_at, last.job_id AS last_serviced_job_id, last.service_code AS last_serviced_service_code,
            (SELECT count(*) FROM job_equipment je WHERE je.equipment_id = e.id) AS job_count
       FROM equipment e
       LEFT JOIN part_manufacturers m ON m.id = e.manufacturer_id
       LEFT JOIN LATERAL (
         SELECT j.id AS job_id, j.service_code, upper(j.service_window) AS we
           FROM job_equipment je JOIN jobs j ON j.id = je.job_id
          WHERE je.equipment_id = e.id AND j.state IN ('complete', 'invoiced')
          ORDER BY upper(j.service_window) DESC LIMIT 1
       ) last ON true
      WHERE e.site_id = $1
      ORDER BY e.active DESC, array_position($2::text[], e.kind), e.label NULLS LAST, e.model`,
    [siteId, [...EQUIPMENT_KINDS]],
  );
  const equipment: EquipmentWire[] = rows.map((r) => ({
    id: r.id, siteId: r.site_id, kind: r.kind, label: r.label, manufacturer: r.manufacturer, model: r.model, serial: r.serial,
    installedOn: r.installed_on, tonnageMilli: r.tonnage_milli, active: r.active,
    lastServicedAt: r.last_serviced_at, lastServicedJobId: r.last_serviced_job_id, lastServicedServiceCode: r.last_serviced_service_code,
    jobCount: Number(r.job_count),
  }));
  return { equipment };
};

export const registerEquipment = async (uow: UnitOfWork, input: RegisterEquipmentInput, newId: () => string): Promise<RegisterEquipmentOutput> => {
  const siteId = requireUuid(input.siteId, "siteId");
  if (!(EQUIPMENT_KINDS as readonly string[]).includes(input.kind)) throw new BadInput(`kind must be one of ${EQUIPMENT_KINDS.join(", ")}`);
  const model = requireText(input.model, "model", 120);
  const label = optionalText(input.label, "label", 80);
  const manufacturer = optionalText(input.manufacturer, "manufacturer", 120);
  const serial = optionalText(input.serial, "serial", 80);
  const installedOn = input.installedOn === undefined || input.installedOn === null ? null : String(input.installedOn);
  if (installedOn !== null && !ISO_DATE.test(installedOn)) throw new BadInput("installedOn must be YYYY-MM-DD");
  // Thousandths of a ton travel as a string, like every other *_milli — and are checked as an integer, never parsed as a float.
  const tonnageMilli = input.tonnageMilli === undefined || input.tonnageMilli === null || input.tonnageMilli === "" ? null : String(input.tonnageMilli);
  if (tonnageMilli !== null && (!/^[1-9]\d{0,8}$/.test(tonnageMilli))) throw new BadInput("tonnageMilli must be a positive integer string (thousandths of a ton)");

  const site = await visibleSite(uow, siteId);
  if (!site.active) throw new InputRefused(`site ${siteId} is not active`, "site_inactive");

  // The manufacturer dictionary is global reference data: it grows by name,
  // once, and every unit of that make points at the same row.
  let manufacturerId: string | null = null;
  if (manufacturer) {
    manufacturerId = (await uow.tx.query<{ id: string }>(
      `INSERT INTO part_manufacturers (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [manufacturer],
    ))[0]!.id;
  }

  const id = newId();
  const after = { id, siteId, kind: input.kind, label, manufacturer, model, serial, installedOn, tonnageMilli };
  const eventId = await uow.apply(
    {
      entity: "equipment", entityId: id, action: "equipment.register", topic: "equipment.registered",
      before: null, after, orgId: site.org_id, regionId: site.region_id,
      payload: { siteId, equipmentId: id, kind: input.kind },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO equipment (id, org_id, region_id, site_id, manufacturer_id, kind, label, model, serial, installed_on, tonnage_milli)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, site.org_id, site.region_id, siteId, manufacturerId, input.kind, label, model, serial, installedOn, tonnageMilli],
      );
    },
  );
  return { id, eventId };
};

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
type ContactRow = {
  id: string; account_id: string; account_name: string; account_tier: AccountTierWire; role: ContactRole; name: string;
  phone: string | null; email: string | null; note: string | null; is_primary: boolean; active: boolean; depth: number;
};

/**
 * The node's own contacts first, then each ancestor's, nearest first. The
 * ancestors come from the node's own `path`, and each contact row is behind
 * `accounts`' rule for ITS node — so a facility manager reads the location's
 * contact (in their breadcrumb) and never a sibling location's.
 */
export const listContacts = async (uow: UnitOfWork, input: ListContactsInput): Promise<ListContactsOutput> => {
  const accountId = requireUuid(input.accountId, "accountId");
  const node = await visibleNode(uow, accountId, "accountId");
  const chain = [...node.path].reverse(); // this node first, region node last
  const rows = await uow.tx.query<ContactRow>(
    `SELECT c.id, c.account_id, a.name AS account_name, a.tier AS account_tier, c.role, c.name, c.phone, c.email, c.note, c.is_primary, c.active,
            array_position($1::uuid[], c.account_id) AS depth
       FROM account_contacts c
       JOIN accounts a ON a.id = c.account_id
      WHERE c.account_id = ANY($1::uuid[]) AND c.active
      ORDER BY depth, c.is_primary DESC, c.role, c.name`,
    [chain],
  );
  const contacts: ContactWire[] = rows.map((r) => ({
    id: r.id, accountId: r.account_id, accountName: r.account_name, accountTier: r.account_tier, role: r.role, name: r.name,
    phone: r.phone, email: r.email, note: r.note, isPrimary: r.is_primary, active: r.active,
  }));
  return { contacts };
};

export const setContact = async (uow: UnitOfWork, input: SetContactInput, newId: () => string): Promise<SetContactOutput> => {
  const accountId = requireUuid(input.accountId, "accountId");
  const role = input.role ?? "site_manager";
  if (!(CONTACT_ROLES as readonly string[]).includes(role)) throw new BadInput(`role must be one of ${CONTACT_ROLES.join(", ")}`);
  const name = requireText(input.name, "name", 120);
  const phone = optionalText(input.phone, "phone", 40);
  const email = optionalText(input.email, "email", 200);
  const note = optionalText(input.note, "note", 500);
  if (!phone && !email) throw new InputRefused("a contact is someone a crew can reach — give a phone or an email", "unreachable_contact");
  const isPrimary = input.isPrimary ?? false;
  if (typeof isPrimary !== "boolean") throw new BadInput("isPrimary must be boolean");
  const active = input.active ?? true;
  if (typeof active !== "boolean") throw new BadInput("active must be boolean");
  const node = await visibleNode(uow, accountId, "accountId");

  const contactId = input.contactId === undefined ? null : requireUuid(input.contactId, "contactId");
  let before: Record<string, unknown> | null = null;
  if (contactId) {
    const existing = (await uow.tx.query<ContactRow>(
      `SELECT c.id, c.account_id, '' AS account_name, 'site' AS account_tier, c.role, c.name, c.phone, c.email, c.note, c.is_primary, c.active, 0 AS depth
         FROM account_contacts c WHERE c.id = $1 AND c.account_id = $2`, [contactId, accountId],
    ))[0];
    if (!existing) throw new InputRefused(`no contact ${contactId} at node ${accountId} in this scope`, "unknown_contact");
    before = { role: existing.role, name: existing.name, phone: existing.phone, email: existing.email, note: existing.note, isPrimary: existing.is_primary, active: existing.active };
  }
  const id = contactId ?? newId();
  const after = { accountId, role, name, phone, email, note, isPrimary, active };
  const eventId = await uow.apply(
    {
      entity: "account_contact", entityId: id, action: contactId ? "account_contact.update" : "account_contact.set", topic: "account_contact.set",
      before, after, orgId: node.org_id, regionId: node.region_id,
      payload: { accountId, contactId: id, role },
    },
    async (tx) => {
      // One primary per role per node: setting a new primary demotes the old one in the same statement set.
      if (isPrimary) await tx.query(`UPDATE account_contacts SET is_primary = false WHERE account_id = $1 AND role = $2 AND id <> $3`, [accountId, role, id]);
      if (contactId) {
        await tx.query(
          `UPDATE account_contacts SET role = $2, name = $3, phone = $4, email = $5, note = $6, is_primary = $7, active = $8 WHERE id = $1`,
          [id, role, name, phone, email, note, isPrimary, active],
        );
      } else {
        await tx.query(
          `INSERT INTO account_contacts (id, org_id, region_id, account_id, role, name, phone, email, note, is_primary, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, node.org_id, node.region_id, accountId, role, name, phone, email, note, isPrimary, active],
        );
      }
    },
  );
  return { id, eventId };
};

// ---------------------------------------------------------------------------
// Invoices — the read. Issuance is WS-E's (D13) and has no operation yet.
// ---------------------------------------------------------------------------
type InvoiceRow = {
  id: string; bill_to_tier: InvoiceWire["billToTier"]; bill_to_id: string; contract_id: string; billing_path: BillingPath;
  period_start: string | null; period_end: string | null; total_minor: string; currency: string; issued_at: string | null; due_at: string | null;
};
type LineRow = { id: string; invoice_id: string; location_id: string; job_id: string | null; description: string; quantity_milli: string; unit_price_minor: string; amount_minor: string };

/**
 * `siteId` — the lines that bill a job at that site. `locationId` — the lines
 * itemised to that location, and the lines that bill a job at any site under
 * it. Neither given — every invoice this principal may see, with every line
 * it may see. In all three the lines are what RLS returned; the handler only
 * chooses which of them to ask for.
 */
export const listInvoices = async (uow: UnitOfWork, input: ListInvoicesInput): Promise<ListInvoicesOutput> => {
  const siteId = input.siteId === undefined ? null : requireUuid(input.siteId, "siteId");
  const locationId = input.locationId === undefined ? null : requireUuid(input.locationId, "locationId");
  if (siteId && locationId) throw new BadInput("ask for a site or a location, not both");
  if (siteId) await visibleSite(uow, siteId);
  if (locationId) await visibleNode(uow, locationId, "locationId");

  const lines = await uow.tx.query<LineRow>(
    `SELECT l.id, l.invoice_id, l.location_id, l.job_id, l.description, l.quantity_milli::text, l.unit_price_minor::text, l.amount_minor::text
       FROM invoice_lines l
       LEFT JOIN jobs j ON j.id = l.job_id
       LEFT JOIN accounts s ON s.id = j.site_id
      WHERE ($1::uuid IS NULL OR j.site_id = $1)
        AND ($2::uuid IS NULL OR l.location_id = $2 OR $2 = ANY(s.path))
      ORDER BY l.invoice_id, l.id`,
    [siteId, locationId],
  );
  if (lines.length === 0) return { invoices: [] };
  const invoiceIds = [...new Set(lines.map((l) => l.invoice_id))];
  const rows = await uow.tx.query<InvoiceRow>(
    `SELECT id, bill_to_tier, bill_to_id, contract_id, billing_path,
            to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
            total_minor::text, currency, ${TS("issued_at")} AS issued_at, ${TS("due_at")} AS due_at
       FROM invoices WHERE id = ANY($1::uuid[])
      ORDER BY issued_at DESC NULLS LAST, created_at DESC`,
    [invoiceIds],
  );
  const byInvoice = new Map<string, InvoiceLineWire[]>();
  for (const l of lines) {
    const list = byInvoice.get(l.invoice_id) ?? [];
    list.push({ id: l.id, locationId: l.location_id, jobId: l.job_id, description: l.description, quantityMilli: l.quantity_milli, unitPriceMinor: l.unit_price_minor, amountMinor: l.amount_minor });
    byInvoice.set(l.invoice_id, list);
  }
  const invoices: InvoiceWire[] = rows.map((r) => {
    const mine = byInvoice.get(r.id) ?? [];
    const subtotal = mine.reduce((acc, l) => acc + BigInt(l.amountMinor), 0n);
    return {
      id: r.id, billToTier: r.bill_to_tier, billToId: r.bill_to_id, contractId: r.contract_id, billingPath: r.billing_path,
      periodStart: r.period_start, periodEnd: r.period_end, totalMinor: r.total_minor, currency: r.currency, issuedAt: r.issued_at, dueAt: r.due_at,
      lines: mine, subtotalMinor: subtotal.toString(),
    };
  });
  return { invoices };
};
