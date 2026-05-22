-- Immutable versioned report snapshots (generated report versions).
-- Mutable processing lifecycle remains on location_report_artifacts.

CREATE TABLE IF NOT EXISTS location_report_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id TEXT NULL,
  request_id UUID NOT NULL REFERENCES location_report_requests(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at TIMESTAMPTZ NULL,
  report_layer TEXT NOT NULL CHECK (report_layer IN ('preliminary', 'final')),
  canonical_document JSONB NOT NULL,
  render_outputs JSONB NULL,
  source_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (request_id, version)
);

CREATE INDEX IF NOT EXISTS idx_location_report_snapshots_request_version
  ON location_report_snapshots(request_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_location_report_snapshots_request_layer_version
  ON location_report_snapshots(request_id, report_layer, version DESC);

ALTER TABLE location_report_snapshots ENABLE ROW LEVEL SECURITY;
