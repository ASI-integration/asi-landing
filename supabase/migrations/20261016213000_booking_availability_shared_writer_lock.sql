-- Forward reconciliation of every existing atomic availability-hold writer.
-- Historical migrations and their rehearsal receipts remain immutable.
DO $guard$
BEGIN
  IF to_regprocedure('public.create_booking_availability_hold_atomic(uuid,text,uuid,text,date,date,timestamp with time zone,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.create_booking_availability_hold_atomic_account_v1(text,uuid,text,uuid,text,date,date,timestamp with time zone,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.reserve_canonical_availability_atomic(text,text,text,date,date,text,timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'availability_shared_writer_prerequisite_missing';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.create_booking_availability_hold_atomic(
  p_property_setup_id uuid,
  p_property_id text,
  p_booking_id uuid,
  p_source text,
  p_date_from date,
  p_date_to date,
  p_hold_expires_at timestamptz,
  p_safe_summary text,
  p_metadata jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_property_id text := nullif(btrim(p_property_id), '');
  v_setup_property_id text;
  v_account_id text;
BEGIN
  IF p_property_setup_id IS NOT NULL THEN
    SELECT nullif(btrim(s.property_id::text), '') INTO v_setup_property_id
      FROM public.booking_property_setup_profiles s
     WHERE s.id = p_property_setup_id;
    IF v_setup_property_id IS NULL THEN
      RAISE EXCEPTION 'property_scope_mismatch' USING ERRCODE = '42501';
    END IF;
    IF v_property_id IS NOT NULL AND v_property_id <> v_setup_property_id THEN
      RAISE EXCEPTION 'property_scope_mismatch' USING ERRCODE = '42501';
    END IF;
    v_property_id := v_setup_property_id;
  END IF;

  IF v_property_id IS NULL THEN
    RAISE EXCEPTION 'property_required' USING ERRCODE = '22023';
  END IF;
  SELECT nullif(btrim(p.account_id::text), '') INTO v_account_id
    FROM public.properties p
   WHERE p.id::text = v_property_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'property_scope_mismatch' USING ERRCODE = '42501';
  END IF;

  -- The delegate revalidates ownership/setup/booking, locks the canonical scope,
  -- and persists account lineage. No unscoped fallback or second insert path.
  RETURN public.create_booking_availability_hold_atomic_account_v1(
    v_account_id, p_property_setup_id, v_property_id, p_booking_id,
    p_source, p_date_from, p_date_to, p_hold_expires_at,
    p_safe_summary, p_metadata, p_idempotency_key
  );
END;
$$;


create or replace function public.reserve_canonical_availability_atomic(
  p_account_id text, p_property_id text, p_unit_id text, p_date_from date, p_date_to date,
  p_idempotency_key text, p_hold_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_hold_id uuid; v_conflicts jsonb;
begin
  if p_date_from >= p_date_to then raise exception 'invalid_date_range'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_account_id || ':property:' || p_property_id, 7411));
  select id into v_hold_id from public.booking_availability_holds where idempotency_key = p_idempotency_key;
  if v_hold_id is not null then return jsonb_build_object('ok', true, 'holdId', v_hold_id, 'duplicate', true); end if;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_conflicts from (
    select jsonb_build_object('kind','reservation','id',r.id,'reference',r.asi_reference,'dateFrom',r.check_in_at,'dateTo',r.check_out_at) item
    from public.booking_ops_records r where r.account_id=p_account_id and r.property_id=p_property_id and (p_unit_id is null or r.unit_id=p_unit_id)
      and r.normalized_status in ('confirmed','checked_in') and r.check_in_at < p_date_to and p_date_from < r.check_out_at
    union all
    select jsonb_build_object('kind','hold','id',h.id,'reference','Temporary hold','dateFrom',h.date_from,'dateTo',h.date_to)
    from public.booking_availability_holds h where h.account_id=p_account_id and h.property_id=p_property_id and (p_unit_id is null or h.unit_id is null or h.unit_id=p_unit_id)
      and h.status='active' and (h.hold_expires_at is null or h.hold_expires_at>now()) and h.date_from<p_date_to and p_date_from<h.date_to
    union all
    select jsonb_build_object('kind','block','id',b.id,'reference',case when b.block_type='maintenance' then 'Maintenance block' else 'Owner block' end,'dateFrom',b.date_from,'dateTo',b.date_to)
    from public.booking_availability_blocks b where b.account_id=p_account_id and b.property_id=p_property_id and (p_unit_id is null or b.unit_id is null or b.unit_id=p_unit_id)
      and b.status='active' and b.date_from<p_date_to and p_date_from<b.date_to
  ) conflicts;
  if jsonb_array_length(v_conflicts)>0 then return jsonb_build_object('ok',false,'conflicts',v_conflicts); end if;
  v_hold_id := gen_random_uuid();
  insert into public.booking_availability_holds(id,account_id,property_id,unit_id,source,status,date_from,date_to,hold_expires_at,conflict_status,idempotency_key,safe_summary)
  values(v_hold_id,p_account_id,p_property_id,p_unit_id,'booking_intake','active',p_date_from,p_date_to,p_hold_expires_at,'no_conflict',p_idempotency_key,'Canonical reservation hold');
  return jsonb_build_object('ok',true,'holdId',v_hold_id,'duplicate',false);
end $$;

-- Existing owner and EXECUTE ACLs are preserved by CREATE OR REPLACE.
NOTIFY pgrst, 'reload schema';
