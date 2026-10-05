BEGIN TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  unresolved_inbound BIGINT;
  unresolved_holds BIGINT;
  unresolved_blocks BIGINT;
  guest_profile_inbound_fks BIGINT;
  auto_send_scope_duplicates BIGINT;
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=read_only_guard_failed';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=missing_migration_history';
  END IF;

  IF to_regclass('public.accounts') IS NULL
     OR to_regclass('public.properties') IS NULL
     OR to_regclass('public.booking_ops_records') IS NULL
     OR to_regclass('public.guest_memory_profiles') IS NULL
     OR to_regclass('public.guest_memory_preferences') IS NULL
     OR to_regclass('public.guest_memory_events') IS NULL
     OR to_regclass('public.booking_ops_communication_auto_send_scopes') IS NULL
     OR to_regclass('public.booking_ops_communication_auto_send_runs') IS NULL
     OR to_regclass('public.booking_ops_communication_deliveries') IS NULL
     OR to_regclass('public.booking_inbound_intake_events') IS NULL
     OR to_regclass('public.booking_availability_holds') IS NULL
     OR to_regclass('public.booking_availability_blocks') IS NULL
     OR to_regclass('public.booking_overbooking_conflict_checks') IS NULL
     OR to_regclass('public.booking_property_setup_profiles') IS NULL THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=missing_prerequisite_relation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20260930200000',
      '20261003093000',
      '20261003124500',
      '20261003141500',
      '20261003150000'
    )
  ) THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=target_history_already_registered';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guest_memory_profiles' AND column_name = 'account_id'
  ) OR to_regclass('public.residential_property_spatial_snapshots') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'booking_ops_communication_auto_send_scopes' AND column_name = 'account_id'
     )
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'booking_inbound_intake_events' AND column_name = 'account_id'
     )
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'booking_overbooking_conflict_checks' AND column_name = 'account_id'
     )
     OR to_regprocedure('public.create_booking_availability_hold_atomic_account_v1(text,uuid,text,uuid,text,date,date,timestamptz,text,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=partial_target_schema_detected';
  END IF;

  SELECT count(*) INTO guest_profile_inbound_fks
  FROM pg_constraint
  WHERE contype = 'f'
    AND confrelid = 'public.guest_memory_profiles'::regclass;
  IF guest_profile_inbound_fks <> 0 THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=guest_memory_profile_has_inbound_fk count=%', guest_profile_inbound_fks;
  END IF;

  SELECT count(*) INTO auto_send_scope_duplicates
  FROM (
    SELECT scope_type, scope_ref_key
    FROM public.booking_ops_communication_auto_send_scopes
    GROUP BY scope_type, scope_ref_key
    HAVING count(*) > 1
  ) duplicate_scope;
  IF auto_send_scope_duplicates <> 0 THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=auto_send_scope_duplicate count=%', auto_send_scope_duplicates;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_ops_communication_auto_send_scopes
    WHERE scope_type <> 'global'
      AND actual_send_enabled = true
  ) THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=enabled_non_global_auto_send_scope_requires_review';
  END IF;

  SELECT count(*) INTO unresolved_inbound
  FROM public.booking_inbound_intake_events e
  WHERE NOT (
    (
      e.booking_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.booking_ops_records b
        JOIN public.accounts a ON a.id::text = b.account_id
        WHERE b.id = e.booking_id
          AND b.account_id IS NOT NULL
      )
    )
    OR (
      e.booking_id IS NULL
      AND e.property_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.properties p
        WHERE p.id::text = e.property_id
          AND p.account_id IS NOT NULL
      )
    )
  );
  IF unresolved_inbound <> 0 THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=unresolved_inbound_rows count=%', unresolved_inbound;
  END IF;

  SELECT count(*) INTO unresolved_holds
  FROM public.booking_availability_holds h
  WHERE NOT (
    (
      h.booking_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.booking_ops_records r
        WHERE r.id = h.booking_id
          AND r.account_id IS NOT NULL
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id::text = h.property_id
        AND p.account_id IS NOT NULL
    )
  );
  IF unresolved_holds <> 0 THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=unresolved_availability_holds count=%', unresolved_holds;
  END IF;

  SELECT count(*) INTO unresolved_blocks
  FROM public.booking_availability_blocks b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id::text = b.property_id
      AND p.account_id IS NOT NULL
  );
  IF unresolved_blocks <> 0 THEN
    RAISE EXCEPTION 'WAVE5_CORE_DB_PRECHECK=unresolved_availability_blocks count=%', unresolved_blocks;
  END IF;
END
$precheck$;

SELECT
  (SELECT count(*) FROM public.guest_memory_profiles) AS guest_memory_profiles_rows,
  (SELECT count(*) FROM public.guest_memory_preferences) AS guest_memory_preferences_rows,
  (SELECT count(*) FROM public.guest_memory_events) AS guest_memory_events_rows,
  (SELECT count(*) FROM public.booking_ops_communication_auto_send_scopes) AS auto_send_scopes_rows,
  (SELECT count(*) FROM public.booking_ops_communication_auto_send_runs) AS auto_send_runs_rows,
  (SELECT count(*) FROM public.booking_inbound_intake_events) AS inbound_intake_rows,
  (SELECT count(*) FROM public.booking_availability_holds) AS availability_holds_rows,
  (SELECT count(*) FROM public.booking_availability_blocks) AS availability_blocks_rows,
  (SELECT count(*) FROM public.booking_overbooking_conflict_checks) AS overbooking_checks_rows;

SELECT 'WAVE5_CORE_DB_PRECHECK=ready' AS result;

COMMIT;
