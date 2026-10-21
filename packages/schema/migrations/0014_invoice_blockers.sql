-- ===========================================================================
-- 0014 — WHAT BLOCKS THE INVOICE.
--
-- A finished job sat in `complete` whatever was stopping the bill, so the
-- dispatch dashboard could not tell "ready to invoice" from "can't invoice
-- yet". Four states, all the office's (jobs.transition, S3):
--
--   needs_pricing      complete → priced → complete
--   awaiting_po        complete → the customer's PO arrives → complete
--   awaiting_pictures  complete → the crew's photos arrive → complete
--   invoice_trouble    invoiced → kicked back, fixed and re-sent → invoiced
--
-- Every one is finished work: packages/contracts' WORK_DONE_STATES puts them
-- beside complete and invoiced for the board, the HQ rollup and "last
-- serviced". Same swap as 0013, with the full list.
-- ===========================================================================
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_state_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_state_check
  CHECK (state IN ('created','assigned','en_route','on_site','in_progress','awaiting_parts','complete','reopened','invoiced','cancelled','aborted','quote_requested','quote_submitted','awaiting_customer','needs_pricing','awaiting_po','awaiting_pictures','invoice_trouble'));
