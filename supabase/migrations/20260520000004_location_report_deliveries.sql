-- Planned and completed report deliveries per immutable snapshot.
-- Snapshots hold generated content; this table tracks channel-specific delivery state.

CREATE TABLE IF NOT EXISTS location_report_deliveries (
  delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES location_report_requests(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES location_report_snapshots(snapshot_id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('cabinet', 'email', 'permalink', 'pdf_download')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'delivered', 'failed', 'skipped')),
  target TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (snapshot_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_location_report_deliveries_request_created_at
  ON location_report_deliveries(request_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_location_report_deliveries_snapshot_created_at
  ON location_report_deliveries(snapshot_id, created_at ASC);

ALTER TABLE location_report_deliveries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_updated_at_location_report_deliveries()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_location_report_deliveries_updated_at ON location_report_deliveries;
CREATE TRIGGER trg_location_report_deliveries_updated_at
BEFORE UPDATE ON location_report_deliveries
FOR EACH ROW EXECUTE FUNCTION set_updated_at_location_report_deliveries();
