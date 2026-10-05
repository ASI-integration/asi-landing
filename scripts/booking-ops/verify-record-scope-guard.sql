\set ON_ERROR_STOP on

-- Disposable PostgreSQL verification for:
-- supabase/migrations/20261005090000_booking_ops_record_scope_guard_v1.sql
--
-- Safety boundary: this script refuses to run unless the database has the
-- exact disposable name below. It creates/drops public test tables and must
-- never be pointed at a normal development, staging, or production database.

DO $$
BEGIN
  IF current_database() <> 'asi_wave5_scope_guard_test' THEN
    RAISE EXCEPTION
      'refusing scope-guard fixture in database %, expected asi_wave5_scope_guard_test',
      current_database();
  END IF;
END;
$$;

BEGIN;

-- Supabase migrations grant trigger-function execution to service_role. A plain
-- disposable PostgreSQL cluster does not have that role, so create it only for
-- this transaction when absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'CREATE ROLE service_role NOLOGIN';
  END IF;
END;
$$;

DROP TABLE IF EXISTS public.booking_ops_records CASCADE;
DROP TABLE IF EXISTS public.properties CASCADE;
DROP TABLE IF EXISTS public.accounts CASCADE;

CREATE TABLE public.accounts (
  id UUID PRIMARY KEY
);

CREATE TABLE public.properties (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE
);

-- Reproduce the legacy-evolved scope types that make a composite FK unsafe:
-- Booking Ops scope columns are TEXT while canonical account/property ids are UUID.
CREATE TABLE public.booking_ops_records (
  id UUID PRIMARY KEY,
  account_id TEXT,
  property_id TEXT,
  notes TEXT
);

INSERT INTO public.accounts(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

INSERT INTO public.properties(id, account_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222');

-- Representative legacy rows already present before migration.
INSERT INTO public.booking_ops_records(id, account_id, property_id, notes) VALUES
  ('00000000-0000-4000-8000-000000000001', NULL, NULL, 'accountless legacy'),
  ('00000000-0000-4000-8000-000000000002', 'legacy', 'free-form-legacy-property', 'legacy account'),
  ('00000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', NULL, 'property-unbound review');

-- Upgrade must succeed over representative legacy rows.
\ir ../../supabase/migrations/20261005090000_booking_ops_record_scope_guard_v1.sql

-- Retry/idempotency: applying the same migration a second time must succeed.
\ir ../../supabase/migrations/20261005090000_booking_ops_record_scope_guard_v1.sql

-- Canonical pair is accepted.
INSERT INTO public.booking_ops_records(id, account_id, property_id, notes) VALUES (
  '00000000-0000-4000-8000-000000000010',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'canonical'
);

-- Accountless, legacy, and property-unbound review inserts remain accepted.
INSERT INTO public.booking_ops_records(id, account_id, property_id, notes) VALUES
  ('00000000-0000-4000-8000-000000000011', NULL, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'accountless'),
  ('00000000-0000-4000-8000-000000000012', 'legacy', 'free-form-legacy-property', 'legacy'),
  ('00000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', NULL, 'review');

-- Same property with the wrong account must fail with the migration's check code.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.booking_ops_records(id, account_id, property_id, notes) VALUES (
      '00000000-0000-4000-8000-000000000020',
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'foreign property'
    );
    RAISE EXCEPTION 'expected foreign-property insert to fail';
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'booking_ops_record_scope_mismatch' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Unknown property must fail closed as well.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.booking_ops_records(id, account_id, property_id, notes) VALUES (
      '00000000-0000-4000-8000-000000000021',
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'unknown property'
    );
    RAISE EXCEPTION 'expected unknown-property insert to fail';
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'booking_ops_record_scope_mismatch' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.booking_ops_records;
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'unexpected surviving row count %, expected 7', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_ops_records
    WHERE id IN (
      '00000000-0000-4000-8000-000000000020'::uuid,
      '00000000-0000-4000-8000-000000000021'::uuid
    )
  ) THEN
    RAISE EXCEPTION 'rejected scope rows unexpectedly persisted';
  END IF;
END;
$$;

ROLLBACK;

\echo 'BOOKING_OPS_RECORD_SCOPE_GUARD_FIXTURE_PASS'
