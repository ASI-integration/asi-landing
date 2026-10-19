BEGIN TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  v_state jsonb;
  v_type_check text;
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=read_only_guard_failed';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=missing_migration_history';
  END IF;

  IF to_regclass('public.booking_channel_manager_connections') IS NULL
     OR to_regclass('public.booking_channel_import_runs') IS NULL
     OR to_regclass('public.reservation_reconciliation_items') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=missing_prerequisite_relation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20260804120000','20260805120000','20260806170000','20260807120000',
      '20260808041000','20260808051000','20261004123000'
    )
  ) THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=target_history_already_or_partially_registered';
  END IF;

  IF to_regprocedure('public.channel_manager_live_core_schema_state()') IS NULL
     OR to_regprocedure('public.channel_manager_live_core_recovery_expected_fk_edges()') IS NULL
     OR to_regprocedure('public.channel_manager_live_core_booking_ops_fk_children(uuid)') IS NULL
     OR to_regprocedure('public.channel_manager_live_core_acceptance_ops_cleanup_v2()') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=expected_existing_v1_recovery_layer_missing';
  END IF;

  SELECT public.channel_manager_live_core_schema_state() INTO v_state;
  IF COALESCE((v_state->>'schemaVersion')::int, 0) <> 1
     OR COALESCE((v_state->>'ready')::boolean, false) IS NOT TRUE
     OR COALESCE((v_state->>'initialSyncTypeReady')::boolean, false) IS NOT TRUE
     OR COALESCE((v_state->>'atomicRunningGuardReady')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=unexpected_v1_state payload=%', v_state;
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_type_check
  FROM pg_constraint c
  JOIN pg_class r ON r.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname='public'
    AND r.relname='booking_channel_import_runs'
    AND c.conname='booking_channel_import_runs_type_check';

  IF v_type_check IS NULL
     OR position('initial_sync' in v_type_check) = 0
     OR position('incremental_sync' in v_type_check) > 0
     OR position('reconciliation_recovery' in v_type_check) > 0 THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=unexpected_import_type_contract';
  END IF;

  IF to_regclass('public.booking_channel_import_runs_one_running_initial_sync') IS NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=initial_sync_guard_missing';
  END IF;

  IF EXISTS (SELECT 1 FROM public.booking_channel_import_runs WHERE status='running') THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=running_import_exists';
  END IF;

  IF to_regprocedure('public.channel_manager_commit_incremental_sync_v1(uuid,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)') IS NOT NULL
     OR to_regprocedure('public.channel_manager_complete_incremental_replay_v1(uuid,uuid,text,text,timestamptz,jsonb)') IS NOT NULL
     OR to_regclass('public.booking_channel_reconciliation_runs') IS NOT NULL
     OR to_regclass('public.booking_channel_reconciliation_items') IS NOT NULL
     OR to_regprocedure('public.channel_manager_finalize_reconciliation_recovery_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,jsonb,text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.channel_manager_live_scope_guard_state_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=partial_missing_layer_detected';
  END IF;

  IF NOT has_function_privilege('service_role','public.channel_manager_live_core_schema_state()','EXECUTE')
     OR has_function_privilege('anon','public.channel_manager_live_core_schema_state()','EXECUTE')
     OR has_function_privilege('authenticated','public.channel_manager_live_core_schema_state()','EXECUTE')
     OR NOT has_function_privilege('service_role','public.channel_manager_live_core_acceptance_ops_cleanup_v2()','EXECUTE')
     OR has_function_privilege('anon','public.channel_manager_live_core_acceptance_ops_cleanup_v2()','EXECUTE')
     OR has_function_privilege('authenticated','public.channel_manager_live_core_acceptance_ops_cleanup_v2()','EXECUTE') THEN
    RAISE EXCEPTION 'CHANNEL_MANAGER_CATCHUP_PRECHECK=existing_rpc_privilege_surface_invalid';
  END IF;
END
$precheck$;

SELECT import_type, status, count(*)::bigint AS row_count
FROM public.booking_channel_import_runs
GROUP BY import_type, status
ORDER BY import_type, status;

SELECT 'CHANNEL_MANAGER_CATCHUP_PRECHECK=ready' AS result;
COMMIT;
