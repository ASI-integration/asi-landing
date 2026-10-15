import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closestPointOnSegmentPlanar } from '../spatial-foundation';
import { haversineMeters } from '../geometry';
import { normalizeReportAccessEntitlementRow } from '../report-access-entitlement';
import { resolveReportAccess } from '../report-access-resolver';
import { canExposePaidLocationReport } from '../report-access';
import type { PersistableLocationReport } from '../standalone-report';
import { buildAnalysis } from '../gravity-scoring';
const db = vi.hoisted(() => ({ row: null as any, deletes: 0 }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row }) }) }),
  delete: () => ({ eq: async () => { db.deletes++; } }),
}) } }));
import { cacheGet, cacheGetByAddress } from '../cache';

describe('deep audit trust boundaries', () => {
  it.each([undefined, null, '', 'ACTIVE', 'revokedd'])('unknown entitlement status %s cannot grant access', status => {
    const entitlement = normalizeReportAccessEntitlementRow({ entitlement_id:'e', request_id:'r', snapshot_id:'s', subject_type:'user', subject_id:'u', access_level:'admin', status });
    expect(resolveReportAccess({ entitlements:[entitlement], requestId:'r', subjectType:'user', subjectId:'u' }).can_access_dashboard).toBe(false);
  });
  it.each([undefined, null, '', 'unknown'])('paid report without proven access status %s stays locked', accessStatus => {
    expect(canExposePaidLocationReport({ version:'v1', reportMode:'paid', accessStatus } as unknown as PersistableLocationReport)).toBe(false);
  });
  it('explicit active entitlement still works', () => {
    const entitlement = normalizeReportAccessEntitlementRow({ entitlement_id:'e', request_id:'r', snapshot_id:'s', subject_type:'user', subject_id:'u', access_level:'full_report', status:'active' });
    expect(resolveReportAccess({ entitlements:[entitlement], requestId:'r', subjectType:'user', subjectId:'u' }).can_view_full).toBe(true);
  });
  it.each([0, 30, -30, 80])('local geometry is invariant under longitude translation at latitude %s', lat => {
    const ordinary = closestPointOnSegmentPlanar(lat, 10, lat, 10.02, lat, 10.01);
    const dateline = closestPointOnSegmentPlanar(lat, 179.99, lat, -179.99, lat, 180);
    expect(dateline.alongDistSM).toBeCloseTo(ordinary.alongDistSM, 5);
    expect(dateline.t).toBeCloseTo(0.5, 8);
    expect(dateline.crossTrackM).toBeLessThan(0.001);
    expect(haversineMeters(lat, 179.99, lat, -179.99)).toBeCloseTo(haversineMeters(lat, 10, lat, 10.02), 5);
  });
  beforeEach(() => { db.deletes = 0; db.row = { coord_key:'59.9200,30.3500', lat:59.92, lon:30.35, address_key:'fixture', analysis:buildAnalysis([],59.92,30.35), elements_count:0, source:'synthetic', updated_at:new Date().toISOString() }; });
  it.each(['not-a-date', '2099-01-01T00:00:00Z'])('rejects unverifiable cache timestamp %s', async timestamp => {
    db.row.updated_at = timestamp;
    expect(await cacheGet(59.92,30.35)).toBeNull();
    expect(db.deletes).toBe(1);
  });
  it.each([[91,30], [59,181], [NaN,30]])('address cache cannot return invalid WGS84 %s/%s', async (lat,lon) => {
    db.row.lat=lat; db.row.lon=lon;
    expect(await cacheGetByAddress('fixture')).toBeNull();
  });
  it('valid cache remains usable', async () => {
    expect((await cacheGet(59.92,30.35))?.freshness).toBe('fresh');
    expect(db.deletes).toBe(0);
  });
});
