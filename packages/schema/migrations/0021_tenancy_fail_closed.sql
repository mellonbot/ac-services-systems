-- ===========================================================================
-- 0021 — TENANCY FAILS CLOSED.
--
-- (Whole-repo review, 2026-10-22.) 0002 promised that a forgotten WHERE
-- returns zero rows. Four things still broke that promise at the table:
--
--   1. ac_unbound() was "ac.namespace is NULL". Every policy that admitted the
--      gateway-before-login therefore admitted ANY transaction that forgot to
--      bind — users with password_hash, sessions, leads, audit_log, outbox,
--      settlements. A forgotten binding was every tenant's rows. The gateway
--      acting as itself now says so (`ac.namespace = 'system'`, pg-tx.ts
--      bindSystem) and a transaction that names nobody reads nothing.
--   2. sync_conflicts, subscriptions and brand_themes had no row security at
--      all: any principal read other tenants' entity snapshots, and could
--      re-point another tenant's white-label host.
--   3. jobs, job_media, parts_used and warranty_cases had a USING-only policy,
--      which Postgres applies to INSERT and UPDATE as well — so a customer or
--      firm binding could write the jobs it could see. Writers are now held to
--      the office and the field layer (the surfaces that write them: S2/S3, S5).
--   4. projects was region-only: a customer, firm or device in a region read
--      every customer's projects there. No handler outside the office reads
--      projects, so outside internal and device it is now absent.
--
-- Also: the warehouse and the worker lose SELECT on users.password_hash; the
-- runtime roles lose write on the migration ledger and the currency table;
-- every SECURITY DEFINER function pins search_path with pg_temp LAST, so a
-- temporary table cannot shadow the table a definer function reads; sessions
-- may be opened only by the gateway acting as itself or by a device login.
-- ===========================================================================

-- 1. ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_unbound() RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') IS NOT DISTINCT FROM 'system'
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS sessions_open ON sessions;
CREATE POLICY sessions_open ON sessions FOR INSERT
  WITH CHECK (ac_unbound() OR ac_setting('ac.namespace') = 'device');

-- 2. ------------------------------------------------------------------------
ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_conflicts_office ON sync_conflicts;
DROP POLICY IF EXISTS sync_conflicts_queue ON sync_conflicts;
-- The office reads and resolves the queue; a device only adds to it.
CREATE POLICY sync_conflicts_office ON sync_conflicts
  USING (ac_internal() AND ac_region_visible(region_id))
  WITH CHECK (ac_internal() AND ac_region_visible(region_id));
CREATE POLICY sync_conflicts_queue ON sync_conflicts FOR INSERT
  WITH CHECK (ac_setting('ac.namespace') = 'device' AND region_id::text = ac_setting('ac.region_id'));

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_internal ON subscriptions;
CREATE POLICY subscriptions_internal ON subscriptions USING (ac_internal()) WITH CHECK (ac_internal());

ALTER TABLE brand_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_themes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brand_themes_read ON brand_themes;
DROP POLICY IF EXISTS brand_themes_write ON brand_themes;
-- A theme is public by construction (the sign-in screen reads it as the
-- gateway itself); a tenant reads its own. Only the office writes one.
CREATE POLICY brand_themes_read ON brand_themes FOR SELECT
  USING (ac_unbound() OR ac_internal() OR org_id::text = ac_setting('ac.org_id'));
CREATE POLICY brand_themes_write ON brand_themes FOR ALL
  USING (ac_internal()) WITH CHECK (ac_internal());

-- 3. ------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','job_media','parts_used','warranty_cases'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_writers_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_writers_update', t);
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT
      WITH CHECK (ac_setting('ac.namespace') IN ('internal', 'device'))$p$, t || '_writers_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE
      USING (ac_setting('ac.namespace') IN ('internal', 'device'))
      WITH CHECK (ac_setting('ac.namespace') IN ('internal', 'device'))$p$, t || '_writers_update', t);
  END LOOP;
END $$;

-- 4. ------------------------------------------------------------------------
DROP POLICY IF EXISTS projects_region_isolation ON projects;
CREATE POLICY projects_region_isolation ON projects
  USING (ac_setting('ac.namespace') IN ('internal', 'device') AND ac_region_visible(region_id));

-- Privileges ------------------------------------------------------------------
-- Column grants only bite once the table grant is gone.
DO $$
DECLARE cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users' AND column_name <> 'password_hash';
  REVOKE SELECT ON users FROM ac_readonly, ac_worker;
  EXECUTE format('GRANT SELECT (%s) ON users TO ac_readonly, ac_worker', cols);
END $$;

REVOKE INSERT, UPDATE, DELETE ON schema_migrations, currencies FROM ac_gateway, ac_worker, ac_readonly;

DO $$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosecdef LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f);
  END LOOP;
END $$;

-- The AC Logins desktop app ---------------------------------------------------
-- It was granted ac_gateway: write on every table, from a laptop. It now has a
-- role of its own that writes only the tables its screens write. It reads
-- under row security like any other caller — and reads broadly because the
-- policies it is held to read other tables on its behalf.
DO $$ BEGIN
  CREATE ROLE ac_logins NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO ac_logins;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ac_logins;
GRANT INSERT, UPDATE ON users, crews, organizations, subcontractor_firms TO ac_logins;
GRANT INSERT ON audit_log, outbox TO ac_logins;
GRANT EXECUTE ON FUNCTION ac_scope_ancestors() TO ac_logins;
GRANT UPDATE ON sessions TO ac_logins;
