-- Wave 5: canonical account scope for availability/overbooking runtime.
-- Prepared only; do not apply from this worktree.

alter table public.booking_overbooking_conflict_checks
  add column if not exists account_id text;

create index if not exists booking_overbooking_checks_account_scope_idx
  on public.booking_overbooking_conflict_checks(account_id, property_id, created_at desc);

update public.booking_availability_holds h
set account_id = r.account_id
from public.booking_ops_records r
where h.account_id is null and h.booking_id = r.id and r.account_id is not null;

update public.booking_availability_holds h
set account_id = p.account_id::text
from public.properties p
where h.account_id is null and h.property_id = p.id::text and p.account_id is not null;

update public.booking_availability_blocks b
set account_id = p.account_id::text
from public.properties p
where b.account_id is null and b.property_id = p.id::text and p.account_id is not null;

update public.booking_overbooking_conflict_checks c
set account_id = r.account_id
from public.booking_ops_records r
where c.account_id is null and c.booking_id = r.id and r.account_id is not null;

update public.booking_overbooking_conflict_checks c
set account_id = p.account_id::text
from public.properties p
where c.account_id is null and c.property_id = p.id::text and p.account_id is not null;

create or replace function public.create_booking_availability_hold_atomic_account_v1(
  p_account_id text,
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
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing public.booking_availability_holds%rowtype;
  v_hold public.booking_availability_holds%rowtype;
  v_conflicts jsonb := '[]'::jsonb;
  v_hard_count integer := 0;
  v_hold_count integer := 0;
  v_status text;
  v_hold_status text;
  v_check_id uuid := gen_random_uuid();
  v_property_id text;
  v_setup_property_id text;
  v_lock_scope text;
begin
  if nullif(btrim(p_account_id), '') is null then
    raise exception 'account_required' using errcode = '22023';
  end if;
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception 'invalid_date_range' using errcode = '22007';
  end if;
  if p_source not in ('booking_intake', 'pilot_autorun', 'channel_import', 'operator', 'manual_block', 'internal') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  v_property_id := nullif(btrim(p_property_id), '');
  if p_property_setup_id is not null then
    select nullif(btrim(property_id), '') into v_setup_property_id
    from public.booking_property_setup_profiles
    where id = p_property_setup_id;
    if v_setup_property_id is null then raise exception 'property_scope_mismatch'; end if;
    if v_property_id is not null and v_property_id <> v_setup_property_id then
      raise exception 'property_scope_mismatch';
    end if;
    v_property_id := v_setup_property_id;
  end if;
  if v_property_id is null then
    raise exception 'property_required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.properties p
    where p.id::text = v_property_id and p.account_id::text = p_account_id
  ) then
    raise exception 'property_scope_mismatch';
  end if;

  if p_booking_id is not null and not exists (
    select 1 from public.booking_ops_records r
    where r.id = p_booking_id
      and r.account_id = p_account_id
      and r.property_id = v_property_id
  ) then
    raise exception 'booking_scope_mismatch';
  end if;

  select * into v_existing
  from public.booking_availability_holds
  where account_id = p_account_id and idempotency_key = p_idempotency_key;
  if found then return to_jsonb(v_existing); end if;

  v_lock_scope := p_account_id || ':' || coalesce(p_property_setup_id::text, 'property:' || v_property_id);
  perform pg_advisory_xact_lock(hashtextextended(v_lock_scope, 7411));

  select * into v_existing
  from public.booking_availability_holds
  where account_id = p_account_id and idempotency_key = p_idempotency_key;
  if found then return to_jsonb(v_existing); end if;
  with found as (
    select 'active_hold'::text kind, h.id::text entity_id, 'possible'::text severity
    from public.booking_availability_holds h
    where h.account_id = p_account_id
      and h.status in ('active', 'confirmed')
      and (h.hold_expires_at is null or h.hold_expires_at > now())
      and (p_booking_id is null or h.booking_id is distinct from p_booking_id)
      and h.property_id = v_property_id
      and h.date_from < p_date_to and p_date_from < h.date_to
    union all
    select 'manual_block', b.id::text, 'confirmed'
    from public.booking_availability_blocks b
    where b.account_id = p_account_id
      and b.status in ('active', 'blocked')
      and b.property_id = v_property_id
      and b.date_from < p_date_to and p_date_from < b.date_to
    union all
    select 'booking', r.id::text, 'confirmed'
    from public.booking_ops_records r
    where r.account_id = p_account_id
      and (p_booking_id is null or r.id is distinct from p_booking_id)
      and r.property_id = v_property_id
      and r.check_in_at is not null and r.check_out_at is not null
      and r.check_in_at < p_date_to::timestamptz
      and p_date_from::timestamptz < r.check_out_at
    union all
    select 'channel_booking', cb.id::text, 'confirmed'
    from public.booking_channel_imported_bookings cb
    left join public.booking_channel_imported_objects co
      on co.connection_id = cb.connection_id and co.external_object_id = cb.external_object_id
    where cb.status <> 'cancelled'
      and cb.checkin_date is not null and cb.checkout_date is not null
      and (p_booking_id is null or cb.matched_booking_id is distinct from p_booking_id)
      and co.matched_property_id = v_property_id
      and cb.checkin_date < p_date_to and p_date_from < cb.checkout_date
    union all
    select 'channel_calendar', cs.id::text, 'confirmed'
    from public.booking_channel_calendar_snapshots cs
    join public.booking_channel_imported_objects co
      on co.connection_id = cs.connection_id and co.external_object_id = cs.external_object_id
    where cs.availability_status in ('booked', 'blocked')
      and co.matched_property_id = v_property_id
      and cs.date >= p_date_from and cs.date < p_date_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', kind, 'id', entity_id, 'severity', severity
  )), '[]'::jsonb),
  count(*) filter (where severity = 'confirmed'),
  count(*) filter (where severity = 'possible')
  into v_conflicts, v_hard_count, v_hold_count
  from found;
  v_status := case
    when v_hard_count > 0 then 'confirmed_conflict'
    when v_hold_count > 0 then 'possible_conflict'
    else 'no_conflict'
  end;
  v_hold_status := case when v_status = 'no_conflict' then 'active' else 'conflict' end;

  insert into public.booking_availability_holds (
    id, account_id, property_setup_id, property_id, booking_id, source, status,
    date_from, date_to, nights, hold_expires_at, conflict_status, conflict_summary,
    safe_summary, metadata, idempotency_key
  ) values (
    gen_random_uuid(), p_account_id, p_property_setup_id, v_property_id, p_booking_id,
    p_source, v_hold_status, p_date_from, p_date_to, p_date_to - p_date_from,
    p_hold_expires_at, v_status, v_conflicts,
    left(nullif(btrim(p_safe_summary), ''), 500),
    coalesce(p_metadata, '{}'::jsonb), p_idempotency_key
  ) returning * into v_hold;

  insert into public.booking_overbooking_conflict_checks (
    id, account_id, property_setup_id, property_id, booking_id, hold_id,
    check_type, status, requested_date_from, requested_date_to,
    conflicts, blockers, safe_summary
  ) values (
    v_check_id, p_account_id, p_property_setup_id, v_property_id, p_booking_id, v_hold.id,
    case p_source
      when 'booking_intake' then 'pre_intake'
      when 'pilot_autorun' then 'pre_autorun'
      when 'channel_import' then 'channel_import'
      else 'manual_review'
    end,
    v_status, p_date_from, p_date_to, v_conflicts,
    case when v_status = 'no_conflict'
      then '[]'::jsonb
      else jsonb_build_array('Нужна проверка доступности оператором.')
    end,
    case when v_status = 'no_conflict'
      then 'Диапазон временно удерживается.'
      else 'Найдено пересечение дат.'
    end
  );

  if p_booking_id is not null then
    update public.booking_ops_records
    set availability_status = case when v_status = 'no_conflict' then 'held' else 'conflict' end,
        overbooking_risk_status = v_status,
        availability_hold_id = v_hold.id,
        availability_summary = jsonb_build_object(
          'status', v_status, 'check_id', v_check_id, 'hold_id', v_hold.id
        ),
        updated_at = now()
    where id = p_booking_id and account_id = p_account_id;
  end if;
  return to_jsonb(v_hold) || jsonb_build_object('check_id', v_check_id);
end;
$$;

revoke all on function public.create_booking_availability_hold_atomic_account_v1(
  text, uuid, text, uuid, text, date, date, timestamptz, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.create_booking_availability_hold_atomic_account_v1(
  text, uuid, text, uuid, text, date, date, timestamptz, text, jsonb, text
) to service_role;

notify pgrst, 'reload schema';
