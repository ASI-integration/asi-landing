-- Channel Manager Live Incremental Sync v1:
-- incremental_sync import type + atomic live-sync guard (initial + incremental)
-- + schema readiness v2. Cursor storage uses connection.metadata jsonb
-- (canonical mutable metadata). Idempotent. No outbound OTA writes.

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
