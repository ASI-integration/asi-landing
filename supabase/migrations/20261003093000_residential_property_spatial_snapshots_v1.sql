-- Wave 5: canonical account/property-bound residential spatial snapshots.
-- Public address caches and paid-report snapshots are intentionally not reused as property truth.
CREATE TABLE IF NOT EXISTS residential_property_spatial_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  validation_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT residential_property_spatial_snapshot_unique UNIQUE (account_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_residential_property_spatial_snapshots_property
  ON residential_property_spatial_snapshots(property_id);

CREATE INDEX IF NOT EXISTS idx_residential_property_spatial_snapshots_observed
  ON residential_property_spatial_snapshots(observed_at DESC);
ALTER TABLE residential_property_spatial_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access"
  ON residential_property_spatial_snapshots;

CREATE POLICY "service_role_full_access"
  ON residential_property_spatial_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE residential_property_spatial_snapshots IS
  'Server-owned RU residential SpatialValidation snapshots bound to canonical account_id + property_id.';
