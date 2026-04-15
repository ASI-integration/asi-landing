-- Persisted standalone location reports (permalink-friendly)
-- Stored as JSONB: the already-prepared LocationStandaloneReport is the source of truth.

CREATE TABLE IF NOT EXISTS location_standalone_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locale TEXT NOT NULL CHECK (locale IN ('ru', 'en')),
  address TEXT NOT NULL,
  report_version TEXT NOT NULL,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_location_standalone_reports_created_at
  ON location_standalone_reports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_location_standalone_reports_locale_created_at
  ON location_standalone_reports(locale, created_at DESC);

