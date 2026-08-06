-- Channel Manager Live Incremental Sync v1:
-- incremental_sync import type + atomic live-sync guard (initial + incremental)
-- + schema readiness v2 + atomic cursor commit RPC. Cursor storage uses
-- connection.metadata jsonb (canonical mutable metadata). Idempotent.
-- No outbound OTA writes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.booking_channel_import_runs
  DROP CONSTRAINT IF EXISTS booking_channel_import_runs_type_check;

ALTER TABLE public.booking_channel_import_runs
  ADD CONSTRAINT booking_channel_import_runs_type_check
    CHECK (import_type IN (
      'full',
      'objects',
      'bookings',
      'calendar',
      'pricing',
      'availability',
      'manual_snapshot',
      'initial_sync',
      'incremental_sync'
    ));

-- Replace initial-sync-only running guard with one live-sync guard per connection.
DROP INDEX IF EXISTS public.booking_channel_import_runs_one_running_initial_sync;

CREATE UNIQUE INDEX IF NOT EXISTS booking_channel_import_runs_one_running_live_sync
  ON public.booking_channel_import_runs (connection_id)
  WHERE import_type IN ('initial_sync', 'incremental_sync')
    AND status = 'running';

-- Read-only schema readiness probe (v2). service_role only.
CREATE OR REPLACE FUNCTION public.channel_manager_live_core_schema_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_oid oid;
  v_conn_oid oid;
  v_check_def text;
  v_initial_type_ready boolean := false;
  v_incremental_type_ready boolean := false;
  v_guard_ready boolean := false;
  v_cursor_ready boolean := false;
  v_indisunique boolean;
  v_indpred text;
  v_indrelid oid;
  v_metadata_attnum smallint;
BEGIN
  SELECT c.oid
  INTO v_table_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'booking_channel_import_runs'
    AND c.relkind = 'r';

  SELECT c.oid
  INTO v_conn_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'booking_channel_manager_connections'
    AND c.relkind = 'r';

  IF v_table_oid IS NOT NULL THEN
    SELECT pg_get_constraintdef(con.oid)
    INTO v_check_def
    FROM pg_constraint con
    WHERE con.conrelid = v_table_oid
      AND con.conname = 'booking_channel_import_runs_type_check'
      AND con.contype = 'c';

    v_initial_type_ready :=
      v_check_def IS NOT NULL
      AND position('initial_sync' IN v_check_def) > 0;

    v_incremental_type_ready :=
      v_check_def IS NOT NULL
      AND position('incremental_sync' IN v_check_def) > 0;
  END IF;

  SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid), i.indrelid
  INTO v_indisunique, v_indpred, v_indrelid
  FROM pg_class idx
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_index i ON i.indexrelid = idx.oid
  WHERE n.nspname = 'public'
    AND idx.relname = 'booking_channel_import_runs_one_running_live_sync'
    AND idx.relkind = 'i';

  v_guard_ready :=
    v_table_oid IS NOT NULL
    AND v_indrelid IS NOT DISTINCT FROM v_table_oid
    AND v_indisunique IS TRUE
    AND v_indpred IS NOT NULL
    AND v_indpred ~* 'initial_sync'
    AND v_indpred ~* 'incremental_sync'
    AND v_indpred ~* 'status[[:space:]]*=[[:space:]]*[''"]?running[''"]?';

  IF v_conn_oid IS NOT NULL THEN
    SELECT a.attnum
    INTO v_metadata_attnum
    FROM pg_attribute a
    WHERE a.attrelid = v_conn_oid
      AND a.attname = 'metadata'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.atttypid = 'jsonb'::regtype;

    v_cursor_ready := v_metadata_attnum IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 2,
    'initialSyncTypeReady', v_initial_type_ready,
    'incrementalSyncTypeReady', v_incremental_type_ready,
    'atomicRunningGuardReady', v_guard_ready,
    'atomicLiveSyncGuardReady', v_guard_ready,
    'cursorStorageReady', v_cursor_ready,
    'ready', (
      v_initial_type_ready
      AND v_incremental_type_ready
      AND v_guard_ready
      AND v_cursor_ready
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_core_schema_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_core_schema_state() TO service_role;

-- Atomic cursor + run completion commit. service_role only.
CREATE OR REPLACE FUNCTION public.channel_manager_commit_incremental_sync_v1(
  p_connection_id uuid,
  p_run_id uuid,
  p_expected_previous_checkpoint text,
  p_expected_previous_batch_hash text,
  p_new_checkpoint text,
  p_new_batch_hash text,
  p_finished_at timestamptz,
  p_status text,
  p_counters jsonb,
  p_safe_run_metadata jsonb,
  p_warnings jsonb DEFAULT '[]'::jsonb,
  p_safe_summary text DEFAULT NULL,
  p_bookings integer DEFAULT 0,
  p_calendar_days integer DEFAULT 0,
  p_prices integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.booking_channel_manager_connections%ROWTYPE;
  v_run public.booking_channel_import_runs%ROWTYPE;
  v_meta jsonb;
  v_cursor jsonb;
  v_prev_checkpoint text;
  v_prev_batch_hash text;
  v_new_cursor jsonb;
  v_checkpoint_hash text;
  v_batch_hash_prefix text;
BEGIN
  IF p_connection_id IS NULL OR p_run_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_arguments', 'message', 'connection_id and run_id are required');
  END IF;

  IF p_new_checkpoint IS NULL OR length(btrim(p_new_checkpoint)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_arguments', 'message', 'new checkpoint is required');
  END IF;

  IF p_new_batch_hash IS NULL OR length(btrim(p_new_batch_hash)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_arguments', 'message', 'new batch hash is required');
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('completed', 'completed_with_warnings') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_arguments', 'message', 'status must be completed or completed_with_warnings');
  END IF;

  SELECT * INTO v_connection
  FROM public.booking_channel_manager_connections
  WHERE id = p_connection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'connection_not_found', 'message', 'connection not found');
  END IF;

  SELECT * INTO v_run
  FROM public.booking_channel_import_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'run_not_found', 'message', 'import run not found');
  END IF;

  IF v_run.connection_id IS DISTINCT FROM p_connection_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'run_connection_mismatch', 'message', 'run does not belong to connection');
  END IF;

  IF v_run.import_type IS DISTINCT FROM 'incremental_sync' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_import_type', 'message', 'run import_type must be incremental_sync');
  END IF;

  IF v_run.status IS DISTINCT FROM 'running' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_run_status', 'message', 'run status must be running');
  END IF;

  v_meta := COALESCE(v_connection.metadata, '{}'::jsonb);
  v_cursor := v_meta->'incrementalCursor';
  IF v_cursor IS NULL OR jsonb_typeof(v_cursor) <> 'object' THEN
    v_prev_checkpoint := NULL;
    v_prev_batch_hash := NULL;
  ELSE
    v_prev_checkpoint := NULLIF(btrim(COALESCE(v_cursor->>'checkpoint', '')), '');
    v_prev_batch_hash := NULLIF(btrim(COALESCE(v_cursor->>'batchHash', v_cursor->>'batch_hash', '')), '');
  END IF;

  IF COALESCE(v_prev_checkpoint, '') IS DISTINCT FROM COALESCE(NULLIF(btrim(COALESCE(p_expected_previous_checkpoint, '')), ''), '') THEN
    RETURN jsonb_build_object('success', false, 'code', 'stale_expected_cursor', 'message', 'expected previous checkpoint does not match committed cursor');
  END IF;

  IF COALESCE(v_prev_batch_hash, '') IS DISTINCT FROM COALESCE(NULLIF(btrim(COALESCE(p_expected_previous_batch_hash, '')), ''), '') THEN
    RETURN jsonb_build_object('success', false, 'code', 'stale_expected_cursor', 'message', 'expected previous batch hash does not match committed cursor');
  END IF;

  v_checkpoint_hash := substr(encode(digest(p_new_checkpoint, 'sha256'), 'hex'), 1, 16);
  v_batch_hash_prefix := substr(p_new_batch_hash, 1, 16);

  v_new_cursor := jsonb_build_object(
    'stream', 'incremental',
    'checkpoint', p_new_checkpoint,
    'batchHash', p_new_batch_hash,
    'updatedAt', p_finished_at,
    'sourceRunId', p_run_id::text
  );

  v_meta := v_meta
    || jsonb_build_object(
      'liveCore', true,
      'lastSuccessfulIncrementalSyncAt', p_finished_at,
      'incrementalCursor', v_new_cursor,
      'lastLiveCoreCounters', COALESCE(p_counters, '{}'::jsonb),
      'liveSyncLease', jsonb_build_object(
        'runId', p_run_id::text,
        'status', 'released',
        'releasedAt', p_finished_at,
        'importType', 'incremental_sync'
      )
    );

  UPDATE public.booking_channel_manager_connections
  SET
    status = CASE WHEN status = 'blocked' THEN status ELSE 'import_ready' END,
    last_success_at = p_finished_at,
    failure_reason = NULL,
    metadata = v_meta,
    updated_at = p_finished_at
  WHERE id = p_connection_id;

  UPDATE public.booking_channel_import_runs
  SET
    status = p_status,
    finished_at = p_finished_at,
    imported_bookings_count = COALESCE(p_bookings, imported_bookings_count),
    imported_calendar_days_count = COALESCE(p_calendar_days, imported_calendar_days_count),
    imported_prices_count = COALESCE(p_prices, imported_prices_count),
    warnings = COALESCE(p_warnings, warnings),
    safe_summary = COALESCE(p_safe_summary, safe_summary),
    metadata = COALESCE(metadata, '{}'::jsonb)
      || COALESCE(p_safe_run_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'liveCore', true,
        'liveCoreStage', 'completed',
        'liveCoreCounters', COALESCE(p_counters, '{}'::jsonb)
      ),
    updated_at = p_finished_at
  WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'checkpointHash', v_checkpoint_hash,
    'batchHashPrefix', v_batch_hash_prefix,
    'sourceRunId', p_run_id::text,
    'updatedAt', p_finished_at,
    'status', p_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_commit_incremental_sync_v1(
  uuid, uuid, text, text, text, text, timestamptz, text, jsonb, jsonb, jsonb, text, integer, integer, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.channel_manager_commit_incremental_sync_v1(
  uuid, uuid, text, text, text, text, timestamptz, text, jsonb, jsonb, jsonb, text, integer, integer, integer
) TO service_role;
