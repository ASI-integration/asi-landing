-- Canonical materialized report payloads (immutable snapshot -> target render cache).

CREATE TABLE IF NOT EXISTS location_report_materialized (
  materialized_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES location_report_snapshots(snapshot_id) ON DELETE CASCADE,
  report_id TEXT NULL,
  target TEXT NOT NULL CHECK (target IN ('web', 'pdf', 'dashboard', 'preview')),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'stale', 'rebuilding', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (snapshot_id, target)
);

CREATE INDEX IF NOT EXISTS idx_location_report_materialized_snapshot_target
  ON location_report_materialized(snapshot_id, target);

CREATE INDEX IF NOT EXISTS idx_location_report_materialized_report_target
  ON location_report_materialized(report_id, target)
  WHERE report_id IS NOT NULL;

ALTER TABLE location_report_materialized ENABLE ROW LEVEL SECURITY;
