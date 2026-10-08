DO $verify$
DECLARE
  v_state jsonb;
  v_scope jsonb;
  v_edges jsonb;
BEGIN
  SELECT public.channel_manager_live_core_schema_state() INTO v_state;
  IF COALESCE((v_state->>'schemaVersion')::int, 0) < 3
     OR COALESCE((v_state->>'ready')::boolean, false) IS NOT TRUE
     OR COALESCE((v_state->>'reconciliationReady')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Channel Manager Live Core v3 readiness failed: %', v_state;
  END IF;

  SELECT public.channel_manager_live_scope_guard_state_v1() INTO v_scope;
  IF COALESCE((v_scope->>'scopedConnectionWritesReady')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Channel Manager scoped live-write readiness failed: %', v_scope;
  END IF;

  IF to_regclass('public.booking_channel_reconciliation_runs') IS NULL
     OR to_regclass('public.booking_channel_reconciliation_items') IS NULL THEN
    RAISE EXCEPTION 'Reconciliation tables are missing.';
  END IF;

  IF to_regprocedure('public.channel_manager_commit_incremental_sync_v1(uuid,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)') IS NULL
     OR to_regprocedure('public.channel_manager_complete_incremental_replay_v1(uuid,uuid,text,text,timestamptz,jsonb)') IS NULL
     OR to_regprocedure('public.channel_manager_finalize_reconciliation_recovery_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('public.channel_manager_fail_reconciliation_recovery_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.channel_manager_live_scope_guard_state_v1()') IS NULL THEN
    RAISE EXCEPTION 'Required Channel Manager RPC is missing.';
  END IF;

  IF NOT has_function_privilege('service_role','public.channel_manager_live_scope_guard_state_v1()','EXECUTE')
     OR has_function_privilege('anon','public.channel_manager_live_scope_guard_state_v1()','EXECUTE')
     OR has_function_privilege('authenticated','public.channel_manager_live_scope_guard_state_v1()','EXECUTE') THEN
    RAISE EXCEPTION 'Scope guard privilege surface is invalid.';
  END IF;

  v_edges := public.channel_manager_live_core_recovery_expected_fk_edges();
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_edges) edge
    WHERE edge->>'table_name' IN ('booking_lifecycle_gates','booking_lifecycle_exceptions')
  ) THEN
    RAISE EXCEPTION 'Recovery FK expectation fix was not applied.';
  END IF;

  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations
    WHERE (version,name) IN (
      ('20260804120000','channel_manager_live_core_initial_sync_v1'),
      ('20260805120000','channel_manager_live_core_synthetic_recovery_v1'),
      ('20260806170000','channel_manager_live_incremental_sync_v1'),
      ('20260807120000','channel_manager_reconciliation_recovery_v1'),
      ('20260808041000','channel_manager_live_core_recovery_fk_expectation_fix_v1'),
      ('20260808051000','channel_manager_live_core_acceptance_cleanup_v2'),
      ('20261004123000','channel_manager_live_scope_guard_v1')
    )
  ) <> 7 THEN
    RAISE EXCEPTION 'Channel Manager migration history is incomplete.';
  END IF;
END
$verify$;

SELECT public.channel_manager_live_core_schema_state() AS live_core_state;
SELECT public.channel_manager_live_scope_guard_state_v1() AS scope_guard_state;
SELECT 'CHANNEL_MANAGER_CATCHUP_SCHEMA_AND_HISTORY_VERIFICATION=passed' AS result;
