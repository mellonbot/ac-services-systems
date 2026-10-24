-- ===========================================================================
-- 0030 — WHAT WAS PAID AGAINST AN INVOICE, AND WHETHER IT WAS VOIDED.
--
-- OPEN-PAYMENTS, customer half, in the shape the S6 payments spec
-- (docs/superpowers/specs/2026-10-21-s6-photos-and-payments-scope.md §2) set:
--
--   payments        one row per payment received: amount, method, reference,
--                   when it arrived. The invoice's paid status is DERIVED —
--                   succeeded rows summed against the total — never a column
--                   someone sets. A part payment is a row like any other.
--   invoices.voided_at / void_reason
--                   the office voids an invoice it should not have issued.
--                   Refused while any payment stands against it.
--
-- Today the office records what arrives (payments.record). Y1–Y5 of the spec
-- (ledger of record, processor, who may pay a consolidated invoice) are still
-- open; whichever way they go, a processor's webhook adds rows to this same
-- table, so nothing here is built twice.
--
-- Held at the table, not only at the gateway:
--   - a payment is against an issued, unvoided invoice, in its currency, its
--     org and its region, and succeeded payments never exceed its total;
--   - a payment is never deleted or re-priced: it moves pending → succeeded
--     or failed, and succeeded → returned or refunded, and nothing else;
--   - an invoice with a payment standing, or voided, keeps its money: its
--     total and its lines no longer change, and a voided one not at all.
-- ===========================================================================

-- Invoices: void.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_void_has_reason;
ALTER TABLE invoices ADD CONSTRAINT invoices_void_has_reason
  CHECK ((voided_at IS NULL) = (void_reason IS NULL) AND (void_reason IS NULL OR length(btrim(void_reason)) > 0));
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_void_once_issued;
ALTER TABLE invoices ADD CONSTRAINT invoices_void_once_issued CHECK (voided_at IS NULL OR issued_at IS NOT NULL);

-- Payments.
CREATE TABLE IF NOT EXISTS payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL REFERENCES currencies(code),
  method text NOT NULL CHECK (method IN ('ach','wire','check','card','cash','other')),
  reference text,
  state text NOT NULL DEFAULT 'succeeded' CHECK (state IN ('pending','succeeded','failed','returned','refunded')),
  received_at timestamptz NOT NULL,
  returned_at timestamptz,
  return_reason text,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT payments_returned_has_when CHECK ((state IN ('returned','refunded')) = (returned_at IS NOT NULL) AND (returned_at IS NULL OR returned_at >= received_at))
);
CREATE INDEX IF NOT EXISTS payments_region_id_idx ON payments (region_id);
CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON payments (invoice_id);

-- Read and write, never delete (as 0011 granted procurement's tables).
GRANT SELECT, INSERT, UPDATE ON payments TO ac_gateway, ac_worker;
GRANT SELECT ON payments TO ac_readonly;

-- A payment is visible exactly when its invoice is (0009's ac_invoice_visible
-- answers that on `invoices`); only the office and the system write one.
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_read ON payments;
DROP POLICY IF EXISTS payments_insert ON payments;
DROP POLICY IF EXISTS payments_update ON payments;
CREATE POLICY payments_read ON payments FOR SELECT
  USING (ac_unbound() OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = payments.invoice_id));
CREATE POLICY payments_insert ON payments FOR INSERT WITH CHECK (ac_unbound() OR ac_internal());
CREATE POLICY payments_update ON payments FOR UPDATE
  USING (ac_unbound() OR ac_internal()) WITH CHECK (ac_unbound() OR ac_internal());

-- A payment fits its invoice. The invoice row is locked, so two payments
-- recorded at once are summed one after the other, never both against the
-- same remainder.
CREATE OR REPLACE FUNCTION ac_payment_fits_its_invoice() RETURNS trigger AS $$
DECLARE
  inv RECORD;
  standing bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment % is not deleted — a payment that came back is marked returned', OLD.id USING ERRCODE = 'AC422';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.invoice_id <> OLD.invoice_id OR NEW.amount_minor <> OLD.amount_minor OR NEW.currency <> OLD.currency
       OR NEW.received_at <> OLD.received_at OR NEW.org_id <> OLD.org_id OR NEW.region_id <> OLD.region_id THEN
      RAISE EXCEPTION 'payment %: what was received does not change — a wrong payment is returned and recorded again', OLD.id
      USING ERRCODE = 'AC422';
    END IF;
    IF NEW.state <> OLD.state AND NOT (
         (OLD.state = 'pending' AND NEW.state IN ('succeeded','failed'))
      OR (OLD.state = 'succeeded' AND NEW.state IN ('returned','refunded'))) THEN
      RAISE EXCEPTION 'payment %: % cannot become %', OLD.id, OLD.state, NEW.state
      USING ERRCODE = 'AC422';
    END IF;
  END IF;

  SELECT id, org_id, region_id, total_minor, currency, issued_at, voided_at INTO inv
    FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment names invoice %, which this caller cannot see', NEW.invoice_id USING ERRCODE = 'AC422';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF inv.issued_at IS NULL THEN
      RAISE EXCEPTION 'invoice % has not been issued — there is nothing to pay yet', inv.id USING ERRCODE = 'AC422';
    END IF;
    IF inv.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'invoice % is void; nothing is paid against it', inv.id USING ERRCODE = 'AC422';
    END IF;
    IF NEW.currency <> inv.currency THEN
      RAISE EXCEPTION 'invoice % is in %; a payment in % is not one it can take', inv.id, inv.currency, NEW.currency USING ERRCODE = 'AC422';
    END IF;
    IF NEW.org_id <> inv.org_id OR NEW.region_id <> inv.region_id THEN
      RAISE EXCEPTION 'payment tenancy does not match invoice %', inv.id USING ERRCODE = 'AC422';
    END IF;
  END IF;
  IF NEW.state = 'succeeded' AND (TG_OP = 'INSERT' OR OLD.state <> 'succeeded') THEN
    SELECT COALESCE(sum(amount_minor), 0) INTO standing FROM payments
     WHERE invoice_id = inv.id AND state = 'succeeded' AND id <> NEW.id;
    IF standing + NEW.amount_minor > inv.total_minor THEN
      RAISE EXCEPTION 'invoice % totals %; % is already paid, so % more would overpay it', inv.id, inv.total_minor, standing, NEW.amount_minor
      USING ERRCODE = 'AC422';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_payment_fits_its_invoice ON payments;
CREATE TRIGGER ac_payment_fits_its_invoice BEFORE INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION ac_payment_fits_its_invoice();

-- An invoice keeps its money once a payment stands against it, and a voided
-- invoice keeps everything.
CREATE OR REPLACE FUNCTION ac_invoice_money_is_held() RETURNS trigger AS $$
DECLARE paid boolean;
BEGIN
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'invoice % is void, and a void invoice does not change — issue a new one', OLD.id USING ERRCODE = 'AC422';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoice % is not deleted — void it', OLD.id USING ERRCODE = 'AC422';
  END IF;
  SELECT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = OLD.id AND p.state IN ('pending','succeeded')) INTO paid;
  IF paid AND (NEW.total_minor <> OLD.total_minor OR NEW.currency <> OLD.currency) THEN
    RAISE EXCEPTION 'invoice % has a payment against it; its total does not change', OLD.id USING ERRCODE = 'AC422';
  END IF;
  IF paid AND NEW.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'invoice % has a payment against it and cannot be voided — return or refund the payment first', OLD.id USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_invoice_money_is_held ON invoices;
CREATE TRIGGER ac_invoice_money_is_held BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION ac_invoice_money_is_held();

CREATE OR REPLACE FUNCTION ac_invoice_line_money_is_held() RETURNS trigger AS $$
DECLARE held boolean;
DECLARE inv uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  SELECT i.voided_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.state IN ('pending','succeeded'))
    INTO held FROM invoices i WHERE i.id = inv;
  IF held THEN
    RAISE EXCEPTION 'invoice % is paid against or void; its lines do not change', inv USING ERRCODE = 'AC422';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_invoice_line_money_is_held ON invoice_lines;
CREATE TRIGGER ac_invoice_line_money_is_held BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION ac_invoice_line_money_is_held();
