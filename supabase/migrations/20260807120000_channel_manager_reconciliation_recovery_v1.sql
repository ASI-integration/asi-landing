-- Channel Manager Reconciliation & Recovery v1:
-- reconciliation_recovery import type + expanded live-sync guard
-- + durable reconciliation run/item tables + finalize RPC
-- + schema readiness v3 fields (without breaking Initial/Incremental ready).
-- Manual normalized snapshot only. No provider API, polling, webhooks, or OTA writes.
-- Idempotent.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Expand import_type CHECK with reconciliation_recovery
-- ---------------------------------------------------------------------------
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
      'incremental_sync',
      'reconciliation_recovery'
    ));

-- ---------------------------------------------------------------------------
-- 2. Expand atomic live-sync guard across all three job kinds
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.booking_channel_import_runs_one_running_live_sync;

CREATE UNIQUE INDEX IF NOT EXISTS booking_channel_import_runs_one_running_live_sync
  ON public.booking_channel_import_runs (connection_id)
  WHERE import_type IN ('initial_sync', 'incremental_sync', 'reconciliation_recovery')
    AND status = 'running';

-- ---------------------------------------------------------------------------
-- 3. Durable reconciliation tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_channel_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL
    REFERENCES public.booking_channel_manager_connections(id) ON DELETE CASCADE,
  provider text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL,
  snapshot_kind text NOT NULL,
  snapshot_hash text NOT NULL,
  report_hash text NOT NULL,
  committed_cursor_hash_at_preview text,
  started_at timestamptz,
  finished_at timestamptz,
  safe_summary text,
  safe_error jsonb NOT NULL DEFAULT '{}'::jsonb,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_reconciliation_runs_mode_check
    CHECK (mode IN ('preview', 'apply')),
  CONSTRAINT booking_channel_reconciliation_runs_status_check
    CHECK (status IN (
      'queued',
      'analyzing',
      'preview_ready',
      'applying',
      'completed',
      'completed_with_blockers',
      'failed'
    )),
  CONSTRAINT booking_channel_reconciliation_runs_snapshot_kind_check
    CHECK (snapshot_kind IN ('complete', 'bounded')),
  CONSTRAINT booking_channel_reconciliation_runs_snapshot_hash_len
    CHECK (char_length(snapshot_hash) >= 16 AND char_length(snapshot_hash) <= 128),
  CONSTRAINT booking_channel_reconciliation_runs_report_hash_len
    CHECK (char_length(report_hash) >= 16 AND char_length(report_hash) <= 128)
);

CREATE TABLE IF NOT EXISTS public.booking_channel_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id uuid NOT NULL
    REFERENCES public.booking_channel_reconciliation_runs(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL
    REFERENCES public.booking_channel_manager_connections(id) ON DELETE CASCADE,
  category text NOT NULL,
  severity text NOT NULL,
  repairability text NOT NULL,
  status text NOT NULL,
  external_identity_hash text,
  imported_booking_id uuid,
  booking_ops_record_id uuid,
  property_id text,
  safe_before jsonb NOT NULL DEFAULT '{}'::jsonb,
  safe_after jsonb NOT NULL DEFAULT '{}'::jsonb,
  deterministic_action_key text NOT NULL,
  safe_message text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_reconciliation_items_severity_check
    CHECK (severity IN ('info', 'warning', 'blocker')),
  CONSTRAINT booking_channel_reconciliation_items_repairability_check
    CHECK (repairability IN ('safe_auto', 'operator_review', 'unsupported')),
  CONSTRAINT booking_channel_reconciliation_items_status_check
    CHECK (status IN ('detected', 'planned', 'applied', 'skipped', 'blocked', 'failed'))
);

-- Indexes: connection + created_at; run + category/status; action key; one active apply
CREATE INDEX IF NOT EXISTS idx_booking_channel_reconciliation_runs_connection_created
  ON public.booking_channel_reconciliation_runs (connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_channel_reconciliation_items_run_category_status
  ON public.booking_channel_reconciliation_items (reconciliation_run_id, category, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_channel_reconciliation_items_action_key
  ON public.booking_channel_reconciliation_items (deterministic_action_key);

CREATE UNIQUE INDEX IF NOT EXISTS booking_channel_reconciliation_one_active_apply
  ON public.booking_channel_reconciliation_runs (connection_id)
  WHERE mode = 'apply'
    AND status IN ('queued', 'analyzing', 'applying');

-- Report uniqueness for preview idempotency (same connection + report hash)
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_channel_reconciliation_runs_report_hash
  ON public.booking_channel_reconciliation_runs (connection_id, report_hash)
  WHERE mode = 'preview';

-- ---------------------------------------------------------------------------
-- 4. RLS / grants — service_role writes only; no direct client access
-- ---------------------------------------------------------------------------
ALTER TABLE public.booking_channel_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_channel_reconciliation_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_channel_reconciliation_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.booking_channel_reconciliation_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.booking_channel_reconciliation_runs TO service_role;
GRANT ALL ON public.booking_channel_reconciliation_items TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Finalization RPC — never touches incrementalCursor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.channel_manager_finalize_reconciliation_recovery_v1(
  p_connection_id uuid,
  p_import_run_id uuid,
  p_reconciliation_run_id uuid,
  p_expected_report_hash text,
  p_finished_at timestamptz,
  p_status text,
  p_counts jsonb,
  p_safe_run_metadata jsonb,
  p_safe_summary text DEFAULT NULL,
  p_safe_error jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.booking_channel_manager_connections%ROWTYPE;
  v_import_run public.booking_channel_import_runs%ROWTYPE;
  v_recon public.booking_channel_reconciliation_runs%ROWTYPE;
  v_meta jsonb;
  v_lease jsonb;
  v_lease_run_id text;
BEGIN
  IF p_connection_id IS NULL
     OR p_import_run_id IS NULL
     OR p_reconciliation_run_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'connection_id, import_run_id and reconciliation_run_id are required'
    );
  END IF;

  IF p_expected_report_hash IS NULL OR length(btrim(p_expected_report_hash)) < 16 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'expected report hash is required'
    );
  END IF;

  IF p_status IS NULL OR p_status NOT IN (
    'completed', 'completed_with_blockers', 'failed'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'status must be completed, completed_with_blockers, or failed'
    );
  END IF;

  SELECT * INTO v_connection
  FROM public.booking_channel_manager_connections
  WHERE id = p_connection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'connection_not_found',
      'message', 'connection not found'
    );
  END IF;

  SELECT * INTO v_import_run
  FROM public.booking_channel_import_runs
  WHERE id = p_import_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'run_not_found',
      'message', 'import run not found'
    );
  END IF;

  IF v_import_run.connection_id IS DISTINCT FROM p_connection_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'run_connection_mismatch',
      'message', 'import run does not belong to connection'
    );
  END IF;

  IF v_import_run.import_type IS DISTINCT FROM 'reconciliation_recovery' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_import_type',
      'message', 'import_type must be reconciliation_recovery'
    );
  END IF;

  IF v_import_run.status IS DISTINCT FROM 'running' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_run_status',
      'message', 'import run status must be running'
    );
  END IF;

  SELECT * INTO v_recon
  FROM public.booking_channel_reconciliation_runs
  WHERE id = p_reconciliation_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'reconciliation_run_not_found',
      'message', 'reconciliation run not found'
    );
  END IF;

  IF v_recon.connection_id IS DISTINCT FROM p_connection_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'run_connection_mismatch',
      'message', 'reconciliation run does not belong to connection'
    );
  END IF;

  IF v_recon.report_hash IS DISTINCT FROM btrim(p_expected_report_hash) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'report_hash_mismatch',
      'message', 'expected report hash does not match reconciliation run'
    );
  END IF;

  -- Persist final reconciliation counters/status (apply mode).
  UPDATE public.booking_channel_reconciliation_runs
  SET
    status = p_status,
    finished_at = p_finished_at,
    counts = COALESCE(p_counts, counts),
    safe_summary = COALESCE(p_safe_summary, safe_summary),
    safe_error = COALESCE(p_safe_error, safe_error),
    metadata = COALESCE(metadata, '{}'::jsonb)
      || COALESCE(p_safe_run_metadata, '{}'::jsonb)
      || jsonb_build_object('finalizedAt', p_finished_at),
    updated_at = p_finished_at
  WHERE id = p_reconciliation_run_id;

  -- Mark import run completed/failed. Never touch incrementalCursor.
  UPDATE public.booking_channel_import_runs
  SET
    status = CASE
      WHEN p_status = 'failed' THEN 'failed'
      WHEN p_status = 'completed_with_blockers' THEN 'completed_with_warnings'
      ELSE 'completed'
    END,
    finished_at = p_finished_at,
    safe_summary = COALESCE(p_safe_summary, safe_summary),
    errors = CASE
      WHEN p_status = 'failed' THEN COALESCE(errors, '[]'::jsonb) || jsonb_build_array(COALESCE(p_safe_error, '{}'::jsonb))
      ELSE errors
    END,
    metadata = COALESCE(metadata, '{}'::jsonb)
      || COALESCE(p_safe_run_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'liveCore', true,
        'liveCoreStage', 'completed',
        'reconciliationRecovery', true,
        'reconciliationRunId', p_reconciliation_run_id::text,
        'reportHashPrefix', substr(p_expected_report_hash, 1, 16)
      ),
    updated_at = p_finished_at
  WHERE id = p_import_run_id;

  -- Release only the matching liveSyncLease; preserve incrementalCursor unchanged.
  v_meta := COALESCE(v_connection.metadata, '{}'::jsonb);
  v_lease := v_meta->'liveSyncLease';
  v_lease_run_id := NULLIF(btrim(COALESCE(v_lease->>'runId', '')), '');

  IF v_lease_run_id IS NOT NULL AND v_lease_run_id = p_import_run_id::text THEN
    v_meta := jsonb_set(
      v_meta,
      '{liveSyncLease}',
      jsonb_build_object(
        'runId', p_import_run_id::text,
        'status', 'released',
        'releasedAt', p_finished_at,
        'importType', 'reconciliation_recovery'
      ),
      true
    );
  END IF;

  UPDATE public.booking_channel_manager_connections
  SET
    metadata = v_meta,
    updated_at = p_finished_at
  WHERE id = p_connection_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', p_status,
    'reconciliationRunId', p_reconciliation_run_id::text,
    'importRunId', p_import_run_id::text,
    'cursorUnchanged', true,
    'leaseReleased', (v_lease_run_id IS NOT NULL AND v_lease_run_id = p_import_run_id::text),
    'finishedAt', p_finished_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_finalize_reconciliation_recovery_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, jsonb, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.channel_manager_finalize_reconciliation_recovery_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, jsonb, text, jsonb
) TO service_role;

-- ---------------------------------------------------------------------------
-- 5b. Fail-closed compensation RPC — exact run only; never touches incrementalCursor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.channel_manager_fail_reconciliation_recovery_v1(
  p_connection_id uuid,
  p_import_run_id uuid,
  p_reconciliation_run_id uuid,
  p_expected_report_hash text,
  p_finished_at timestamptz,
  p_safe_summary text DEFAULT NULL,
  p_safe_error jsonb DEFAULT '{}'::jsonb,
  p_safe_run_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.booking_channel_manager_connections%ROWTYPE;
  v_import_run public.booking_channel_import_runs%ROWTYPE;
  v_recon public.booking_channel_reconciliation_runs%ROWTYPE;
  v_meta jsonb;
  v_lease jsonb;
  v_lease_run_id text;
  v_lease_released boolean := false;
BEGIN
  IF p_connection_id IS NULL
     OR p_import_run_id IS NULL
     OR p_reconciliation_run_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'connection_id, import_run_id and reconciliation_run_id are required'
    );
  END IF;

  IF p_expected_report_hash IS NULL OR length(btrim(p_expected_report_hash)) < 16 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'expected report hash is required'
    );
  END IF;

  SELECT * INTO v_connection
  FROM public.booking_channel_manager_connections
  WHERE id = p_connection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'connection_not_found',
      'message', 'connection not found'
    );
  END IF;

  SELECT * INTO v_import_run
  FROM public.booking_channel_import_runs
  WHERE id = p_import_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'run_not_found',
      'message', 'import run not found'
    );
  END IF;

  IF v_import_run.connection_id IS DISTINCT FROM p_connection_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'run_connection_mismatch',
      'message', 'import run does not belong to connection'
    );
  END IF;

  IF v_import_run.import_type IS DISTINCT FROM 'reconciliation_recovery' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_import_type',
      'message', 'import_type must be reconciliation_recovery'
    );
  END IF;

  SELECT * INTO v_recon
  FROM public.booking_channel_reconciliation_runs
  WHERE id = p_reconciliation_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'reconciliation_run_not_found',
      'message', 'reconciliation run not found'
    );
  END IF;

  IF v_recon.connection_id IS DISTINCT FROM p_connection_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'run_connection_mismatch',
      'message', 'reconciliation run does not belong to connection'
    );
  END IF;

  IF v_recon.report_hash IS DISTINCT FROM btrim(p_expected_report_hash) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'report_hash_mismatch',
      'message', 'expected report hash does not match reconciliation run'
    );
  END IF;

  -- Mark reconciliation run failed (compensation path).
  UPDATE public.booking_channel_reconciliation_runs
  SET
    status = 'failed',
    finished_at = COALESCE(p_finished_at, now()),
    safe_summary = COALESCE(p_safe_summary, safe_summary, 'Reconciliation recovery failed closed.'),
    safe_error = COALESCE(p_safe_error, safe_error),
    metadata = COALESCE(metadata, '{}'::jsonb)
      || COALESCE(p_safe_run_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'failCompensation', true,
        'failCompensatedAt', COALESCE(p_finished_at, now())
      ),
    updated_at = COALESCE(p_finished_at, now())
  WHERE id = p_reconciliation_run_id;

  -- Mark import run failed when still running (or reinforce failed). Never touch incrementalCursor.
  UPDATE public.booking_channel_import_runs
  SET
    status = 'failed',
    finished_at = COALESCE(finished_at, p_finished_at, now()),
    safe_summary = COALESCE(p_safe_summary, safe_summary, 'Reconciliation recovery failed closed.'),
    errors = COALESCE(errors, '[]'::jsonb) || jsonb_build_array(COALESCE(p_safe_error, '{}'::jsonb)),
    metadata = COALESCE(metadata, '{}'::jsonb)
      || COALESCE(p_safe_run_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'liveCore', true,
        'liveCoreStage', 'failed',
        'reconciliationRecovery', true,
        'failCompensation', true,
        'reconciliationRunId', p_reconciliation_run_id::text,
        'reportHashPrefix', substr(p_expected_report_hash, 1, 16)
      ),
    updated_at = COALESCE(p_finished_at, now())
  WHERE id = p_import_run_id;

  -- Release only the matching liveSyncLease; preserve incrementalCursor unchanged.
  v_meta := COALESCE(v_connection.metadata, '{}'::jsonb);
  v_lease := v_meta->'liveSyncLease';
  v_lease_run_id := NULLIF(btrim(COALESCE(v_lease->>'runId', '')), '');

  IF v_lease_run_id IS NOT NULL AND v_lease_run_id = p_import_run_id::text THEN
    v_meta := jsonb_set(
      v_meta,
      '{liveSyncLease}',
      jsonb_build_object(
        'runId', p_import_run_id::text,
        'status', 'released',
        'releasedAt', COALESCE(p_finished_at, now()),
        'importType', 'reconciliation_recovery',
        'failCompensation', true
      ),
      true
    );
    v_lease_released := true;
  END IF;

  UPDATE public.booking_channel_manager_connections
  SET
    metadata = v_meta,
    updated_at = COALESCE(p_finished_at, now())
  WHERE id = p_connection_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'failed',
    'reconciliationRunId', p_reconciliation_run_id::text,
    'importRunId', p_import_run_id::text,
    'cursorUnchanged', true,
    'leaseReleased', v_lease_released,
    'finishedAt', COALESCE(p_finished_at, now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_fail_reconciliation_recovery_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.channel_manager_fail_reconciliation_recovery_v1(
  uuid, uuid, uuid, text, timestamptz, text, jsonb, jsonb
) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Schema readiness v3 — Incremental ready stays independent of reconciliation
-- ---------------------------------------------------------------------------
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
  v_recon_runs_oid oid;
  v_recon_items_oid oid;
  v_check_def text;
  v_initial_type_ready boolean := false;
  v_incremental_type_ready boolean := false;
  v_reconciliation_type_ready boolean := false;
  v_guard_ready boolean := false;
  v_reconciliation_guard_ready boolean := false;
  v_cursor_ready boolean := false;
  v_atomic_commit_ready boolean := false;
  v_replay_finalize_ready boolean := false;
  v_reconciliation_tables_ready boolean := false;
  v_reconciliation_finalize_ready boolean := false;
  v_incremental_ready boolean := false;
  v_reconciliation_ready boolean := false;
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

  SELECT c.oid
  INTO v_recon_runs_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'booking_channel_reconciliation_runs'
    AND c.relkind = 'r';

  SELECT c.oid
  INTO v_recon_items_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'booking_channel_reconciliation_items'
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

    v_reconciliation_type_ready :=
      v_check_def IS NOT NULL
      AND position('reconciliation_recovery' IN v_check_def) > 0;
  END IF;

  SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid), i.indrelid
  INTO v_indisunique, v_indpred, v_indrelid
  FROM pg_class idx
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_index i ON i.indexrelid = idx.oid
  WHERE n.nspname = 'public'
    AND idx.relname = 'booking_channel_import_runs_one_running_live_sync'
    AND idx.relkind = 'i';

  -- Incremental/Initial ready: guard must cover initial + incremental (reconciliation optional).
  v_guard_ready :=
    v_table_oid IS NOT NULL
    AND v_indrelid IS NOT DISTINCT FROM v_table_oid
    AND v_indisunique IS TRUE
    AND v_indpred IS NOT NULL
    AND v_indpred ~* 'initial_sync'
    AND v_indpred ~* 'incremental_sync'
    AND v_indpred ~* 'status[[:space:]]*=[[:space:]]*[''"]?running[''"]?';

  v_reconciliation_guard_ready :=
    v_guard_ready
    AND v_indpred ~* 'reconciliation_recovery';

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

  v_atomic_commit_ready := public.channel_manager_live_core_rpc_ready(
    'public.channel_manager_commit_incremental_sync_v1(uuid,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)'
  );
  v_replay_finalize_ready := public.channel_manager_live_core_rpc_ready(
    'public.channel_manager_complete_incremental_replay_v1(uuid,uuid,text,text,timestamptz,jsonb)'
  );
  v_reconciliation_finalize_ready := public.channel_manager_live_core_rpc_ready(
    'public.channel_manager_finalize_reconciliation_recovery_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,jsonb,text,jsonb)'
  )
  AND public.channel_manager_live_core_rpc_ready(
    'public.channel_manager_fail_reconciliation_recovery_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,jsonb)'
  );

  v_reconciliation_tables_ready :=
    v_recon_runs_oid IS NOT NULL
    AND v_recon_items_oid IS NOT NULL;

  v_incremental_ready :=
    v_initial_type_ready
    AND v_incremental_type_ready
    AND v_guard_ready
    AND v_cursor_ready
    AND v_atomic_commit_ready
    AND v_replay_finalize_ready;

  v_reconciliation_ready :=
    v_incremental_ready
    AND v_reconciliation_type_ready
    AND v_reconciliation_tables_ready
    AND v_reconciliation_guard_ready
    AND v_reconciliation_finalize_ready;

  RETURN jsonb_build_object(
    'schemaVersion', 3,
    'initialSyncTypeReady', v_initial_type_ready,
    'incrementalSyncTypeReady', v_incremental_type_ready,
    'atomicRunningGuardReady', v_guard_ready,
    'atomicLiveSyncGuardReady', v_guard_ready,
    'cursorStorageReady', v_cursor_ready,
    'atomicCommitRpcReady', v_atomic_commit_ready,
    'replayFinalizeRpcReady', v_replay_finalize_ready,
    -- Existing Incremental/Initial ready must NOT require reconciliation migration.
    'ready', v_incremental_ready,
    'reconciliationTypeReady', v_reconciliation_type_ready,
    'reconciliationTablesReady', v_reconciliation_tables_ready,
    'reconciliationGuardReady', v_reconciliation_guard_ready,
    'reconciliationFinalizeRpcReady', v_reconciliation_finalize_ready,
    'reconciliationReady', v_reconciliation_ready
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_core_schema_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_core_schema_state() TO service_role;
