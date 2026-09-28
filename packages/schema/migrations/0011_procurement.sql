-- ===========================================================================
-- 0011 — PROCUREMENT, AND THE VENDOR'S SIDE OF IT (item 11, S7 Vendor Portal).
--
-- The office buys parts from vendors: it records the vendor, our receiving
-- points and the vendor's catalogue, raises a purchase order at the vendor's
-- ACCEPTED price, receives what arrives and asks for returns. The vendor
-- answers on S7 with the registry's five writes: it acknowledges a PO with a
-- ship date (po_ack), records a shipment (ship_date), proposes a price
-- (catalog_price), submits an invoice that is matched against the order and
-- the receipt (vendor_invoice), and authorizes or rejects a return (rma).
--
-- The registry's sentence for S7 is "vendors see parts, POs and destination
-- tier — never customer names, never job records". Read as a vendor BEFORE
-- this migration, bound to South, the database answered otherwise:
--
--   jobs 8, assignments 5, crews 10, crew_credentials 21,
--   compliance_clearances 5, job_state_events 8, sla_timers 8,
--   service_requests 1, job_equipment 3
--
-- — every South job, its crew, the crew's documents, its clock and the
-- customer's request. The region rule (0002's ac_region_visible) admits any
-- namespace bound to the region, and 0006/0007 carved out the customer and
-- the firm but not the vendor. None of it through a screen; the fifth
-- migration to say so. The fix is not a sixth carve-out in every policy but a
-- RESTRICTIVE policy on each table a vendor has no business in: restrictive
-- policies are AND-ed with the permissive ones, so every existing rule stays
-- exactly as it was for every other namespace, and a vendor gets nothing.
--
-- Everything a vendor may read below carries org_id = the vendor (a vendor is
-- a tenant root, like a firm). A purchase order names one of OUR receiving
-- points by code, never a customer, a site or a job. Tenancy is inherited by
-- trigger; what a vendor may CHANGE on a row it can see is held by trigger,
-- column by column, forward only. tools/ci/schema-guard.ts §3d holds the
-- ERRCODE on every RAISE.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tables, for a database that already ran 0001 without them. On a fresh
-- database 0001 (regenerated) created them and this is a no-op. Source of
-- truth: packages/schema/src/tables/procurement.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  legal_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','terminated')),
  payment_terms_days integer NOT NULL DEFAULT 30,
  contact_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS vendors_region_id_idx ON vendors (region_id);

-- Where OUR goods are received: a regional hub, the national warehouse, or a location stock room. Named by code — a vendor reads this row, so it never carries a customer's name.
CREATE TABLE IF NOT EXISTS receiving_points (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  code text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('location_stock','regional_hub','national')),
  address jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS receiving_points_region_id_idx ON receiving_points (region_id);

CREATE TABLE IF NOT EXISTS vendor_catalog_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  vendor_sku text NOT NULL,
  description text NOT NULL,
  manufacturer_id uuid REFERENCES part_manufacturers(id),
  uom text NOT NULL DEFAULT 'each',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (vendor_id, vendor_sku)
);
CREATE INDEX IF NOT EXISTS vendor_catalog_items_region_id_idx ON vendor_catalog_items (region_id);
CREATE INDEX IF NOT EXISTS vendor_catalog_items_vendor_id_idx ON vendor_catalog_items (vendor_id);

-- A vendor PROPOSES a price from a day; it applies to a purchase order only once the office has accepted it. Two accepted prices for one item at once are unrepresentable (the EXCLUDE below).
CREATE TABLE IF NOT EXISTS vendor_catalog_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  item_id uuid NOT NULL REFERENCES vendor_catalog_items(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  price_minor bigint NOT NULL,
  currency text NOT NULL REFERENCES currencies(code),
  effective daterange NOT NULL,
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','accepted','rejected','withdrawn')),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT vendor_catalog_prices_no_overlap EXCLUDE USING gist (item_id WITH =, effective WITH &&) WHERE (state = 'accepted')
);
CREATE INDEX IF NOT EXISTS vendor_catalog_prices_region_id_idx ON vendor_catalog_prices (region_id);
CREATE INDEX IF NOT EXISTS vendor_catalog_prices_item_id_idx ON vendor_catalog_prices (item_id);
CREATE INDEX IF NOT EXISTS vendor_catalog_prices_vendor_id_idx ON vendor_catalog_prices (vendor_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  number text NOT NULL,
  receiving_point_id uuid NOT NULL REFERENCES receiving_points(id),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','issued','acknowledged','received','cancelled')),
  currency text NOT NULL REFERENCES currencies(code),
  total_minor bigint NOT NULL DEFAULT 0,
  raised_by uuid NOT NULL,
  issued_at timestamptz,
  acknowledged_at timestamptz,
  promised_ship_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (number)
);
CREATE INDEX IF NOT EXISTS purchase_orders_region_id_idx ON purchase_orders (region_id);
CREATE INDEX IF NOT EXISTS purchase_orders_vendor_id_idx ON purchase_orders (vendor_id);
CREATE INDEX IF NOT EXISTS purchase_orders_receiving_point_id_idx ON purchase_orders (receiving_point_id);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  po_id uuid NOT NULL REFERENCES purchase_orders(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES vendor_catalog_items(id),
  price_id uuid NOT NULL REFERENCES vendor_catalog_prices(id),
  quantity_milli bigint NOT NULL,
  unit_price_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (po_id, line_no)
);
CREATE INDEX IF NOT EXISTS purchase_order_lines_region_id_idx ON purchase_order_lines (region_id);
CREATE INDEX IF NOT EXISTS purchase_order_lines_po_id_idx ON purchase_order_lines (po_id);

CREATE TABLE IF NOT EXISTS shipments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  po_id uuid NOT NULL REFERENCES purchase_orders(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  shipped_on date NOT NULL,
  carrier text NOT NULL,
  tracking text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS shipments_region_id_idx ON shipments (region_id);
CREATE INDEX IF NOT EXISTS shipments_po_id_idx ON shipments (po_id);

CREATE TABLE IF NOT EXISTS shipment_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  po_line_id uuid NOT NULL REFERENCES purchase_order_lines(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  quantity_milli bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS shipment_lines_region_id_idx ON shipment_lines (region_id);
CREATE INDEX IF NOT EXISTS shipment_lines_shipment_id_idx ON shipment_lines (shipment_id);
CREATE INDEX IF NOT EXISTS shipment_lines_po_line_id_idx ON shipment_lines (po_line_id);

CREATE TABLE IF NOT EXISTS po_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  po_id uuid NOT NULL REFERENCES purchase_orders(id),
  po_line_id uuid NOT NULL REFERENCES purchase_order_lines(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  quantity_milli bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS po_receipts_region_id_idx ON po_receipts (region_id);
CREATE INDEX IF NOT EXISTS po_receipts_po_id_idx ON po_receipts (po_id);
CREATE INDEX IF NOT EXISTS po_receipts_po_line_id_idx ON po_receipts (po_line_id);

CREATE TABLE IF NOT EXISTS vendor_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  po_id uuid NOT NULL REFERENCES purchase_orders(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  total_minor bigint NOT NULL,
  currency text NOT NULL REFERENCES currencies(code),
  match_state text NOT NULL CHECK (match_state IN ('matched','held')),
  match_notes jsonb NOT NULL DEFAULT '[]',
  document_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (vendor_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS vendor_invoices_region_id_idx ON vendor_invoices (region_id);
CREATE INDEX IF NOT EXISTS vendor_invoices_po_id_idx ON vendor_invoices (po_id);
CREATE INDEX IF NOT EXISTS vendor_invoices_vendor_id_idx ON vendor_invoices (vendor_id);

CREATE TABLE IF NOT EXISTS vendor_invoice_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  invoice_id uuid NOT NULL REFERENCES vendor_invoices(id),
  po_line_id uuid NOT NULL REFERENCES purchase_order_lines(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  quantity_milli bigint NOT NULL,
  unit_price_minor bigint NOT NULL,
  amount_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS vendor_invoice_lines_region_id_idx ON vendor_invoice_lines (region_id);
CREATE INDEX IF NOT EXISTS vendor_invoice_lines_invoice_id_idx ON vendor_invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS vendor_invoice_lines_po_line_id_idx ON vendor_invoice_lines (po_line_id);

-- A return. The office requests it against a received line; the vendor authorizes it (with its RMA number) or rejects it (with a reason).
CREATE TABLE IF NOT EXISTS rmas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  po_id uuid NOT NULL REFERENCES purchase_orders(id),
  po_line_id uuid NOT NULL REFERENCES purchase_order_lines(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  quantity_milli bigint NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','authorized','rejected')),
  requested_by uuid NOT NULL,
  rma_number text,
  vendor_note text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS rmas_region_id_idx ON rmas (region_id);
CREATE INDEX IF NOT EXISTS rmas_po_id_idx ON rmas (po_id);
CREATE INDEX IF NOT EXISTS rmas_vendor_id_idx ON rmas (vendor_id);

-- 0002 granted on ALL TABLES as they stood; tables created afterwards get
-- their grants here. The gateway and the worker read and write; nobody deletes.
GRANT SELECT, INSERT, UPDATE ON vendors, receiving_points, vendor_catalog_items, vendor_catalog_prices, purchase_orders,
  purchase_order_lines, shipments, shipment_lines, po_receipts, vendor_invoices, vendor_invoice_lines, rmas TO ac_gateway, ac_worker;
GRANT SELECT ON vendors, receiving_points, vendor_catalog_items, vendor_catalog_prices, purchase_orders,
  purchase_order_lines, shipments, shipment_lines, po_receipts, vendor_invoices, vendor_invoice_lines, rmas TO ac_readonly;

-- ---------------------------------------------------------------------------
-- Tenancy is inherited, not typed. A vendor is its own organization; its
-- catalogue lives where it does; a purchase order lives where its goods are
-- going; everything that hangs off a PO or a header takes the parent's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_vendor_is_its_org() RETURNS TRIGGER AS $$
BEGIN
  NEW.org_id := NEW.id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS vendors_is_its_org ON vendors;
CREATE TRIGGER vendors_is_its_org BEFORE INSERT OR UPDATE OF id, org_id ON vendors FOR EACH ROW EXECUTE FUNCTION ac_vendor_is_its_org();

CREATE OR REPLACE FUNCTION ac_inherit_from_vendor() RETURNS TRIGGER AS $$
DECLARE v RECORD;
BEGIN
  SELECT id, region_id INTO v FROM vendors WHERE id = NEW.vendor_id;
  IF v IS NULL THEN
    RAISE EXCEPTION '%: vendor % is not visible in this scope', TG_TABLE_NAME, NEW.vendor_id USING ERRCODE = 'AC422';
  END IF;
  NEW.org_id := v.id;
  NEW.region_id := v.region_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS vendor_catalog_items_inherit ON vendor_catalog_items;
CREATE TRIGGER vendor_catalog_items_inherit BEFORE INSERT OR UPDATE OF vendor_id, org_id, region_id ON vendor_catalog_items FOR EACH ROW EXECUTE FUNCTION ac_inherit_from_vendor();

CREATE OR REPLACE FUNCTION ac_price_inherits_from_item() RETURNS TRIGGER AS $$
DECLARE i RECORD;
BEGIN
  SELECT vendor_id, org_id, region_id INTO i FROM vendor_catalog_items WHERE id = NEW.item_id;
  IF i IS NULL THEN
    RAISE EXCEPTION 'vendor_catalog_prices: item % is not visible in this scope', NEW.item_id USING ERRCODE = 'AC422';
  END IF;
  NEW.vendor_id := i.vendor_id; NEW.org_id := i.org_id; NEW.region_id := i.region_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS vendor_catalog_prices_inherit ON vendor_catalog_prices;
CREATE TRIGGER vendor_catalog_prices_inherit BEFORE INSERT OR UPDATE OF item_id, vendor_id, org_id, region_id ON vendor_catalog_prices FOR EACH ROW EXECUTE FUNCTION ac_price_inherits_from_item();

CREATE OR REPLACE FUNCTION ac_po_inherits() RETURNS TRIGGER AS $$
DECLARE rp RECORD;
BEGIN
  SELECT region_id, active INTO rp FROM receiving_points WHERE id = NEW.receiving_point_id;
  IF rp IS NULL THEN
    RAISE EXCEPTION 'purchase_orders: receiving point % is not visible in this scope', NEW.receiving_point_id USING ERRCODE = 'AC422';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = NEW.vendor_id) THEN
    RAISE EXCEPTION 'purchase_orders: vendor % is not visible in this scope', NEW.vendor_id USING ERRCODE = 'AC422';
  END IF;
  NEW.org_id := NEW.vendor_id;
  NEW.region_id := rp.region_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS purchase_orders_inherit ON purchase_orders;
CREATE TRIGGER purchase_orders_inherit BEFORE INSERT OR UPDATE OF vendor_id, receiving_point_id, org_id, region_id ON purchase_orders FOR EACH ROW EXECUTE FUNCTION ac_po_inherits();

-- Children of a PO: org, region and vendor are the PO's; a po_line_id, where
-- the row names one, must be a line of the same PO.
CREATE OR REPLACE FUNCTION ac_inherit_from_po() RETURNS TRIGGER AS $$
DECLARE p RECORD; l RECORD; row_po UUID; row_line UUID;
BEGIN
  row_po := (to_jsonb(NEW) ->> 'po_id')::uuid;
  row_line := (to_jsonb(NEW) ->> 'po_line_id')::uuid;
  SELECT id, org_id, region_id, vendor_id INTO p FROM purchase_orders WHERE id = row_po;
  IF p IS NULL THEN
    RAISE EXCEPTION '%: purchase order % is not visible in this scope', TG_TABLE_NAME, row_po USING ERRCODE = 'AC422';
  END IF;
  IF row_line IS NOT NULL THEN
    SELECT po_id INTO l FROM purchase_order_lines WHERE id = row_line;
    IF l IS NULL OR l.po_id <> p.id THEN
      RAISE EXCEPTION '%: line % is not a line of purchase order %', TG_TABLE_NAME, row_line, p.id USING ERRCODE = 'AC422';
    END IF;
  END IF;
  NEW.org_id := p.org_id; NEW.region_id := p.region_id; NEW.vendor_id := p.vendor_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ac_inherit_from_header() RETURNS TRIGGER AS $$
DECLARE h RECORD; l RECORD; header_table TEXT; header_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'shipment_lines' THEN header_table := 'shipments'; header_id := NEW.shipment_id;
  ELSE header_table := 'vendor_invoices'; header_id := (to_jsonb(NEW) ->> 'invoice_id')::uuid; END IF;
  EXECUTE format('SELECT po_id, org_id, region_id, vendor_id FROM %I WHERE id = $1', header_table) INTO h USING header_id;
  IF h IS NULL THEN
    RAISE EXCEPTION '%: % % is not visible in this scope', TG_TABLE_NAME, header_table, header_id USING ERRCODE = 'AC422';
  END IF;
  SELECT po_id INTO l FROM purchase_order_lines WHERE id = NEW.po_line_id;
  IF l IS NULL OR l.po_id <> h.po_id THEN
    RAISE EXCEPTION '%: line % is not a line of the purchase order this % is for', TG_TABLE_NAME, NEW.po_line_id, header_table USING ERRCODE = 'AC422';
  END IF;
  NEW.org_id := h.org_id; NEW.region_id := h.region_id; NEW.vendor_id := h.vendor_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_order_lines','shipments','po_receipts','vendor_invoices','rmas'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_inherit', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION ac_inherit_from_po()', t || '_inherit', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['shipment_lines','vendor_invoice_lines'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_inherit', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION ac_inherit_from_header()', t || '_inherit', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Quantities. Nothing ships beyond what was ordered, nothing is received
-- beyond what was ordered, nothing is returned beyond what was received.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_quantity_within_order() RETURNS TRIGGER AS $$
DECLARE ordered BIGINT; already BIGINT; limit_qty BIGINT; what TEXT;
BEGIN
  IF NEW.quantity_milli <= 0 THEN
    RAISE EXCEPTION '%: a quantity is more than zero', TG_TABLE_NAME USING ERRCODE = 'AC422';
  END IF;
  SELECT quantity_milli INTO ordered FROM purchase_order_lines WHERE id = NEW.po_line_id;
  IF TG_TABLE_NAME = 'shipment_lines' THEN
    SELECT COALESCE(sum(quantity_milli), 0) INTO already FROM shipment_lines WHERE po_line_id = NEW.po_line_id;
    limit_qty := ordered; what := 'ordered';
  ELSIF TG_TABLE_NAME = 'po_receipts' THEN
    SELECT COALESCE(sum(quantity_milli), 0) INTO already FROM po_receipts WHERE po_line_id = NEW.po_line_id;
    limit_qty := ordered; what := 'ordered';
  ELSE
    SELECT COALESCE(sum(quantity_milli), 0) INTO limit_qty FROM po_receipts WHERE po_line_id = NEW.po_line_id;
    SELECT COALESCE(sum(quantity_milli), 0) INTO already FROM rmas WHERE po_line_id = NEW.po_line_id AND state <> 'rejected';
    what := 'received';
  END IF;
  IF already + NEW.quantity_milli > limit_qty THEN
    RAISE EXCEPTION '%: % thousandths on top of % already would exceed the % % on line %',
      TG_TABLE_NAME, NEW.quantity_milli, already, limit_qty, what, NEW.po_line_id USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['shipment_lines','po_receipts','rmas'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_within_order', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION ac_quantity_within_order()', t || '_within_order', t);
  END LOOP;
END $$;

-- A shipment is recorded against a PO the vendor has acknowledged, and not
-- against a draft, a cancelled or a fully received one.
CREATE OR REPLACE FUNCTION ac_shipment_needs_acknowledged_po() RETURNS TRIGGER AS $$
DECLARE st TEXT;
BEGIN
  SELECT state INTO st FROM purchase_orders WHERE id = NEW.po_id;
  IF st IS DISTINCT FROM 'acknowledged' THEN
    RAISE EXCEPTION 'shipments: purchase order % is %; a shipment is recorded against an acknowledged order', NEW.po_id, COALESCE(st, 'not visible') USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS shipments_need_acknowledged_po ON shipments;
CREATE TRIGGER shipments_need_acknowledged_po BEFORE INSERT ON shipments FOR EACH ROW EXECUTE FUNCTION ac_shipment_needs_acknowledged_po();

-- ---------------------------------------------------------------------------
-- What a VENDOR may change on a row it can see. Each is one step, forward,
-- on named columns; every other column is the office's, and a vendor's
-- attempt at one is refused by name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_vendor_changes_are_its_own() RETURNS TRIGGER AS $$
DECLARE allowed TEXT[]; col TEXT; o JSONB := to_jsonb(OLD); n JSONB := to_jsonb(NEW);
BEGIN
  IF ac_setting('ac.namespace') IS DISTINCT FROM 'vendor' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'purchase_orders' THEN
    allowed := ARRAY['state','acknowledged_at','promised_ship_on'];
    IF NOT (OLD.state = 'issued' AND NEW.state = 'acknowledged') THEN
      RAISE EXCEPTION 'purchase_orders: a vendor acknowledges an issued order (issued → acknowledged); this one is % → %', OLD.state, NEW.state USING ERRCODE = 'AC403';
    END IF;
  ELSIF TG_TABLE_NAME = 'vendor_catalog_prices' THEN
    allowed := ARRAY['state'];
    IF NOT (OLD.state = 'proposed' AND NEW.state = 'withdrawn') THEN
      RAISE EXCEPTION 'vendor_catalog_prices: a vendor withdraws its own proposal (proposed → withdrawn); deciding is the office''s. This one is % → %', OLD.state, NEW.state USING ERRCODE = 'AC403';
    END IF;
  ELSIF TG_TABLE_NAME = 'rmas' THEN
    allowed := ARRAY['state','rma_number','vendor_note','responded_at'];
    IF NOT (OLD.state = 'requested' AND NEW.state IN ('authorized','rejected')) THEN
      RAISE EXCEPTION 'rmas: a vendor answers a requested return once (requested → authorized | rejected); this one is % → %', OLD.state, NEW.state USING ERRCODE = 'AC403';
    END IF;
    IF NEW.state = 'authorized' AND COALESCE(NEW.rma_number, '') = '' THEN
      RAISE EXCEPTION 'rmas: an authorized return carries the vendor''s RMA number' USING ERRCODE = 'AC422';
    END IF;
  ELSE
    RAISE EXCEPTION '%: a vendor changes nothing on this table', TG_TABLE_NAME USING ERRCODE = 'AC403';
  END IF;
  FOR col IN SELECT jsonb_object_keys(n) LOOP
    IF NOT (col = ANY(allowed)) AND (o -> col) IS DISTINCT FROM (n -> col) THEN
      RAISE EXCEPTION '%: a vendor may change % and nothing else; this write changes %', TG_TABLE_NAME, array_to_string(allowed, ', '), col USING ERRCODE = 'AC403';
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- A vendor's price arrives as a proposal, whatever the INSERT said.
CREATE OR REPLACE FUNCTION ac_vendor_price_is_proposed() RETURNS TRIGGER AS $$
BEGIN
  IF ac_setting('ac.namespace') = 'vendor' AND (NEW.state IS DISTINCT FROM 'proposed' OR NEW.decided_at IS NOT NULL OR NEW.decided_by IS NOT NULL) THEN
    RAISE EXCEPTION 'vendor_catalog_prices: a vendor proposes a price; accepting it is the office''s' USING ERRCODE = 'AC403';
  END IF;
  IF NEW.price_minor < 0 THEN
    RAISE EXCEPTION 'vendor_catalog_prices: a price is not negative' USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS vendor_catalog_prices_proposed ON vendor_catalog_prices;
CREATE TRIGGER vendor_catalog_prices_proposed BEFORE INSERT ON vendor_catalog_prices FOR EACH ROW EXECUTE FUNCTION ac_vendor_price_is_proposed();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders','vendor_catalog_prices','rmas'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_vendor_changes', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION ac_vendor_changes_are_its_own()', t || '_vendor_changes', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Visibility. We see everything; a vendor sees its own, and a purchase order
-- only once it is issued (a draft is ours, like a draft statement is 0007's).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_procurement_internal() RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'internal'
$$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION ac_vendor_own(row_org UUID) RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'vendor' AND row_org::text = ac_setting('ac.org_id')
$$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION ac_po_visible(row_po UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id = row_po)
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['vendors','receiving_points','vendor_catalog_items','vendor_catalog_prices','purchase_orders','purchase_order_lines',
                           'shipments','shipment_lines','po_receipts','vendor_invoices','vendor_invoice_lines','rmas'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
  END LOOP;
END $$;

-- Reads.
CREATE POLICY vendors_read ON vendors FOR SELECT USING (ac_procurement_internal() OR ac_vendor_own(id));
CREATE POLICY receiving_points_read ON receiving_points FOR SELECT USING (
  ac_procurement_internal()
  OR (ac_setting('ac.namespace') = 'vendor' AND EXISTS (SELECT 1 FROM purchase_orders p WHERE p.receiving_point_id = receiving_points.id)));
CREATE POLICY vendor_catalog_items_read ON vendor_catalog_items FOR SELECT USING (ac_procurement_internal() OR ac_vendor_own(org_id));
CREATE POLICY vendor_catalog_prices_read ON vendor_catalog_prices FOR SELECT USING (ac_procurement_internal() OR ac_vendor_own(org_id));
CREATE POLICY purchase_orders_read ON purchase_orders FOR SELECT USING (ac_procurement_internal() OR (ac_vendor_own(org_id) AND state <> 'draft'));
CREATE POLICY purchase_order_lines_read ON purchase_order_lines FOR SELECT USING (ac_procurement_internal() OR (ac_vendor_own(org_id) AND ac_po_visible(po_id)));
CREATE POLICY shipments_read ON shipments FOR SELECT USING (ac_procurement_internal() OR ac_vendor_own(org_id));
CREATE POLICY shipment_lines_read ON shipment_lines FOR SELECT USING (ac_procurement_internal() OR ac_vendor_own(org_id));
CREATE POLICY po_receipts_read ON po_receipts FOR SELECT USING (ac_procurement_internal() OR (ac_vendor_own(org_id) AND ac_po_visible(po_id)));
CREATE POLICY vendor_invoices_read ON vendor_invoices FOR SELECT USING (ac_procurement_internal() OR ac_vendor_own(org_id));
CREATE POLICY vendor_invoice_lines_read ON vendor_invoice_lines FOR SELECT USING (ac_procurement_internal() OR ac_vendor_own(org_id));
CREATE POLICY rmas_read ON rmas FOR SELECT USING (ac_procurement_internal() OR ac_vendor_own(org_id));

-- Writes. The office's tables: internal only.
CREATE POLICY vendors_insert ON vendors FOR INSERT WITH CHECK (ac_procurement_internal());
CREATE POLICY vendors_update ON vendors FOR UPDATE USING (ac_procurement_internal()) WITH CHECK (ac_procurement_internal());
CREATE POLICY receiving_points_insert ON receiving_points FOR INSERT WITH CHECK (ac_procurement_internal());
CREATE POLICY receiving_points_update ON receiving_points FOR UPDATE USING (ac_procurement_internal()) WITH CHECK (ac_procurement_internal());
CREATE POLICY vendor_catalog_items_insert ON vendor_catalog_items FOR INSERT WITH CHECK (ac_procurement_internal());
CREATE POLICY vendor_catalog_items_update ON vendor_catalog_items FOR UPDATE USING (ac_procurement_internal()) WITH CHECK (ac_procurement_internal());
CREATE POLICY purchase_order_lines_insert ON purchase_order_lines FOR INSERT WITH CHECK (ac_procurement_internal());
CREATE POLICY purchase_order_lines_update ON purchase_order_lines FOR UPDATE USING (ac_procurement_internal()) WITH CHECK (ac_procurement_internal());
CREATE POLICY po_receipts_insert ON po_receipts FOR INSERT WITH CHECK (ac_procurement_internal());
-- Shared: the office raises and issues a PO; the vendor acknowledges its own (the trigger holds the columns).
CREATE POLICY purchase_orders_insert ON purchase_orders FOR INSERT WITH CHECK (ac_procurement_internal());
CREATE POLICY purchase_orders_update ON purchase_orders FOR UPDATE
  USING (ac_procurement_internal() OR (ac_vendor_own(org_id) AND state <> 'draft'))
  WITH CHECK (ac_procurement_internal() OR ac_vendor_own(org_id));
-- A vendor proposes prices on its own items and withdraws its own proposals; the office decides.
CREATE POLICY vendor_catalog_prices_insert ON vendor_catalog_prices FOR INSERT WITH CHECK (ac_procurement_internal() OR ac_vendor_own(org_id));
CREATE POLICY vendor_catalog_prices_update ON vendor_catalog_prices FOR UPDATE
  USING (ac_procurement_internal() OR ac_vendor_own(org_id)) WITH CHECK (ac_procurement_internal() OR ac_vendor_own(org_id));
-- The vendor's own records: shipments and invoices, on its own visible orders. Written once, never updated.
CREATE POLICY shipments_insert ON shipments FOR INSERT WITH CHECK (ac_vendor_own(org_id) AND ac_po_visible(po_id));
CREATE POLICY shipment_lines_insert ON shipment_lines FOR INSERT WITH CHECK (ac_vendor_own(org_id));
CREATE POLICY vendor_invoices_insert ON vendor_invoices FOR INSERT WITH CHECK (ac_vendor_own(org_id) AND ac_po_visible(po_id));
CREATE POLICY vendor_invoice_lines_insert ON vendor_invoice_lines FOR INSERT WITH CHECK (ac_vendor_own(org_id));
-- A return: the office asks, the vendor answers (the trigger holds the columns).
CREATE POLICY rmas_insert ON rmas FOR INSERT WITH CHECK (ac_procurement_internal());
CREATE POLICY rmas_update ON rmas FOR UPDATE USING (ac_procurement_internal() OR ac_vendor_own(org_id)) WITH CHECK (ac_procurement_internal() OR ac_vendor_own(org_id));

-- ---------------------------------------------------------------------------
-- NEVER CUSTOMER NAMES, NEVER JOB RECORDS. A restrictive policy per table a
-- vendor has no business in, AND-ed with whatever permissive rule the table
-- already has — so nothing changes for any other namespace. Not here:
-- organizations and users (0007 already answers an external principal with
-- its own row), sessions (the liveness check reads the caller's own),
-- audit_log and outbox (every bound write inserts into both), regions, and
-- the tables above.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts','equipment','account_contacts','job_equipment',
    'subcontractor_firms','crews','crew_credentials','rate_cards','devices','device_grants',
    'contracts','contract_term_overrides','leads','call_records',
    'projects','jobs','compliance_clearances','assignments','job_state_events','job_media','time_entries','checklist_items','parts_used','warranty_cases',
    'service_requests','invoices','invoice_lines','working_capital_positions','settlements','settlement_lines','sync_mutations','sla_timers','hq_metrics'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_no_vendor', t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL USING (ac_setting(''ac.namespace'') IS DISTINCT FROM ''vendor'')', t || '_no_vendor', t);
  END LOOP;
END $$;
