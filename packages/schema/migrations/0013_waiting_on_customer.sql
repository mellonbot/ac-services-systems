-- ===========================================================================
-- 0013 — WAITING ON THE CUSTOMER.
--
-- The job state machine had no way to say the ball is in the customer's
-- court, so the dispatch dashboard's "Waiting on customer" bucket had nothing
-- to count. Three states, each a place a job sits while someone outside the
-- company decides:
--
--   quote_requested    before dispatch: the customer asked for pricing
--   quote_submitted    before dispatch: we priced it; approved → created
--                      (back to dispatch), declined → cancelled
--   awaiting_customer  mid-job: an approval or access the crew cannot act
--                      without; resumed → in_progress
--
-- The legal moves are packages/domain's JOB_TRANSITIONS; the ones the office
-- makes by hand (jobs.transition, S3) are OFFICE_JOB_TRANSITIONS in
-- packages/contracts. This file widens the CHECK on a database that already
-- ran 0001 with the old list. On a fresh database 0001 (regenerated from
-- packages/schema/src/tables/work.ts) already carries the new list and the
-- swap below replaces it with the same constraint.
-- ===========================================================================
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_state_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_state_check
  CHECK (state IN ('created','assigned','en_route','on_site','in_progress','awaiting_parts','complete','reopened','invoiced','cancelled','aborted','quote_requested','quote_submitted','awaiting_customer'));
