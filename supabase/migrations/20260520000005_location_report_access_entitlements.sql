-- Report access entitlements: ownership and permissions separate from delivery channels.

CREATE TABLE IF NOT EXISTS location_report_access_entitlements (
  entitlement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES location_report_requests(id) ON DELETE CASCADE,
  report_id TEXT NULL,
  snapshot_id UUID NOT NULL REFERENCES location_report_snapshots(snapshot_id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'guest', 'email', 'share_link')),
  subject_id TEXT NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level IN ('preview', 'full_report', 'pdf_download', 'admin')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (snapshot_id, subject_type, subject_id, access_level)
);

CREATE INDEX IF NOT EXISTS idx_location_report_access_entitlements_request_created_at
  ON location_report_access_entitlements(request_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_location_report_access_entitlements_request_status
  ON location_report_access_entitlements(request_id, status);

ALTER TABLE location_report_access_entitlements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_updated_at_location_report_access_entitlements()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_location_report_access_entitlements_updated_at ON location_report_access_entitlements;
CREATE TRIGGER trg_location_report_access_entitlements_updated_at
BEFORE UPDATE ON location_report_access_entitlements
FOR EACH ROW EXECUTE FUNCTION set_updated_at_location_report_access_entitlements();
