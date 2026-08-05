-- Channel Manager Live Core synthetic recovery v1
-- Additive only. Service-role-only RPCs for owner recovery workflow.
-- Does not delete production data by itself; application must pass exact verified IDs.
-- No hardcoded orphan IDs. No public/anon/authenticated execute grants.

CREATE OR REPLACE FUNCTION public.channel_manager_live_core_booking_ops_fk_children(
  p_booking_ops_record_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_sql text;
  v_ids uuid[];
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
BEGIN
  IF p_booking_ops_record_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR r IN
    SELECT
      c.conrelid::regclass::text AS table_name,
      a.attname AS column_name,
      conf.confdeltype AS delete_action
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    JOIN LATERAL (
      SELECT confdeltype
      FROM pg_constraint conf
      WHERE conf.oid = c.oid
    ) conf ON true
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.booking_ops_records'::regclass
  LOOP
    BEGIN
      v_sql := format(
        'SELECT coalesce(array_agg(%I::uuid), ARRAY[]::uuid[]) FROM %s WHERE %I = $1',
        'id',
        r.table_name,
        r.column_name
      );
      EXECUTE v_sql INTO v_ids USING p_booking_ops_record_id;
      IF v_ids IS NOT NULL THEN
        FOREACH v_id IN ARRAY v_ids LOOP
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'table_name', r.table_name,
            'column_name', r.column_name,
            'child_id', v_id,
            'delete_action', r.delete_action
          ));
        END LOOP;
      END IF;
    EXCEPTION
      WHEN undefined_table OR undefined_column OR datatype_mismatch THEN
        CONTINUE;
    END;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_core_booking_ops_fk_children(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.channel_manager_live_core_booking_ops_fk_children(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_core_booking_ops_fk_children(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.channel_manager_live_core_synthetic_recovery_cleanup(
  p_confirm text,
  p_dry_run boolean,
  p_booking_ops_record_id uuid,
  p_expected_property_id text,
  p_expected_booking_id text,
  p_expected_guest_name text,
  p_deletion_manifest jsonb,
  p_preserve_owner_setup_id uuid,
  p_preserve_property_setup_id uuid,
  p_preserve_connection_id uuid,
  p_preserve_import_run_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirm_phrase constant text := 'CLEAN_SYNTHETIC_LIVE_CORE_ACCEPTANCE_V1';
  v_row public.booking_ops_records%ROWTYPE;
  v_table text;
  v_ids uuid[];
  v_id uuid;
  v_deleted int;
  v_expected int;
  v_deleted_counts jsonb := '{}'::jsonb;
  v_fk jsonb;
  v_hit jsonb;
  v_hit_table text;
  v_hit_id text;
  v_allowlisted text[];
  v_post jsonb := '{}'::jsonb;
  v_owner_ok boolean;
  v_property_ok boolean;
  v_connection_ok boolean;
  v_run_id uuid;
  v_meta jsonb;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '15s', true);

  IF p_booking_ops_record_id IS NULL
     OR coalesce(p_expected_property_id, '') = ''
     OR coalesce(p_expected_booking_id, '') = ''
     OR coalesce(p_expected_guest_name, '') = '' THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'transaction_committed', false,
      'blocker_code', 'identity_mismatch',
      'blocker_summary', 'Required recovery identity parameters are missing.',
      'safe_error', 'identity_params_missing'
    );
  END IF;

  IF p_dry_run IS NOT TRUE AND coalesce(p_confirm, '') IS DISTINCT FROM v_confirm_phrase THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'transaction_committed', false,
      'blocker_code', 'confirmation_mismatch',
      'blocker_summary', 'Confirmation phrase mismatch.',
      'safe_error', 'confirmation_mismatch'
    );
  END IF;

  SELECT * INTO v_row
  FROM public.booking_ops_records
  WHERE id = p_booking_ops_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_clean',
      'transaction_committed', false,
      'blocker_code', 'already_clean',
      'blocker_summary', 'Target booking_ops_records row not found.',
      'deleted_counts_by_table', '{}'::jsonb,
      'post_verification', jsonb_build_object('deterministicIdentityGone', true)
    );
  END IF;

  v_meta := coalesce(v_row.reservation_metadata, '{}'::jsonb);

  IF v_row.property_id IS DISTINCT FROM p_expected_property_id
     OR v_row.booking_id IS DISTINCT FROM p_expected_booking_id
     OR v_row.guest_name IS DISTINCT FROM p_expected_guest_name THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'transaction_committed', false,
      'blocker_code', 'identity_mismatch',
      'blocker_summary', 'Row identity mismatch inside transaction.',
      'safe_error', 'identity_mismatch'
    );
  END IF;

  IF v_row.account_id IS NOT NULL
     OR coalesce(v_row.guest_phone, '') <> ''
     OR coalesce(v_row.guest_email, '') <> ''
     OR coalesce(v_row.guest_telegram, '') <> '' THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'transaction_committed', false,
      'blocker_code', 'contact_present',
      'blocker_summary', 'Row has account or guest contact.',
      'safe_error', 'contact_or_account_present'
    );
  END IF;

  IF jsonb_typeof(v_meta) <> 'object' THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'transaction_committed', false,
      'blocker_code', 'metadata_not_empty',
      'blocker_summary', 'reservation_metadata is not an object.',
      'safe_error', 'metadata_invalid'
    );
  END IF;

  IF v_meta <> '{}'::jsonb
     AND coalesce(v_meta->>'acceptanceHarness', '') IS DISTINCT FROM 'channel_manager_live_core_v1' THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'transaction_committed', false,
      'blocker_code', 'metadata_not_empty',
      'blocker_summary', 'Unmarked non-empty reservation_metadata.',
      'safe_error', 'metadata_not_empty'
    );
  END IF;

  -- Discover live FK children and require every child ID to be in the verified manifest.
  v_fk := public.channel_manager_live_core_booking_ops_fk_children(p_booking_ops_record_id);
  SELECT coalesce(array_agg(key), ARRAY[]::text[])
  INTO v_allowlisted
  FROM jsonb_object_keys(coalesce(p_deletion_manifest, '{}'::jsonb)) AS key;

  FOR v_hit IN SELECT * FROM jsonb_array_elements(coalesce(v_fk, '[]'::jsonb))
  LOOP
    v_hit_table := v_hit->>'table_name';
    v_hit_id := v_hit->>'child_id';
    IF v_hit_table IS NULL OR v_hit_id IS NULL THEN
      CONTINUE;
    END IF;
    -- Imported booking match pointer is SET NULL / not deleted as booking ops child scope.
    IF v_hit_table = 'booking_channel_imported_bookings' THEN
      CONTINUE;
    END IF;
    IF NOT (v_hit_table = ANY (v_allowlisted))
       OR NOT (
         coalesce(p_deletion_manifest -> v_hit_table, '[]'::jsonb)
           ? v_hit_id
       ) THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'transaction_committed', false,
        'blocker_code', 'unknown_fk_descendant',
        'blocker_summary', format('Unverified FK child %s:%s', v_hit_table, v_hit_id),
        'safe_error', 'unknown_fk_descendant'
      );
    END IF;
  END LOOP;

  IF p_dry_run IS TRUE THEN
    RETURN jsonb_build_object(
      'status', 'passed',
      'transaction_committed', false,
      'dry_run', true,
      'blocker_code', 'none',
      'blocker_summary', null,
      'deleted_counts_by_table', (
        SELECT coalesce(jsonb_object_agg(key, jsonb_array_length(value)), '{}'::jsonb)
        FROM jsonb_each(coalesce(p_deletion_manifest, '{}'::jsonb))
      ),
      'post_verification', jsonb_build_object('dryRun', true, 'locked', true)
    );
  END IF;

  -- Delete allowlisted descendants first (exact IDs only).
  FOR v_table IN
    SELECT key
    FROM jsonb_each(coalesce(p_deletion_manifest, '{}'::jsonb))
    WHERE key <> 'booking_ops_records'
  LOOP
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(coalesce(p_deletion_manifest -> v_table, '[]'::jsonb))::uuid
    ) INTO v_ids;

    v_expected := coalesce(array_length(v_ids, 1), 0);
    IF v_expected = 0 THEN
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('DELETE FROM %I WHERE id = ANY ($1)', v_table)
      USING v_ids;
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      IF v_deleted <> v_expected THEN
        RAISE EXCEPTION 'deleted_count_mismatch:%:%:%', v_table, v_expected, v_deleted;
      END IF;
      v_deleted_counts := v_deleted_counts || jsonb_build_object(v_table, v_deleted);
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        CONTINUE;
    END;
  END LOOP;

  DELETE FROM public.booking_ops_records
  WHERE id = p_booking_ops_record_id
    AND property_id = p_expected_property_id
    AND booking_id = p_expected_booking_id
    AND guest_name = p_expected_guest_name
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'main_row_delete_failed';
  END IF;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('booking_ops_records', 1);

  -- Post verification
  IF EXISTS (
    SELECT 1 FROM public.booking_ops_records
    WHERE property_id = p_expected_property_id
      AND booking_id = p_expected_booking_id
  ) THEN
    RAISE EXCEPTION 'deterministic_identity_remains';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.booking_owner_setup_profiles WHERE id = p_preserve_owner_setup_id
  ) INTO v_owner_ok;
  SELECT EXISTS (
    SELECT 1 FROM public.booking_property_setup_profiles WHERE id = p_preserve_property_setup_id
  ) INTO v_property_ok;
  SELECT EXISTS (
    SELECT 1 FROM public.booking_channel_manager_connections WHERE id = p_preserve_connection_id
  ) INTO v_connection_ok;

  IF p_preserve_owner_setup_id IS NOT NULL AND v_owner_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'contour_owner_missing';
  END IF;
  IF p_preserve_property_setup_id IS NOT NULL AND v_property_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'contour_property_missing';
  END IF;
  IF p_preserve_connection_id IS NOT NULL AND v_connection_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'contour_connection_missing';
  END IF;

  IF p_preserve_import_run_ids IS NOT NULL THEN
    FOREACH v_run_id IN ARRAY p_preserve_import_run_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.booking_channel_import_runs WHERE id = v_run_id
      ) THEN
        RAISE EXCEPTION 'import_run_missing:%', v_run_id;
      END IF;
    END LOOP;
  END IF;

  v_post := jsonb_build_object(
    'deterministicIdentityGone', true,
    'descendantsRemain', false,
    'contourPreserved', true,
    'importRunsPreserved', true
  );

  RETURN jsonb_build_object(
    'status', 'passed',
    'transaction_committed', true,
    'dry_run', false,
    'blocker_code', 'none',
    'blocker_summary', null,
    'safe_error', null,
    'deleted_counts_by_table', v_deleted_counts,
    'post_verification', v_post
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'failed',
      'transaction_committed', false,
      'blocker_code', 'cleanup_failed',
      'blocker_summary', 'Transactional cleanup rolled back.',
      'safe_error', left(SQLERRM, 240),
      'deleted_counts_by_table', '{}'::jsonb
    );
END;
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_core_synthetic_recovery_cleanup(
  text, boolean, uuid, text, text, text, jsonb, uuid, uuid, uuid, uuid[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.channel_manager_live_core_synthetic_recovery_cleanup(
  text, boolean, uuid, text, text, text, jsonb, uuid, uuid, uuid, uuid[]
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_core_synthetic_recovery_cleanup(
  text, boolean, uuid, text, text, text, jsonb, uuid, uuid, uuid, uuid[]
) TO service_role;

COMMENT ON FUNCTION public.channel_manager_live_core_synthetic_recovery_cleanup(
  text, boolean, uuid, text, text, text, jsonb, uuid, uuid, uuid, uuid[]
) IS
  'Owner recovery helper: transactional delete of exact verified synthetic Live Core acceptance Booking Ops artifacts. Service-role only.';
