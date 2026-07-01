-- Pricing Intelligence & Tariff Grid Autopilot v1.
-- Foundation for dynamic pricing recommendations. Does not push prices to OTA.

CREATE TABLE IF NOT EXISTS public.booking_pricing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE CASCADE,
  property_id text,
  connection_id uuid REFERENCES public.booking_channel_manager_connections(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  pricing_strategy text NOT NULL DEFAULT 'balanced',
  base_price numeric(14,2),
  min_price numeric(14,2),
  max_price numeric(14,2),
  cleaning_fee numeric(14,2),
  deposit_amount numeric(14,2),
  currency text NOT NULL DEFAULT 'RUB',
  min_stay_default integer,
  max_stay_default integer,
  readiness_score integer NOT NULL DEFAULT 0,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_pricing_profiles_status_check
    CHECK (status IN ('draft', 'incomplete', 'ready_for_recommendations', 'recommendations_ready',
      'auto_apply_ready', 'auto_apply_enabled', 'blocked')),
  CONSTRAINT booking_pricing_profiles_strategy_check
    CHECK (pricing_strategy IN ('balanced', 'occupancy_first', 'adr_first', 'aggressive_growth',
      'conservative', 'event_driven', 'custom')),
  CONSTRAINT booking_pricing_profiles_readiness_score_check
    CHECK (readiness_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_booking_pricing_profiles_setup
  ON public.booking_pricing_profiles (property_setup_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_pricing_profiles_property
  ON public.booking_pricing_profiles (property_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_property_audience_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE CASCADE,
  property_id text,
  primary_audience text NOT NULL DEFAULT 'unknown',
  secondary_audiences jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score integer NOT NULL DEFAULT 0,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_property_audience_profiles_audience_check
    CHECK (primary_audience IN ('leisure_seaside', 'business_center', 'family_vacation', 'medical_travel',
      'event_visitors', 'students', 'nightlife', 'transit', 'remote_work', 'budget', 'premium', 'mixed', 'unknown')),
  CONSTRAINT booking_property_audience_profiles_confidence_check
    CHECK (confidence_score BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_property_audience_profiles_setup_unique
  ON public.booking_property_audience_profiles (property_setup_id)
  WHERE property_setup_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.booking_pricing_market_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE CASCADE,
  property_id text,
  signal_date date NOT NULL,
  radius_km numeric(6,2) NOT NULL,
  signal_type text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score integer NOT NULL DEFAULT 50,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_pricing_market_signals_type_check
    CHECK (signal_type IN ('competitor_prices', 'available_supply', 'occupancy_pressure',
      'event_pressure', 'weather_pressure', 'seasonality', 'booking_pace', 'channel_snapshot',
      'manual_snapshot', 'other')),
  CONSTRAINT booking_pricing_market_signals_source_check
    CHECK (source IN ('manual', 'channel_import', 'weather_provider_placeholder',
      'events_provider_placeholder', 'market_provider_placeholder', 'internal')),
  CONSTRAINT booking_pricing_market_signals_confidence_check
    CHECK (confidence_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_booking_pricing_market_signals_setup_date
  ON public.booking_pricing_market_signals (property_setup_id, signal_date, radius_km);

CREATE TABLE IF NOT EXISTS public.booking_tariff_grid_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_profile_id uuid NOT NULL REFERENCES public.booking_pricing_profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  base_price numeric(14,2),
  recommended_price numeric(14,2),
  final_price numeric(14,2),
  min_price numeric(14,2),
  max_price numeric(14,2),
  min_stay integer,
  demand_score integer NOT NULL DEFAULT 50,
  supply_score integer NOT NULL DEFAULT 50,
  event_score integer NOT NULL DEFAULT 50,
  weather_score integer NOT NULL DEFAULT 50,
  audience_score integer NOT NULL DEFAULT 50,
  adjustment_reason jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_tariff_grid_days_status_check
    CHECK (status IN ('draft', 'recommended', 'approved', 'auto_applied_placeholder', 'blocked')),
  CONSTRAINT booking_tariff_grid_days_unique UNIQUE (pricing_profile_id, date),
  CONSTRAINT booking_tariff_grid_days_demand_check CHECK (demand_score BETWEEN 0 AND 100),
  CONSTRAINT booking_tariff_grid_days_supply_check CHECK (supply_score BETWEEN 0 AND 100),
  CONSTRAINT booking_tariff_grid_days_event_check CHECK (event_score BETWEEN 0 AND 100),
  CONSTRAINT booking_tariff_grid_days_weather_check CHECK (weather_score BETWEEN 0 AND 100),
  CONSTRAINT booking_tariff_grid_days_audience_check CHECK (audience_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_booking_tariff_grid_days_profile_date
  ON public.booking_tariff_grid_days (pricing_profile_id, date);

CREATE TABLE IF NOT EXISTS public.booking_pricing_recommendation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_profile_id uuid NOT NULL REFERENCES public.booking_pricing_profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  date_from date NOT NULL,
  date_to date NOT NULL,
  strategy text NOT NULL DEFAULT 'balanced',
  signals_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  safe_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_pricing_recommendation_runs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'dry_run')),
  CONSTRAINT booking_pricing_recommendation_runs_strategy_check
    CHECK (strategy IN ('balanced', 'occupancy_first', 'adr_first', 'aggressive_growth',
      'conservative', 'event_driven', 'custom'))
);

CREATE INDEX IF NOT EXISTS idx_booking_pricing_recommendation_runs_profile
  ON public.booking_pricing_recommendation_runs (pricing_profile_id, created_at DESC);

ALTER TABLE public.booking_pricing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_property_audience_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_pricing_market_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_tariff_grid_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_pricing_recommendation_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_pricing_profiles FROM anon, authenticated;
REVOKE ALL ON public.booking_property_audience_profiles FROM anon, authenticated;
REVOKE ALL ON public.booking_pricing_market_signals FROM anon, authenticated;
REVOKE ALL ON public.booking_tariff_grid_days FROM anon, authenticated;
REVOKE ALL ON public.booking_pricing_recommendation_runs FROM anon, authenticated;

GRANT ALL ON public.booking_pricing_profiles TO service_role;
GRANT ALL ON public.booking_property_audience_profiles TO service_role;
GRANT ALL ON public.booking_pricing_market_signals TO service_role;
GRANT ALL ON public.booking_tariff_grid_days TO service_role;
GRANT ALL ON public.booking_pricing_recommendation_runs TO service_role;

COMMENT ON TABLE public.booking_pricing_profiles IS
  'Pricing intelligence profiles. Recommendations only — no live OTA price push.';
COMMENT ON TABLE public.booking_tariff_grid_days IS
  'Day-level tariff grid with transparent adjustment reasons. auto_applied_placeholder is not a real OTA push.';
