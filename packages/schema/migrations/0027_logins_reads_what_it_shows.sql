-- ===========================================================================
-- 0027 — THE LOGINS APP READS WHAT ITS SCREENS SHOW, AND NO PASSWORD HASH.
--
-- 0021 gave ac_logins SELECT on every table and said it "reads under row
-- security like any other caller". Row security is bound by GUCs any role
-- may set, so in practice the role read every users.password_hash, every
-- session, every rate card, settlement and the audit log — from a laptop.
--
-- Now it reads the tables its screens and its policies' subqueries read, and
-- users without password_hash (the same column grant 0021 gave ac_readonly
-- and ac_worker). It still WRITES a hash: setting a password is its job;
-- reading one back is not.
-- ===========================================================================
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM ac_logins;

GRANT SELECT ON accounts, assignments, crew_credentials, crews, device_grants, jobs,
                organizations, regions, subcontractor_firms
  TO ac_logins;

DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users' AND column_name <> 'password_hash';
  EXECUTE format('GRANT SELECT (%s) ON users TO ac_logins', cols);
END $$;

-- sessions: the revoke-on-deactivate UPDATE filters on these, and nothing else.
GRANT SELECT (id, principal_kind, principal_id, revoked_at) ON sessions TO ac_logins;
