-- Durable artifact lifecycle for paid location reports.
-- Access/unlock state remains on location_report_requests; this table only tracks generation artifacts.

CREATE TABLE IF NOT EXISTS location_report_artifacts (
  request_id UUID PRIMARY KEY REFERENCES location_report_requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'report_forming'
    CHECK (status IN ('report_forming', 'preliminary_ready', 'final_ready', 'pdf_ready', 'failed')),

  preliminary_report_url TEXT NULL,
  final_report_url TEXT NULL,
  pdf_url TEXT NULL,

  generated_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  cleanup_ready BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_location_report_artifacts_status_updated_at
  ON location_report_artifacts(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_location_report_artifacts_cleanup_ready_expires_at
  ON location_report_artifacts(cleanup_ready, expires_at)
  WHERE cleanup_ready = TRUE;

ALTER TABLE location_report_artifacts
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE location_report_artifacts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_updated_at_location_report_artifacts()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_location_report_artifacts_updated_at ON location_report_artifacts;
CREATE TRIGGER trg_location_report_artifacts_updated_at
BEFORE UPDATE ON location_report_artifacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at_location_report_artifacts();
