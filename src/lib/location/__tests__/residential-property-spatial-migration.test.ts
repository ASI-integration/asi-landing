import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20261003093000_residential_property_spatial_snapshots_v1.sql',
  ),
  'utf8',
);

describe('residential property spatial snapshot migration contract', () => {
  it('binds snapshots to canonical account and property ownership', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS residential_property_spatial_snapshots');
    expect(migration).toContain('account_id UUID NOT NULL REFERENCES accounts(id)');
    expect(migration).toContain('property_id UUID NOT NULL REFERENCES properties(id)');
    expect(migration).toContain(
      'CONSTRAINT residential_property_spatial_snapshot_unique UNIQUE (account_id, property_id)',
    );
  });
  it('stores versioned observation time and canonical SpatialValidation payload', () => {
    expect(migration).toContain('revision TEXT NOT NULL');
    expect(migration).toContain('observed_at TIMESTAMPTZ NOT NULL');
    expect(migration).toContain('validation_json JSONB NOT NULL');
  });

  it('is server-owned rather than directly writable by tenant browser sessions', () => {
    expect(migration).toContain(
      'ALTER TABLE residential_property_spatial_snapshots ENABLE ROW LEVEL SECURITY',
    );
    expect(migration).toContain('CREATE POLICY "service_role_full_access"');
    expect(migration).toContain("USING (auth.role() = 'service_role')");
    expect(migration).toContain("WITH CHECK (auth.role() = 'service_role')");
  });

  it('does not repurpose the public address cache or report snapshot tables', () => {
    expect(migration).not.toContain('ALTER TABLE location_analysis_cache');
    expect(migration).not.toContain('ALTER TABLE location_report_snapshots');
  });
});
