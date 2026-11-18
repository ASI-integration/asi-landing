-- SOURCE-ONLY G2 acceptance fixture SQL candidate; DO NOT APPLY to shared DB.
-- The shared Supabase database has a working FOUR-argument function today.
-- This transaction intentionally removes that overload. Require an approved
-- administrator change window, a PRIVATE backup of pg_get_functiondef/ACL,
-- and isolated PostgreSQL integration tests before any DB modification.
-- Activation is an opt-in postgres-only transaction gate, not a staging check.
-- Never enable the dependent API until the migration and rollback are verified.
-- Allowed record/account/property IDs are mandatory UUID inputs supplied by
-- a staging-only, separately reviewed, server-side configuration.
-- Arguments themselves are NOT an independent trust boundary: only a
-- dedicated least-privilege database role and reviewed deployment can be.
-- The explicit owner pin prevents other records being selected by accident.
-- Verified in the connected shared DB: a UNIQUE index exists on
-- booking_ops_events(booking_ops_record_id, dedupe_key) for non-null dedupe keys;
-- combined with the booking_ops_records FOR UPDATE lock, it prevents duplicate
-- same-record acceptance audit insertions. Do not assume the index elsewhere.
BEGIN;
-- Explicit manual activation guard; evaluated before any destructive DDL.
DO $migration_gate$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('asi.acceptance_fixture_migration_authorized', true)
        IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'FIXTURE_MIGRATION_NOT_AUTHORIZED';
  END IF;
END $migration_gate$;
-- No CASCADE: abort transaction if the old RPC still has dependencies.
DROP FUNCTION IF EXISTS public.asi_mark_acceptance_fixture(uuid,text,text,text);
CREATE OR REPLACE FUNCTION public.asi_mark_acceptance_fixture(
  p_record_id uuid, p_account_id text, p_property_id text, p_actor_id text,
  p_allowed_record_id uuid, p_allowed_account_id uuid, p_allowed_property_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v public.booking_ops_records%ROWTYPE;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE';
  END IF;
  IF p_record_id IS NULL OR p_allowed_record_id IS NULL
     OR p_allowed_account_id IS NULL OR p_allowed_property_id IS NULL
     OR nullif(trim(p_account_id),'') IS NULL
     OR nullif(trim(p_property_id),'') IS NULL
     OR nullif(trim(p_actor_id),'') IS NULL THEN
    RAISE EXCEPTION 'fixture_parameters_invalid';
  END IF;
  -- Reject mismatched allowed/actual IDs BEFORE reading or writing a row.
  -- The target tenant columns are text in the current schema. Cast each to
  -- UUID only after checking it exists; invalid strings raise an exception.
  -- PostgreSQL UUID comparison is canonical and case/format independent.
  IF p_record_id IS DISTINCT FROM p_allowed_record_id
     OR p_account_id::uuid IS DISTINCT FROM p_allowed_account_id
     OR p_property_id::uuid IS DISTINCT FROM p_allowed_property_id THEN
    RAISE EXCEPTION 'fixture_record_not_owner_pinned';
  END IF;
  -- The receipt is only safe if the unique dedupe constraint is present.
  IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
      JOIN pg_catalog.pg_class tab ON tab.oid=i.indrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid=tab.relnamespace
      WHERE ns.nspname='public' AND tab.relname='booking_ops_events'
        AND idx.relname='idx_booking_ops_events_dedupe'
        AND i.indisunique AND i.indisvalid AND i.indisready
    ) THEN
    RAISE EXCEPTION 'fixture_dedupe_unique_index_required';
  END IF;
  SELECT * INTO v FROM public.booking_ops_records
    WHERE id=p_record_id AND account_id=p_account_id AND property_id=p_property_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fixture_tenant_scope_not_found'; END IF;

  -- Guard provenance: do not turn a live booking or contactable guest into a test.
  IF v.booking_id IS NOT NULL OR v.ota_source IS DISTINCT FROM 'manual'
     OR v.ops_status IS DISTINCT FROM 'created'
     OR v.guest_name IS NULL
     -- Explicit synthetic name prefix required for ALL calls, including
     -- idempotent ones. The real pinned record was read-only verified to match.
     OR btrim(v.guest_name) !~* '^ASI[[:space:]_-]+SYNTHETIC[[:space:]_-]+'
     OR nullif(trim(COALESCE(v.guest_email,'')),'') IS NOT NULL
     OR nullif(trim(COALESCE(v.guest_phone,'')),'') IS NOT NULL
     OR nullif(trim(COALESCE(v.guest_telegram,'')),'') IS NOT NULL
     OR v.documents_status IS DISTINCT FROM 'not_started'
     OR v.contract_status IS DISTINCT FROM 'not_started'
     OR v.checkin_readiness_status IS DISTINCT FROM 'not_started' THEN
    RAISE EXCEPTION 'fixture_provenance_not_verified';
  END IF;
  -- Idempotence is allowed ONLY for the exact owner-pinned synthetic record,
  -- with an exact metadata provenance marker and exact tenant-scoped audit.
  -- An already-marked record without complete proof must RAISE, not return false.
  IF v.reservation_metadata->>'acceptance_safe' = 'true' THEN
    IF v.reservation_metadata->>'test_reservation' IS DISTINCT FROM 'true'
       OR v.reservation_metadata->>'environment' IS DISTINCT FROM 'test'
       OR v.reservation_metadata->>'acceptance_source'
            IS DISTINCT FROM 'owner_scoped_staging_fixture'
       OR NOT EXISTS (SELECT 1 FROM public.booking_ops_events
         WHERE booking_ops_record_id=p_record_id
           AND dedupe_key='acceptance-fixture:'||p_record_id::text
           AND metadata->>'no_send'='true'
           AND metadata->>'synthetic_only'='true'
           AND metadata->>'account_id'=p_account_id
           AND metadata->>'property_id'=p_property_id) THEN
      RAISE EXCEPTION 'fixture_existing_provenance_or_audit_invalid';
    END IF;
    RETURN true;
  END IF;
  -- New marking requires the exact synthetic fixture label, in addition to
  -- the explicit ASI SYNTHETIC prefix already checked above.
  IF btrim(v.guest_name) !~*
     '^ASI[[:space:]_-]+SYNTHETIC[[:space:]]+ACCEPTANCE[[:space:]]+FIXTURE$' THEN
    RAISE EXCEPTION 'fixture_new_record_requires_exact_synthetic_label';
  END IF;
  IF COALESCE(v.reservation_metadata, '{}'::jsonb) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'fixture_has_preexisting_metadata';
  END IF;
  IF EXISTS (SELECT 1 FROM public.booking_ops_events
    WHERE booking_ops_record_id=p_record_id
      AND dedupe_key='acceptance-fixture:'||p_record_id::text) THEN
    RAISE EXCEPTION 'fixture_audit_already_exists';
  END IF;

  -- All checks above completed before ANY write; the row remains FOR UPDATE
  -- locked through the metadata update + same-transaction audit insert.
  UPDATE public.booking_ops_records
  SET reservation_metadata=jsonb_build_object(
      'acceptance_safe',true,'test_reservation',true,'environment','test',
      'acceptance_source','owner_scoped_staging_fixture'),
      updated_at=now()
  WHERE id=p_record_id AND account_id=p_account_id AND property_id=p_property_id;
  INSERT INTO public.booking_ops_events
    (booking_ops_record_id,event_type,title,description,actor_type,metadata,dedupe_key)
  VALUES (p_record_id,'booking_updated','Synthetic acceptance fixture authorized',
    'Account-scoped staging only; external transports disabled',
    'admin',jsonb_build_object('actor_id',p_actor_id,'account_id',p_account_id,
      'property_id',p_property_id,'no_send',true,'synthetic_only',true),
    'acceptance-fixture:'||p_record_id::text);
  RETURN true;
END $$;
-- Default PUBLIC EXECUTE must be revoked before commit.
REVOKE ALL ON FUNCTION public.asi_mark_acceptance_fixture(uuid,text,text,text,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asi_mark_acceptance_fixture(uuid,text,text,text,uuid,uuid,uuid)
  TO service_role;
COMMIT;
