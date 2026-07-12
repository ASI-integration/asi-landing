-- OPS v17.1 canonical reservation ledger. Additive, service-role only.
create sequence if not exists public.asi_reservation_reference_seq start 100001;

alter table public.booking_ops_records
  add column if not exists account_id text,
  add column if not exists unit_id text,
  add column if not exists asi_reference text,
  add column if not exists source_type text not null default 'manual',
  add column if not exists source_provider text,
  add column if not exists original_channel text,
  add column if not exists normalized_status text not null default 'inquiry',
  add column if not exists amount numeric(14,2),
  add column if not exists currency text,
  add column if not exists sync_status text not null default 'local_only',
  add column if not exists source_created_at timestamptz,
  add column if not exists last_external_update_at timestamptz,
  add column if not exists created_by_actor text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists reservation_metadata jsonb not null default '{}'::jsonb;

update public.booking_ops_records
set asi_reference = 'ASI-' || nextval('public.asi_reservation_reference_seq')::text
where asi_reference is null;

alter table public.booking_ops_records
  alter column asi_reference set default ('ASI-' || nextval('public.asi_reservation_reference_seq')::text);

alter table public.booking_ops_records drop constraint if exists booking_ops_records_source_type_check;
alter table public.booking_ops_records add constraint booking_ops_records_source_type_check check (source_type in (
  'channel_manager','ota','direct_website','phone','telegram','email','walk_in','manual','owner_block','maintenance_block'
));
alter table public.booking_ops_records drop constraint if exists booking_ops_records_normalized_status_check;
alter table public.booking_ops_records add constraint booking_ops_records_normalized_status_check check (normalized_status in (
  'inquiry','temporary_hold','confirmed','checked_in','checked_out','cancelled'
));
create unique index if not exists booking_ops_records_asi_reference_uidx on public.booking_ops_records(asi_reference);
create index if not exists booking_ops_records_account_dates_idx on public.booking_ops_records(account_id, property_id, unit_id, check_in_at, check_out_at);

create table if not exists public.reservation_source_links (
  id uuid primary key,
  account_id text not null,
  booking_ops_record_id uuid not null references public.booking_ops_records(id) on delete cascade,
  provider text not null,
  external_reservation_id text not null,
  original_channel text,
  source_status text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_external_update_at timestamptz,
  cancelled_at timestamptz,
  unique(account_id, provider, external_reservation_id)
);
create index if not exists reservation_source_links_booking_idx on public.reservation_source_links(booking_ops_record_id);

create table if not exists public.reservation_import_batches (
  id uuid primary key,
  account_id text not null,
  source_type text not null,
  provider text,
  status text not null check (status in ('preview','committing','completed','failed')),
  idempotency_key text not null,
  column_mapping jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  committed_at timestamptz,
  created_by_actor text not null,
  created_at timestamptz not null default now(),
  unique(account_id, idempotency_key)
);
create table if not exists public.reservation_import_rows (
  id uuid primary key,
  batch_id uuid not null references public.reservation_import_batches(id) on delete cascade,
  row_number integer not null,
  fingerprint text not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  outcome text not null check (outcome in ('pending','imported','updated','duplicate','conflict','missing_property','missing_unit','rejected')),
  booking_ops_record_id uuid references public.booking_ops_records(id) on delete set null,
  safe_error text,
  created_at timestamptz not null default now(),
  unique(batch_id, row_number), unique(batch_id, fingerprint)
);
create table if not exists public.reservation_reconciliation_items (
  id uuid primary key,
  account_id text not null,
  booking_ops_record_id uuid references public.booking_ops_records(id) on delete set null,
  source_link_id uuid references public.reservation_source_links(id) on delete set null,
  kind text not null check (kind in ('duplicate','probable_duplicate','conflicting_update','missing_property','missing_unit','overlap_conflict','source_cancelled','local_only')),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  safe_summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.reservation_ledger_audit (
  id uuid primary key, account_id text not null, booking_ops_record_id uuid references public.booking_ops_records(id) on delete set null,
  action text not null, actor_id text not null, before_value jsonb not null default '{}'::jsonb, after_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.booking_availability_holds add column if not exists account_id text, add column if not exists unit_id text;
alter table public.booking_availability_blocks add column if not exists account_id text, add column if not exists unit_id text, add column if not exists block_type text, add column if not exists severity text, add column if not exists issue_task_reference text, add column if not exists expected_reopening_at timestamptz, add column if not exists reinspection_required boolean not null default false;
create index if not exists booking_availability_holds_account_unit_range_idx on public.booking_availability_holds(account_id, property_id, unit_id, date_from, date_to);
create index if not exists booking_availability_blocks_account_unit_range_idx on public.booking_availability_blocks(account_id, property_id, unit_id, date_from, date_to);

alter table public.ops_v17_onboardings drop constraint if exists ops_v17_onboardings_current_step_check;
alter table public.ops_v17_onboardings add constraint ops_v17_onboardings_current_step_check check (current_step in ('business','owner','properties','units','operations','channel_manager','reservations','communications','legal_payments','staff','verification','launch'));

alter table public.reservation_source_links enable row level security;
alter table public.reservation_import_batches enable row level security;
alter table public.reservation_import_rows enable row level security;
alter table public.reservation_reconciliation_items enable row level security;
alter table public.reservation_ledger_audit enable row level security;
revoke all on public.reservation_source_links, public.reservation_import_batches, public.reservation_import_rows, public.reservation_reconciliation_items, public.reservation_ledger_audit from anon, authenticated;
grant all on public.reservation_source_links, public.reservation_import_batches, public.reservation_import_rows, public.reservation_reconciliation_items, public.reservation_ledger_audit to service_role;
grant usage, select on sequence public.asi_reservation_reference_seq to service_role;

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
