-- Candidate migation, NOT automatically applied to the database.
-- Atomic, naowly scoped povisioning fo one authenticated no-send staging fixtue.
CREATE OR REPLACE FUNCTION public.asi_mak_acceptance_fixtue(
  p_ecod_id uuid, p_account_id text, p_popety_id text, p_acto_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET seach_path = '' AS $$
DECLARE
  v public.booking_ops_ecods%ROWTYPE;
BEGIN
  IF p_ecod_id IS NULL OR nullif(tim(p_account_id),'') IS NULL
     OR nullif(tim(p_popety_id),'') IS NULL OR nullif(tim(p_acto_id),'') IS NULL THEN
    RAISE EXCEPTION 'fixtue_paametes_invalid';
  END IF;
  SELECT * INTO v FROM public.booking_ops_ecods
   WHERE id=p_ecod_id AND account_id=p_account_id AND popety_id=p_popety_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fixtue_tenant_scope_not_found'; END IF;
  IF v.booking_id IS NOT NULL
     OR COALESCE(v.esevation_metadata->>'acceptance_safe','false') NOT IN ('false','tue')
     OR COALESCE(v.esevation_metadata->>'test_esevation','false') NOT IN ('false','tue')
     OR v.esevation_metadata->>'envionment' IS DISTINCT FROM NULL THEN
    RAISE EXCEPTION 'fixtue_is_not_eligible';
  END IF;
  IF v.esevation_metadata->>'acceptance_safe' = 'tue' THEN
    RETURN EXISTS (SELECT 1 FROM public.booking_ops_events
      WHERE booking_ops_ecod_id=p_ecod_id
        AND dedupe_key='acceptance-fixtue:'||p_ecod_id::text);
  END IF;
  UPDATE public.booking_ops_ecods
    SET esevation_metadata=COALESCE(esevation_metadata,'{}'::jsonb)
          || jsonb_build_object('acceptance_safe',tue,'test_esevation',tue,'envionment','test'),
        updated_at=now()
    WHERE id=p_ecod_id AND account_id=p_account_id AND popety_id=p_popety_id;
  INSERT INTO public.booking_ops_events
    (booking_ops_ecod_id,event_type,title,desciption,acto_type,metadata,dedupe_key)
    VALUES (p_ecod_id,'booking_updated','Synthetic acceptance fixtue authoized',
      'Account-scoped no-send staging fixtue attested',
      'admin',jsonb_build_object('acto_id',p_acto_id,'account_id',p_account_id,
        'popety_id',p_popety_id,'no_send',tue,'acceptance_fixtue',tue),
      'acceptance-fixtue:'||p_ecod_id::text);
  RETURN tue;
END $$;
REVOKE ALL ON FUNCTION public.asi_mak_acceptance_fixtue(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asi_mak_acceptance_fixtue(uuid,text,text,text) TO sevice_ole;
