-- CANDIDATE FOR DISPOSABLE RESTORE REHEARSAL; NOT LIVE AUTHORIZATION.
-- Entire rehearsal rolls back. Do not change final ROLLBACK without reviewed apply backend.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(7411, 20261016);
CREATE TEMP TABLE preserved_history ON COMMIT DROP AS
SELECT version,name,statements FROM supabase_migrations.schema_migrations
WHERE version IN (SELECT column1 FROM (VALUES ('20260729040307'),('20260729040309'),('20260729040332'),('20260913120838'),('20260913120856'),('20260913120921'),('20260913120945')) AS ids);
DO $$ BEGIN
 IF (SELECT count(*) FROM preserved_history) <> 7 THEN RAISE EXCEPTION 'preserved_history_missing'; END IF;
 IF current_setting('server_version_num')::int / 10000 <> 17 THEN RAISE EXCEPTION 'postgres17_required'; END IF;
 IF to_regclass('public.booking_ops_automation_executions') IS NOT NULL
 OR to_regprocedure('public.g0_begin_automation(uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.g0_end_automation(uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.g0_alert_revision()') IS NOT NULL
 OR to_regprocedure('public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint)') IS NOT NULL
 THEN RAISE EXCEPTION 'partial_g0_requires_reconciliation'; END IF;
END $$;
CREATE TEMP TABLE preserved_functions ON COMMIT DROP AS
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,
 pg_get_functiondef(p.oid) definition,p.proacl,p.proowner,p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='runtime_bridge' OR p.proname LIKE '%asi_runtime_bridge%';

-- SOURCE 20261003124500_booking_ops_auto_send_account_scope_v1.sql SHA256 fb874f776a01b14fec70314d2c76a9358d7c362d6b6f9d16a4ca4dc2c8148c32
-- Wave 5: bind controlled auto-send scopes, runs and deliveries to canonical accounts.
-- Legacy non-global scopes are disabled before any backfill. Ambiguous owner/pilot
-- scopes intentionally remain unbound and cannot authorize account-scoped delivery.

ALTER TABLE public.booking_ops_communication_auto_send_scopes
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.booking_ops_communication_auto_send_runs
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.booking_ops_communication_deliveries
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

UPDATE public.booking_ops_communication_auto_send_scopes
SET actual_send_enabled = false,
    dry_run_only = true,
    disabled_at = COALESCE(disabled_at, now()),
    reason = COALESCE(reason, 'Disabled during account-scope migration.'),
    updated_at = now()
WHERE scope_type <> 'global';
WITH booking_matches AS (
  SELECT
    s.id AS scope_id,
    MIN(a.id::text)::uuid AS account_id
  FROM public.booking_ops_communication_auto_send_scopes s
  JOIN public.booking_ops_records b
    ON s.scope_type = 'booking'
   AND b.account_id IS NOT NULL
   AND (s.scope_ref = b.id::text OR s.scope_ref = b.booking_id)
  JOIN public.accounts a
    ON a.id::text = b.account_id
  GROUP BY s.id
  HAVING COUNT(DISTINCT a.id) = 1
)
UPDATE public.booking_ops_communication_auto_send_scopes s
SET account_id = m.account_id,
    updated_at = now()
FROM booking_matches m
WHERE s.id = m.scope_id
  AND s.account_id IS NULL;

WITH property_matches AS (
  SELECT
    s.id AS scope_id,
    MIN(p.account_id::text)::uuid AS account_id
  FROM public.booking_ops_communication_auto_send_scopes s
  JOIN public.properties p
    ON s.scope_type = 'property'
   AND s.scope_ref = p.id::text
  GROUP BY s.id
  HAVING COUNT(DISTINCT p.account_id) = 1
)
UPDATE public.booking_ops_communication_auto_send_scopes s
SET account_id = m.account_id,
    updated_at = now()
FROM property_matches m
WHERE s.id = m.scope_id
  AND s.account_id IS NULL;
UPDATE public.booking_ops_communication_deliveries d
SET account_id = a.id,
    updated_at = now()
FROM public.booking_ops_communication_intents i
JOIN public.booking_ops_records b
  ON b.id = i.booking_ops_record_id
JOIN public.accounts a
  ON a.id::text = b.account_id
WHERE d.communication_intent_id = i.id
  AND d.account_id IS NULL
  AND b.account_id IS NOT NULL;

DO $$
DECLARE
  old_constraint TEXT;
BEGIN
  SELECT c.conname
  INTO old_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.booking_ops_communication_auto_send_scopes'::regclass
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (scope_type, scope_ref_key)%'
  LIMIT 1;

  IF old_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.booking_ops_communication_auto_send_scopes DROP CONSTRAINT %I',
      old_constraint
    );
  END IF;
END
$$;

ALTER TABLE public.booking_ops_communication_auto_send_scopes
  ADD COLUMN IF NOT EXISTS account_scope_key TEXT
  GENERATED ALWAYS AS (COALESCE(account_id::text, 'global')) STORED;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.booking_ops_communication_auto_send_scopes'::regclass
      AND conname = 'booking_ops_auto_send_scope_account_unique'
  ) THEN
    ALTER TABLE public.booking_ops_communication_auto_send_scopes
      ADD CONSTRAINT booking_ops_auto_send_scope_account_unique
      UNIQUE (account_scope_key, scope_type, scope_ref_key);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.booking_ops_communication_auto_send_scopes'::regclass
      AND conname = 'booking_ops_auto_send_scope_account_guard'
  ) THEN
    ALTER TABLE public.booking_ops_communication_auto_send_scopes
      ADD CONSTRAINT booking_ops_auto_send_scope_account_guard
      CHECK (
        (scope_type = 'global' AND account_id IS NULL)
        OR (
          scope_type <> 'global'
          AND (
            account_id IS NOT NULL
            OR (actual_send_enabled = false AND dry_run_only = true)
          )
        )
      );
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS idx_booking_ops_auto_send_scope_account
  ON public.booking_ops_communication_auto_send_scopes (account_id, scope_type, scope_ref)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_ops_auto_send_runs_account_started
  ON public.booking_ops_communication_auto_send_runs (account_id, started_at DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_ops_communication_delivery_account
  ON public.booking_ops_communication_deliveries (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- SOURCE 20261003141500_booking_inbound_intake_account_scope_v1.sql SHA256 05df3a611da0eb52da11331c41b6cb96b79139ac4be34c6983527a200d5d4474
-- Wave 5: add canonical account lineage to inbound intake events.
-- Public/unresolved intake may remain unbound (account_id NULL) until a canonical
-- booking or property establishes ownership. Tenant dashboard reads never span
-- bound accounts.

ALTER TABLE public.booking_inbound_intake_events
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

UPDATE public.booking_inbound_intake_events e
SET account_id = a.id,
    updated_at = now()
FROM public.booking_ops_records b
JOIN public.accounts a
  ON a.id::text = b.account_id
WHERE e.account_id IS NULL
  AND e.booking_id = b.id
  AND b.account_id IS NOT NULL;

UPDATE public.booking_inbound_intake_events e
SET account_id = p.account_id,
    updated_at = now()
FROM public.properties p
WHERE e.account_id IS NULL
  AND e.booking_id IS NULL
  AND e.property_id = p.id::text
  AND p.account_id IS NOT NULL;

ALTER TABLE public.booking_inbound_intake_events
  DROP CONSTRAINT IF EXISTS booking_inbound_intake_events_idempotency_key_unique;

ALTER TABLE public.booking_inbound_intake_events
  ADD COLUMN IF NOT EXISTS account_scope_key TEXT
  GENERATED ALWAYS AS (COALESCE(account_id::text, 'unbound')) STORED;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.booking_inbound_intake_events'::regclass
      AND conname = 'booking_inbound_intake_events_account_idempotency_unique'
  ) THEN
    ALTER TABLE public.booking_inbound_intake_events
      ADD CONSTRAINT booking_inbound_intake_events_account_idempotency_unique
      UNIQUE (account_scope_key, idempotency_key);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_booking_inbound_intake_events_account_created
  ON public.booking_inbound_intake_events (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_inbound_intake_events_account_status
  ON public.booking_inbound_intake_events (account_id, status, created_at DESC)
  WHERE account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- SOURCE 20261003150000_booking_availability_account_scope_v1.sql SHA256 ba52c412da61cf7912a4c101267ff5110a75778a7a55f43dffa6679e332c00e7
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

-- SOURCE 20261005090000_booking_ops_record_scope_guard_v1.sql SHA256 21c0421d214d34450076bfe271b56fc609f57ab69b041b1a792e1c4e7fbdb9c4
-- Wave 5: atomic canonical account/property guard for new Booking Ops records.
-- Additive and intentionally INSERT-only so existing legacy/unbound rows keep
-- their current update semantics until a separate type/data normalization pass.

CREATE OR REPLACE FUNCTION public.booking_ops_record_insert_scope_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Legacy/accountless/property-unbound intake stays review-only and is not
  -- forced through the canonical property invariant at insert time.
  IF NEW.account_id IS NULL
     OR btrim(NEW.account_id) = ''
     OR NEW.account_id = 'legacy'
     OR NEW.property_id IS NULL
     OR btrim(NEW.property_id) = '' THEN
    RETURN NEW;
  END IF;

  -- Compare as text because booking_ops_records evolved with TEXT scope columns
  -- while canonical properties use UUID ids. FOR SHARE keeps ownership stable
  -- for the duration of this INSERT transaction.
  PERFORM 1
  FROM public.properties p
  WHERE p.id::text = btrim(NEW.property_id)
    AND p.account_id::text = btrim(NEW.account_id)
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_ops_record_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() FROM anon;
REVOKE ALL ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() TO service_role;

DROP TRIGGER IF EXISTS booking_ops_record_insert_scope_guard_v1
  ON public.booking_ops_records;

CREATE TRIGGER booking_ops_record_insert_scope_guard_v1
BEFORE INSERT ON public.booking_ops_records
FOR EACH ROW
EXECUTE FUNCTION public.booking_ops_record_insert_scope_guard_v1();

-- SOURCE 20261015103000_booking_knowledge_read_contract.sql SHA256 8e41fda68656ab0b551f79e5a968ebd4ef7f7e42d4c521b3c896ac6532411d30
-- Complete the existing Booking Ops read contract without sample property data.
-- Additive only; no send policy is enabled and public roles retain no access.
ALTER TABLE public.tg_property_knowledge
  ADD COLUMN IF NOT EXISTS object_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS check_in_instructions text,
  ADD COLUMN IF NOT EXISTS check_in_text text,
  ADD COLUMN IF NOT EXISTS key_instructions text,
  ADD COLUMN IF NOT EXISTS parking_instructions text,
  ADD COLUMN IF NOT EXISTS parking_text text,
  ADD COLUMN IF NOT EXISTS house_rules text,
  ADD COLUMN IF NOT EXISTS house_rules_text text,
  ADD COLUMN IF NOT EXISTS check_out_instructions text,
  ADD COLUMN IF NOT EXISTS emergency_contacts text,
  ADD COLUMN IF NOT EXISTS escalation_contact_text text;
GRANT SELECT ON public.booking_property_setup_profiles TO service_role;
NOTIFY pgrst, 'reload schema';

-- SOURCE 20261016090000_g0_operator_revision_takeover.sql SHA256 eb91b48dfb4df3ae8bd63118f678573028b4fd53f5f3eeaa916adaf25d1fc3bd
-- Candidate only. Acceptance applies solely inside a disposable PostgreSQL17 database.

-- PostgreSQL row locks require UPDATE privilege on at least one column.
-- Trusted server role only; no owner/authenticated role gains mutation rights.
GRANT UPDATE (user_id) ON public.account_members TO service_role;
GRANT UPDATE (id) ON public.properties TO service_role;
ALTER TABLE public.booking_ops_alerts ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE public.booking_ops_records ADD COLUMN automation_paused boolean NOT NULL DEFAULT false;
CREATE TABLE public.booking_ops_automation_executions (
  token uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.booking_ops_automation_executions(booking_id);
ALTER TABLE public.booking_ops_automation_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_ops_automation_executions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.booking_ops_automation_executions TO service_role;
CREATE FUNCTION public.g0_begin_automation(p_booking uuid, p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE paused boolean;
BEGIN
  SELECT automation_paused INTO paused FROM public.booking_ops_records WHERE id=p_booking FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF paused THEN RAISE EXCEPTION 'booking_automation_manually_paused'; END IF;
  INSERT INTO public.booking_ops_automation_executions(token,booking_id) VALUES(p_token,p_booking);
  RETURN true;
END $$;
CREATE FUNCTION public.g0_end_automation(p_booking uuid, p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  DELETE FROM public.booking_ops_automation_executions WHERE booking_id=p_booking AND token=p_token;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.g0_begin_automation(uuid,uuid), public.g0_end_automation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.g0_begin_automation(uuid,uuid), public.g0_end_automation(uuid,uuid) TO service_role;
CREATE FUNCTION public.g0_alert_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  -- A changed incident requires a fresh operator acknowledgement.
  IF OLD.status = 'acknowledged' AND NEW.status = 'acknowledged' AND
    (to_jsonb(NEW) - ARRAY['revision','updated_at','acknowledged_at','acknowledged_by']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['revision','updated_at','acknowledged_at','acknowledged_by']) THEN
    NEW.status := 'open'; NEW.acknowledged_at := NULL; NEW.acknowledged_by := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER g0_alert_revision BEFORE UPDATE ON public.booking_ops_alerts
FOR EACH ROW EXECUTE FUNCTION public.g0_alert_revision();
CREATE FUNCTION public.g0_acknowledge_operator_alert(p_account uuid, p_alert uuid, p_actor uuid, p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE a public.booking_ops_alerts; b public.booking_ops_records;
BEGIN
  -- Serialize membership deletion against the actual acknowledgement transaction.
  PERFORM 1 FROM public.account_members WHERE account_id=p_account AND user_id=p_actor FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'operator_membership_revoked'; END IF;
  SELECT * INTO a FROM public.booking_ops_alerts WHERE id=p_alert AND account_id::text=p_account::text FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'alert_not_found'; END IF;
  SELECT * INTO b FROM public.booking_ops_records WHERE id=a.booking_id AND account_id::text=p_account::text AND property_id=a.property_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_scope_mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_ops_automation_executions WHERE booking_id=b.id) THEN RAISE EXCEPTION 'booking_automation_inflight_hold'; END IF;
  PERFORM 1 FROM public.properties WHERE id::text=a.property_id AND account_id=p_account FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_scope_mismatch'; END IF;
  IF p_revision IS NULL OR p_revision <> a.revision OR a.status <> 'open' THEN RAISE EXCEPTION 'alert_revision_conflict'; END IF;
  UPDATE public.booking_ops_records SET automation_paused=true WHERE id=b.id;
  UPDATE public.booking_ops_alerts SET status='acknowledged', acknowledged_at=clock_timestamp(),
    acknowledged_by=p_actor::text, updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
  RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.g0_alert_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint) TO service_role;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_inbound_intake_events' AND column_name='account_id') THEN RAISE EXCEPTION 'missing_booking_inbound_intake_events_account_id'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_inbound_intake_events' AND column_name='account_scope_key') THEN RAISE EXCEPTION 'missing_booking_inbound_intake_events_account_scope_key'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_ops_communication_auto_send_scopes' AND column_name='account_id') THEN RAISE EXCEPTION 'missing_booking_ops_communication_auto_send_scopes_account_id'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_ops_communication_auto_send_scopes' AND column_name='account_scope_key') THEN RAISE EXCEPTION 'missing_booking_ops_communication_auto_send_scopes_account_scope_key'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_ops_communication_auto_send_runs' AND column_name='account_id') THEN RAISE EXCEPTION 'missing_booking_ops_communication_auto_send_runs_account_id'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_ops_communication_deliveries' AND column_name='account_id') THEN RAISE EXCEPTION 'missing_booking_ops_communication_deliveries_account_id'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_overbooking_conflict_checks' AND column_name='account_id') THEN RAISE EXCEPTION 'missing_booking_overbooking_conflict_checks_account_id'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_ops_records' AND column_name='automation_paused') THEN RAISE EXCEPTION 'missing_booking_ops_records_automation_paused'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_ops_alerts' AND column_name='revision') THEN RAISE EXCEPTION 'missing_booking_ops_alerts_revision'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tg_property_knowledge' AND column_name='check_in_instructions') THEN RAISE EXCEPTION 'missing_tg_property_knowledge_check_in_instructions'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tg_property_knowledge' AND column_name='key_instructions') THEN RAISE EXCEPTION 'missing_tg_property_knowledge_key_instructions'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tg_property_knowledge' AND column_name='parking_instructions') THEN RAISE EXCEPTION 'missing_tg_property_knowledge_parking_instructions'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tg_property_knowledge' AND column_name='check_out_instructions') THEN RAISE EXCEPTION 'missing_tg_property_knowledge_check_out_instructions'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tg_property_knowledge' AND column_name='emergency_contacts') THEN RAISE EXCEPTION 'missing_tg_property_knowledge_emergency_contacts'; END IF;
 IF EXISTS(SELECT version,name,statements FROM preserved_history EXCEPT SELECT version,name,statements FROM supabase_migrations.schema_migrations) THEN RAISE EXCEPTION 'history_changed'; END IF;
 IF EXISTS (SELECT * FROM preserved_functions EXCEPT
 SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl,p.proowner,p.proconfig
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='runtime_bridge' OR p.proname LIKE '%asi_runtime_bridge%') THEN RAISE EXCEPTION 'runtime_bridge_changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_ops_communication_auto_send_scopes WHERE scope_type<>'global' AND (actual_send_enabled IS DISTINCT FROM false OR dry_run_only IS DISTINCT FROM true)) THEN RAISE EXCEPTION 'send_scope_not_disabled'; END IF;
 IF has_function_privilege('anon','public.g0_begin_automation(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.g0_acknowledge_operator_alert(uuid,uuid,uuid,bigint)','EXECUTE') THEN RAISE EXCEPTION 'client_execute_exposed'; END IF;
END $$;
ROLLBACK;
