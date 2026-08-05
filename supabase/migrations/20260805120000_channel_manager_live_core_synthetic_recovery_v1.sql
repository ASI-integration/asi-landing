-- Channel Manager Live Core synthetic recovery v1 (hardened)
-- Additive only. Service-role-only RPCs for owner recovery workflow.
-- Fail closed on FK inspection / schema drift / unscoped deletes.
-- No hardcoded orphan IDs. No public/anon/authenticated execute grants.

-- Reviewed FK edges referencing booking_ops_records (source: supabase/migrations).
-- confdeltype: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT
CREATE OR REPLACE FUNCTION public.channel_manager_live_core_recovery_expected_fk_edges()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('table_name','booking_ops_events','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_tasks','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_telegram_drafts','column_name','booking_ops_record_id','delete_action','a','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_communication_intents','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_guest_intake_sessions','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_guest_intake_submissions','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_guest_documents','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_contracts','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_deposits','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_mvd_reports','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_checkin_execution','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_instay_checkout','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_guest_stay_issues','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_lifecycle_gates','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_lifecycle_exceptions','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_availability_holds','column_name','booking_id','delete_action','n','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_overbooking_conflict_checks','column_name','booking_id','delete_action','n','pk_column','id','deletable',true),
    -- SET NULL edge: presence blocks cleanup (never rely on silent SET NULL mutation).
    jsonb_build_object('table_name','booking_channel_imported_bookings','column_name','matched_booking_id','delete_action','n','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_physical_readiness','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_cleaning_tasks','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_linen_tasks','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_supplies_tasks','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_maintenance_tickets','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_physical_coordination_drafts','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_guest_legal_readiness','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_legal_execution_events','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    -- Delete-order note: decisions/autopilot before domain_events; lifecycle_events before lifecycle_runs.
    jsonb_build_object('table_name','booking_ops_lifecycle_decisions','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_lifecycle_events','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_lifecycle_runs','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_lifecycle_states','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_sla_items','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_ops_lifecycle_drafts','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_guest_intake_events','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_ops_checkin_release_drafts','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_ops_autopilot_states','column_name','booking_id','delete_action','c','pk_column','booking_id','deletable',true),
    jsonb_build_object('table_name','booking_ops_domain_events','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_worker_tasks','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_worker_link_audit','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_ops_alerts','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_alerts','column_name','previous_booking_id','delete_action','n','pk_column','id','deletable',false),
    jsonb_build_object('table_name','reservation_source_links','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','reservation_import_rows','column_name','booking_ops_record_id','delete_action','n','pk_column','id','deletable',false),
    jsonb_build_object('table_name','reservation_reconciliation_items','column_name','booking_ops_record_id','delete_action','n','pk_column','id','deletable',false),
    jsonb_build_object('table_name','reservation_ledger_audit','column_name','booking_ops_record_id','delete_action','n','pk_column','id','deletable',false)
  );
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_core_recovery_expected_fk_edges() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.channel_manager_live_core_recovery_expected_fk_edges() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_core_recovery_expected_fk_edges() TO service_role;

-- Live FK discovery: every edge inspected; never silently skip errors.
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
  v_expected jsonb := public.channel_manager_live_core_recovery_expected_fk_edges();
  v_edge jsonb;
  v_pk text;
  v_deletable boolean;
  v_sql text;
  v_count bigint;
  v_keys text[];
  v_out jsonb := '[]'::jsonb;
  v_live_keys text[] := ARRAY[]::text[];
  v_expected_keys text[] := ARRAY[]::text[];
  v_key text;
  v_found boolean;
BEGIN
  IF p_booking_ops_record_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blocker_code', 'identity_mismatch',
      'blocker_summary', 'booking_ops_record_id is required',
      'edges', '[]'::jsonb
    );
  END IF;

  FOR v_edge IN SELECT * FROM jsonb_array_elements(v_expected)
  LOOP
    v_expected_keys := array_append(
      v_expected_keys,
      (v_edge->>'table_name') || ':' || (v_edge->>'column_name')
    );
  END LOOP;

  -- Multi-column FKs cannot be safely cleaned by this recovery RPC.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = (SELECT relnamespace FROM pg_class WHERE oid = c.conrelid)
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.booking_ops_records'::regclass
      AND n.nspname = 'public'
      AND coalesce(array_length(c.conkey, 1), 0) <> 1
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blocker_code', 'unknown_fk_descendant',
      'blocker_summary', 'Multi-column FK to booking_ops_records is not supported by recovery cleanup',
      'edges', '[]'::jsonb
    );
  END IF;

  FOR r IN
    SELECT
      n.nspname AS schema_name,
      c.conrelid::regclass::text AS table_name,
      replace(c.conrelid::regclass::text, 'public.', '') AS bare_table,
      a.attname AS column_name,
      c.confdeltype AS delete_action
    FROM pg_constraint c
    JOIN pg_class cls ON cls.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = c.conkey[1]
     AND NOT a.attisdropped
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.booking_ops_records'::regclass
      AND n.nspname = 'public'
      AND array_length(c.conkey, 1) = 1
  LOOP
    v_key := r.bare_table || ':' || r.column_name;
    v_live_keys := array_append(v_live_keys, v_key);
    v_found := false;
    v_pk := NULL;
    v_deletable := false;

    FOR v_edge IN SELECT * FROM jsonb_array_elements(v_expected)
    LOOP
      IF (v_edge->>'table_name') = r.bare_table
         AND (v_edge->>'column_name') = r.column_name THEN
        v_found := true;
        v_pk := v_edge->>'pk_column';
        v_deletable := coalesce((v_edge->>'deletable')::boolean, false);
        IF (v_edge->>'delete_action') IS DISTINCT FROM r.delete_action::text THEN
          RETURN jsonb_build_object(
            'ok', false,
            'blocker_code', 'unknown_fk_descendant',
            'blocker_summary', format(
              'FK delete action drift for %s.%s: expected %s got %s',
              r.bare_table, r.column_name, v_edge->>'delete_action', r.delete_action
            ),
            'edges', v_out
          );
        END IF;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_found THEN
      RETURN jsonb_build_object(
        'ok', false,
        'blocker_code', 'unknown_fk_descendant',
        'blocker_summary', format('Unexpected live FK edge %s.%s', r.bare_table, r.column_name),
        'edges', v_out
      );
    END IF;

    IF v_pk IS NULL OR length(v_pk) = 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'blocker_code', 'unknown_fk_descendant',
        'blocker_summary', format('No reviewed primary-key mapping for %s.%s', r.bare_table, r.column_name),
        'edges', v_out
      );
    END IF;

    BEGIN
      v_sql := format(
        'SELECT count(*), coalesce(array_agg(%I::text), ARRAY[]::text[]) FROM public.%I WHERE %I = $1',
        v_pk,
        r.bare_table,
        r.column_name
      );
      EXECUTE v_sql INTO v_count, v_keys USING p_booking_ops_record_id;
    EXCEPTION
      WHEN undefined_table OR undefined_column OR datatype_mismatch OR others THEN
        RETURN jsonb_build_object(
          'ok', false,
          'blocker_code', 'unknown_fk_descendant',
          'blocker_summary', format(
            'Uninspectable FK edge %s.%s pk=%s: %s',
            r.bare_table, r.column_name, v_pk, SQLERRM
          ),
          'edges', v_out
        );
    END;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'table_name', r.bare_table,
      'column_name', r.column_name,
      'delete_action', r.delete_action,
      'pk_column', v_pk,
      'deletable', v_deletable,
      'row_count', v_count,
      'child_keys', to_jsonb(coalesce(v_keys, ARRAY[]::text[]))
    ));
  END LOOP;

  FOREACH v_key IN ARRAY v_expected_keys LOOP
    IF NOT (v_key = ANY (v_live_keys)) THEN
      -- Optional: table may not exist yet in older environments → BLOCK (fail closed).
      RETURN jsonb_build_object(
        'ok', false,
        'blocker_code', 'unknown_fk_descendant',
        'blocker_summary', format('Expected reviewed FK edge missing from live schema: %s', v_key),
        'edges', v_out
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'blocker_code', 'none',
    'blocker_summary', null,
    'edges', v_out
  );
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
  v_meta jsonb;
  v_fk jsonb;
  v_edge jsonb;
  v_table text;
  v_column text;
  v_pk text;
  v_deletable boolean;
  v_keys text[];
  v_key text;
  v_manifest_keys text[];
  v_manifest_uuids uuid[];
  v_locked_uuids uuid[];
  v_deleted int;
  v_expected int;
  v_deleted_counts jsonb := '{}'::jsonb;
  v_sql text;
  v_count bigint;
  v_intent_ids uuid[];
  v_delivery_ids uuid[];
  v_manifest_delivery_ids uuid[];
  v_post jsonb;
  v_owner_ok boolean;
  v_property_ok boolean;
  v_connection_ok boolean;
  v_run_id uuid;
  v_remaining_descendants bigint := 0;
  v_allowlist text[];
  v_delete_order text[];
  v_source_count bigint;
  v_payment_count bigint;
  v_edge_by_table jsonb := '{}'::jsonb;
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

  -- Hardcoded recovery allowlist (table names only).
  SELECT array_agg(DISTINCT e->>'table_name')
  INTO v_allowlist
  FROM jsonb_array_elements(public.channel_manager_live_core_recovery_expected_fk_edges()) e
  WHERE coalesce((e->>'deletable')::boolean, false);

  v_allowlist := array_append(v_allowlist, 'booking_ops_records');
  v_allowlist := array_append(v_allowlist, 'booking_ops_communication_deliveries');

  -- Reject unknown manifest tables.
  FOR v_table IN
    SELECT key FROM jsonb_each(coalesce(p_deletion_manifest, '{}'::jsonb))
  LOOP
    IF NOT (v_table = ANY (v_allowlist)) THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'transaction_committed', false,
        'blocker_code', 'unknown_fk_descendant',
        'blocker_summary', format('Manifest table outside recovery allowlist: %s', v_table),
        'safe_error', 'manifest_table_not_allowlisted'
      );
    END IF;
  END LOOP;

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
      'post_verification', jsonb_build_object('deterministicIdentityGone', true, 'descendantsRemain', false)
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

  -- Payments / source-link safety (do not trust preview).
  SELECT count(*) INTO v_payment_count
  FROM public.booking_deposits WHERE booking_id = p_booking_ops_record_id;
  IF v_payment_count > 0 THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'transaction_committed', false,
      'blocker_code', 'payments_present',
      'blocker_summary', 'Deposits present — cleanup blocked.',
      'safe_error', 'payments_present'
    );
  END IF;

  IF to_regclass('public.reservation_source_links') IS NOT NULL THEN
    SELECT count(*) INTO v_source_count
    FROM public.reservation_source_links WHERE booking_ops_record_id = p_booking_ops_record_id;
    IF v_source_count > 0 THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'transaction_committed', false,
        'blocker_code', 'identity_mismatch',
        'blocker_summary', 'Reservation source links present — cleanup blocked.',
        'safe_error', 'source_links_present'
      );
    END IF;
  END IF;

  v_fk := public.channel_manager_live_core_booking_ops_fk_children(p_booking_ops_record_id);
  IF coalesce(v_fk->>'ok', 'false') <> 'true' THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'transaction_committed', false,
      'blocker_code', coalesce(v_fk->>'blocker_code', 'unknown_fk_descendant'),
      'blocker_summary', coalesce(v_fk->>'blocker_summary', 'FK discovery failed.'),
      'safe_error', 'fk_discovery_failed'
    );
  END IF;

  -- Validate every live edge with children against manifest and allowlist.
  -- Lock exact primary keys via SELECT ... FOR UPDATE (never aggregate FOR UPDATE).
  FOR v_edge IN SELECT * FROM jsonb_array_elements(coalesce(v_fk->'edges', '[]'::jsonb))
  LOOP
    v_table := v_edge->>'table_name';
    v_column := v_edge->>'column_name';
    v_pk := v_edge->>'pk_column';
    v_deletable := coalesce((v_edge->>'deletable')::boolean, false);
    v_expected := coalesce((v_edge->>'row_count')::int, 0);

    IF v_expected = 0 THEN
      CONTINUE;
    END IF;

    -- Keep the live edge used for locking/deletes (tables may have multiple FK columns).
    v_edge_by_table := v_edge_by_table || jsonb_build_object(v_table, v_edge);

    IF NOT v_deletable THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'transaction_committed', false,
        'blocker_code', 'unknown_fk_descendant',
        'blocker_summary', format(
          'Non-deletable FK children present on %s.%s (%s rows, action=%s)',
          v_table, v_column, v_expected, v_edge->>'delete_action'
        ),
        'safe_error', 'non_deletable_fk_children'
      );
    END IF;

    SELECT ARRAY(
      SELECT jsonb_array_elements_text(coalesce(p_deletion_manifest -> v_table, '[]'::jsonb))
    ) INTO v_manifest_keys;

    SELECT ARRAY(
      SELECT jsonb_array_elements_text(coalesce(v_edge->'child_keys', '[]'::jsonb))
    ) INTO v_keys;

    IF coalesce(array_length(v_keys, 1), 0) <> coalesce(array_length(v_manifest_keys, 1), 0)
       OR EXISTS (
         SELECT 1 FROM unnest(v_keys) k
         WHERE NOT (k = ANY (coalesce(v_manifest_keys, ARRAY[]::text[])))
       )
       OR EXISTS (
         SELECT 1 FROM unnest(coalesce(v_manifest_keys, ARRAY[]::text[])) k
         WHERE NOT (k = ANY (v_keys))
       ) THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'transaction_committed', false,
        'blocker_code', 'row_changed',
        'blocker_summary', format('Manifest mismatch for %s.%s', v_table, v_column),
        'safe_error', 'manifest_child_mismatch'
      );
    END IF;

    BEGIN
      SELECT ARRAY(
        SELECT unnest(coalesce(v_manifest_keys, ARRAY[]::text[]))::uuid
      ) INTO v_manifest_uuids;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN jsonb_build_object(
          'status', 'blocked',
          'transaction_committed', false,
          'blocker_code', 'row_changed',
          'blocker_summary', format('Manifest contains non-UUID keys for %s', v_table),
          'safe_error', 'manifest_non_uuid'
        );
    END;

    -- Prove every manifest UUID currently belongs to this orphan via FK column.
    v_sql := format(
      'SELECT count(*) FROM public.%I WHERE %I = ANY ($1::uuid[]) AND %I IS DISTINCT FROM $2',
      v_table, v_pk, v_column
    );
    EXECUTE v_sql INTO v_count USING v_manifest_uuids, p_booking_ops_record_id;
    IF v_count > 0 THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'transaction_committed', false,
        'blocker_code', 'row_changed',
        'blocker_summary', format('Manifest contains IDs not belonging to orphan on %s', v_table),
        'safe_error', 'extra_manifest_id'
      );
    END IF;

    -- Lock exact verified children by primary key (row-level FOR UPDATE).
    v_sql := format(
      $q$
      SELECT coalesce(array_agg(locked.%I ORDER BY locked.%I::text), ARRAY[]::uuid[])
      FROM (
        SELECT %I
        FROM public.%I
        WHERE %I = ANY ($1::uuid[])
          AND %I = $2
        FOR UPDATE
      ) locked
      $q$,
      v_pk, v_pk, v_pk, v_table, v_pk, v_column
    );
    EXECUTE v_sql INTO v_locked_uuids USING v_manifest_uuids, p_booking_ops_record_id;
    IF coalesce(array_length(v_locked_uuids, 1), 0) <> coalesce(array_length(v_manifest_uuids, 1), 0) THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'transaction_committed', false,
        'blocker_code', 'row_changed',
        'blocker_summary', format('Unable to lock all verified children for %s', v_table),
        'safe_error', 'child_lock_mismatch'
      );
    END IF;
  END LOOP;

  -- Indirect deliveries via intents must be exact-manifested (no silent cascade reliance for verification).
  SELECT ARRAY(
    SELECT jsonb_array_elements_text(coalesce(p_deletion_manifest -> 'booking_ops_communication_intents', '[]'::jsonb))::uuid
  ) INTO v_intent_ids;

  IF coalesce(array_length(v_intent_ids, 1), 0) > 0
     AND to_regclass('public.booking_ops_communication_deliveries') IS NOT NULL THEN
    SELECT coalesce(array_agg(d.id), ARRAY[]::uuid[])
    INTO v_delivery_ids
    FROM public.booking_ops_communication_deliveries d
    WHERE d.communication_intent_id = ANY (v_intent_ids);

    SELECT ARRAY(
      SELECT jsonb_array_elements_text(coalesce(p_deletion_manifest -> 'booking_ops_communication_deliveries', '[]'::jsonb))::uuid
    ) INTO v_manifest_delivery_ids;

    IF coalesce(array_length(v_delivery_ids, 1), 0) > 0 THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'transaction_committed', false,
        'blocker_code', 'deliveries_present',
        'blocker_summary', 'Communication deliveries present — cleanup blocked.',
        'safe_error', 'deliveries_present'
      );
    END IF;

    IF coalesce(array_length(v_manifest_delivery_ids, 1), 0) > 0 THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'transaction_committed', false,
        'blocker_code', 'deliveries_present',
        'blocker_summary', 'Delivery IDs in manifest are not allowed for synthetic cleanup.',
        'safe_error', 'deliveries_in_manifest'
      );
    END IF;
  END IF;

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

  -- Scoped deletes in FK-safe order: exact UUID PK AND FK relationship to orphan.
  -- decisions/autopilot before domain_events; lifecycle_events before lifecycle_runs.
  v_delete_order := ARRAY[
    'booking_ops_lifecycle_decisions',
    'booking_ops_lifecycle_events',
    'booking_ops_events',
    'booking_ops_tasks',
    'booking_ops_telegram_drafts',
    'booking_ops_communication_intents',
    'booking_ops_guest_intake_sessions',
    'booking_availability_holds',
    'booking_overbooking_conflict_checks',
    'booking_ops_lifecycle_drafts',
    'booking_ops_alerts',
    'booking_ops_worker_tasks',
    'booking_ops_autopilot_states',
    'booking_ops_domain_events',
    'booking_ops_lifecycle_runs',
    'booking_ops_lifecycle_states'
  ];

  FOREACH v_table IN ARRAY v_delete_order
  LOOP
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(coalesce(p_deletion_manifest -> v_table, '[]'::jsonb))
    ) INTO v_manifest_keys;
    v_expected := coalesce(array_length(v_manifest_keys, 1), 0);
    IF v_expected = 0 THEN
      CONTINUE;
    END IF;

    v_edge := v_edge_by_table -> v_table;
    IF v_edge IS NULL OR jsonb_typeof(v_edge) = 'null' THEN
      RAISE EXCEPTION 'missing_live_edge_for_manifest_table:%', v_table;
    END IF;
    IF coalesce((v_edge->>'deletable')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'non_deletable_edge_during_delete:%', v_table;
    END IF;

    v_column := v_edge->>'column_name';
    v_pk := v_edge->>'pk_column';
    SELECT ARRAY(
      SELECT unnest(v_manifest_keys)::uuid
    ) INTO v_manifest_uuids;

    v_sql := format(
      'DELETE FROM public.%I WHERE %I = ANY ($1::uuid[]) AND %I = $2',
      v_table, v_pk, v_column
    );
    EXECUTE v_sql USING v_manifest_uuids, p_booking_ops_record_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> v_expected THEN
      RAISE EXCEPTION 'deleted_count_mismatch:%:%:%', v_table, v_expected, v_deleted;
    END IF;
    v_deleted_counts := v_deleted_counts || jsonb_build_object(v_table, coalesce((v_deleted_counts->>v_table)::int, 0) + v_deleted);
  END LOOP;

  -- Any remaining allowlisted manifest tables not covered by delete_order must still be deleted.
  FOR v_table IN
    SELECT key FROM jsonb_each(coalesce(p_deletion_manifest, '{}'::jsonb))
    WHERE key <> 'booking_ops_records'
      AND key <> 'booking_ops_communication_deliveries'
      AND NOT (key = ANY (v_delete_order))
  LOOP
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(coalesce(p_deletion_manifest -> v_table, '[]'::jsonb))
    ) INTO v_manifest_keys;
    IF coalesce(array_length(v_manifest_keys, 1), 0) = 0 THEN
      CONTINUE;
    END IF;
    v_edge := v_edge_by_table -> v_table;
    IF v_edge IS NULL OR jsonb_typeof(v_edge) = 'null' THEN
      RAISE EXCEPTION 'missing_live_edge_for_manifest_table:%', v_table;
    END IF;
    IF coalesce((v_edge->>'deletable')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'non_deletable_edge_during_delete:%', v_table;
    END IF;
    v_column := v_edge->>'column_name';
    v_pk := v_edge->>'pk_column';
    v_expected := array_length(v_manifest_keys, 1);
    SELECT ARRAY(SELECT unnest(v_manifest_keys)::uuid) INTO v_manifest_uuids;
    v_sql := format(
      'DELETE FROM public.%I WHERE %I = ANY ($1::uuid[]) AND %I = $2',
      v_table, v_pk, v_column
    );
    EXECUTE v_sql USING v_manifest_uuids, p_booking_ops_record_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> v_expected THEN
      RAISE EXCEPTION 'deleted_count_mismatch:%:%:%', v_table, v_expected, v_deleted;
    END IF;
    v_deleted_counts := v_deleted_counts || jsonb_build_object(v_table, coalesce((v_deleted_counts->>v_table)::int, 0) + v_deleted);
  END LOOP;

  DELETE FROM public.booking_ops_records
  WHERE id = p_booking_ops_record_id
    AND property_id = p_expected_property_id
    AND booking_id = p_expected_booking_id
    AND guest_name = p_expected_guest_name;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'main_row_delete_failed';
  END IF;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('booking_ops_records', 1);

  -- Post verification: identity gone
  IF EXISTS (
    SELECT 1 FROM public.booking_ops_records
    WHERE property_id = p_expected_property_id
      AND booking_id = p_expected_booking_id
  ) THEN
    RAISE EXCEPTION 'deterministic_identity_remains';
  END IF;

  IF EXISTS (SELECT 1 FROM public.booking_ops_records WHERE id = p_booking_ops_record_id) THEN
    RAISE EXCEPTION 'main_row_remains';
  END IF;

  -- Rerun live FK graph against orphan id (should be empty everywhere).
  -- Since parent is gone, count remaining references via dynamic edges is not possible via FK helper
  -- (parent missing). Instead verify every allowlisted table has zero matching keys from manifest
  -- and zero rows still pointing at the orphan id where column exists.
  FOR v_edge IN SELECT * FROM jsonb_array_elements(public.channel_manager_live_core_recovery_expected_fk_edges())
  LOOP
    v_table := v_edge->>'table_name';
    v_column := v_edge->>'column_name';
    v_pk := v_edge->>'pk_column';
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'post_check_missing_table:%', v_table;
    END IF;
    v_sql := format('SELECT count(*) FROM public.%I WHERE %I = $1', v_table, v_column);
    BEGIN
      EXECUTE v_sql INTO v_count USING p_booking_ops_record_id;
    EXCEPTION
      WHEN undefined_table OR undefined_column OR others THEN
        RAISE EXCEPTION 'post_check_uninspectable:%:%', v_table, SQLERRM;
    END;
    v_remaining_descendants := v_remaining_descendants + coalesce(v_count, 0);

    SELECT ARRAY(
      SELECT jsonb_array_elements_text(coalesce(p_deletion_manifest -> v_table, '[]'::jsonb))
    ) INTO v_manifest_keys;
    IF coalesce(array_length(v_manifest_keys, 1), 0) > 0 THEN
      SELECT ARRAY(SELECT unnest(v_manifest_keys)::uuid) INTO v_manifest_uuids;
      v_sql := format('SELECT count(*) FROM public.%I WHERE %I = ANY ($1::uuid[])', v_table, v_pk);
      EXECUTE v_sql INTO v_count USING v_manifest_uuids;
      IF v_count > 0 THEN
        RAISE EXCEPTION 'manifest_ids_remain:%', v_table;
      END IF;
    END IF;
  END LOOP;

  IF to_regclass('public.booking_ops_communication_deliveries') IS NOT NULL
     AND coalesce(array_length(v_intent_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_count
    FROM public.booking_ops_communication_deliveries
    WHERE communication_intent_id = ANY (v_intent_ids);
    v_remaining_descendants := v_remaining_descendants + coalesce(v_count, 0);
  END IF;

  IF v_remaining_descendants <> 0 THEN
    RAISE EXCEPTION 'descendants_remain:%', v_remaining_descendants;
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
    'descendantsRemain', (v_remaining_descendants <> 0),
    'descendantCount', v_remaining_descendants,
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
    -- Ensures mutation-phase failures roll back and surface a safe failed payload.
    RETURN jsonb_build_object(
      'status', 'failed',
      'transaction_committed', false,
      'blocker_code', 'cleanup_failed',
      'blocker_summary', 'Transactional cleanup rolled back.',
      'safe_error', left(SQLERRM, 240),
      'deleted_counts_by_table', '{}'::jsonb,
      'post_verification', jsonb_build_object('descendantsRemain', true)
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
  'Owner recovery helper: fail-closed transactional delete of exact verified synthetic Live Core acceptance Booking Ops artifacts. Service-role only.';
