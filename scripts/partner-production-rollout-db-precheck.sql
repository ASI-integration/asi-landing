DO $precheck$
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'PARTNER_ROLLOUT_DB_PRECHECK=read_only_guard_failed';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'PARTNER_ROLLOUT_DB_PRECHECK=missing_migration_history';
  END IF;

  IF to_regclass('public.accounts') IS NULL
     OR to_regclass('public.properties') IS NULL
     OR to_regclass('public.booking_ops_records') IS NULL
     OR to_regclass('public.tg_property_knowledge') IS NULL
     OR to_regclass('public.booking_pricing_profiles') IS NULL
     OR EXISTS (
       SELECT 1
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname LIKE 'partner\_%' ESCAPE '\'
     )
     OR EXISTS (
       SELECT 1
       FROM supabase_migrations.schema_migrations
       WHERE version IN (
         '20260816144742',
         '20260815102111',
         '20260815130000',
         '20260815160000',
         '20260815190000',
         '20260815210000',
         '20260815230000'
       )
     ) THEN
    RAISE EXCEPTION 'PARTNER_ROLLOUT_DB_PRECHECK=blocked_schema_or_history_state';
  END IF;
END
$precheck$;

SELECT 'PARTNER_ROLLOUT_DB_PRECHECK=ready' AS result;
