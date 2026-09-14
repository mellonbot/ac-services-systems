-- The assertion that the shard key is still total.
-- Runs in CI after every migration. If it ever fails, Tier 3 just became a
-- migration project and feature work stops (risk register, same response as a
-- hierarchy leak).

CREATE OR REPLACE FUNCTION ac_assert_region_id_everywhere() RETURNS void AS $$
DECLARE
  offender TEXT;
  -- The two allowlists, mirrored from packages/schema/src/tenancy.ts.
  -- They are short on purpose and they are the whole exception surface.
  tenancy_roots TEXT[] := ARRAY['organizations','regions'];
  global_refs   TEXT[] := ARRAY['currencies','part_manufacturers','schema_migrations','term_registry'];
BEGIN
  SELECT string_agg(t.table_name, ', ') INTO offender
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND NOT (t.table_name = ANY(tenancy_roots))
    AND NOT (t.table_name = ANY(global_refs))
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t.table_name
        AND c.column_name = 'region_id' AND c.is_nullable = 'NO'
    );

  IF offender IS NOT NULL THEN
    RAISE EXCEPTION
      'region_id is not total. Offending tables: %. Either the table is operational (add it via operationalTable()) or it is an exception (name it in a reviewed diff in tenancy.ts AND here).',
      offender;
  END IF;
END $$ LANGUAGE plpgsql;
