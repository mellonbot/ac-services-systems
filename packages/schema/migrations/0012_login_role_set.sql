-- ===========================================================================
-- 0012 — THE LOGIN MAY SET ROLE TO THE APPLICATION ROLES.
--
-- Every gateway transaction begins `SET LOCAL ROLE ac_gateway`, and the
-- worker's `ac_worker` (pg-tx.ts: "the pool's login role IS a member of
-- ac_gateway"). On the first production database that was false in the one
-- way nothing before this file could see: the login that ran 0002 CREATED the
-- roles, and since Postgres 16 a creator is granted membership with ADMIN
-- OPTION but INHERIT FALSE and SET FALSE. pg_has_role(... 'MEMBER') answered
-- true; SET ROLE answered "permission denied" (42501); every request was a
-- 500 while /healthz, which sets no role, stayed green.
--
-- So the migrating login is granted the two roles WITH SET TRUE, by name,
-- here, where it is applied by the deploy and recorded in schema_migrations
-- rather than typed once into a console. The login that migrates and the
-- login the gateway and worker connect as are the same DATABASE_URL
-- (docs/CLOUDFLARE_PAGES.md); should they ever differ, the gateway's login
-- needs this same grant and this file is the one that says so. Under CI's
-- superuser the statement is a no-op with a NOTICE. Re-granting an existing
-- membership updates its options, so the file is safe to apply on any state.
-- ===========================================================================
DO $$ BEGIN
  EXECUTE format('GRANT ac_gateway, ac_worker TO %I WITH SET TRUE', current_user);
END $$;
