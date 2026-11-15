-- V17 customer change receipts: one transaction for verification, internal application and audit.
-- Does not dispatch messages, update canonical properties, prices, calendars or external PMS APIs.
CREATE TABLE public.ops_v17_owner_change_receipts (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES public.ops_v17_onboardings(account_id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  section text NOT NULL CHECK (section IN ('business','owner','operations')),
  requested_values jsonb NOT NULL,
  before_values jsonb NOT NULL,
  applied_values jsonb,
  status text NOT NULL CHECK (status IN ('applied_internal','conflict')),
  external_status text NOT NULL CHECK (external_status IN ('not_required','awaiting_verified_adapter')),
  explanation text NOT NULL,
  verified_at timestamptz,
  applied_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ops_v17_owner_change_receipts_account_time_idx
  ON public.ops_v17_owner_change_receipts(account_id, created_at DESC);

ALTER TABLE public.ops_v17_owner_change_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ops_v17_owner_change_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.ops_v17_owner_change_receipts TO service_role;

CREATE FUNCTION public.apply_ops_v17_owner_change(
  p_account_id text,
  p_actor_id text,
  p_request_id uuid,
  p_section text,
  p_values jsonb,
  p_expected jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_onboarding_id uuid;
  v_data jsonb;
  v_previous jsonb;
  v_applied jsonb;
  v_confirmed jsonb;
  v_receipt public.ops_v17_owner_change_receipts%ROWTYPE;
  v_external text;
  v_explanation text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF current_user <> 'service_role'
     OR p_account_id IS NULL OR length(p_account_id) < 1
     OR p_actor_id IS NULL OR length(p_actor_id) < 1
     OR p_section NOT IN ('business','owner','operations')
     OR jsonb_typeof(p_values) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
     OR octet_length(p_values::text) > 5000
     OR octet_length(p_expected::text) > 8000 THEN
    RAISE EXCEPTION 'invalid_or_unauthorized_change' USING ERRCODE='22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_values) item
    WHERE jsonb_typeof(item.value) <> 'string'
       OR length(item.value #>> '{}') > 2000
       OR NOT (
         (p_section = 'business' AND item.key IN ('name','legalName'))
         OR (p_section = 'owner' AND item.key IN ('name','phone','email'))
         OR (p_section = 'operations' AND item.key IN (
           'checkInTime','checkOutTime','cleaningRule','linenRule','inspectionRule','maintenanceRule'
         ))
       )
  ) OR p_values = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_change_fields' USING ERRCODE='22023';
  END IF;

  -- Create a minimal owner intake row when no prior onboarding exists. The
  -- account id is authenticated and server-derived; no canonical property is fabricated.
  INSERT INTO public.ops_v17_onboardings (id, account_id, current_step, data, progress)
  VALUES (pg_catalog.gen_random_uuid(), p_account_id, 'business', '{}'::jsonb, 0)
  ON CONFLICT (account_id) DO NOTHING;

  -- The account row is the serialization/ownership boundary; no client-selected account is trusted by the API.
  SELECT id, data INTO v_onboarding_id, v_data
  FROM public.ops_v17_onboardings
  WHERE account_id = p_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','setup_required','requestId',p_request_id);
  END IF;

  SELECT * INTO v_receipt
  FROM public.ops_v17_owner_change_receipts
  WHERE id = p_request_id;
  IF FOUND THEN
    IF v_receipt.account_id <> p_account_id
       OR v_receipt.section <> p_section
       OR v_receipt.actor_id <> p_actor_id
       OR v_receipt.requested_values <> p_values THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object(
      'requestId', v_receipt.id, 'status',v_receipt.status,
      'externalStatus',v_receipt.external_status, 'explanation',v_receipt.explanation,
      'replayed', true
    );
  END IF;

  v_previous := coalesce(v_data -> p_section, '{}'::jsonb);
  IF v_previous <> p_expected THEN
    INSERT INTO public.ops_v17_owner_change_receipts (
      id, account_id, actor_id, section, requested_values, before_values,
      status, external_status, explanation, verified_at
    ) VALUES (
      p_request_id, p_account_id, p_actor_id, p_section, p_values, v_previous,
      'conflict', 'not_required', 'Данные были изменены в другой сессии. Перезагрузите раздел.', v_now
    );
    RETURN jsonb_build_object(
      'requestId', p_request_id, 'status','conflict', 'externalStatus','not_required',
      'explanation','Данные изменились. Обновите раздел и повторите сохранение.'
    );
  END IF;

  v_applied := v_previous || p_values;
  v_external := CASE WHEN p_section = 'operations' THEN 'awaiting_verified_adapter' ELSE 'not_required' END;
  v_explanation := CASE WHEN p_section = 'operations'
    THEN 'Внутренние правила ASI обновлены. Изменения подключённых сервисов не отправлялись и требуют проверенного адаптера.'
    ELSE 'Данные анкеты ASI сохранены и подтверждены; внешние сервисы не затронуты.'
  END;

  UPDATE public.ops_v17_onboardings
  SET data = jsonb_set(coalesce(data,'{}'::jsonb), ARRAY[p_section], v_applied, true),
      updated_at = v_now
  WHERE id = v_onboarding_id
  RETURNING data -> p_section INTO v_confirmed;

  IF v_confirmed IS DISTINCT FROM v_applied THEN
    RAISE EXCEPTION 'change_readback_failed';
  END IF;

  INSERT INTO public.ops_v17_owner_change_receipts (
    id, account_id, actor_id, section, requested_values, before_values, applied_values,
    status, external_status, explanation, verified_at, applied_at, confirmed_at
  ) VALUES (
    p_request_id, p_account_id, p_actor_id, p_section, p_values, v_previous, v_confirmed,
    'applied_internal', v_external, v_explanation, v_now, v_now, v_now
  );

  INSERT INTO public.ops_v17_audit_log(id,onboarding_id,action,actor_id,detail)
  VALUES (
    pg_catalog.gen_random_uuid(), v_onboarding_id, 'owner_change_verified_applied',
    p_actor_id, jsonb_build_object('requestId', p_request_id, 'section', p_section,
      'status', 'applied_internal', 'externalStatus', v_external)
  );

  RETURN jsonb_build_object(
    'requestId',p_request_id, 'status','applied_internal',
    'externalStatus',v_external, 'explanation',v_explanation, 'replayed',false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.apply_ops_v17_owner_change(text,text,uuid,text,jsonb,jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ops_v17_owner_change(text,text,uuid,text,jsonb,jsonb)
TO service_role;
