-- Channel Manager Live Core v1: initial_sync import type + atomic running-run guard.
-- Idempotent. Does not apply outbound publishing or real provider credentials.
-- Counters / cursors / diagnostic lease live in metadata jsonb.

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
      'initial_sync'
    ));

-- At most one running initial_sync per connection (atomic execution guard).
CREATE UNIQUE INDEX IF NOT EXISTS booking_channel_import_runs_one_running_initial_sync
  ON public.booking_channel_import_runs (connection_id)
  WHERE import_type = 'initial_sync' AND status = 'running';

-- Read-only schema readiness probe for Dashboard/API (no write side effects).
CREATE OR REPLACE FUNCTION public.channel_manager_live_core_schema_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_oid oid;
  v_check_def text;
  v_type_ready boolean := false;
  v_guard_ready boolean := false;
  v_indisunique boolean;
  v_indpred text;
  v_indrelid oid;
BEGIN
  SELECT c.oid
  INTO v_table_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'booking_channel_import_runs'
    AND c.relkind = 'r';

  IF v_table_oid IS NOT NULL THEN
    SELECT pg_get_constraintdef(con.oid)
    INTO v_check_def
    FROM pg_constraint con
    WHERE con.conrelid = v_table_oid
      AND con.conname = 'booking_channel_import_runs_type_check'
      AND con.contype = 'c';

    v_type_ready :=
      v_check_def IS NOT NULL
      AND position('initial_sync' IN v_check_def) > 0;
  END IF;

  SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid), i.indrelid
  INTO v_indisunique, v_indpred, v_indrelid
  FROM pg_class idx
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_index i ON i.indexrelid = idx.oid
  WHERE n.nspname = 'public'
    AND idx.relname = 'booking_channel_import_runs_one_running_initial_sync'
    AND idx.relkind = 'i';

  v_guard_ready :=
    v_table_oid IS NOT NULL
    AND v_indrelid IS NOT DISTINCT FROM v_table_oid
    AND v_indisunique IS TRUE
    AND v_indpred IS NOT NULL
    AND v_indpred ~* 'import_type[[:space:]]*=[[:space:]]*[''"]?initial_sync[''"]?'
    AND v_indpred ~* 'status[[:space:]]*=[[:space:]]*[''"]?running[''"]?';

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'initialSyncTypeReady', v_type_ready,
    'atomicRunningGuardReady', v_guard_ready,
    'ready', (v_type_ready AND v_guard_ready)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_core_schema_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_core_schema_state() TO service_role;
