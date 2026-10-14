-- TASK12 SOURCE ONLY. NEVER APPLIED. No database/role/credential creation.
-- Canonical DDL extracted verbatim from listed migrations, not production seeds.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
DO $guard$ BEGIN
 IF current_database()<>'strigunov_task11_isolated_lab' OR current_user<>'strigunov_task11_owner' THEN
  RAISE EXCEPTION 'task12_fixture_target'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','asi_task08_private','asi_task11_private','task12_fixture') AND c.relkind IN ('r','p','v','m')) THEN
  RAISE EXCEPTION 'task12_fixture_not_fresh'; END IF;
END $guard$;
CREATE SCHEMA task12_fixture;
REVOKE ALL ON SCHEMA task12_fixture FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA task12_fixture REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- SOURCE 001_initial_schema.sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  telegram_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SOURCE 001_initial_schema.sql
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SOURCE 20260408000001_multitenant_account_layer_v1.sql
CREATE TABLE IF NOT EXISTS accounts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  plan_code           TEXT        NOT NULL DEFAULT 'small',
  subscription_status TEXT        NOT NULL DEFAULT 'trial',
  trial_started_at    TIMESTAMPTZ,
  trial_ends_at       TIMESTAMPTZ,
  billing_customer_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT accounts_plan_code_check
    CHECK (plan_code IN ('small', 'growth', 'enterprise')),

  CONSTRAINT accounts_subscription_status_check
    CHECK (subscription_status IN ('trial', 'active', 'paused', 'canceled'))
);

-- SOURCE 20260408000001_multitenant_account_layer_v1.sql
CREATE TABLE IF NOT EXISTS account_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT account_members_role_check
    CHECK (role IN ('owner', 'manager', 'operator')),

  CONSTRAINT account_members_account_user_unique
    UNIQUE (account_id, user_id)
);

-- SOURCE 20260408000001_multitenant_account_layer_v1.sql
CREATE TABLE IF NOT EXISTS properties (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  address_line TEXT,
  city         TEXT,
  country      TEXT,
  status       TEXT        NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT properties_status_check
    CHECK (status IN ('draft', 'active', 'inactive'))
);

-- SOURCE 20260528000001_telegram_guest_memory_foundation.sql
CREATE TABLE IF NOT EXISTS tg_guest_reservations (
  id TEXT PRIMARY KEY,
  booking_id TEXT,
  property_id TEXT,
  guest_id TEXT,
  guest_name TEXT,
  phone TEXT,
  guest_phone TEXT,
  chat_id BIGINT,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'confirmed',
  access_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE 20260528000001_telegram_guest_memory_foundation.sql
CREATE TABLE IF NOT EXISTS tg_property_knowledge (
  property_id TEXT PRIMARY KEY,
  location TEXT,
  check_in_time TEXT,
  check_out_time TEXT,
  wifi_name TEXT,
  wifi_password TEXT,
  wifi_notes TEXT,
  checkin_instructions TEXT,
  door_code_notes TEXT,
  access_notes TEXT,
  parking_rules TEXT,
  parking_paid_or_free TEXT,
  parking_location_notes TEXT,
  quiet_hours TEXT,
  house_rules TEXT,
  heating_notes TEXT,
  emergency_contact_notes TEXT,
  checkout_notes TEXT,
  late_checkout_policy TEXT,
  early_checkin_policy TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE 20260627000001_booking_ops_v1.sql
CREATE TABLE IF NOT EXISTS booking_ops_records (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id               TEXT,
  guest_name               TEXT,
  guest_phone              TEXT,
  guest_email              TEXT,
  guest_telegram           TEXT,
  property_id              TEXT,
  property_label           TEXT,
  ota_source               TEXT,
  check_in_at              TIMESTAMPTZ,
  check_out_at             TIMESTAMPTZ,
  ops_status               TEXT        NOT NULL DEFAULT 'created',
  manual_next_action       TEXT,
  is_blocked               BOOLEAN     NOT NULL DEFAULT FALSE,
  blocker_reason           TEXT,
  documents_status         TEXT        NOT NULL DEFAULT 'not_started',
  contract_status          TEXT        NOT NULL DEFAULT 'not_started',
  deposit_status           TEXT        NOT NULL DEFAULT 'not_started',
  mvd_status               TEXT        NOT NULL DEFAULT 'not_required',
  checkin_readiness_status TEXT        NOT NULL DEFAULT 'not_started',
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT booking_ops_records_ops_status_check
    CHECK (ops_status IN (
      'created',
      'guest_contact_known',
      'documents_requested',
      'documents_received',
      'contract_prepared',
      'contract_sent',
      'contract_signed',
      'deposit_requested',
      'deposit_confirmed',
      'mvd_required',
      'mvd_prepared',
      'mvd_submitted',
      'checkin_instructions_ready',
      'ready_for_checkin',
      'problem_blocked'
    )),

  CONSTRAINT booking_ops_records_documents_status_check
    CHECK (documents_status IN (
      'not_started',
      'requested',
      'received',
      'verified',
      'problem'
    )),

  CONSTRAINT booking_ops_records_contract_status_check
    CHECK (contract_status IN (
      'not_started',
      'prepared',
      'sent',
      'signed',
      'problem'
    )),

  CONSTRAINT booking_ops_records_deposit_status_check
    CHECK (deposit_status IN (
      'not_started',
      'requested',
      'confirmed',
      'problem'
    )),

  CONSTRAINT booking_ops_records_mvd_status_check
    CHECK (mvd_status IN (
      'not_required',
      'required',
      'prepared',
      'submitted',
      'problem'
    )),

  CONSTRAINT booking_ops_records_checkin_readiness_status_check
    CHECK (checkin_readiness_status IN (
      'not_started',
      'in_progress',
      'ready',
      'problem'
    ))
);

-- SOURCE 20260629235959_booking_legal_payment_autopilot_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_guest_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  guest_id TEXT,
  document_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  storage_ref TEXT,
  masked_document_number TEXT,
  issued_country TEXT,
  expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by TEXT,
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_guest_documents_status_check
    CHECK (status IN ('requested', 'received', 'verified', 'rejected', 'expired', 'missing')),
  CONSTRAINT booking_guest_documents_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

-- SOURCE 20260629235959_booking_legal_payment_autopilot_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'not_started',
  template_key TEXT,
  document_ref TEXT,
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_contracts_provider_check
    CHECK (provider IN ('manual', 'okidoki', 'other')),
  CONSTRAINT booking_contracts_status_check
    CHECK (status IN ('not_started', 'prepared', 'sent', 'signed', 'rejected', 'expired', 'failed')),
  CONSTRAINT booking_contracts_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

-- SOURCE 20260629235959_booking_legal_payment_autopilot_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL DEFAULT 'not_requested',
  requested_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_deposits_provider_check
    CHECK (provider IN ('manual', 'payment_link', 'stripe', 'yoo_money', 'other')),
  CONSTRAINT booking_deposits_status_check
    CHECK (status IN (
      'not_requested',
      'requested',
      'received',
      'refunded',
      'partially_refunded',
      'failed',
      'waived'
    )),
  CONSTRAINT booking_deposits_currency_check
    CHECK (length(trim(currency)) BETWEEN 3 AND 12),
  CONSTRAINT booking_deposits_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

-- SOURCE 20260629235959_booking_legal_payment_autopilot_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_mvd_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'not_started',
  prepared_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_mvd_reports_provider_check
    CHECK (provider IN ('manual', 'integration', 'other')),
  CONSTRAINT booking_mvd_reports_status_check
    CHECK (status IN ('not_started', 'prepared', 'submitted', 'accepted', 'rejected', 'failed')),
  CONSTRAINT booking_mvd_reports_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

-- SOURCE 20260702180000_guest_legal_deposit_mvd_execution_pack_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_guest_legal_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_setup_id UUID,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN (
    'incomplete', 'ready_for_operator_review', 'ready_for_checkin', 'blocked'
  )),
  documents_status TEXT NOT NULL DEFAULT 'not_requested',
  contract_status TEXT NOT NULL DEFAULT 'not_started',
  deposit_status TEXT NOT NULL DEFAULT 'not_requested',
  mvd_status TEXT NOT NULL DEFAULT 'not_started',
  availability_status TEXT,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers) = 'array'),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  safe_summary TEXT,
  last_checked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE 20260702200000_booking_physical_readiness_execution_pack_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_cleaning_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','in_progress','completed','verified','blocked','cancelled')),
  due_at TIMESTAMPTZ,
  assigned_to_name TEXT,
  assigned_to_phone TEXT,
  assigned_to_telegram TEXT,
  notes TEXT,
  report_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report_payload) = 'object'),
  blocker_reason TEXT,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE 20260702200000_booking_physical_readiness_execution_pack_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_linen_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pickup_needed','picked_up','in_laundry','delivered','verified','shortage','blocked','cancelled')),
  due_at TIMESTAMPTZ,
  assigned_to_name TEXT,
  assigned_to_phone TEXT,
  assigned_to_telegram TEXT,
  notes TEXT,
  report_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report_payload) = 'object'),
  blocker_reason TEXT,
  delivered_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE 20260702200000_booking_physical_readiness_execution_pack_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_supplies_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','verified','missing','waived','blocked')),
  due_at TIMESTAMPTZ,
  critical_items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(critical_items) = 'array'),
  notes TEXT,
  report_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report_payload) = 'object'),
  blocker_reason TEXT,
  waiver_reason TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE 20260702200000_booking_physical_readiness_execution_pack_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_maintenance_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  is_blocking BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','resolved','verified','deferred','cancelled')),
  assigned_to_name TEXT,
  assigned_to_phone TEXT,
  assigned_to_telegram TEXT,
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  report_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report_payload) = 'object'),
  blocker_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE 20260702200000_booking_physical_readiness_execution_pack_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_physical_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'not_ready' CHECK (status IN ('not_ready','ready_for_review','approved','blocked')),
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers) = 'array'),
  final_ready BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE 20260630000003_booking_instay_checkout_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_instay_checkout (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_checked_in',
  checkout_instructions_status TEXT NOT NULL DEFAULT 'not_prepared',
  checkout_confirmation_status TEXT NOT NULL DEFAULT 'not_requested',
  planned_checkout_at TIMESTAMPTZ,
  actual_checkout_at TIMESTAMPTZ,
  inspection_status TEXT NOT NULL DEFAULT 'not_started',
  deposit_return_status TEXT NOT NULL DEFAULT 'not_ready',
  closure_status TEXT NOT NULL DEFAULT 'open',
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_instay_checkout_booking_unique UNIQUE (booking_id),
  CONSTRAINT booking_instay_checkout_status_check
    CHECK (status IN (
      'not_checked_in',
      'in_stay',
      'guest_issue_open',
      'guest_issue_blocked',
      'checkout_preparing',
      'checkout_instructions_queued',
      'checkout_pending',
      'checked_out',
      'inspection_pending',
      'inspection_done',
      'deposit_return_ready',
      'ready_to_close',
      'closed',
      'blocked'
    )),
  CONSTRAINT booking_instay_checkout_instructions_check
    CHECK (checkout_instructions_status IN ('not_prepared', 'prepared', 'queued', 'sent', 'failed')),
  CONSTRAINT booking_instay_checkout_confirmation_check
    CHECK (checkout_confirmation_status IN ('not_requested', 'requested', 'confirmed', 'missed')),
  CONSTRAINT booking_instay_checkout_inspection_check
    CHECK (inspection_status IN ('not_started', 'scheduled', 'done', 'issue_found', 'failed')),
  CONSTRAINT booking_instay_checkout_deposit_check
    CHECK (deposit_return_status IN ('not_ready', 'ready', 'held', 'partially_held', 'returned', 'waived')),
  CONSTRAINT booking_instay_checkout_closure_check
    CHECK (closure_status IN ('open', 'ready_to_close', 'closed', 'blocked'))
);

-- SOURCE 20260630000003_booking_instay_checkout_v1.sql
CREATE TABLE IF NOT EXISTS public.booking_guest_stay_issues (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'guest',
  description TEXT,
  resolution TEXT,
  assigned_to_type TEXT,
  assigned_to_ref TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_guest_stay_issues_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT booking_guest_stay_issues_status_check
    CHECK (status IN ('open', 'triaged', 'assigned', 'resolved', 'blocked', 'cancelled')),
  CONSTRAINT booking_guest_stay_issues_source_check
    CHECK (source IN ('guest', 'admin', 'cleaner', 'master', 'system'))
);

-- SOURCE 20260920203530_ru_legal_acceptances_v1.sql
CREATE TABLE IF NOT EXISTS public.ru_legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  accepted_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL
    CHECK (document_type IN ('offer', 'personal_data_consent')),
  document_version TEXT NOT NULL
    CHECK (char_length(trim(document_version)) BETWEEN 1 AND 64),
  document_sha256 TEXT NOT NULL
    CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_snapshot TEXT NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ru_legal_acceptances_account_document_version_key
    UNIQUE (account_id, document_type, document_version)
);

ALTER TABLE public.booking_guest_documents
  DROP CONSTRAINT IF EXISTS booking_guest_documents_status_check;
ALTER TABLE public.booking_guest_documents
  ALTER COLUMN status SET DEFAULT 'not_requested';
ALTER TABLE public.booking_guest_documents
  ADD CONSTRAINT booking_guest_documents_status_check CHECK (status IN (
    'not_requested', 'requested', 'partially_received', 'received', 'needs_review',
    'verified', 'rejected', 'blocked', 'expired', 'missing'
  ));

ALTER TABLE public.booking_contracts
  DROP CONSTRAINT IF EXISTS booking_contracts_status_check;
ALTER TABLE public.booking_contracts
  ADD CONSTRAINT booking_contracts_status_check CHECK (status IN (
    'not_started', 'draft_needed', 'draft_ready', 'sent_for_signature_placeholder',
    'signed_manual', 'signed_provider_placeholder', 'needs_review', 'blocked',
    'prepared', 'sent', 'signed', 'rejected', 'expired', 'failed'
  ));

ALTER TABLE public.booking_deposits
  DROP CONSTRAINT IF EXISTS booking_deposits_status_check;
ALTER TABLE public.booking_deposits
  ADD CONSTRAINT booking_deposits_status_check CHECK (status IN (
    'not_requested', 'request_draft_ready', 'requested_placeholder', 'pending',
    'paid_manual', 'paid_provider_placeholder', 'failed', 'refunded_manual',
    'disputed', 'waived_manual', 'blocked', 'requested', 'received', 'refunded',
    'partially_refunded', 'waived'
  ));

ALTER TABLE public.booking_mvd_reports
  DROP CONSTRAINT IF EXISTS booking_mvd_reports_status_check;
ALTER TABLE public.booking_mvd_reports
  ADD CONSTRAINT booking_mvd_reports_status_check CHECK (status IN (
    'not_required', 'not_started', 'data_needed', 'draft_ready', 'export_ready',
    'submitted_manual', 'submitted_provider_placeholder', 'accepted_manual',
    'rejected', 'needs_review', 'blocked', 'prepared', 'submitted', 'accepted', 'failed'
  ));


-- account_id TEXT canonical addition confirmed by account-scope migration.
ALTER TABLE public.booking_ops_records ADD COLUMN account_id text NOT NULL DEFAULT 'legacy';
CREATE UNIQUE INDEX task12_contract_provider_key ON public.booking_contracts(booking_id,provider);
CREATE UNIQUE INDEX task12_deposit_provider_key ON public.booking_deposits(booking_id,provider);
CREATE UNIQUE INDEX task12_mvd_provider_key ON public.booking_mvd_reports(booking_id,provider);
CREATE FUNCTION task12_fixture.fid(i integer,k integer) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog
AS $$ SELECT ('12000000-0000-4000-8000-'||lpad((i*100+k)::text,12,'0'))::uuid $$;
CREATE TABLE task12_fixture.slots(
 slot integer PRIMARY KEY CHECK(slot BETWEEN 1 AND 64),account_id uuid NOT NULL,property_id uuid NOT NULL,
 actor_id uuid NOT NULL,booking_id uuid NOT NULL,predecessor_id uuid NOT NULL,session_id uuid,request_id uuid NOT NULL,
 decision_id uuid NOT NULL,source_id text NOT NULL,source_pred text NOT NULL
);
DO $seed$
DECLARE i integer; a uuid; p uuid; u uuid; b uuid; prev uuid; day timestamptz; ts timestamptz:=clock_timestamp();
BEGIN
 day:=date_trunc('day',ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 FOR i IN 1..64 LOOP
  a:=task12_fixture.fid(i,1);p:=task12_fixture.fid(i,2);u:=task12_fixture.fid(i,3);
  b:=task12_fixture.fid(i,4);prev:=task12_fixture.fid(i,5);
  INSERT INTO public.users(id,email,password_hash) VALUES(u,'task12-'||i||'@invalid.example','UNUSABLE_SYNTHETIC');
  INSERT INTO public.accounts(id,name) VALUES(a,'SYNTHETIC Task12 '||i);
  INSERT INTO public.account_members(account_id,user_id,role) VALUES(a,u,'owner');
  INSERT INTO public.properties(id,account_id,name,status) VALUES(p,a,'SYNTHETIC room','active');
  INSERT INTO public.tg_guest_reservations(id,property_id,check_in,check_out,status) VALUES
   ('task12-current-'||i,p::text,day+interval '1 day 15 hours',day+interval '3 days 12 hours','confirmed'),
   ('task12-previous-'||i,p::text,ts-interval '2 days',ts-interval '1 hour','confirmed');
  INSERT INTO public.booking_ops_records(id,account_id,property_id,booking_id,check_in_at,check_out_at,ops_status) VALUES
   (b,a::text,p::text,'task12-current-'||i,day+interval '1 day 15 hours',day+interval '3 days 12 hours','ready_for_checkin'),
   (prev,a::text,p::text,'task12-previous-'||i,ts-interval '2 days',ts-interval '1 hour','ready_for_checkin');
  INSERT INTO public.tg_property_knowledge(property_id,early_checkin_policy) VALUES(p::text,'SYNTHETIC manual early arrival only');
  INSERT INTO public.booking_cleaning_tasks(booking_id,property_id,status,verified_at) VALUES(b,p::text,'verified',ts);
  INSERT INTO public.booking_linen_tasks(booking_id,property_id,status,verified_at) VALUES(b,p::text,'verified',ts);
  INSERT INTO public.booking_supplies_tasks(booking_id,property_id,status,verified_at) VALUES(b,p::text,'verified',ts);
  INSERT INTO public.booking_maintenance_tickets(booking_id,property_id,title,status) VALUES(b,p::text,'SYNTHETIC','verified');
  INSERT INTO public.booking_physical_readiness(booking_id,property_id,status,final_ready,approved_at) VALUES(b,p::text,'approved',true,ts);
  INSERT INTO public.booking_guest_documents(booking_id,document_type,status,verified_at,expires_at) VALUES(b,'guest_identity','verified',ts,ts+interval '1 day');
  INSERT INTO public.booking_contracts(booking_id,status,signed_at) VALUES(b,'signed_manual',ts);
  INSERT INTO public.booking_deposits(booking_id,status,received_at) VALUES(b,'paid_manual',ts);
  INSERT INTO public.booking_mvd_reports(booking_id,status,accepted_at) VALUES(b,'accepted_manual',ts);
  INSERT INTO public.booking_guest_legal_readiness(booking_id,property_id,status) VALUES(b,p::text,'ready_for_checkin');
  INSERT INTO public.booking_instay_checkout(id,booking_id,planned_checkout_at,actual_checkout_at,inspection_status,checkout_confirmation_status,status)
   VALUES(task12_fixture.fid(i,8),prev,ts-interval '1 hour',ts-interval '1 hour','done','confirmed','closed');
  INSERT INTO public.ru_legal_acceptances(account_id,accepted_by_user_id,document_type,document_version,document_sha256) VALUES
   (a,u,'offer','task12',repeat('a',64)),(a,u,'personal_data_consent','task12',repeat('b',64));
  INSERT INTO task12_fixture.slots VALUES(i,a,p,u,b,prev,NULL,task12_fixture.fid(i,6),task12_fixture.fid(i,7),'task12-current-'||i,'task12-previous-'||i);
 END LOOP;
 -- Foreign tenant deliberately unmapped to both test LOGINs.
 INSERT INTO public.users(id,email,password_hash) VALUES(task12_fixture.fid(99,3),'task12-foreign@invalid.example','UNUSABLE_SYNTHETIC');
 INSERT INTO public.accounts(id,name) VALUES(task12_fixture.fid(99,1),'FOREIGN SYNTHETIC');
 INSERT INTO public.properties(id,account_id,name,status) VALUES(task12_fixture.fid(99,2),task12_fixture.fid(99,1),'FOREIGN','active');
END $seed$;
DO $rls$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['users','sessions','accounts','account_members','properties','tg_guest_reservations','tg_property_knowledge','booking_ops_records','booking_cleaning_tasks','booking_linen_tasks','booking_supplies_tasks','booking_maintenance_tickets','booking_physical_readiness','booking_guest_documents','booking_contracts','booking_deposits','booking_mvd_reports','booking_guest_legal_readiness','booking_instay_checkout','booking_guest_stay_issues','ru_legal_acceptances'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);
  EXECUTE format('CREATE POLICY task12_owner ON public.%I TO strigunov_task11_owner USING(true) WITH CHECK(true)',n);
 END LOOP;
END $rls$;
COMMIT;
