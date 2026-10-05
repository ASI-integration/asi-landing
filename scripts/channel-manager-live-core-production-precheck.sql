BEGIN TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  v_state jsonb;
  v_invalid_types bigint;
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=read_only_guard_failed';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=missing_migration_history';
  END IF;

  IF to_regclass('public.booking_channel_manager_connections') IS NULL
     OR to_regclass('public.booking_property_setup_profiles') IS NULL
     OR to_regclass('public.booking_channel_import_runs') IS NULL
     OR to_regclass('public.booking_channel_imported_objects') IS NULL
     OR to_regclass('public.booking_channel_imported_bookings') IS NULL
     OR to_regclass('public.booking_channel_calendar_snapshots') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=missing_prerequisite_relation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20260804120000','20260805120000','20260806170000','20260807120000',
      '20260808041000','20260808051000','20261004123000'
    )
  ) THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=target_history_already_registered';
  END IF;

  IF to_regprocedure('public.channel_manager_live_core_schema_state()') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=initial_schema_probe_missing';
  END IF;

  v_state := public.channel_manager_live_core_schema_state();
  IF COALESCE((v_state->>'ready')::boolean, false) IS NOT TRUE
     OR COALESCE((v_state->>'schemaVersion')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=unexpected_initial_schema_state state=%', v_state;
  END IF;

  SELECT count(*) INTO v_invalid_types
  FROM public.booking_channel_import_runs
  WHERE import_type NOT IN (
    'full','objects','bookings','calendar','pricing','availability',
    'manual_snapshot','initial_sync'
  );
  IF v_invalid_types <> 0 THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=import_type_not_replay_safe count=%', v_invalid_types;
  END IF;

  IF to_regprocedure('public.channel_manager_live_core_rpc_ready(text)') IS NOT NULL
     OR to_regclass('public.booking_channel_reconciliation_runs') IS NOT NULL
     OR to_regclass('public.booking_channel_reconciliation_items') IS NOT NULL
     OR to_regprocedure('public.channel_manager_live_scope_guard_state_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=partial_incremental_or_scope_guard_schema_detected';
  END IF;

  IF to_regprocedure('public.channel_manager_live_core_recovery_expected_fk_edges()') IS NULL
     OR to_regprocedure('public.channel_manager_live_core_booking_ops_fk_children(uuid)') IS NULL
     OR to_regprocedure('public.channel_manager_live_core_synthetic_recovery_cleanup(text,boolean,uuid,text,text,text,jsonb,uuid,uuid,uuid,uuid[])') IS NULL
     OR to_regprocedure('public.channel_manager_live_core_acceptance_ops_cleanup_v2()') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=recovery_baseline_signature_missing';
  END IF;
END
$precheck$;

SELECT
  (SELECT count(*) FROM public.booking_channel_import_runs) AS import_run_rows,
  (SELECT count(*) FROM public.booking_channel_import_runs WHERE import_type = 'initial_sync') AS initial_sync_rows;

SELECT 'CHANNEL_MANAGER_LIVE_CORE_PRECHECK=ready' AS result;
COMMIT;
