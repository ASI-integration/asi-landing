-- Asynchronous “full location report” requests.
-- These requests are created from the fast demo/preview UI and processed later.

CREATE TABLE IF NOT EXISTS location_report_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locale TEXT NOT NULL CHECK (locale IN ('ru', 'en')),
  mode TEXT NOT NULL CHECK (mode IN ('residential', 'commercial')),

  address TEXT NOT NULL,
  lat DOUBLE PRECISION NULL,
  lon DOUBLE PRECISION NULL,

  -- Delivery target is optional; dashboard delivery can be added later.
  delivery_channel TEXT NULL CHECK (delivery_channel IN ('email', 'telegram', 'dashboard')),
  delivery_target TEXT NULL,

  -- Monetization-ready: request can be created even if payment is required.
  access_tier TEXT NOT NULL DEFAULT 'unknown' CHECK (access_tier IN ('unknown', 'included', 'paid_required')),

  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  report_id UUID NULL,
  error TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_location_report_requests_status_created_at
  ON location_report_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_location_report_requests_locale_created_at
  ON location_report_requests(locale, created_at DESC);

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION set_updated_at_location_report_requests()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_location_report_requests_updated_at ON location_report_requests;
CREATE TRIGGER trg_location_report_requests_updated_at
BEFORE UPDATE ON location_report_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at_location_report_requests();

