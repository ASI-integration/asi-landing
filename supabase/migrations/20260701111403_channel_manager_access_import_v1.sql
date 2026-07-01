-- Channel Manager Access & Import v1.
-- This layer stores credential references only and does not publish to OTA providers.

CREATE TABLE IF NOT EXISTS public.booking_channel_manager_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_setup_id uuid REFERENCES public.booking_owner_setup_profiles(id) ON DELETE SET NULL,
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE CASCADE,
  owner_id text,
  provider text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'not_requested',
  access_status text NOT NULL DEFAULT 'unknown',
  safe_access_ref text,
  provider_account_ref text,
  last_import_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_manager_connections_provider_check
    CHECK (provider IN ('manual', 'bnovo', 'realtycalendar', 'travelline', 'other')),
  CONSTRAINT booking_channel_manager_connections_status_check
    CHECK (status IN ('not_requested', 'requested', 'access_received', 'credential_ref_pending', 'connected', 'import_ready', 'import_failed', 'disconnected', 'blocked')),
  CONSTRAINT booking_channel_manager_connections_access_status_check
    CHECK (access_status IN ('unknown', 'requested', 'received', 'invalid', 'expired', 'blocked')),
  CONSTRAINT booking_channel_manager_connections_safe_ref_length
    CHECK (safe_access_ref IS NULL OR length(safe_access_ref) <= 255),
  CONSTRAINT booking_channel_manager_connections_property_provider_unique
    UNIQUE (property_setup_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_booking_channel_manager_connections_property
  ON public.booking_channel_manager_connections (property_setup_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_channel_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.booking_channel_manager_connections(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  import_type text NOT NULL DEFAULT 'full',
  started_at timestamptz,
  finished_at timestamptz,
  imported_objects_count integer NOT NULL DEFAULT 0,
  imported_bookings_count integer NOT NULL DEFAULT 0,
  imported_calendar_days_count integer NOT NULL DEFAULT 0,
  imported_prices_count integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  safe_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_import_runs_provider_check
    CHECK (provider IN ('manual', 'bnovo', 'realtycalendar', 'travelline', 'other')),
  CONSTRAINT booking_channel_import_runs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'dry_run')),
  CONSTRAINT booking_channel_import_runs_type_check
    CHECK (import_type IN ('full', 'objects', 'bookings', 'calendar', 'pricing', 'availability', 'manual_snapshot'))
);

CREATE INDEX IF NOT EXISTS idx_booking_channel_import_runs_connection
  ON public.booking_channel_import_runs (connection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_channel_imported_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.booking_channel_manager_connections(id) ON DELETE CASCADE,
  import_run_id uuid REFERENCES public.booking_channel_import_runs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  external_object_id text NOT NULL,
  external_listing_id text,
  matched_property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE SET NULL,
  matched_property_id text,
  match_status text NOT NULL DEFAULT 'unmatched',
  title text,
  city text,
  safe_address_summary text,
  capacity integer,
  status text NOT NULL DEFAULT 'unknown',
  raw_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_imported_objects_match_check
    CHECK (match_status IN ('unmatched', 'matched', 'possible_match', 'duplicate', 'ignored')),
  CONSTRAINT booking_channel_imported_objects_status_check
    CHECK (status IN ('active', 'inactive', 'draft', 'blocked', 'unknown')),
  CONSTRAINT booking_channel_imported_objects_unique UNIQUE (connection_id, external_object_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_channel_imported_objects_match
  ON public.booking_channel_imported_objects (connection_id, match_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_channel_imported_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.booking_channel_manager_connections(id) ON DELETE CASCADE,
  import_run_id uuid REFERENCES public.booking_channel_import_runs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  external_booking_id text NOT NULL,
  external_object_id text,
  matched_booking_id uuid REFERENCES public.booking_ops_records(id) ON DELETE SET NULL,
  matched_property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE SET NULL,
  guest_safe_name text,
  guest_contact_ref text,
  checkin_date date,
  checkout_date date,
  guest_count integer,
  status text NOT NULL DEFAULT 'unknown',
  match_status text NOT NULL DEFAULT 'unmatched',
  raw_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_imported_bookings_status_check
    CHECK (status IN ('new', 'confirmed', 'cancelled', 'modified', 'unknown')),
  CONSTRAINT booking_channel_imported_bookings_match_check
    CHECK (match_status IN ('unmatched', 'matched', 'possible_duplicate', 'imported_to_booking_ops', 'ignored')),
  CONSTRAINT booking_channel_imported_bookings_unique UNIQUE (connection_id, external_booking_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_channel_imported_bookings_match
  ON public.booking_channel_imported_bookings (connection_id, match_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_channel_calendar_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.booking_channel_manager_connections(id) ON DELETE CASCADE,
  import_run_id uuid REFERENCES public.booking_channel_import_runs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  external_object_id text NOT NULL,
  date date NOT NULL,
  availability_status text NOT NULL DEFAULT 'unknown',
  min_stay integer,
  price_amount numeric(14,2),
  currency text,
  raw_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_calendar_snapshots_availability_check
    CHECK (availability_status IN ('available', 'blocked', 'booked', 'unknown')),
  CONSTRAINT booking_channel_calendar_snapshots_unique UNIQUE (connection_id, external_object_id, date)
);

CREATE INDEX IF NOT EXISTS idx_booking_channel_calendar_connection_date
  ON public.booking_channel_calendar_snapshots (connection_id, date DESC);

ALTER TABLE public.booking_channel_manager_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_channel_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_channel_imported_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_channel_imported_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_channel_calendar_snapshots ENABLE ROW LEVEL SECURITY;

-- Dashboard APIs use the server-side service role. The new tables are not exposed
-- to anon/authenticated clients directly.
REVOKE ALL ON public.booking_channel_manager_connections FROM anon, authenticated;
REVOKE ALL ON public.booking_channel_import_runs FROM anon, authenticated;
REVOKE ALL ON public.booking_channel_imported_objects FROM anon, authenticated;
REVOKE ALL ON public.booking_channel_imported_bookings FROM anon, authenticated;
REVOKE ALL ON public.booking_channel_calendar_snapshots FROM anon, authenticated;
GRANT ALL ON public.booking_channel_manager_connections TO service_role;
GRANT ALL ON public.booking_channel_import_runs TO service_role;
GRANT ALL ON public.booking_channel_imported_objects TO service_role;
GRANT ALL ON public.booking_channel_imported_bookings TO service_role;
GRANT ALL ON public.booking_channel_calendar_snapshots TO service_role;
