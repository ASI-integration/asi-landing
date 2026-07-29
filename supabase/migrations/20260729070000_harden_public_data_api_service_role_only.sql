-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: harden the public Data API for the current server-only architecture
--
-- Current ASI application code accesses Supabase only from the server with
-- SUPABASE_SERVICE_ROLE_KEY. No table in public is intended for direct anon or
-- authenticated browser access.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      r.schema_name,
      r.table_name
    );

    EXECUTE format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
      r.schema_name,
      r.table_name
    );

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM anon, authenticated',
      r.schema_name,
      r.table_name
    );

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC',
      r.schema_name,
      r.table_name
    );

    -- Make server-only intent explicit and remove the Security Advisor
    -- "RLS enabled, no policy" finding without replacing existing narrower
    -- service-role policies.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy p
      WHERE p.polrelid = r.oid
    ) THEN
      EXECUTE format(
        'CREATE POLICY service_role_full_access ON %I.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        r.schema_name,
        r.table_name
      );
    END IF;
  END LOOP;
END
$$;

-- This policy was created for a historical browser-client design. Current auth
-- and billing APIs use the server-side service-role client.
DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    DROP POLICY IF EXISTS users_select_own_subscription ON public.subscriptions;
  END IF;
END
$$;

-- Public roles must not retain sequence access either.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS sequence_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM anon, authenticated',
      r.schema_name,
      r.sequence_name
    );

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM PUBLIC',
      r.schema_name,
      r.sequence_name
    );
  END LOOP;
END
$$;

-- The subscriptions helper must use the caller's permissions and underlying
-- RLS rather than the view owner's privileges.
DO $$
BEGIN
  IF to_regclass('public.active_subscriptions') IS NOT NULL THEN
    ALTER VIEW public.active_subscriptions SET (security_invoker = true);
    REVOKE ALL PRIVILEGES ON TABLE public.active_subscriptions FROM anon, authenticated;
    REVOKE ALL PRIVILEGES ON TABLE public.active_subscriptions FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON TABLE public.active_subscriptions FROM service_role;
    GRANT SELECT ON TABLE public.active_subscriptions TO service_role;
  END IF;
END
$$;

-- Pin trigger-function lookup paths and remove direct public execution.
DO $$
DECLARE
  function_name text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'set_updated_at_location_report_requests',
    'set_updated_at_location_report_artifacts',
    'set_updated_at_location_report_deliveries',
    'set_updated_at_location_report_access_entitlements',
    'set_updated_at_asi_runtime_snapshots'
  ]
  LOOP
    IF to_regprocedure(format('public.%I()', function_name)) IS NOT NULL THEN
      EXECUTE format(
        'ALTER FUNCTION public.%I() SET search_path = pg_catalog',
        function_name
      );

      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated',
        function_name
      );
    END IF;
  END LOOP;
END
$$;
