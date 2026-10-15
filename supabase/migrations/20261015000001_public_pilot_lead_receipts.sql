-- Public lead replay must survive API process restarts. Isolated CI only until owner rollout.
-- No backfill: pre-existing CRM contacts are untouched. Receipt is internal and cascades on CRM deletion.
CREATE TABLE public.public_pilot_lead_receipts (
  fingerprint text PRIMARY KEY CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  contact_id uuid NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX public_pilot_lead_receipts_expiry_idx ON public.public_pilot_lead_receipts(expires_at);
ALTER TABLE public.public_pilot_lead_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_pilot_lead_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON public.public_pilot_lead_receipts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
REVOKE ALL ON public.public_pilot_lead_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_pilot_lead_receipts TO service_role;

CREATE FUNCTION public.persist_public_pilot_lead(p_lead jsonb)
RETURNS TABLE(contact_id uuid, replayed boolean, expires_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
DECLARE
  key text;
  found_id uuid;
  receipt_expiry timestamptz;
  row_input public.crm_contacts;
BEGIN
  IF jsonb_typeof(p_lead) IS DISTINCT FROM 'object' OR octet_length(p_lead::text) > 8192
    OR p_lead->>'role' IS DISTINCT FROM 'owner' OR p_lead->>'source' IS DISTINCT FROM 'form'
    OR coalesce(length(p_lead->>'name'),0) NOT BETWEEN 1 AND 160
    OR coalesce(length(p_lead->>'contact'),0) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'invalid_public_lead' USING ERRCODE = '22023'; END IF;
  -- Derive key inside the trusted SQL boundary from canonical JSONB, never caller supplied.
  key := encode(sha256(convert_to(lower(p_lead::text), 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('public_pilot_lead:' || key, 0));
  SELECT r.contact_id,r.expires_at INTO found_id,receipt_expiry FROM public.public_pilot_lead_receipts r
    WHERE r.fingerprint = key AND r.expires_at > clock_timestamp();
  IF found_id IS NOT NULL THEN RETURN QUERY SELECT found_id, true, receipt_expiry; RETURN; END IF;
  row_input := jsonb_populate_record(NULL::public.crm_contacts, p_lead);
  INSERT INTO public.crm_contacts
    (name,contact,phone,telegram_username,email,role,source,property_count,city,notes,status,
     communication_status,last_activity_at,next_action,next_action_due_at)
  VALUES (row_input.name,row_input.contact,row_input.phone,row_input.telegram_username,row_input.email,
    row_input.role,row_input.source,row_input.property_count,row_input.city,row_input.notes,row_input.status,
    row_input.communication_status,row_input.last_activity_at,row_input.next_action,row_input.next_action_due_at)
  RETURNING id INTO found_id;
  receipt_expiry := clock_timestamp() + interval '10 minutes';
  INSERT INTO public.public_pilot_lead_receipts(fingerprint,contact_id,expires_at)
    VALUES(key,found_id,receipt_expiry)
    ON CONFLICT(fingerprint) DO UPDATE SET contact_id=EXCLUDED.contact_id,expires_at=EXCLUDED.expires_at;
  -- Bounded opportunistic retention; avoids a growing anonymous receipt log or a global DELETE.
  DELETE FROM public.public_pilot_lead_receipts WHERE fingerprint IN (
    SELECT r.fingerprint FROM public.public_pilot_lead_receipts r
    WHERE r.expires_at < clock_timestamp() - interval '1 day'
    ORDER BY r.expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  RETURN QUERY SELECT found_id, false, receipt_expiry;
END;
$$;
REVOKE ALL ON FUNCTION public.persist_public_pilot_lead(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_public_pilot_lead(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
