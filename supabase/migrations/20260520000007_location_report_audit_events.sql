-- Report pipeline audit events: lightweight observability across layers.

CREATE TABLE IF NOT EXISTS location_report_audit_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES location_report_requests(id) ON DELETE CASCADE,
  report_id TEXT NULL,
  snapshot_id UUID NULL REFERENCES location_report_snapshots(snapshot_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN (
    'payment', 'artifact', 'producer', 'adapter', 'document', 'renderer',
    'snapshot', 'materialization', 'delivery', 'entitlement', 'gateway', 'lifecycle'
  )),
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'skipped', 'failed', 'warning')),
  message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_location_report_audit_events_request_created_at
  ON location_report_audit_events(request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_location_report_audit_events_report_created_at
  ON location_report_audit_events(report_id, created_at DESC)
  WHERE report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_location_report_audit_events_snapshot_created_at
  ON location_report_audit_events(snapshot_id, created_at DESC)
  WHERE snapshot_id IS NOT NULL;

ALTER TABLE location_report_audit_events ENABLE ROW LEVEL SECURITY;
