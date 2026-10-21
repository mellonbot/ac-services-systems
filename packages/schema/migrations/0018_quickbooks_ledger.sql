-- ===========================================================================
-- 0018 — THE QUICKBOOKS MIRROR.
--
-- QuickBooks Online is the ledger of record (decided 2026-10-21): invoices
-- are written there, and customers pay through QuickBooks' own pay link.
-- These tables are the worker's copy of them, so the office can read billed,
-- collected and invoiced → paid beside the work that earned them.
--
--   ledger_invoices     one QuickBooks invoice; its job is the one its memo
--                       names, and it carries that job's tenancy — or
--                       INTERNAL / UNASSIGNED until the memo names one
--   ledger_payments     one QuickBooks payment applied to one invoice
--   ledger_sync_state   the sync cursor and the encrypted refresh token
--
-- Read: the internal namespace, every row (0010's rule for derived figures).
--       Nobody else reads any: the customer's view of its invoices is S6's,
--       and comes with its own scope when the pay link reaches S6.
--       ledger_sync_state holds a credential: the office may read when the
--       mirror last ran (a column grant), and only the worker reads the token.
-- Written: the worker, bound as itself, and nothing else. Nothing is ever
--       deleted (no runtime role may): a payment line QuickBooks drops is
--       zeroed, and the lines it still has are written over it.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ledger_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  realm_id text NOT NULL,
  qbo_id text NOT NULL,
  doc_number text,
  customer_name text,
  memo text,
  job_id uuid REFERENCES jobs(id),
  txn_date date NOT NULL,
  due_date date,
  total_minor bigint NOT NULL,
  balance_minor bigint NOT NULL,
  currency text NOT NULL REFERENCES currencies(code),
  qbo_updated_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (realm_id, qbo_id)
);
CREATE INDEX IF NOT EXISTS ledger_invoices_region_id_idx ON ledger_invoices (region_id);
CREATE INDEX IF NOT EXISTS ledger_invoices_job_id_idx ON ledger_invoices (job_id);
CREATE INDEX IF NOT EXISTS ledger_invoices_txn_date_idx ON ledger_invoices (txn_date);

CREATE TABLE IF NOT EXISTS ledger_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  realm_id text NOT NULL,
  qbo_id text NOT NULL,
  invoice_qbo_id text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL REFERENCES currencies(code),
  received_on date NOT NULL,
  qbo_updated_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (realm_id, qbo_id, invoice_qbo_id)
);
CREATE INDEX IF NOT EXISTS ledger_payments_region_id_idx ON ledger_payments (region_id);
CREATE INDEX IF NOT EXISTS ledger_payments_realm_id_invoice_qbo_id_idx ON ledger_payments (realm_id, invoice_qbo_id);
CREATE INDEX IF NOT EXISTS ledger_payments_received_on_idx ON ledger_payments (received_on);

CREATE TABLE IF NOT EXISTS ledger_sync_state (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  realm_id text NOT NULL,
  cursor timestamptz,
  refresh_token_enc text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (realm_id)
);
CREATE INDEX IF NOT EXISTS ledger_sync_state_region_id_idx ON ledger_sync_state (region_id);

REVOKE ALL ON ledger_invoices FROM ac_gateway, ac_readonly, ac_worker;
GRANT SELECT, INSERT, UPDATE ON ledger_invoices TO ac_worker;
GRANT SELECT ON ledger_invoices TO ac_gateway, ac_readonly;
ALTER TABLE ledger_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_invoices_read ON ledger_invoices;
DROP POLICY IF EXISTS ledger_invoices_insert ON ledger_invoices;
DROP POLICY IF EXISTS ledger_invoices_update ON ledger_invoices;
DROP POLICY IF EXISTS ledger_invoices_delete ON ledger_invoices;
CREATE POLICY ledger_invoices_read ON ledger_invoices FOR SELECT
  USING (ac_setting('ac.namespace') = 'internal');
CREATE POLICY ledger_invoices_insert ON ledger_invoices FOR INSERT WITH CHECK (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker');
CREATE POLICY ledger_invoices_update ON ledger_invoices FOR UPDATE USING (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker') WITH CHECK (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker');

REVOKE ALL ON ledger_payments FROM ac_gateway, ac_readonly, ac_worker;
GRANT SELECT, INSERT, UPDATE ON ledger_payments TO ac_worker;
GRANT SELECT ON ledger_payments TO ac_gateway, ac_readonly;
ALTER TABLE ledger_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_payments_read ON ledger_payments;
DROP POLICY IF EXISTS ledger_payments_insert ON ledger_payments;
DROP POLICY IF EXISTS ledger_payments_update ON ledger_payments;
DROP POLICY IF EXISTS ledger_payments_delete ON ledger_payments;
CREATE POLICY ledger_payments_read ON ledger_payments FOR SELECT
  USING (ac_setting('ac.namespace') = 'internal');
CREATE POLICY ledger_payments_insert ON ledger_payments FOR INSERT WITH CHECK (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker');
CREATE POLICY ledger_payments_update ON ledger_payments FOR UPDATE USING (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker') WITH CHECK (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker');

REVOKE ALL ON ledger_sync_state FROM ac_gateway, ac_readonly, ac_worker;
GRANT SELECT, INSERT, UPDATE ON ledger_sync_state TO ac_worker;
ALTER TABLE ledger_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_sync_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_sync_state_read ON ledger_sync_state;
DROP POLICY IF EXISTS ledger_sync_state_insert ON ledger_sync_state;
DROP POLICY IF EXISTS ledger_sync_state_update ON ledger_sync_state;
DROP POLICY IF EXISTS ledger_sync_state_delete ON ledger_sync_state;
-- The office may see when the mirror last ran, never the token: a column grant, so the row policy can be the internal one.
GRANT SELECT (realm_id, cursor, synced_at) ON ledger_sync_state TO ac_gateway, ac_readonly;
CREATE POLICY ledger_sync_state_read ON ledger_sync_state FOR SELECT
  USING (ac_setting('ac.namespace') = 'internal');
CREATE POLICY ledger_sync_state_insert ON ledger_sync_state FOR INSERT WITH CHECK (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker');
CREATE POLICY ledger_sync_state_update ON ledger_sync_state FOR UPDATE USING (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker') WITH CHECK (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker');
