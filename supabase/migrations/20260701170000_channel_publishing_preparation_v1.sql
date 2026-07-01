-- Channel Publishing Preparation v1.
-- Provider-ready package only: this migration does not enable external OTA publishing.

CREATE TABLE IF NOT EXISTS public.booking_channel_publication_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE CASCADE,
  property_id text,
  connection_id uuid REFERENCES public.booking_channel_manager_connections(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'draft',
  readiness_score integer NOT NULL DEFAULT 0,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  safe_summary text,
  package_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_publication_packages_provider_check
    CHECK (provider IN ('manual', 'bnovo', 'realtycalendar', 'travelline', 'other')),
  CONSTRAINT booking_channel_publication_packages_status_check
    CHECK (status IN ('draft', 'incomplete', 'ready_for_review', 'ready_for_publication',
      'publication_pending', 'published_placeholder', 'blocked')),
  CONSTRAINT booking_channel_publication_packages_readiness_score_check
    CHECK (readiness_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_booking_channel_publication_packages_setup
  ON public.booking_channel_publication_packages (property_setup_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_channel_publication_packages_connection
  ON public.booking_channel_publication_packages (connection_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_channel_publication_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.booking_channel_publication_packages(id) ON DELETE CASCADE,
  channel_key text NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'not_selected',
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_publication_channels_key_check
    CHECK (channel_key IN ('ostrovok', 'yandex_travel', 'avito_travel', 'sutochno', 'cian',
      '101hotels', 'bronevik', 'kvartirka', 'ozon_travel', 'mts_travel', 'onetwotrip',
      'twil', 'otello', 'other')),
  CONSTRAINT booking_channel_publication_channels_status_check
    CHECK (status IN ('not_selected', 'selected', 'ready', 'missing_data',
      'publication_pending', 'published_placeholder', 'blocked')),
  CONSTRAINT booking_channel_publication_channels_package_key_unique UNIQUE (package_id, channel_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_channel_publication_channels_package
  ON public.booking_channel_publication_channels (package_id, selected, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_channel_publication_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.booking_channel_publication_packages(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  status text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_publication_checks_status_check
    CHECK (status IN ('pass', 'warning', 'fail', 'skipped')),
  CONSTRAINT booking_channel_publication_checks_package_key_unique UNIQUE (package_id, check_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_channel_publication_checks_package
  ON public.booking_channel_publication_checks (package_id, status, updated_at DESC);

ALTER TABLE public.booking_channel_publication_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_channel_publication_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_channel_publication_checks ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.booking_channel_publication_packages TO service_role;
GRANT ALL ON public.booking_channel_publication_channels TO service_role;
GRANT ALL ON public.booking_channel_publication_checks TO service_role;

COMMENT ON TABLE public.booking_channel_publication_packages IS
  'Safe provider-ready publication packages. Does not represent real OTA publication.';
COMMENT ON COLUMN public.booking_channel_publication_packages.package_payload IS
  'Allowlisted publication data only. Credentials, access codes and guest data are prohibited.';
