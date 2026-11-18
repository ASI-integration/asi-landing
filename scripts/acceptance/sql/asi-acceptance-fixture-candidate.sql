-- SOURCE CANDIDATE ONLY: this is NOT permission to reapply the SQL to the
-- SHARED Supabase database. Read-only inspection on 2026-11-18 confirms the
-- original function already exists and the exact fixture was already marked
-- with one no-send audit event. Verify current DB definition independently.
-- Do not invoke the RPC or enable the API until DB/security review and rollback.
-- The function is SECURITY INVOKER; only the server-side service_role can EXECUTE.
-- Because service_role bypasses RLS, the API must separately prove admin access,
-- exact record/account/property scope, and all staging no-send flags.
-- The record pin intentionally prevents modifying arbitrary booking records.
-- Verified in the connected shared DB: a UNIQUE index exists on
-- booking_ops_events(booking_ops_record_id, dedupe_key) for non-null dedupe keys;
-- combined with the booking_ops_records FOR UPDATE lock, it prevents duplicate
-- same-record acceptance audit insertions. Do not assume the index elsewhere.
BEGIN;
CREATE OR REPLACE FUNCTION public.asi_mark_acceptance_fixture(
  p_record_id uuid, p_account_id text, p_property_id text, p_actor_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v public.booking_ops_records%ROWTYPE;
BEGIN
  IF p_record_id IS NULL OR nullif(trim(p_account_id),'') IS NULL
     OR nullif(trim(p_property_id),'') IS NULL OR nullif(trim(p_actor_id),'') IS NULL THEN
    RAISE EXCEPTION 'fixture_parameters_invalid';
  END IF;
  -- This RPC is intentionally scoped to the single owner-selected synthetic record.
  -- It cannot be used as a generic backdoor for marking other tenant bookings.
  IF p_record_id IS DISTINCT FROM '5477f7dd-2d60-4a3d-9212-c74e8d36119e'::uuid
     OR p_account_id IS DISTINCT FROM '9623421a-3b3d-4331-b126-8ca63c5611f1'
     OR p_property_id IS DISTINCT FROM '0bc3d3dd-678c-4d42-b1a1-d9cce39d53ac' THEN
    RAISE EXCEPTION 'fixture_record_not_owner_pinned';
  END IF;
  SELECT * INTO v FROM public.booking_ops_records
    WHERE id=p_record_id AND account_id=p_account_id AND property_id=p_property_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fixture_tenant_scope_not_found'; END IF;

  -- Guard provenance: do not turn a live booking or contactable guest into a test.
  IF v.booking_id IS NOT NULL OR v.ota_source IS DISTINCT FROM 'manual'
     OR v.ops_status IS DISTINCT FROM 'created'
     OR v.guest_name IS NULL
     OR nullif(trim(COALESCE(v.guest_email,'')),'') IS NOT NULL
     OR nullif(trim(COALESCE(v.guest_phone,'')),'') IS NOT NULL
     OR nullif(trim(COALESCE(v.guest_telegram,'')),'') IS NOT NULL
     OR v.documents_status IS DISTINCT FROM 'not_started'
     OR v.contract_status IS DISTINCT FROM 'not_started'
     OR v.checkin_readiness_status IS DISTINCT FROM 'not_started' THEN
    RAISE EXCEPTION 'fixture_provenance_not_verified';
  END IF;
  IF v.reservation_metadata->>'acceptance_safe' = 'true' THEN
    RETURN EXISTS (SELECT 1 FROM public.booking_ops_events
      WHERE booking_ops_record_id=p_record_id
        AND dedupe_key='acceptance-fixture:'||p_record_id::text
        AND metadata->>'no_send'='true');
  END IF;
  -- Existing single-row acceptance evidence is idempotent only when the
  -- exact no-send audit receipt is present (checked above). New marking is
  -- stricter: a prefix like "Test User - Real Booking" is never sufficient.
  IF btrim(v.guest_name) !~*
     '^(asi[[:space:]]+synthetic[[:space:]]+acceptance[[:space:]]+fixture|synthetic[[:space:]]+acceptance[[:space:]]+fixture)$' THEN
    RAISE EXCEPTION 'fixture_provenance_not_verified';
  END IF;
  IF COALESCE(v.reservation_metadata, '{}'::jsonb) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'fixture_has_preexisting_metadata';
  END IF;
  IF EXISTS (SELECT 1 FROM public.booking_ops_events
    WHERE booking_ops_record_id=p_record_id
      AND dedupe_key='acceptance-fixture:'||p_record_id::text) THEN
    RAISE EXCEPTION 'fixture_audit_already_exists';
  END IF;

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
REVOKE ALL ON FUNCTION public.asi_mark_acceptance_fixture(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asi_mark_acceptance_fixture(uuid,text,text,text)
  TO service_role;
COMMIT;
