-- Source only; NOT APPLIED. Requires 20260619000001_crm_early_access_v1.sql.
-- SECURITY INVOKER uses the existing trusted server service_role, never an
-- anonymous credential. No security-definer elevation or public receipt table.
BEGIN;

CREATE SCHEMA public_lead_private;
REVOKE ALL ON SCHEMA public_lead_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public_lead_private TO service_role;

CREATE TABLE public_lead_private.admission_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  key_commitment text CHECK (key_commitment ~ '^[0-9a-f]{64}$'),
  total_created integer NOT NULL DEFAULT 0 CHECK (total_created BETWEEN 0 AND 100000),
  last_seen_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO public_lead_private.admission_state(singleton) VALUES (true);

CREATE TABLE public_lead_private.consent_receipts (
  crm_id uuid PRIMARY KEY REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  contact_digest text NOT NULL CHECK (contact_digest ~ '^[0-9a-f]{64}$'),
  submission_digest text NOT NULL CHECK (submission_digest ~ '^[0-9a-f]{64}$'),
  consent_accepted boolean NOT NULL CHECK (consent_accepted),
  consented_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source = 'form'),
  referral text NOT NULL CHECK (referral IN ('site', 'strigunov')),
  policy_id text NOT NULL CHECK (policy_id = '/ru/privacy'),
  policy_version text NOT NULL,
  policy_source_sha256 text NOT NULL CHECK (policy_source_sha256 ~ '^[0-9a-f]{64}$'),
  policy_content_sha256 text NOT NULL CHECK (policy_content_sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE (submission_digest, consented_at)
);
CREATE INDEX public_lead_receipt_contact_time
  ON public_lead_private.consent_receipts(contact_digest, consented_at DESC);
CREATE INDEX public_lead_receipt_time
  ON public_lead_private.consent_receipts(consented_at DESC);

ALTER TABLE public_lead_private.admission_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_lead_private.admission_state FORCE ROW LEVEL SECURITY;
ALTER TABLE public_lead_private.consent_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_lead_private.consent_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY service_admission_state ON public_lead_private.admission_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_consent_receipts ON public_lead_private.consent_receipts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public_lead_private.admission_state,
  public_lead_private.consent_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON public_lead_private.admission_state TO service_role;
GRANT SELECT, INSERT ON public_lead_private.consent_receipts TO service_role;

CREATE FUNCTION public.admit_public_pilot_lead_v1(
  p_key_commitment text,
  p_contact_digest text,
  p_submission_digest text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '2s'
AS $function$
DECLARE
  v_state public_lead_private.admission_state%ROWTYPE;
  v_now timestamptz;
  v_crm_id uuid;
  v_global integer;
  v_contact integer;
  v_global_oldest timestamptz;
  v_contact_oldest timestamptz;
  v_retry integer := 1;
BEGIN
  -- SQL boundary is also fail closed. Only the server adapter may issue these
  -- arguments; browser fields are normalized/allowlisted before signing.
  IF (
    p_key_commitment ~ '^[0-9a-f]{64}$'
    AND p_contact_digest ~ '^[0-9a-f]{64}$'
    AND p_submission_digest ~ '^[0-9a-f]{64}$'
    AND pg_catalog.jsonb_typeof(p_payload) = 'object'
    AND pg_catalog.octet_length(p_payload::text) <= 4096
    AND p_payload->'consent' = 'true'::jsonb
    AND p_payload->>'policy_id' = '/ru/privacy'
    AND p_payload->>'policy_version' = 'ru-privacy-20261009-v1'
    AND p_payload->>'policy_source_sha256' =
      '85cba6292d2d0bc5e82c1c2777a3dfa23b2b193ee8904639bf0d0717e9961978'
    AND p_payload->>'policy_content_sha256' ~ '^[0-9a-f]{64}$'
    AND p_payload->>'referral' IN ('site', 'strigunov')
    AND pg_catalog.jsonb_typeof(p_payload->'name') = 'string'
    AND pg_catalog.length(p_payload->>'name') BETWEEN 1 AND 160
    AND p_payload->>'name' !~ '[[:cntrl:]]'
    AND p_payload->>'contact_kind' IN ('telegram', 'email', 'phone')
    AND pg_catalog.length(p_payload->>'contact_value') BETWEEN 1 AND 100
    AND p_payload->>'contact_value' !~ '[[:cntrl:]]'
    AND p_payload->>'objects_count' IN ('1', '2', '6', '11', '21')
    AND pg_catalog.jsonb_typeof(p_payload->'note') = 'string'
    AND pg_catalog.length(p_payload->>'note') BETWEEN 1 AND 2000
    AND pg_catalog.jsonb_typeof(p_payload->'next_step') = 'string'
    AND pg_catalog.length(p_payload->>'next_step') BETWEEN 1 AND 500
    AND (p_payload - ARRAY['name', 'contact_kind', 'contact_value', 'objects_count',
      'note', 'next_step', 'referral', 'consent', 'policy_id', 'policy_version',
      'policy_source_sha256', 'policy_content_sha256']::text[]) = '{}'::jsonb
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid public lead admission';
  END IF;

  -- One deterministic serialization point for ALL workers. Counts, replay
  -- lookup, CRM insert and receipt insert run while this row remains locked.
  -- State is updated every transaction so stronger isolation errors fail closed.
  SELECT * INTO STRICT v_state FROM public_lead_private.admission_state
    WHERE singleton = true FOR UPDATE;
  IF v_state.key_commitment IS NOT NULL AND
     v_state.key_commitment <> p_key_commitment THEN
    RAISE EXCEPTION 'public lead issuer mismatch';
  END IF;
  -- Read trusted database clock AFTER waiting; clamp backwards clock movement.
  v_now := GREATEST(pg_catalog.clock_timestamp(), v_state.last_seen_at);
  UPDATE public_lead_private.admission_state
    SET key_commitment = p_key_commitment, last_seen_at = v_now
    WHERE singleton = true;

  -- JOIN + key-share lock proves the CRM row still exists, not merely a cached
  -- promise. Deletion cascades the receipt; replay never resurrects deleted PII.
  SELECT c.id INTO v_crm_id
    FROM public_lead_private.consent_receipts r
    JOIN public.crm_contacts c ON c.id = r.crm_id
    WHERE r.submission_digest = p_submission_digest
      AND r.contact_digest = p_contact_digest
      AND r.policy_content_sha256 = p_payload->>'policy_content_sha256'
      AND r.consented_at > v_now - interval '10 minutes'
    ORDER BY r.consented_at DESC LIMIT 1 FOR KEY SHARE OF c;
  IF v_crm_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('protocol', 'public-lead-v1',
      'status', 'replayed', 'persisted', true, 'crm_id', v_crm_id,
      'submission_digest', p_submission_digest);
  END IF;

  -- Rolling windows for persisted NEW admissions. Replays consume no new quota;
  -- failed transactions consume no quota and cannot leave a false success.
  SELECT count(*), min(consented_at) INTO v_global, v_global_oldest
    FROM public_lead_private.consent_receipts
    WHERE consented_at > v_now - interval '60 seconds';
  SELECT count(*), min(consented_at) INTO v_contact, v_contact_oldest
    FROM public_lead_private.consent_receipts
    WHERE contact_digest = p_contact_digest
      AND consented_at > v_now - interval '60 minutes';
  IF v_global >= 150 OR v_contact >= 3 THEN
    IF v_global >= 150 THEN
      v_retry := GREATEST(v_retry,
        CEIL(EXTRACT(EPOCH FROM v_global_oldest + interval '60 seconds' - v_now))::integer);
    END IF;
    IF v_contact >= 3 THEN
      v_retry := GREATEST(v_retry,
        CEIL(EXTRACT(EPOCH FROM v_contact_oldest + interval '60 minutes' - v_now))::integer);
    END IF;
    RETURN pg_catalog.jsonb_build_object('protocol', 'public-lead-v1',
      'status', 'rate_limited', 'retry_after_seconds', LEAST(3600, v_retry));
  END IF;
  -- Hard storage bound pending separately reviewed retention operations.
  -- Never delete receipts or old CRM data as an admission side effect.
  IF v_state.total_created >= 100000 THEN
    RAISE EXCEPTION 'public lead capacity hold';
  END IF;

  INSERT INTO public.crm_contacts(
    name, contact, phone, telegram_username, email, role, source,
    property_count, notes, status, communication_status, next_action
  ) VALUES (
    p_payload->>'name', p_payload->>'contact_value',
    CASE WHEN p_payload->>'contact_kind' = 'phone' THEN p_payload->>'contact_value' END,
    CASE WHEN p_payload->>'contact_kind' = 'telegram' THEN p_payload->>'contact_value' END,
    CASE WHEN p_payload->>'contact_kind' = 'email' THEN p_payload->>'contact_value' END,
    'owner', 'form', (p_payload->>'objects_count')::integer,
    p_payload->>'note', 'new', 'needs_manual_reaction', p_payload->>'next_step'
  ) RETURNING id INTO STRICT v_crm_id;
  INSERT INTO public_lead_private.consent_receipts(
    crm_id, contact_digest, submission_digest, consent_accepted, consented_at,
    source, referral, policy_id, policy_version, policy_source_sha256, policy_content_sha256
  ) VALUES (
    v_crm_id, p_contact_digest, p_submission_digest, true, v_now,
    'form', p_payload->>'referral', p_payload->>'policy_id', p_payload->>'policy_version',
    p_payload->>'policy_source_sha256', p_payload->>'policy_content_sha256'
  );
  UPDATE public_lead_private.admission_state SET total_created = total_created + 1
    WHERE singleton = true;
  RETURN pg_catalog.jsonb_build_object('protocol', 'public-lead-v1',
    'status', 'created', 'persisted', true, 'crm_id', v_crm_id,
    'submission_digest', p_submission_digest);
  -- No exception handler: any error rolls back CRM, receipt and state together.
END;
$function$;
REVOKE ALL ON FUNCTION public.admit_public_pilot_lead_v1(text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_public_pilot_lead_v1(text, text, text, jsonb)
  TO service_role;
COMMIT;
