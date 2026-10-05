-- Channel Manager Live Core canonical connection-scope guard v1.
-- Adds atomic wrappers around mutable Live Core connection and import-run writes.
-- Prepared only; this migration is not applied by the Wave 5 implementation pass.

CREATE OR REPLACE FUNCTION public.channel_manager_assert_connection_scope_locked_v1(
  p_connection_id uuid,
  p_expected_scope jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.booking_channel_manager_connections%ROWTYPE;
  v_property public.booking_property_setup_profiles%ROWTYPE;
  v_expected_owner text;
  v_expected_property_setup text;
  v_expected_property text;
  v_expected_account text;
BEGIN
  IF p_connection_id IS NULL
     OR p_expected_scope IS NULL
     OR jsonb_typeof(p_expected_scope) <> 'object' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'connection_scope_invalid',
      'message', 'connection_id and expected_scope are required'
    );
  END IF;

  v_expected_owner := NULLIF(btrim(COALESCE(p_expected_scope->>'ownerSetupId', '')), '');
  v_expected_property_setup := NULLIF(btrim(COALESCE(p_expected_scope->>'propertySetupId', '')), '');
  v_expected_property := NULLIF(btrim(COALESCE(p_expected_scope->>'propertyId', '')), '');
  v_expected_account := NULLIF(btrim(COALESCE(p_expected_scope->>'accountId', '')), '');

  IF v_expected_owner IS NULL OR v_expected_property_setup IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'connection_scope_invalid',
      'message', 'ownerSetupId and propertySetupId are required'
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

  IF v_connection.owner_setup_id::text IS DISTINCT FROM v_expected_owner
     OR v_connection.property_setup_id::text IS DISTINCT FROM v_expected_property_setup
     OR NULLIF(btrim(COALESCE(v_connection.metadata->>'accountId', '')), '') IS DISTINCT FROM v_expected_account THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'account_scope_mismatch',
      'message', 'connection owner/property/account scope changed'
    );
  END IF;

  SELECT * INTO v_property
  FROM public.booking_property_setup_profiles
  WHERE id = v_connection.property_setup_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'connection_scope_invalid',
      'message', 'property setup not found'
    );
  END IF;

  IF v_property.owner_setup_id::text IS DISTINCT FROM v_expected_owner
     OR NULLIF(btrim(COALESCE(v_property.property_id::text, '')), '') IS DISTINCT FROM v_expected_property THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'account_scope_mismatch',
      'message', 'canonical property scope changed'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_assert_connection_scope_locked_v1(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_assert_connection_scope_locked_v1(uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.channel_manager_set_live_sync_lease_scoped_v1(
  p_connection_id uuid,
  p_expected_scope jsonb,
  p_lease jsonb,
  p_updated_at timestamptz,
  p_last_import_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope jsonb;
BEGIN
  v_scope := public.channel_manager_assert_connection_scope_locked_v1(
    p_connection_id,
    p_expected_scope
  );
  IF COALESCE((v_scope->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_scope;
  END IF;

  RETURN public.channel_manager_set_live_sync_lease_v1(
    p_connection_id,
    p_lease,
    p_updated_at,
    p_last_import_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_set_live_sync_lease_scoped_v1(
  uuid, jsonb, jsonb, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_set_live_sync_lease_scoped_v1(
  uuid, jsonb, jsonb, timestamptz, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.channel_manager_update_live_connection_scoped_v1(
  p_connection_id uuid,
  p_expected_scope jsonb,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope jsonb;
  v_connection public.booking_channel_manager_connections%ROWTYPE;
  v_unknown jsonb;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'patch must be a JSON object'
    );
  END IF;

  v_unknown := p_patch - ARRAY[
    'status',
    'last_success_at',
    'last_failure_at',
    'failure_reason',
    'last_import_at',
    'metadata',
    'updated_at'
  ]::text[];

  IF v_unknown <> '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'patch contains unsupported fields'
    );
  END IF;

  v_scope := public.channel_manager_assert_connection_scope_locked_v1(
    p_connection_id,
    p_expected_scope
  );
  IF COALESCE((v_scope->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_scope;
  END IF;

  UPDATE public.booking_channel_manager_connections
  SET
    status = CASE
      WHEN p_patch ? 'status' THEN p_patch->>'status'
      ELSE status
    END,
    last_success_at = CASE
      WHEN p_patch ? 'last_success_at'
        THEN NULLIF(p_patch->>'last_success_at', '')::timestamptz
      ELSE last_success_at
    END,
    last_failure_at = CASE
      WHEN p_patch ? 'last_failure_at'
        THEN NULLIF(p_patch->>'last_failure_at', '')::timestamptz
      ELSE last_failure_at
    END,
    failure_reason = CASE
      WHEN p_patch ? 'failure_reason' THEN p_patch->>'failure_reason'
      ELSE failure_reason
    END,
    last_import_at = CASE
      WHEN p_patch ? 'last_import_at'
        THEN NULLIF(p_patch->>'last_import_at', '')::timestamptz
      ELSE last_import_at
    END,
    metadata = CASE
      WHEN p_patch ? 'metadata' THEN COALESCE(p_patch->'metadata', '{}'::jsonb)
      ELSE metadata
    END,
    updated_at = CASE
      WHEN p_patch ? 'updated_at'
        THEN COALESCE(NULLIF(p_patch->>'updated_at', '')::timestamptz, updated_at)
      ELSE updated_at
    END
  WHERE id = p_connection_id
  RETURNING * INTO v_connection;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'connection_not_found',
      'message', 'connection not found'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'connection', to_jsonb(v_connection)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_update_live_connection_scoped_v1(
  uuid, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_update_live_connection_scoped_v1(
  uuid, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.channel_manager_commit_incremental_sync_scoped_v1(
  p_connection_id uuid,
  p_expected_scope jsonb,
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
  v_scope jsonb;
BEGIN
  v_scope := public.channel_manager_assert_connection_scope_locked_v1(
    p_connection_id,
    p_expected_scope
  );
  IF COALESCE((v_scope->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_scope;
  END IF;

  RETURN public.channel_manager_commit_incremental_sync_v1(
    p_connection_id,
    p_run_id,
    p_expected_previous_checkpoint,
    p_expected_previous_batch_hash,
    p_new_checkpoint,
    p_new_batch_hash,
    p_finished_at,
    p_status,
    p_counters,
    p_safe_run_metadata,
    p_warnings,
    p_safe_summary,
    p_bookings,
    p_calendar_days,
    p_prices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_commit_incremental_sync_scoped_v1(
  uuid, jsonb, uuid, text, text, text, text, timestamptz, text, jsonb, jsonb, jsonb, text, integer, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_commit_incremental_sync_scoped_v1(
  uuid, jsonb, uuid, text, text, text, text, timestamptz, text, jsonb, jsonb, jsonb, text, integer, integer, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.channel_manager_complete_incremental_replay_scoped_v1(
  p_connection_id uuid,
  p_expected_scope jsonb,
  p_run_id uuid,
  p_expected_checkpoint text,
  p_expected_batch_hash text,
  p_finished_at timestamptz,
  p_safe_run_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope jsonb;
BEGIN
  v_scope := public.channel_manager_assert_connection_scope_locked_v1(
    p_connection_id,
    p_expected_scope
  );
  IF COALESCE((v_scope->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_scope;
  END IF;

  RETURN public.channel_manager_complete_incremental_replay_v1(
    p_connection_id,
    p_run_id,
    p_expected_checkpoint,
    p_expected_batch_hash,
    p_finished_at,
    p_safe_run_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_complete_incremental_replay_scoped_v1(
  uuid, jsonb, uuid, text, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_complete_incremental_replay_scoped_v1(
  uuid, jsonb, uuid, text, text, timestamptz, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.channel_manager_live_scope_guard_state_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'scopedConnectionWritesReady',
      public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_assert_connection_scope_locked_v1(uuid,jsonb)'
      )
      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_set_live_sync_lease_scoped_v1(uuid,jsonb,jsonb,timestamptz,timestamptz)'
      )
      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_update_live_connection_scoped_v1(uuid,jsonb,jsonb)'
      )
      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_commit_incremental_sync_scoped_v1(uuid,jsonb,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)'
      )
      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_complete_incremental_replay_scoped_v1(uuid,jsonb,uuid,text,text,timestamptz,jsonb)'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_scope_guard_state_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_scope_guard_state_v1()
  TO service_role;


CREATE OR REPLACE FUNCTION public.channel_manager_acquire_live_sync_guard_scoped_v1(
  p_connection_id uuid,
  p_expected_scope jsonb,
  p_run_id uuid,
  p_provider text,
  p_import_type text,
  p_started_at timestamptz,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope jsonb;
  v_run public.booking_channel_import_runs%ROWTYPE;
BEGIN
  IF p_run_id IS NULL
     OR NULLIF(btrim(COALESCE(p_provider, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_import_type, '')), '') IS NULL
     OR p_started_at IS NULL
     OR p_metadata IS NULL
     OR jsonb_typeof(p_metadata) <> 'object' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'run identity, provider, import type, started_at, and metadata are required'
    );
  END IF;

  v_scope := public.channel_manager_assert_connection_scope_locked_v1(
    p_connection_id,
    p_expected_scope
  );
  IF COALESCE((v_scope->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_scope;
  END IF;

  BEGIN
    INSERT INTO public.booking_channel_import_runs (
      id,
      connection_id,
      provider,
      status,
      import_type,
      started_at,
      warnings,
      errors,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      p_run_id,
      p_connection_id,
      p_provider,
      'running',
      p_import_type,
      p_started_at,
      '[]'::jsonb,
      '[]'::jsonb,
      p_metadata,
      p_started_at,
      p_started_at
    )
    RETURNING * INTO v_run;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'execution_guard',
        'message', 'live sync already running for this connection'
      );
  END;

  RETURN jsonb_build_object(
    'success', true,
    'run', to_jsonb(v_run)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_acquire_live_sync_guard_scoped_v1(
  uuid, jsonb, uuid, text, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_acquire_live_sync_guard_scoped_v1(
  uuid, jsonb, uuid, text, text, timestamptz, jsonb
) TO service_role;


CREATE OR REPLACE FUNCTION public.channel_manager_update_import_run_scoped_v1(
  p_connection_id uuid,
  p_expected_scope jsonb,
  p_run_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope jsonb;
  v_run public.booking_channel_import_runs%ROWTYPE;
  v_unknown jsonb;
BEGIN
  IF p_run_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'run_id and patch are required'
    );
  END IF;

  v_unknown := p_patch - ARRAY[
    'status',
    'finished_at',
    'imported_objects_count',
    'imported_bookings_count',
    'imported_calendar_days_count',
    'imported_prices_count',
    'warnings',
    'errors',
    'safe_summary',
    'metadata',
    'updated_at'
  ]::text[];

  IF v_unknown <> '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_arguments',
      'message', 'patch contains unsupported fields'
    );
  END IF;

  v_scope := public.channel_manager_assert_connection_scope_locked_v1(
    p_connection_id,
    p_expected_scope
  );

  IF COALESCE((v_scope->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_scope;
  END IF;

  UPDATE public.booking_channel_import_runs
  SET
    status = CASE
      WHEN p_patch ? 'status' THEN COALESCE(NULLIF(p_patch->>'status', ''), status)
      ELSE status
    END,
    finished_at = CASE
      WHEN p_patch ? 'finished_at' THEN NULLIF(p_patch->>'finished_at', '')::timestamptz
      ELSE finished_at
    END,
    imported_objects_count = CASE
      WHEN p_patch ? 'imported_objects_count'
        THEN COALESCE((p_patch->>'imported_objects_count')::integer, imported_objects_count)
      ELSE imported_objects_count
    END,

    imported_bookings_count = CASE
      WHEN p_patch ? 'imported_bookings_count'
        THEN COALESCE((p_patch->>'imported_bookings_count')::integer, imported_bookings_count)
      ELSE imported_bookings_count
    END,
    imported_calendar_days_count = CASE
      WHEN p_patch ? 'imported_calendar_days_count'
        THEN COALESCE((p_patch->>'imported_calendar_days_count')::integer, imported_calendar_days_count)
      ELSE imported_calendar_days_count
    END,
    imported_prices_count = CASE
      WHEN p_patch ? 'imported_prices_count'
        THEN COALESCE((p_patch->>'imported_prices_count')::integer, imported_prices_count)
      ELSE imported_prices_count
    END,
    warnings = CASE
      WHEN p_patch ? 'warnings' THEN COALESCE(p_patch->'warnings', '[]'::jsonb)
      ELSE warnings
    END,

    errors = CASE
      WHEN p_patch ? 'errors' THEN COALESCE(p_patch->'errors', '[]'::jsonb)
      ELSE errors
    END,
    safe_summary = CASE
      WHEN p_patch ? 'safe_summary' THEN p_patch->>'safe_summary'
      ELSE safe_summary
    END,
    metadata = CASE
      WHEN p_patch ? 'metadata' THEN COALESCE(p_patch->'metadata', '{}'::jsonb)
      ELSE metadata
    END,
    updated_at = CASE
      WHEN p_patch ? 'updated_at'
        THEN COALESCE(NULLIF(p_patch->>'updated_at', '')::timestamptz, updated_at)
      ELSE updated_at
    END
  WHERE id = p_run_id
    AND connection_id = p_connection_id
  RETURNING * INTO v_run;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'import_run_not_found',
      'message', 'import run not found in connection scope'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'run', to_jsonb(v_run)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_update_import_run_scoped_v1(uuid, jsonb, uuid, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.channel_manager_update_import_run_scoped_v1(uuid, jsonb, uuid, jsonb) FROM anon;

REVOKE ALL ON FUNCTION public.channel_manager_update_import_run_scoped_v1(uuid, jsonb, uuid, jsonb) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.channel_manager_update_import_run_scoped_v1(uuid, jsonb, uuid, jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.channel_manager_live_scope_guard_state_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'scopedConnectionWritesReady',
      public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_assert_connection_scope_locked_v1(uuid,jsonb)'
      )
      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_set_live_sync_lease_scoped_v1(uuid,jsonb,jsonb,timestamptz,timestamptz)'
      )
      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_update_live_connection_scoped_v1(uuid,jsonb,jsonb)'
      )
      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_acquire_live_sync_guard_scoped_v1(uuid,jsonb,uuid,text,text,timestamptz,jsonb)'
      )
      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_update_import_run_scoped_v1(uuid,jsonb,uuid,jsonb)'
      )

      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_commit_incremental_sync_scoped_v1(uuid,jsonb,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)'
      )
      AND public.channel_manager_live_core_rpc_ready(
        'public.channel_manager_complete_incremental_replay_scoped_v1(uuid,jsonb,uuid,text,text,timestamptz,jsonb)'
      )
  );
$$;
