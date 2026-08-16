\set ON_ERROR_STOP on
\pset tuples_only on
\pset pager off

BEGIN TRANSACTION READ ONLY;

SELECT current_setting('transaction_read_only') = 'on' AS read_only_guard \gset
\if :read_only_guard
\else
  \echo 'PARTNER_ROLLOUT_DB_PRECHECK=read_only_guard_failed'
  \quit 3
\endif

SELECT (
  to_regclass('public.accounts') IS NOT NULL
  AND to_regclass('public.properties') IS NOT NULL
  AND to_regclass('public.booking_ops_records') IS NOT NULL
  AND to_regclass('public.tg_property_knowledge') IS NOT NULL
  AND to_regclass('public.booking_pricing_profiles') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname LIKE 'partner\_%' ESCAPE '\'
  )
  AND NOT EXISTS (
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
  )
) AS rollout_ready \gset

\if :rollout_ready
  \echo 'PARTNER_ROLLOUT_DB_PRECHECK=ready'
\else
  \echo 'PARTNER_ROLLOUT_DB_PRECHECK=blocked_schema_or_history_state'
  \quit 4
\endif

ROLLBACK;
