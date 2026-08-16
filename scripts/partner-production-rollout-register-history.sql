-- Supabase CLI migration tracking contract:
-- supabase_migrations.schema_migrations(version text primary key, statements text[], name text).
-- The CLI compares migration versions to decide whether a file is pending. These plain inserts
-- deliberately fail on any existing version and run in the same transaction as the seven files.

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
    FROM pg_constraint AS constraint_record
    JOIN pg_class AS relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'supabase_migrations'
      AND relation.relname = 'schema_migrations'
      AND constraint_record.contype = 'p'
      AND pg_get_constraintdef(constraint_record.oid) = 'PRIMARY KEY (version)'
  ) THEN
    RAISE EXCEPTION 'Supabase migration history table contract is incompatible.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20260816144742',
      '20260815102111',
      '20260815130000',
      '20260815160000',
      '20260815190000',
      '20260815210000',
      '20260815230000'
    )
  ) THEN
    RAISE EXCEPTION 'An allowlisted partner migration version is already registered.';
  END IF;
END
$history_contract$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  ('20260816144742', 'partner_property_knowledge_schema_completion_v1', ARRAY[]::TEXT[]),
  ('20260815102111', 'partner_communication_durable_state_v1', ARRAY[]::TEXT[]),
  ('20260815130000', 'partner_authenticated_inbox_v1', ARRAY[]::TEXT[]),
  ('20260815160000', 'partner_communication_brain_v1', ARRAY[]::TEXT[]),
  ('20260815190000', 'partner_service_recovery_loop_v1', ARRAY[]::TEXT[]),
  ('20260815210000', 'partner_review_reputation_engine_v1', ARRAY[]::TEXT[]),
  ('20260815230000', 'partner_revenue_shadow_pricing_v1', ARRAY[]::TEXT[]);

SELECT 'PARTNER_ROLLOUT_MIGRATION_HISTORY=seven_versions_registered' AS result;
