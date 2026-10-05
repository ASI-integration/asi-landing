DO $verify$
DECLARE
  required_column TEXT;
  required_constraint TEXT;
  availability_fn REGPROCEDURE;
BEGIN
  FOREACH required_column IN ARRAY ARRAY[
    'guest_memory_profiles.account_id',
    'guest_memory_preferences.account_id',
    'guest_memory_events.account_id',
    'booking_ops_communication_auto_send_scopes.account_id',
    'booking_ops_communication_auto_send_runs.account_id',
    'booking_ops_communication_deliveries.account_id',
    'booking_inbound_intake_events.account_id',
    'booking_overbooking_conflict_checks.account_id'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = split_part(required_column, '.', 1)
        AND column_name = split_part(required_column, '.', 2)
    ) THEN
      RAISE EXCEPTION 'Missing required Wave 5 core column: %', required_column;
    END IF;
  END LOOP;

  IF to_regclass('public.residential_property_spatial_snapshots') IS NULL THEN
    RAISE EXCEPTION 'Missing residential_property_spatial_snapshots.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'residential_property_spatial_snapshots'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on residential_property_spatial_snapshots.';
  END IF;

  FOREACH required_constraint IN ARRAY ARRAY[
    'guest_memory_profiles_account_required',
    'guest_memory_preferences_account_required',
    'guest_memory_events_account_required',
    'booking_ops_auto_send_scope_account_guard',
    'booking_inbound_intake_events_account_idempotency_unique'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = required_constraint
    ) THEN
      RAISE EXCEPTION 'Missing Wave 5 core constraint: %', required_constraint;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_ops_communication_auto_send_scopes'
      AND column_name = 'account_scope_key'
  ) THEN
    RAISE EXCEPTION 'Missing booking_ops_communication_auto_send_scopes.account_scope_key.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_inbound_intake_events'
      AND column_name = 'account_scope_key'
  ) THEN
    RAISE EXCEPTION 'Missing booking_inbound_intake_events.account_scope_key.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_ops_communication_auto_send_scopes
    WHERE scope_type <> 'global'
      AND account_id IS NULL
      AND (actual_send_enabled = true OR dry_run_only = false)
  ) THEN
    RAISE EXCEPTION 'Unbound non-global auto-send scope is not fail-closed.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_inbound_intake_events
    WHERE account_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Production inbound intake rows remain unbound after migration.';
  END IF;

  availability_fn := to_regprocedure(
    'public.create_booking_availability_hold_atomic_account_v1(text,uuid,text,uuid,text,date,date,timestamptz,text,jsonb,text)'
  );
  IF availability_fn IS NULL THEN
    RAISE EXCEPTION 'Missing account-scoped availability hold function.';
  END IF;

  IF NOT has_function_privilege('service_role', availability_fn, 'EXECUTE')
     OR has_function_privilege('anon', availability_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', availability_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Availability hold function privilege surface is invalid.';
  END IF;

  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations
    WHERE (version, name) IN (
      ('20260930200000', 'guest_long_term_memory_account_scope'),
      ('20261003093000', 'residential_property_spatial_snapshots_v1'),
      ('20261003124500', 'booking_ops_auto_send_account_scope_v1'),
      ('20261003141500', 'booking_inbound_intake_account_scope_v1'),
      ('20261003150000', 'booking_availability_account_scope_v1')
    )
  ) <> 5 THEN
    RAISE EXCEPTION 'Supabase migration history does not contain all five Wave 5 core versions and names.';
  END IF;
END
$verify$;

SELECT
  (SELECT count(*) FROM public.guest_memory_profiles WHERE account_id IS NULL) AS legacy_guest_memory_profiles,
  (SELECT count(*) FROM public.guest_memory_preferences WHERE account_id IS NULL) AS legacy_guest_memory_preferences,
  (SELECT count(*) FROM public.booking_overbooking_conflict_checks WHERE account_id IS NULL) AS legacy_unbound_overbooking_checks;

SELECT 'WAVE5_CORE_SCHEMA_AND_HISTORY_VERIFICATION=passed' AS result;
