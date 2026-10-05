DO $history_contract$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Supabase migration history table is missing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20260804120000','20260805120000','20260806170000','20260807120000',
      '20260808041000','20260808051000','20261004123000'
    )
  ) THEN
    RAISE EXCEPTION 'A Channel Manager Live Core rollout version is already registered.';
  END IF;
END
$history_contract$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  ('20260804120000', 'channel_manager_live_core_initial_sync_v1', ARRAY[]::TEXT[]),
  ('20260805120000', 'channel_manager_live_core_synthetic_recovery_v1', ARRAY[]::TEXT[]),
  ('20260806170000', 'channel_manager_live_incremental_sync_v1', ARRAY[]::TEXT[]),
  ('20260807120000', 'channel_manager_reconciliation_recovery_v1', ARRAY[]::TEXT[]),
  ('20260808041000', 'channel_manager_live_core_recovery_fk_expectation_fix_v1', ARRAY[]::TEXT[]),
  ('20260808051000', 'channel_manager_live_core_acceptance_cleanup_v2', ARRAY[]::TEXT[]),
  ('20261004123000', 'channel_manager_live_scope_guard_v1', ARRAY[]::TEXT[]);

SELECT 'CHANNEL_MANAGER_LIVE_CORE_HISTORY=seven_versions_registered' AS result;
