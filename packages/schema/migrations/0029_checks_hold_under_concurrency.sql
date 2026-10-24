-- ===========================================================================
-- 0029 — A CHECK THAT READS ANOTHER ROW HOLDS IT, AND IS RE-RUN WHEN IT MOVES.
--
-- (Whole-repo review, 2026-10-24.) Each check below read a sum or an EXISTS
-- with no lock, so two concurrent writers both passed it; or ran on INSERT
-- only, so an UPDATE walked straight past it.
--
--   1. quantities: shipment_lines, po_receipts and rmas are summed under a
--      lock on their PO line, and re-checked when a quantity or line changes.
-- ===========================================================================

-- 1. ------------------------------------------------------------------------
-- The lock only. A vendor records shipment lines but may not UPDATE the PO
-- line, and FOR UPDATE reads through UPDATE policies — so taking the lock as
-- the caller would hide the line from a vendor. This reads nothing back; the
-- check below still reads the ordered quantity through the caller's row
-- security, and refuses a line it cannot see.
CREATE OR REPLACE FUNCTION ac_lock_po_line(line UUID) RETURNS VOID AS $$
  SELECT NULL::void FROM (SELECT 1 FROM purchase_order_lines WHERE id = line FOR UPDATE) l
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION ac_quantity_within_order() RETURNS TRIGGER AS $$
DECLARE ordered BIGINT; already BIGINT; limit_qty BIGINT; what TEXT;
BEGIN
  IF NEW.quantity_milli <= 0 THEN
    RAISE EXCEPTION '%: a quantity is more than zero', TG_TABLE_NAME USING ERRCODE = 'AC422';
  END IF;
  -- Concurrent writers to one line queue here; each sum below is read after
  -- the one before it committed.
  PERFORM ac_lock_po_line(NEW.po_line_id);
  SELECT quantity_milli INTO ordered FROM purchase_order_lines WHERE id = NEW.po_line_id;
  IF ordered IS NULL THEN
    RAISE EXCEPTION '%: line % is not visible in this scope', TG_TABLE_NAME, NEW.po_line_id USING ERRCODE = 'AC422';
  END IF;
  -- id <> NEW.id: on UPDATE the row's old quantity is not "already".
  IF TG_TABLE_NAME = 'shipment_lines' THEN
    SELECT COALESCE(sum(quantity_milli), 0) INTO already FROM shipment_lines WHERE po_line_id = NEW.po_line_id AND id <> NEW.id;
    limit_qty := ordered; what := 'ordered';
  ELSIF TG_TABLE_NAME = 'po_receipts' THEN
    SELECT COALESCE(sum(quantity_milli), 0) INTO already FROM po_receipts WHERE po_line_id = NEW.po_line_id AND id <> NEW.id;
    limit_qty := ordered; what := 'ordered';
  ELSE
    SELECT COALESCE(sum(quantity_milli), 0) INTO limit_qty FROM po_receipts WHERE po_line_id = NEW.po_line_id;
    SELECT COALESCE(sum(quantity_milli), 0) INTO already FROM rmas WHERE po_line_id = NEW.po_line_id AND state <> 'rejected' AND id <> NEW.id;
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
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF quantity_milli, po_line_id ON %I FOR EACH ROW EXECUTE FUNCTION ac_quantity_within_order()', t || '_within_order', t);
  END LOOP;
END $$;
