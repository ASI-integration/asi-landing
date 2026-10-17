create or replace function public.reserve_canonical_availability_atomic(
  p_account_id text, p_property_id text, p_unit_id text, p_date_from date, p_date_to date,
  p_idempotency_key text, p_hold_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_hold_id uuid; v_conflicts jsonb;
begin
  if p_date_from >= p_date_to then raise exception 'invalid_date_range'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_account_id || ':' || p_property_id || ':' || coalesce(p_unit_id, '*'), 0));
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
revoke all on function public.reserve_canonical_availability_atomic(text,text,text,date,date,text,timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_canonical_availability_atomic(text,text,text,date,date,text,timestamptz) to service_role;

