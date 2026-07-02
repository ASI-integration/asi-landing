-- Market Signals Ingestion v1.
-- Manual/provider-ready ingestion only. No external provider calls or OTA price push.

CREATE TABLE IF NOT EXISTS public.booking_market_signal_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE CASCADE,
  property_id text,
  source_type text NOT NULL DEFAULT 'manual',
  provider text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'draft',
  radius_km numeric(6,2),
  schedule_status text NOT NULL DEFAULT 'not_scheduled',
  last_ingested_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_reason text,
  safe_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_market_signal_sources_type_check CHECK (source_type IN (
    'manual', 'channel_import', 'weather_provider_placeholder', 'events_provider_placeholder',
    'market_provider_placeholder', 'competitor_snapshot', 'supply_snapshot', 'internal'
  )),
  CONSTRAINT booking_market_signal_sources_provider_check CHECK (provider IN (
    'manual', 'openweather_placeholder', 'yandex_weather_placeholder',
    'event_provider_placeholder', 'channel_manager', 'other'
  )),
  CONSTRAINT booking_market_signal_sources_status_check CHECK (status IN (
    'draft', 'configured', 'active_placeholder', 'active_manual', 'paused', 'failed', 'blocked'
  )),
  CONSTRAINT booking_market_signal_sources_schedule_check CHECK (schedule_status IN (
    'not_scheduled', 'scheduled_placeholder', 'manual_run', 'failed'
  )),
  CONSTRAINT booking_market_signal_sources_radius_check
    CHECK (radius_km IS NULL OR radius_km IN (1, 3, 7, 10))
);

CREATE INDEX IF NOT EXISTS idx_booking_market_signal_sources_setup
  ON public.booking_market_signal_sources (property_setup_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_market_signal_ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.booking_market_signal_sources(id) ON DELETE SET NULL,
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE CASCADE,
  property_id text,
  status text NOT NULL DEFAULT 'queued',
  signal_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  date_from date,
  date_to date,
  radii_km jsonb NOT NULL DEFAULT '[]'::jsonb,
  ingested_count integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  safe_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_market_signal_ingestion_runs_status_check CHECK (status IN (
    'queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'dry_run'
  )),
  CONSTRAINT booking_market_signal_ingestion_runs_count_check CHECK (ingested_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_booking_market_signal_ingestion_runs_setup
  ON public.booking_market_signal_ingestion_runs (property_setup_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_market_signal_ingestion_runs_source
  ON public.booking_market_signal_ingestion_runs (source_id, created_at DESC);

ALTER TABLE public.booking_market_signal_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_market_signal_ingestion_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_market_signal_sources FROM anon, authenticated;
REVOKE ALL ON public.booking_market_signal_ingestion_runs FROM anon, authenticated;
GRANT ALL ON public.booking_market_signal_sources TO service_role;
GRANT ALL ON public.booking_market_signal_ingestion_runs TO service_role;

COMMENT ON TABLE public.booking_market_signal_sources IS
  'Manual/provider-ready market signal sources. Placeholder providers do not imply live coverage.';
COMMENT ON TABLE public.booking_market_signal_ingestion_runs IS
  'Auditable market signal ingestion runs. Scheduler-ready; no live cron is installed.';
