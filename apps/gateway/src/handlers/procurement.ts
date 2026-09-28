import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { threeWayMatch } from "../../../../packages/domain/src/procurement/match.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";
import type {
  AddressWire, VendorWire, ListVendorsOutput, CreateVendorInput, CreateVendorOutput,
  ReceivingTier, ReceivingPointWire, ListReceivingPointsOutput, CreateReceivingPointInput, CreateReceivingPointOutput,
  CatalogPriceWire, CatalogItemWire, ListCatalogInput, ListCatalogOutput, AddCatalogItemInput, AddCatalogItemOutput,
  ProposePriceInput, ProposePriceOutput, WithdrawPriceInput, WithdrawPriceOutput, DecidePriceInput, DecidePriceOutput, PriceState,
  PoState, PurchaseOrderWire, ListPurchaseOrdersInput, ListPurchaseOrdersOutput, PoLineWire, PurchaseOrderDetailInput, PurchaseOrderDetailOutput,
  CreatePurchaseOrderInput, CreatePurchaseOrderOutput, PoIdInput, CancelPurchaseOrderInput, PoTransitionOutput, AcknowledgePurchaseOrderInput,
  RecordShipmentInput, RecordShipmentOutput, RecordReceiptInput, RecordReceiptOutput, SubmitVendorInvoiceInput, SubmitVendorInvoiceOutput,
  VendorInvoiceWire, ListVendorInvoicesInput, ListVendorInvoicesOutput, MatchNoteWire,
  RmaWire, RmaState, RequestReturnInput, RequestReturnOutput, RespondToReturnInput, RespondToReturnOutput, ListReturnsInput, ListReturnsOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * ITEM 11 — PROCUREMENT. The office's purchasing (S2) and the vendor's side of
 * the same rows (S7), in one file because they are one set of records.
 *
 * Inputs are this file's to check. Who may SEE a row, who may change which
 * column, and how much may ship, arrive or go back are migration 0011's: a
 * vendor's request for an order it cannot see finds no row here and is told
 * "unknown", not "forbidden". Tenancy on insert is inherited by trigger, so
 * the org and region passed to uow.apply are read from the parent row, never
 * typed from the request.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS = /^\d+$/;
const TIERS: readonly ReceivingTier[] = ["location_stock", "regional_hub", "national"];
const PO_STATES: readonly PoState[] = ["draft", "issued", "acknowledged", "received", "cancelled"];

const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const requireText = (v: unknown, field: string, max = 200): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new BadInput(`${field} is required`);
  if (v.trim().length > max) throw new BadInput(`${field} is at most ${max} characters`);
  return v.trim();
};
const requireDate = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !ISO_DATE.test(v)) throw new BadInput(`${field} must be an ISO date (YYYY-MM-DD)`);
  return v;
};
const requireInt = (v: unknown, field: string, min: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new BadInput(`${field} must be an integer ≥ ${min}`);
  return v;
};
/** Money and quantities are strings of digits on the wire; a JSON number is a double. */
const requireDigits = (v: unknown, field: string, positive = false): bigint => {
  if (typeof v !== "string" || !DIGITS.test(v)) throw new BadInput(`${field} must be a string of digits (integer minor units or thousandths)`);
  const n = BigInt(v);
  if (positive && n === 0n) throw new BadInput(`${field} must be more than zero`);
  return n;
};
const requireOneOf = <T extends string>(v: unknown, field: string, legal: readonly T[]): T => {
  if (typeof v !== "string" || !(legal as readonly string[]).includes(v)) throw new BadInput(`${field} must be one of ${legal.join(", ")}`);
  return v as T;
};
const requireLines = <T>(v: unknown, field: string): readonly T[] => {
  if (!Array.isArray(v) || v.length === 0) throw new BadInput(`${field} needs at least one line`);
  return v as T[];
};
/** quantity (thousandths) × unit price (minor) → minor, half up. The same arithmetic the office and the vendor see. */
export const lineAmount = (quantityMilli: bigint, unitPriceMinor: bigint): bigint => (quantityMilli * unitPriceMinor + 500n) / 1000n;
const ts = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ---------------------------------------------------------------------------
// Vendors and receiving points — the office records both.
// ---------------------------------------------------------------------------
type VendorRow = { id: string; legal_name: string; status: VendorWire["status"]; region_id: string; payment_terms_days: number; contact_email: string | null };
const vendorWire = (r: VendorRow): VendorWire => ({ id: r.id, legalName: r.legal_name, status: r.status, regionId: r.region_id, paymentTermsDays: r.payment_terms_days, contactEmail: r.contact_email });
const loadVendor = async (uow: UnitOfWork, id: string): Promise<VendorRow> => {
  const r = (await uow.tx.query<VendorRow>("SELECT id, legal_name, status, region_id, payment_terms_days, contact_email FROM vendors WHERE id = $1", [id]))[0];
  if (!r) throw new InputRefused(`no vendor ${id} visible in this scope`, "unknown_vendor");
  return r;
};

export const listVendors = async (uow: UnitOfWork): Promise<ListVendorsOutput> => ({
  vendors: (await uow.tx.query<VendorRow>("SELECT id, legal_name, status, region_id, payment_terms_days, contact_email FROM vendors ORDER BY legal_name")).map(vendorWire),
});

export const createVendor = async (uow: UnitOfWork, input: CreateVendorInput, newId: () => string): Promise<CreateVendorOutput> => {
  const legalName = requireText(input.legalName, "legalName");
  const regionId = requireUuid(input.regionId, "regionId");
  const terms = input.paymentTermsDays === undefined ? 30 : requireInt(input.paymentTermsDays, "paymentTermsDays", 0);
  const email = input.contactEmail === undefined ? null : requireText(input.contactEmail, "contactEmail");
  const region = (await uow.tx.query<{ id: string; active: boolean; name: string }>("SELECT id, active, name FROM regions WHERE id = $1", [regionId]))[0];
  if (!region || !region.active) throw new InputRefused(`no active service region ${regionId}`, "unknown_region");
  const id = newId();
  const eventId = await uow.apply(
    { entity: "vendor", entityId: id, action: "vendor.create", topic: "vendor.created", before: null, after: { id, legalName, regionId, paymentTermsDays: terms }, orgId: id, regionId, payload: { legalName } },
    async (tx) => {
      await tx.query("INSERT INTO organizations (id, name, kind) VALUES ($1, $2, 'vendor')", [id, legalName]);
      await tx.query("INSERT INTO vendors (id, org_id, region_id, legal_name, payment_terms_days, contact_email) VALUES ($1, $1, $2, $3, $4, $5)", [id, regionId, legalName, terms, email]);
    },
  );
  return { id, eventId };
};

type RpRow = { id: string; code: string; tier: ReceivingTier; region_id: string; address: AddressWire; active: boolean };
const rpWire = (r: RpRow): ReceivingPointWire => ({ id: r.id, code: r.code, tier: r.tier, regionId: r.region_id, address: r.address, active: r.active });

export const listReceivingPoints = async (uow: UnitOfWork): Promise<ListReceivingPointsOutput> => ({
  receivingPoints: (await uow.tx.query<RpRow>("SELECT id, code, tier, region_id, address, active FROM receiving_points ORDER BY tier, code")).map(rpWire),
});

export const createReceivingPoint = async (uow: UnitOfWork, input: CreateReceivingPointInput, newId: () => string): Promise<CreateReceivingPointOutput> => {
  const code = requireText(input.code, "code", 40).toUpperCase();
  const tier = requireOneOf(input.tier, "tier", TIERS);
  const regionId = requireUuid(input.regionId, "regionId");
  const a = input.address;
  if (!a || typeof a !== "object") throw new BadInput("address is required — a vendor ships to it");
  requireText(a.line1, "address.line1"); requireText(a.city, "address.city");
  const region = (await uow.tx.query<{ id: string; active: boolean }>("SELECT id, active FROM regions WHERE id = $1", [regionId]))[0];
  if (!region || !region.active) throw new InputRefused(`no active service region ${regionId}`, "unknown_region");
  const id = newId();
  const eventId = await uow.apply(
    { entity: "receiving_point", entityId: id, action: "receiving_point.create", topic: "receiving_point.set", before: null, after: { code, tier, regionId }, orgId: INTERNAL_ORG_ID, regionId },
    async (tx) => { await tx.query("INSERT INTO receiving_points (id, org_id, region_id, code, tier, address) VALUES ($1, $2, $3, $4, $5, $6::jsonb)", [id, INTERNAL_ORG_ID, regionId, code, tier, JSON.stringify(a)]); },
  );
  return { id, eventId };
};

// ---------------------------------------------------------------------------
// The catalogue and its prices. A vendor proposes; the office decides.
// ---------------------------------------------------------------------------
type PriceRow = { id: string; item_id: string; vendor_id: string; price_minor: string; currency: string; eff_from: string; eff_to: string | null; state: PriceState; proposed_at: string; decided_at: string | null; decision_note: string | null; org_id: string; region_id: string; current: boolean };
const PRICE_COLS = `p.id, p.item_id, p.vendor_id, p.price_minor::text AS price_minor, p.currency,
  to_char(lower(p.effective), 'YYYY-MM-DD') AS eff_from, CASE WHEN upper_inf(p.effective) THEN NULL ELSE to_char(upper(p.effective), 'YYYY-MM-DD') END AS eff_to,
  p.state, ${ts("p.proposed_at")} AS proposed_at, CASE WHEN p.decided_at IS NULL THEN NULL ELSE ${ts("p.decided_at")} END AS decided_at, p.decision_note,
  p.org_id, p.region_id, (p.state = 'accepted' AND p.effective @> current_date) AS current`;
const priceWire = (r: PriceRow): CatalogPriceWire => ({
  id: r.id, itemId: r.item_id, vendorId: r.vendor_id, priceMinor: r.price_minor, currency: r.currency, effectiveFrom: r.eff_from, effectiveTo: r.eff_to,
  state: r.state, proposedAt: r.proposed_at, decidedAt: r.decided_at, decisionNote: r.decision_note,
});
type ItemRow = { id: string; vendor_id: string; vendor_sku: string; description: string; uom: string; active: boolean; org_id: string; region_id: string };

export const listCatalog = async (uow: UnitOfWork, input: ListCatalogInput): Promise<ListCatalogOutput> => {
  const vendorId = input.vendorId === undefined ? null : requireUuid(input.vendorId, "vendorId");
  const items = await uow.tx.query<ItemRow>(
    "SELECT id, vendor_id, vendor_sku, description, uom, active, org_id, region_id FROM vendor_catalog_items WHERE ($1::uuid IS NULL OR vendor_id = $1) ORDER BY vendor_sku", [vendorId]);
  const prices = await uow.tx.query<PriceRow>(
    `SELECT ${PRICE_COLS} FROM vendor_catalog_prices p WHERE ($1::uuid IS NULL OR p.vendor_id = $1) AND p.state IN ('accepted','proposed') ORDER BY p.proposed_at`, [vendorId]);
  return {
    items: items.map((i): CatalogItemWire => {
      const mine = prices.filter((p) => p.item_id === i.id);
      const current = mine.find((p) => p.current);
      return {
        id: i.id, vendorId: i.vendor_id, vendorSku: i.vendor_sku, description: i.description, uom: i.uom, active: i.active,
        current: current ? priceWire(current) : null, proposals: mine.filter((p) => p.state === "proposed").map(priceWire),
      };
    }),
  };
};

const loadItem = async (uow: UnitOfWork, id: string): Promise<ItemRow> => {
  const r = (await uow.tx.query<ItemRow>("SELECT id, vendor_id, vendor_sku, description, uom, active, org_id, region_id FROM vendor_catalog_items WHERE id = $1", [id]))[0];
  if (!r) throw new InputRefused(`no catalogue item ${id} visible in this scope`, "unknown_item");
  return r;
};

export const addCatalogItem = async (uow: UnitOfWork, input: AddCatalogItemInput, newId: () => string): Promise<AddCatalogItemOutput> => {
  const vendor = await loadVendor(uow, requireUuid(input.vendorId, "vendorId"));
  const sku = requireText(input.vendorSku, "vendorSku", 60);
  const description = requireText(input.description, "description");
  const uom = input.uom === undefined ? "each" : requireText(input.uom, "uom", 20);
  const id = newId();
  const eventId = await uow.apply(
    { entity: "part", entityId: id, action: "catalog_item.add", topic: "catalog_item.set", before: null, after: { vendorId: vendor.id, sku, description, uom }, orgId: vendor.id, regionId: vendor.region_id },
    async (tx) => { await tx.query("INSERT INTO vendor_catalog_items (id, org_id, region_id, vendor_id, vendor_sku, description, uom) VALUES ($1, $2, $3, $2, $4, $5, $6)", [id, vendor.id, vendor.region_id, sku, description, uom]); },
  );
  return { id, eventId };
};

export const proposePrice = async (uow: UnitOfWork, input: ProposePriceInput, newId: () => string): Promise<ProposePriceOutput> => {
  const item = await loadItem(uow, requireUuid(input.itemId, "itemId"));
  const price = requireDigits(input.priceMinor, "priceMinor");
  const currency = requireText(input.currency, "currency", 3).toUpperCase();
  const from = requireDate(input.effectiveFrom, "effectiveFrom");
  if (from < new Date().toISOString().slice(0, 10)) throw new InputRefused(`a price is proposed from today or later; ${from} has passed`, "backdated_price");
  const id = newId();
  const eventId = await uow.apply(
    { entity: "catalog_price", entityId: id, action: "price.propose", topic: "vendor_price.proposed", before: null, after: { itemId: item.id, priceMinor: price.toString(), currency, effectiveFrom: from }, orgId: item.org_id, regionId: item.region_id },
    async (tx) => {
      await tx.query(
        `INSERT INTO vendor_catalog_prices (id, org_id, region_id, item_id, vendor_id, price_minor, currency, effective)
         VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, daterange($8::date, NULL, '[)'))`,
        [id, item.org_id, item.region_id, item.id, item.vendor_id, price.toString(), currency, from]);
    },
  );
  return { id, eventId };
};

const loadPrice = async (uow: UnitOfWork, id: string): Promise<PriceRow> => {
  const r = (await uow.tx.query<PriceRow>(`SELECT ${PRICE_COLS} FROM vendor_catalog_prices p WHERE p.id = $1`, [id]))[0];
  if (!r) throw new InputRefused(`no price ${id} visible in this scope`, "unknown_price");
  return r;
};

export const withdrawPrice = async (uow: UnitOfWork, input: WithdrawPriceInput): Promise<WithdrawPriceOutput> => {
  const p = await loadPrice(uow, requireUuid(input.priceId, "priceId"));
  if (p.state !== "proposed") throw new InputRefused(`this price is ${p.state}; only a proposal waiting on the office is withdrawn`, "not_proposed");
  const eventId = await uow.apply(
    { entity: "catalog_price", entityId: p.id, action: "price.withdraw", topic: "vendor_price.withdrawn", before: { state: p.state }, after: { state: "withdrawn" }, orgId: p.org_id, regionId: p.region_id },
    async (tx) => { await tx.query("UPDATE vendor_catalog_prices SET state = 'withdrawn' WHERE id = $1", [p.id]); },
  );
  return { id: p.id, eventId };
};

export const decidePrice = async (uow: UnitOfWork, input: DecidePriceInput, actorId: string, now: Date): Promise<DecidePriceOutput> => {
  const p = await loadPrice(uow, requireUuid(input.priceId, "priceId"));
  const decision = requireOneOf(input.decision, "decision", ["accepted", "rejected"] as const);
  const note = input.note === undefined ? null : requireText(input.note, "note", 500);
  if (p.state !== "proposed") throw new InputRefused(`this price is ${p.state}; the office decides a proposal once`, "not_proposed");
  let closedId: string | null = null;
  if (decision === "accepted") {
    const open = (await uow.tx.query<{ id: string; eff_from: string }>(
      `SELECT id, to_char(lower(effective), 'YYYY-MM-DD') AS eff_from FROM vendor_catalog_prices
        WHERE item_id = $1 AND state = 'accepted' AND effective @> $2::date`, [p.item_id, p.eff_from]))[0];
    if (open && open.eff_from === p.eff_from) throw new InputRefused(`an accepted price already starts on ${p.eff_from}; propose from a later day`, "price_same_day");
    closedId = open?.id ?? null;
  }
  const eventId = await uow.apply(
    { entity: "price_decision", entityId: p.id, action: `price.${decision}`, topic: "vendor_price.decided", before: { state: p.state }, after: { state: decision, closedId }, orgId: p.org_id, regionId: p.region_id, payload: { decision, itemId: p.item_id } },
    async (tx) => {
      if (closedId) await tx.query("UPDATE vendor_catalog_prices SET effective = daterange(lower(effective), $2::date, '[)') WHERE id = $1", [closedId, p.eff_from]);
      await tx.query("UPDATE vendor_catalog_prices SET state = $2, decided_at = $3, decided_by = $4, decision_note = $5 WHERE id = $1", [p.id, decision, now.toISOString(), actorId, note]);
    },
  );
  return { id: p.id, state: decision, closedId, eventId };
};

// ---------------------------------------------------------------------------
// Purchase orders.
// ---------------------------------------------------------------------------
type PoRow = { id: string; number: string; vendor_id: string; vendor_name: string | null; receiving_point_id: string; rp_code: string | null; rp_tier: ReceivingTier | null; region_id: string; org_id: string; state: PoState; currency: string; total_minor: string; issued_at: string | null; acknowledged_at: string | null; promised_ship_on: string | null; created_at: string };
const PO_SELECT = `SELECT po.id, po.number, po.vendor_id, v.legal_name AS vendor_name, po.receiving_point_id, rp.code AS rp_code, rp.tier AS rp_tier, po.region_id, po.org_id,
    po.state, po.currency, po.total_minor::text AS total_minor,
    CASE WHEN po.issued_at IS NULL THEN NULL ELSE ${ts("po.issued_at")} END AS issued_at,
    CASE WHEN po.acknowledged_at IS NULL THEN NULL ELSE ${ts("po.acknowledged_at")} END AS acknowledged_at,
    to_char(po.promised_ship_on, 'YYYY-MM-DD') AS promised_ship_on, ${ts("po.created_at")} AS created_at
  FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id LEFT JOIN receiving_points rp ON rp.id = po.receiving_point_id`;
const poWire = (r: PoRow): PurchaseOrderWire => ({
  id: r.id, number: r.number, vendorId: r.vendor_id, vendorName: r.vendor_name, receivingPointId: r.receiving_point_id, receivingPointCode: r.rp_code, receivingTier: r.rp_tier,
  regionId: r.region_id, state: r.state, currency: r.currency, totalMinor: r.total_minor, issuedAt: r.issued_at, acknowledgedAt: r.acknowledged_at, promisedShipOn: r.promised_ship_on, createdAt: r.created_at,
});
const loadPo = async (uow: UnitOfWork, id: string): Promise<PoRow> => {
  const r = (await uow.tx.query<PoRow>(`${PO_SELECT} WHERE po.id = $1`, [id]))[0];
  if (!r) throw new InputRefused(`no purchase order ${id} visible in this scope`, "unknown_po");
  return r;
};

export const listPurchaseOrders = async (uow: UnitOfWork, input: ListPurchaseOrdersInput): Promise<ListPurchaseOrdersOutput> => {
  const state = input.state === undefined ? null : requireOneOf(input.state, "state", PO_STATES);
  return { orders: (await uow.tx.query<PoRow>(`${PO_SELECT} WHERE ($1::text IS NULL OR po.state = $1) ORDER BY po.created_at DESC`, [state])).map(poWire) };
};

type LineRow = { id: string; line_no: number; item_id: string; vendor_sku: string; description: string; uom: string; quantity_milli: string; unit_price_minor: string; shipped: string; received: string; invoiced: string; returned: string };
const loadLines = (uow: UnitOfWork, poId: string) => uow.tx.query<LineRow>(
  `SELECT l.id, l.line_no, l.item_id, i.vendor_sku, i.description, i.uom, l.quantity_milli::text AS quantity_milli, l.unit_price_minor::text AS unit_price_minor,
          (SELECT COALESCE(sum(s.quantity_milli), 0) FROM shipment_lines s WHERE s.po_line_id = l.id)::text AS shipped,
          (SELECT COALESCE(sum(r.quantity_milli), 0) FROM po_receipts r WHERE r.po_line_id = l.id)::text AS received,
          -- Matched invoices only: a held invoice is on record but is not a claim the office accepted,
          -- so a corrected invoice after a held one is matched against what is really left to bill.
          (SELECT COALESCE(sum(v.quantity_milli), 0) FROM vendor_invoice_lines v JOIN vendor_invoices vi ON vi.id = v.invoice_id
            WHERE v.po_line_id = l.id AND vi.match_state = 'matched')::text AS invoiced,
          (SELECT COALESCE(sum(m.quantity_milli), 0) FROM rmas m WHERE m.po_line_id = l.id AND m.state <> 'rejected')::text AS returned
     FROM purchase_order_lines l JOIN vendor_catalog_items i ON i.id = l.item_id
    WHERE l.po_id = $1 ORDER BY l.line_no`, [poId]);
const lineWire = (l: LineRow): PoLineWire => ({
  id: l.id, lineNo: l.line_no, itemId: l.item_id, vendorSku: l.vendor_sku, description: l.description, uom: l.uom,
  quantityMilli: l.quantity_milli, shippedMilli: l.shipped, receivedMilli: l.received, invoicedMilli: l.invoiced, returnedMilli: l.returned,
  unitPriceMinor: l.unit_price_minor, amountMinor: lineAmount(BigInt(l.quantity_milli), BigInt(l.unit_price_minor)).toString(),
});

export const purchaseOrder = async (uow: UnitOfWork, input: PurchaseOrderDetailInput): Promise<PurchaseOrderDetailOutput> => {
  const po = await loadPo(uow, requireUuid(input.poId, "poId"));
  const rp = (await uow.tx.query<RpRow>("SELECT id, code, tier, region_id, address, active FROM receiving_points WHERE id = $1", [po.receiving_point_id]))[0];
  const lines = await loadLines(uow, po.id);
  const shipments = await uow.tx.query<{ id: string; shipped_on: string; carrier: string; tracking: string | null }>(
    "SELECT id, to_char(shipped_on, 'YYYY-MM-DD') AS shipped_on, carrier, tracking FROM shipments WHERE po_id = $1 ORDER BY shipped_on, created_at", [po.id]);
  const shipLines = await uow.tx.query<{ shipment_id: string; po_line_id: string; quantity_milli: string }>(
    "SELECT sl.shipment_id, sl.po_line_id, sl.quantity_milli::text AS quantity_milli FROM shipment_lines sl JOIN shipments s ON s.id = sl.shipment_id WHERE s.po_id = $1", [po.id]);
  const receipts = await uow.tx.query<{ id: string; po_line_id: string; quantity_milli: string; received_at: string }>(
    `SELECT id, po_line_id, quantity_milli::text AS quantity_milli, ${ts("received_at")} AS received_at FROM po_receipts WHERE po_id = $1 ORDER BY received_at`, [po.id]);
  return {
    order: poWire(po), receivingPoint: rp ? rpWire(rp) : null, lines: lines.map(lineWire),
    shipments: shipments.map((s) => ({ id: s.id, shippedOn: s.shipped_on, carrier: s.carrier, tracking: s.tracking, lines: shipLines.filter((l) => l.shipment_id === s.id).map((l) => ({ poLineId: l.po_line_id, quantityMilli: l.quantity_milli })) })),
    receipts: receipts.map((r) => ({ id: r.id, poLineId: r.po_line_id, quantityMilli: r.quantity_milli, receivedAt: r.received_at })),
    invoices: (await listVendorInvoices(uow, { poId: po.id })).invoices,
    returns: (await listReturns(uow, { poId: po.id })).returns,
  };
};

export const createPurchaseOrder = async (uow: UnitOfWork, input: CreatePurchaseOrderInput, actorId: string, newId: () => string, now: Date): Promise<CreatePurchaseOrderOutput> => {
  const vendor = await loadVendor(uow, requireUuid(input.vendorId, "vendorId"));
  if (vendor.status !== "active") throw new InputRefused(`vendor ${vendor.legal_name} is ${vendor.status}; orders go to an active vendor`, "vendor_inactive");
  const rp = (await uow.tx.query<RpRow>("SELECT id, code, tier, region_id, address, active FROM receiving_points WHERE id = $1", [requireUuid(input.receivingPointId, "receivingPointId")]))[0];
  if (!rp || !rp.active) throw new InputRefused(`no active receiving point ${input.receivingPointId}`, "unknown_receiving_point");
  const raw = requireLines<{ itemId: unknown; quantityMilli: unknown }>(input.lines, "lines");
  const lines: { itemId: string; qty: bigint; priceId: string; price: bigint; currency: string }[] = [];
  for (const [n, l] of raw.entries()) {
    const item = await loadItem(uow, requireUuid(l.itemId, `lines[${n}].itemId`));
    if (item.vendor_id !== vendor.id) throw new InputRefused(`item ${item.vendor_sku} is another vendor's — an order goes to one vendor`, "item_not_vendors");
    const price = (await uow.tx.query<{ id: string; price_minor: string; currency: string }>(
      "SELECT id, price_minor::text AS price_minor, currency FROM vendor_catalog_prices WHERE item_id = $1 AND state = 'accepted' AND effective @> $2::date", [item.id, now.toISOString().slice(0, 10)]))[0];
    if (!price) throw new InputRefused(`${item.vendor_sku} has no accepted price today — accept the vendor's proposal first`, "no_accepted_price");
    lines.push({ itemId: item.id, qty: requireDigits(l.quantityMilli, `lines[${n}].quantityMilli`, true), priceId: price.id, price: BigInt(price.price_minor), currency: price.currency });
  }
  const currencies = new Set(lines.map((l) => l.currency));
  if (currencies.size > 1) throw new InputRefused(`the lines are priced in ${[...currencies].join(" and ")}; an order is in one currency`, "mixed_currency");
  const total = lines.reduce((t, l) => t + lineAmount(l.qty, l.price), 0n);
  const id = newId();
  const number = `PO-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  const eventId = await uow.apply(
    { entity: "purchase_order", entityId: id, action: "po.create", topic: "po.created", before: null, after: { number, vendorId: vendor.id, receivingPointId: rp.id, lines: lines.length, totalMinor: total.toString() }, orgId: vendor.id, regionId: rp.region_id },
    async (tx) => {
      await tx.query(
        `INSERT INTO purchase_orders (id, org_id, region_id, vendor_id, number, receiving_point_id, currency, total_minor, raised_by)
         VALUES ($1, $2, $3, $2, $4, $5, $6, $7::bigint, $8)`, [id, vendor.id, rp.region_id, number, rp.id, [...currencies][0], total.toString(), actorId]);
      for (const [i, l] of lines.entries()) {
        await tx.query(
          `INSERT INTO purchase_order_lines (org_id, region_id, po_id, vendor_id, line_no, item_id, price_id, quantity_milli, unit_price_minor)
           VALUES ($1, $2, $3, $1, $4, $5, $6, $7::bigint, $8::bigint)`, [vendor.id, rp.region_id, id, i + 1, l.itemId, l.priceId, l.qty.toString(), l.price.toString()]);
      }
    },
  );
  return { id, number, totalMinor: total.toString(), eventId };
};

const transition = async (uow: UnitOfWork, po: PoRow, entity: "purchase_order" | "po_ack", topic: "po.issued" | "po.cancelled" | "po.acknowledged", to: PoState, sql: string, params: unknown[]): Promise<PoTransitionOutput> => {
  const eventId = await uow.apply(
    { entity, entityId: po.id, action: `po.${to}`, topic, before: { state: po.state }, after: { state: to }, orgId: po.org_id, regionId: po.region_id, payload: { number: po.number, to } },
    async (tx) => { await tx.query(sql, [po.id, ...params]); },
  );
  return { id: po.id, state: to, eventId };
};

export const issuePurchaseOrder = async (uow: UnitOfWork, input: PoIdInput, now: Date): Promise<PoTransitionOutput> => {
  const po = await loadPo(uow, requireUuid(input.poId, "poId"));
  if (po.state !== "draft") throw new InputRefused(`order ${po.number} is ${po.state}; only a draft is issued`, "not_draft");
  return transition(uow, po, "purchase_order", "po.issued", "issued", "UPDATE purchase_orders SET state = 'issued', issued_at = $2 WHERE id = $1", [now.toISOString()]);
};

export const cancelPurchaseOrder = async (uow: UnitOfWork, input: CancelPurchaseOrderInput): Promise<PoTransitionOutput> => {
  const po = await loadPo(uow, requireUuid(input.poId, "poId"));
  if (!["draft", "issued", "acknowledged"].includes(po.state)) throw new InputRefused(`order ${po.number} is ${po.state} and cannot be cancelled`, "not_cancellable");
  const shipped = (await uow.tx.query<{ n: string }>("SELECT count(*)::text AS n FROM shipments WHERE po_id = $1", [po.id]))[0]?.n ?? "0";
  if (shipped !== "0") throw new InputRefused(`order ${po.number} has ${shipped} shipment(s) recorded; receive it and return what is not wanted`, "already_shipped");
  return transition(uow, po, "purchase_order", "po.cancelled", "cancelled", "UPDATE purchase_orders SET state = 'cancelled' WHERE id = $1", []);
};

export const acknowledgePurchaseOrder = async (uow: UnitOfWork, input: AcknowledgePurchaseOrderInput, now: Date): Promise<PoTransitionOutput> => {
  const po = await loadPo(uow, requireUuid(input.poId, "poId"));
  const on = requireDate(input.promisedShipOn, "promisedShipOn");
  if (po.state !== "issued") throw new InputRefused(`order ${po.number} is ${po.state}; an issued order is acknowledged, once`, "not_issued");
  if (on < now.toISOString().slice(0, 10)) throw new InputRefused(`a promised ship date is today or later; ${on} has passed`, "ship_date_passed");
  return transition(uow, po, "po_ack", "po.acknowledged", "acknowledged",
    "UPDATE purchase_orders SET state = 'acknowledged', acknowledged_at = $2, promised_ship_on = $3::date WHERE id = $1", [now.toISOString(), on]);
};

type QtyLine = { poLineId: string; qty: bigint };
const parseQtyLines = (v: unknown, lineIds: ReadonlySet<string>): QtyLine[] => {
  const raw = requireLines<{ poLineId: unknown; quantityMilli: unknown }>(v, "lines");
  const seen = new Set<string>();
  return raw.map((l, n) => {
    const poLineId = requireUuid(l.poLineId, `lines[${n}].poLineId`);
    if (!lineIds.has(poLineId)) throw new InputRefused(`line ${poLineId} is not on this purchase order`, "unknown_line");
    if (seen.has(poLineId)) throw new InputRefused(`line ${poLineId} appears twice`, "duplicate_line");
    seen.add(poLineId);
    return { poLineId, qty: requireDigits(l.quantityMilli, `lines[${n}].quantityMilli`, true) };
  });
};

export const recordShipment = async (uow: UnitOfWork, input: RecordShipmentInput, newId: () => string): Promise<RecordShipmentOutput> => {
  const po = await loadPo(uow, requireUuid(input.poId, "poId"));
  const shippedOn = requireDate(input.shippedOn, "shippedOn");
  const carrier = requireText(input.carrier, "carrier", 80);
  const tracking = input.tracking === undefined || input.tracking === "" ? null : requireText(input.tracking, "tracking", 80);
  if (po.state !== "acknowledged") throw new InputRefused(`order ${po.number} is ${po.state}; a shipment is recorded against an acknowledged order`, "not_acknowledged");
  const lines = parseQtyLines(input.lines, new Set((await loadLines(uow, po.id)).map((l) => l.id)));
  const id = newId();
  const eventId = await uow.apply(
    { entity: "ship_date", entityId: id, action: "shipment.record", topic: "po.shipped", before: null, after: { poId: po.id, shippedOn, carrier, tracking, lines: lines.map((l) => ({ poLineId: l.poLineId, quantityMilli: l.qty.toString() })) }, orgId: po.org_id, regionId: po.region_id, payload: { number: po.number, shippedOn } },
    async (tx) => {
      await tx.query("INSERT INTO shipments (id, org_id, region_id, po_id, vendor_id, shipped_on, carrier, tracking) VALUES ($1, $2, $3, $4, $2, $5::date, $6, $7)", [id, po.org_id, po.region_id, po.id, shippedOn, carrier, tracking]);
      for (const l of lines) await tx.query("INSERT INTO shipment_lines (org_id, region_id, shipment_id, po_line_id, vendor_id, quantity_milli) VALUES ($1, $2, $3, $4, $1, $5::bigint)", [po.org_id, po.region_id, id, l.poLineId, l.qty.toString()]);
    },
  );
  return { id, eventId };
};

export const recordReceipt = async (uow: UnitOfWork, input: RecordReceiptInput, actorId: string, newId: () => string): Promise<RecordReceiptOutput> => {
  const po = await loadPo(uow, requireUuid(input.poId, "poId"));
  if (po.state !== "acknowledged") throw new InputRefused(`order ${po.number} is ${po.state}; goods are received against an acknowledged order`, "not_acknowledged");
  const current = await loadLines(uow, po.id);
  const lines = parseQtyLines(input.lines, new Set(current.map((l) => l.id)));
  const ids = lines.map(() => newId());
  const complete = current.every((c) => BigInt(c.received) + (lines.find((l) => l.poLineId === c.id)?.qty ?? 0n) >= BigInt(c.quantity_milli));
  const state: PoState = complete ? "received" : "acknowledged";
  const eventId = await uow.apply(
    { entity: "po_receipt", entityId: po.id, action: "po.receive", topic: "po.received", before: { state: po.state }, after: { state, lines: lines.map((l) => ({ poLineId: l.poLineId, quantityMilli: l.qty.toString() })) }, orgId: po.org_id, regionId: po.region_id, payload: { number: po.number, complete } },
    async (tx) => {
      for (const [i, l] of lines.entries()) {
        await tx.query("INSERT INTO po_receipts (id, org_id, region_id, po_id, po_line_id, vendor_id, quantity_milli, received_by) VALUES ($1, $2, $3, $4, $5, $2, $6::bigint, $7)", [ids[i], po.org_id, po.region_id, po.id, l.poLineId, l.qty.toString(), actorId]);
      }
      if (complete) await tx.query("UPDATE purchase_orders SET state = 'received' WHERE id = $1", [po.id]);
    },
  );
  return { ids, state, eventId };
};

// ---------------------------------------------------------------------------
// Vendor invoices — matched three ways at submission.
// ---------------------------------------------------------------------------
type InvRow = { id: string; po_id: string; po_number: string | null; vendor_id: string; invoice_number: string; invoice_date: string; total_minor: string; currency: string; match_state: "matched" | "held"; match_notes: MatchNoteWire[]; created_at: string };

export const listVendorInvoices = async (uow: UnitOfWork, input: ListVendorInvoicesInput): Promise<ListVendorInvoicesOutput> => {
  const poId = input.poId === undefined ? null : requireUuid(input.poId, "poId");
  const rows = await uow.tx.query<InvRow>(
    `SELECT i.id, i.po_id, po.number AS po_number, i.vendor_id, i.invoice_number, to_char(i.invoice_date, 'YYYY-MM-DD') AS invoice_date, i.total_minor::text AS total_minor,
            i.currency, i.match_state, i.match_notes, ${ts("i.created_at")} AS created_at
       FROM vendor_invoices i LEFT JOIN purchase_orders po ON po.id = i.po_id
      WHERE ($1::uuid IS NULL OR i.po_id = $1) ORDER BY i.created_at DESC`, [poId]);
  const lines = await uow.tx.query<{ invoice_id: string; po_line_id: string; quantity_milli: string; unit_price_minor: string; amount_minor: string }>(
    `SELECT l.invoice_id, l.po_line_id, l.quantity_milli::text AS quantity_milli, l.unit_price_minor::text AS unit_price_minor, l.amount_minor::text AS amount_minor
       FROM vendor_invoice_lines l JOIN vendor_invoices i ON i.id = l.invoice_id WHERE ($1::uuid IS NULL OR i.po_id = $1)`, [poId]);
  return {
    invoices: rows.map((r): VendorInvoiceWire => ({
      id: r.id, poId: r.po_id, poNumber: r.po_number, vendorId: r.vendor_id, invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date, totalMinor: r.total_minor, currency: r.currency,
      matchState: r.match_state, matchNotes: r.match_notes, createdAt: r.created_at,
      lines: lines.filter((l) => l.invoice_id === r.id).map((l) => ({ poLineId: l.po_line_id, quantityMilli: l.quantity_milli, unitPriceMinor: l.unit_price_minor, amountMinor: l.amount_minor })),
    })),
  };
};

export const submitVendorInvoice = async (uow: UnitOfWork, input: SubmitVendorInvoiceInput, newId: () => string): Promise<SubmitVendorInvoiceOutput> => {
  const po = await loadPo(uow, requireUuid(input.poId, "poId"));
  const invoiceNumber = requireText(input.invoiceNumber, "invoiceNumber", 60);
  const invoiceDate = requireDate(input.invoiceDate, "invoiceDate");
  const documentKey = input.documentKey === undefined ? null : requireText(input.documentKey, "documentKey");
  if (!["acknowledged", "received"].includes(po.state)) throw new InputRefused(`order ${po.number} is ${po.state}; an invoice is submitted against an acknowledged or received order`, "not_invoiceable");
  const current = await loadLines(uow, po.id);
  const raw = requireLines<{ poLineId: unknown; quantityMilli: unknown; unitPriceMinor: unknown }>(input.lines, "lines");
  const ids = new Set(current.map((l) => l.id));
  const seen = new Set<string>();
  const lines = raw.map((l, n) => {
    const poLineId = requireUuid(l.poLineId, `lines[${n}].poLineId`);
    if (!ids.has(poLineId)) throw new InputRefused(`line ${poLineId} is not on order ${po.number}`, "unknown_line");
    if (seen.has(poLineId)) throw new InputRefused(`line ${poLineId} appears twice`, "duplicate_line");
    seen.add(poLineId);
    const quantityMilli = requireDigits(l.quantityMilli, `lines[${n}].quantityMilli`, true);
    const unitPriceMinor = requireDigits(l.unitPriceMinor, `lines[${n}].unitPriceMinor`);
    return { poLineId, quantityMilli, unitPriceMinor, amount: lineAmount(quantityMilli, unitPriceMinor) };
  });
  const verdict = threeWayMatch(
    current.map((c) => ({ poLineId: c.id, lineNo: c.line_no, unitPriceMinor: BigInt(c.unit_price_minor), receivedMilli: BigInt(c.received), invoicedMilli: BigInt(c.invoiced) })),
    lines,
  );
  const total = lines.reduce((t, l) => t + l.amount, 0n);
  const id = newId();
  const eventId = await uow.apply(
    { entity: "vendor_invoice", entityId: id, action: "vendor_invoice.submit", topic: "vendor_invoice.submitted", before: null, after: { poId: po.id, invoiceNumber, totalMinor: total.toString(), matchState: verdict.state, notes: verdict.notes }, orgId: po.org_id, regionId: po.region_id, payload: { number: po.number, invoiceNumber, matchState: verdict.state } },
    async (tx) => {
      await tx.query(
        `INSERT INTO vendor_invoices (id, org_id, region_id, po_id, vendor_id, invoice_number, invoice_date, total_minor, currency, match_state, match_notes, document_key)
         VALUES ($1, $2, $3, $4, $2, $5, $6::date, $7::bigint, $8, $9, $10::jsonb, $11)`,
        [id, po.org_id, po.region_id, po.id, invoiceNumber, invoiceDate, total.toString(), po.currency, verdict.state, JSON.stringify(verdict.notes), documentKey]);
      for (const l of lines) {
        await tx.query(
          `INSERT INTO vendor_invoice_lines (org_id, region_id, invoice_id, po_line_id, vendor_id, quantity_milli, unit_price_minor, amount_minor)
           VALUES ($1, $2, $3, $4, $1, $5::bigint, $6::bigint, $7::bigint)`,
          [po.org_id, po.region_id, id, l.poLineId, l.quantityMilli.toString(), l.unitPriceMinor.toString(), l.amount.toString()]);
      }
    },
  );
  return { id, matchState: verdict.state, matchNotes: verdict.notes, totalMinor: total.toString(), eventId };
};

// ---------------------------------------------------------------------------
// Returns. The office asks; the vendor answers once.
// ---------------------------------------------------------------------------
type RmaRow = { id: string; po_id: string; po_number: string | null; po_line_id: string; vendor_id: string; quantity_milli: string; reason: string; state: RmaState; rma_number: string | null; vendor_note: string | null; created_at: string; responded_at: string | null; org_id: string; region_id: string };
const RMA_SELECT = `SELECT m.id, m.po_id, po.number AS po_number, m.po_line_id, m.vendor_id, m.quantity_milli::text AS quantity_milli, m.reason, m.state, m.rma_number, m.vendor_note,
    ${ts("m.created_at")} AS created_at, CASE WHEN m.responded_at IS NULL THEN NULL ELSE ${ts("m.responded_at")} END AS responded_at, m.org_id, m.region_id
  FROM rmas m LEFT JOIN purchase_orders po ON po.id = m.po_id`;
const rmaWire = (r: RmaRow): RmaWire => ({
  id: r.id, poId: r.po_id, poNumber: r.po_number, poLineId: r.po_line_id, vendorId: r.vendor_id, quantityMilli: r.quantity_milli, reason: r.reason,
  state: r.state, rmaNumber: r.rma_number, vendorNote: r.vendor_note, createdAt: r.created_at, respondedAt: r.responded_at,
});

export const listReturns = async (uow: UnitOfWork, input: ListReturnsInput): Promise<ListReturnsOutput> => {
  const poId = input.poId === undefined ? null : requireUuid(input.poId, "poId");
  return { returns: (await uow.tx.query<RmaRow>(`${RMA_SELECT} WHERE ($1::uuid IS NULL OR m.po_id = $1) ORDER BY m.created_at DESC`, [poId])).map(rmaWire) };
};

export const requestReturn = async (uow: UnitOfWork, input: RequestReturnInput, actorId: string, newId: () => string): Promise<RequestReturnOutput> => {
  const po = await loadPo(uow, requireUuid(input.poId, "poId"));
  const poLineId = requireUuid(input.poLineId, "poLineId");
  if (!(await loadLines(uow, po.id)).some((l) => l.id === poLineId)) throw new InputRefused(`line ${poLineId} is not on order ${po.number}`, "unknown_line");
  const qty = requireDigits(input.quantityMilli, "quantityMilli", true);
  const reason = requireText(input.reason, "reason", 500);
  const id = newId();
  const eventId = await uow.apply(
    { entity: "rma_request", entityId: id, action: "rma.request", topic: "rma.requested", before: null, after: { poId: po.id, poLineId, quantityMilli: qty.toString(), reason }, orgId: po.org_id, regionId: po.region_id, payload: { number: po.number } },
    async (tx) => {
      await tx.query("INSERT INTO rmas (id, org_id, region_id, po_id, po_line_id, vendor_id, quantity_milli, reason, requested_by) VALUES ($1, $2, $3, $4, $5, $2, $6::bigint, $7, $8)",
        [id, po.org_id, po.region_id, po.id, poLineId, qty.toString(), reason, actorId]);
    },
  );
  return { id, eventId };
};

export const respondToReturn = async (uow: UnitOfWork, input: RespondToReturnInput, now: Date): Promise<RespondToReturnOutput> => {
  const rmaId = requireUuid(input.rmaId, "rmaId");
  const r = (await uow.tx.query<RmaRow>(`${RMA_SELECT} WHERE m.id = $1`, [rmaId]))[0];
  if (!r) throw new InputRefused(`no return ${rmaId} visible in this scope`, "unknown_rma");
  const decision = requireOneOf(input.decision, "decision", ["authorized", "rejected"] as const);
  if (r.state !== "requested") throw new InputRefused(`this return is already ${r.state}; a vendor answers a request once`, "already_answered");
  const rmaNumber = decision === "authorized" ? requireText(input.rmaNumber, "rmaNumber", 60) : null;
  const note = decision === "rejected" ? requireText(input.note, "note", 500) : input.note === undefined ? null : requireText(input.note, "note", 500);
  const eventId = await uow.apply(
    { entity: "rma", entityId: r.id, action: `rma.${decision}`, topic: "rma.responded", before: { state: r.state }, after: { state: decision, rmaNumber, note }, orgId: r.org_id, regionId: r.region_id, payload: { decision } },
    async (tx) => {
      await tx.query("UPDATE rmas SET state = $2, rma_number = $3, vendor_note = $4, responded_at = $5 WHERE id = $1", [r.id, decision, rmaNumber, note, now.toISOString()]);
    },
  );
  return { id: r.id, state: decision, eventId };
};
