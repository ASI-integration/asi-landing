-- Register the exact five Wave 5 core migration versions in the same transaction as schema apply.
-- This follows the repository's established atomic production migration-history contract.

DO $history_contract$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Supabase migration history table is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations'
      AND table_name = 'schema_migrations'
      AND column_name = 'version'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations'
      AND table_name = 'schema_migrations'
      AND column_name = 'name'
      AND data_type = 'text'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations'
      AND table_name = 'schema_migrations'
      AND column_name = 'statements'
      AND data_type = 'ARRAY'
      AND udt_name = '_text'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'supabase_migrations'
      AND r.relname = 'schema_migrations'
      AND c.contype = 'p'
      AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (version)'
  ) THEN
    RAISE EXCEPTION 'Supabase migration history table contract is incompatible.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20260930200000',
      '20261003093000',
      '20261003124500',
      '20261003141500',
      '20261003150000'
    )
  ) THEN
    RAISE EXCEPTION 'A Wave 5 core migration version is already registered.';
  END IF;
END
$history_contract$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  ('20260930200000', 'guest_long_term_memory_account_scope', ARRAY[]::TEXT[]),
  ('20261003093000', 'residential_property_spatial_snapshots_v1', ARRAY[]::TEXT[]),
  ('20261003124500', 'booking_ops_auto_send_account_scope_v1', ARRAY[]::TEXT[]),
  ('20261003141500', 'booking_inbound_intake_account_scope_v1', ARRAY[]::TEXT[]),
  ('20261003150000', 'booking_availability_account_scope_v1', ARRAY[]::TEXT[]);

SELECT 'WAVE5_CORE_MIGRATION_HISTORY=five_versions_registered' AS result;
