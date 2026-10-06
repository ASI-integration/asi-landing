DO $verify$
DECLARE
  v_state jsonb;
  v_scope_state jsonb;
BEGIN
  IF to_regclass('public.booking_channel_reconciliation_runs') IS NULL
     OR to_regclass('public.booking_channel_reconciliation_items') IS NULL THEN
    RAISE EXCEPTION 'Missing reconciliation tables after Live Core rollout.';
  END IF;

  IF to_regprocedure('public.channel_manager_live_core_schema_state()') IS NULL
     OR to_regprocedure('public.channel_manager_live_core_rpc_ready(text)') IS NULL
     OR to_regprocedure('public.channel_manager_live_scope_guard_state_v1()') IS NULL THEN
    RAISE EXCEPTION 'Missing Live Core readiness RPC after rollout.';
  END IF;

  v_state := public.channel_manager_live_core_schema_state();
  IF COALESCE((v_state->>'schemaVersion')::integer, 0) <> 3
     OR COALESCE((v_state->>'ready')::boolean, false) IS NOT TRUE
     OR COALESCE((v_state->>'reconciliationReady')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Live Core schema state not ready: %', v_state;
  END IF;

  v_scope_state := public.channel_manager_live_scope_guard_state_v1();
  IF COALESCE((v_scope_state->>'scopedConnectionWritesReady')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Live Core scope guard not ready: %', v_scope_state;
  END IF;

  IF public.channel_manager_live_core_rpc_ready(
       'public.channel_manager_update_import_run_scoped_v1(uuid,jsonb,uuid,jsonb)'
     ) IS NOT TRUE
     OR public.channel_manager_live_core_rpc_ready(
       'public.channel_manager_commit_incremental_sync_scoped_v1(uuid,jsonb,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)'
     ) IS NOT TRUE
     OR public.channel_manager_live_core_rpc_ready(
       'public.channel_manager_complete_incremental_replay_scoped_v1(uuid,jsonb,uuid,text,text,timestamptz,jsonb)'
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Scoped Live Core RPC privilege/signature verification failed.';
  END IF;

  IF (
    SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE (version, name) IN (
      ('20260804120000', 'channel_manager_live_core_initial_sync_v1'),
      ('20260805120000', 'channel_manager_live_core_synthetic_recovery_v1'),
      ('20260806170000', 'channel_manager_live_incremental_sync_v1'),
      ('20260807120000', 'channel_manager_reconciliation_recovery_v1'),
      ('20260808041000', 'channel_manager_live_core_recovery_fk_expectation_fix_v1'),
      ('20260808051000', 'channel_manager_live_core_acceptance_cleanup_v2'),
      ('20261004123000', 'channel_manager_live_scope_guard_v1')
    )
  ) <> 7 THEN
    RAISE EXCEPTION 'Migration history does not contain all seven Live Core versions.';
  END IF;
END
$verify$;

SELECT public.channel_manager_live_core_schema_state() AS live_core_state;
SELECT public.channel_manager_live_scope_guard_state_v1() AS scope_guard_state;
SELECT 'CHANNEL_MANAGER_LIVE_CORE_SCHEMA_AND_HISTORY=passed' AS result;
