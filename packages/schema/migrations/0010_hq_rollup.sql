-- ===========================================================================
-- 0010 — THE HQ ROLLUP (item 10, S4 HQ Ops Dashboard).
--
-- S4 is Rankine's leadership looking at the whole company: service, money,
-- the network and growth, every region at once. The registry says what it may
-- be and nothing more: org-wide READ only, writes `[]`, and "warehouse-backed
-- and already asynchronous; shows the age of its last rollup and nothing
-- more". So S4 does not read the operational tables at all. The worker
-- computes the figures into `hq_metrics` on a schedule
-- (apps/worker/src/rollup.ts); the gateway reads that one table; the screen
-- prints `as_of`. Leadership load never lands on the rows dispatch is
-- writing, and a dashboard that is fifteen minutes old says so.
--
-- Who may do what with a row, stated here rather than remembered:
--
--   read      the internal namespace — S4's principals, and the office roles
--             that already see every region's rows the figures are made of.
--             No customer, firm, vendor, device or visitor reads a figure:
--             a region's breach count is ours.
--   write     the worker, and only the worker: internal namespace AND bound
--             as surface 'worker'. The gateway role is not granted INSERT or
--             UPDATE at all, so no request path — S4's included — can write
--             a figure, whatever a handler does. That is the database half of
--             `SURFACES.S4.writes = []`.
--   delete    nobody (0002: DELETE is revoked from every role). A day's row
--             is overwritten by the next refresh that day and kept after it.
--
-- tools/ci/schema-guard.ts §3d holds the ERRCODE on every RAISE; there is no
-- RAISE here — every refusal on this table is RLS's own.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The table, for a database that already ran 0001 without it. On a fresh
-- database 0001 (regenerated) created it and this is a no-op. Source of
-- truth: packages/schema/src/tables/hq.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hq_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  day date NOT NULL,
  metric text NOT NULL,
  value bigint NOT NULL,
  as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (day, region_id, metric)
);
CREATE INDEX IF NOT EXISTS hq_metrics_region_id_idx ON hq_metrics (region_id);
CREATE INDEX IF NOT EXISTS hq_metrics_day_idx ON hq_metrics (day);
CREATE INDEX IF NOT EXISTS hq_metrics_metric_day_idx ON hq_metrics (metric, day);

-- On a fresh database 0002's GRANT ON ALL TABLES reached this table after
-- 0001 created it; on an existing one nothing has. Either way, end in the
-- same place: the worker writes, everyone else reads.
GRANT SELECT, INSERT, UPDATE ON hq_metrics TO ac_worker;
GRANT SELECT ON hq_metrics TO ac_gateway, ac_readonly;
REVOKE INSERT, UPDATE, DELETE ON hq_metrics FROM ac_gateway, ac_readonly;
REVOKE DELETE ON hq_metrics FROM ac_worker;

ALTER TABLE hq_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE hq_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hq_metrics_read ON hq_metrics;
DROP POLICY IF EXISTS hq_metrics_insert ON hq_metrics;
DROP POLICY IF EXISTS hq_metrics_update ON hq_metrics;
CREATE POLICY hq_metrics_read ON hq_metrics FOR SELECT
  USING (ac_setting('ac.namespace') = 'internal');
CREATE POLICY hq_metrics_insert ON hq_metrics FOR INSERT
  WITH CHECK (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker');
CREATE POLICY hq_metrics_update ON hq_metrics FOR UPDATE
  USING (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker')
  WITH CHECK (ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.surface_id') = 'worker');
