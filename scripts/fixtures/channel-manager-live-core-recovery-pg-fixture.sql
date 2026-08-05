-- Disposable schema bootstrap for Live Core recovery RPC integration tests.
-- Synthetic IDs only. Never apply to production or asi-staging.
-- Creates the reviewed FK graph stubs required by
-- channel_manager_live_core_recovery_expected_fk_edges().

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase role stubs so migration GRANT/REVOKE statements succeed on bare Postgres.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$roles$;

CREATE TABLE IF NOT EXISTS public.booking_ops_records (
  id uuid PRIMARY KEY,
  account_id text,
  property_id text,
  booking_id text,
  guest_name text,
  guest_phone text,
  guest_email text,
  guest_telegram text,
  ota_source text,
  reservation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_owner_setup_profiles (
  id uuid PRIMARY KEY,
  lead_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.booking_property_setup_profiles (
  id uuid PRIMARY KEY,
  owner_setup_id uuid REFERENCES public.booking_owner_setup_profiles(id),
  property_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.booking_channel_manager_connections (
  id uuid PRIMARY KEY,
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id),
  owner_setup_id uuid,
  provider text NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.booking_channel_import_runs (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES public.booking_channel_manager_connections(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued',
  import_type text NOT NULL DEFAULT 'full',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Direct children (deletable and non-deletable) referenced by expected FK manifest.
CREATE TABLE IF NOT EXISTS public.booking_ops_events (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_tasks (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_telegram_drafts (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE NO ACTION
);
CREATE TABLE IF NOT EXISTS public.booking_ops_communication_intents (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_guest_intake_sessions (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_guest_intake_submissions (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_guest_documents (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_contracts (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_deposits (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_mvd_reports (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_checkin_execution (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_instay_checkout (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_guest_stay_issues (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_lifecycle_gates (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_lifecycle_exceptions (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_availability_holds (
  id uuid PRIMARY KEY,
  booking_id uuid REFERENCES public.booking_ops_records(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.booking_overbooking_conflict_checks (
  id uuid PRIMARY KEY,
  booking_id uuid REFERENCES public.booking_ops_records(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.booking_channel_imported_bookings (
  id uuid PRIMARY KEY,
  matched_booking_id uuid REFERENCES public.booking_ops_records(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.booking_physical_readiness (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_cleaning_tasks (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_linen_tasks (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_supplies_tasks (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_maintenance_tickets (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_physical_coordination_drafts (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_guest_legal_readiness (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_legal_execution_events (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_runs (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  run_type text NOT NULL DEFAULT 'single_booking',
  status text NOT NULL DEFAULT 'completed'
);
CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_states (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_events (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'synthetic',
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_type text NOT NULL DEFAULT 'system',
  run_id uuid REFERENCES public.booking_ops_lifecycle_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.booking_ops_sla_items (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_drafts (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_guest_intake_events (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_checkin_release_drafts (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_domain_events (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_type text NOT NULL DEFAULT 'system',
  source text NOT NULL DEFAULT 'fixture',
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.booking_ops_lifecycle_decisions (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  event_id uuid NOT NULL UNIQUE REFERENCES public.booking_ops_domain_events(id) ON DELETE CASCADE,
  previous_stage text NOT NULL,
  next_stage text NOT NULL,
  decision text NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.booking_ops_autopilot_states (
  booking_id uuid PRIMARY KEY REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'booking_received',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_event_id uuid REFERENCES public.booking_ops_domain_events(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.booking_ops_worker_tasks (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_worker_link_audit (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.booking_ops_alerts (
  id uuid PRIMARY KEY,
  booking_id uuid REFERENCES public.booking_ops_records(id) ON DELETE CASCADE,
  previous_booking_id uuid REFERENCES public.booking_ops_records(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.reservation_source_links (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid NOT NULL REFERENCES public.booking_ops_records(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.reservation_import_rows (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid REFERENCES public.booking_ops_records(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.reservation_reconciliation_items (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid REFERENCES public.booking_ops_records(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.reservation_ledger_audit (
  id uuid PRIMARY KEY,
  booking_ops_record_id uuid REFERENCES public.booking_ops_records(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.booking_ops_communication_deliveries (
  id uuid PRIMARY KEY,
  communication_intent_id uuid REFERENCES public.booking_ops_communication_intents(id) ON DELETE CASCADE,
  booking_id uuid,
  status text,
  sent_at timestamptz
);
