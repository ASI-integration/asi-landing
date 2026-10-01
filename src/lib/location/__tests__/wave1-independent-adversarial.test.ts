import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { validateLocation, validateSpatialEvidence } from '../spatial-validation';
import { validatePublicOsmLocation } from '../spatial-validation-osm';
import { ensurePaidLocationReportForRequest } from '../location-report-engine';
import type { SpatialRequest, SpatialLocation, SpatialEvidence } from '../spatial-validation-types';
import type { LocationReportRequestEntity } from '../report-request-store';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), create: vi.fn(), link: vi.fn(), geocode: vi.fn() }));
vi.mock('../overpass', () => ({ fetchOsmData: mocks.fetch }));
vi.mock('../standalone-report-store', () => ({ createStandaloneReport: mocks.create, getStandaloneReportById: vi.fn() }));
vi.mock('../report-request-store', () => ({ getLocationReportRequestById: vi.fn(), linkLocationReportRequestReport: mocks.link }));
vi.mock('../address-providers/geocode-pipeline', () => ({ geocodePlainAddressForMarket: mocks.geocode }));
vi.mock('../cache', () => ({ cacheGetByAddress: vi.fn(async () => null), cacheSet: vi.fn() }));
const now = new Date('2026-10-01T12:00:00Z');
const point = { lat: 59.92, lon: 30.35 };
function fixture(mode: 'residential' | 'commercial' = 'residential') {
  const scope = { kind: 'account' as const, accountId: 'A', locationId: 'P' };
  const source = { provider: 'survey', observedAt: now.toISOString(), origin: 'external' as const, delivery: 'live' as const };
  const request: SpatialRequest = { scope, mode, purpose: 'site_assessment', radiusMeters: 1000 };
  const location: SpatialLocation = { scope, mode, objectKind: 'property', address: 'Ligovsky, SPB', city: 'SPB', country: 'RU', coordinates: { ...point }, addressCoordinates: { ...point }, source };
  const evidence: SpatialEvidence = { scope, mode, center: { ...point }, radiusMeters: 1000, source, status: 'available', coverage: ['competitor'], entities: [{ id: '1', kind: 'transit', category: 'metro', name: 'Station', coordinates: { ...point }, source }] };
  return { request, location, evidence };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External network forbidden in audit'); }));
  mocks.create.mockResolvedValue({ reportId: 'local-report' });
  mocks.link.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
describe('Wave 1 independent adversarial safety assertions', () => {
  it.each([0, -1, 999, 5001, 1e15])('rejects radius %s', radiusMeters => {
    const f = fixture(); f.request.radiusMeters = radiusMeters;
    expect(validateSpatialEvidence(f.request, f.location, [f.evidence], now).ok).toBe(false);
  });
  it.each(['residential', 'commercial'] as const)('%s rejects foreign account cache', mode => {
    const f = fixture(mode); f.evidence.scope = { kind: 'account', accountId: 'B', locationId: 'P' };
    const result = validateSpatialEvidence(f.request, f.location, [f.evidence], now);
    expect(result.ok).toBe(false); expect(result.evidence).toEqual([]);
  });
  it('rejects changed ownership returned as a new object after await', async () => {
    const f = fixture(); let changed = false;
    const result = await validateLocation(f.request, {
      resolveLocation: async () => changed ? { ...f.location, scope: { kind: 'account', accountId: 'B', locationId: 'P' } } : f.location,
      loadEvidence: async () => { changed = true; return [f.evidence]; },
    }, now);
    expect(result.ok).toBe(false); expect(result.location).toBeNull();
  });
  it('does not accept a mutated shared identity after the provider await', async () => {
    const f = fixture();
    const result = await validateLocation(f.request, {
      resolveLocation: async () => f.location,
      loadEvidence: async () => {
        if (f.location.scope.kind === 'account') f.location.scope.accountId = 'B';
        return [f.evidence];
      },
    }, now);
    expect(result.ok, JSON.stringify({ scope: result.scope, ok: result.ok, automated: result.automated })).toBe(false);
  });
  it('does not certify an unknown provider entity kind as residential evidence', () => {
    const f = fixture();
    f.evidence.entities[0].kind = 'not-a-spatial-kind' as never;
    const result = validateSpatialEvidence(f.request, f.location, [f.evidence], now);
    expect(result.ok, JSON.stringify({ ok: result.ok, automated: result.automated, counts: result.counts })).toBe(false);
  });
  it('missing provenance fails closed in the runner', async () => {
    const f = fixture(); f.evidence.entities[0].source = undefined as never;
    const result = await validateLocation(f.request, { resolveLocation: async () => f.location, loadEvidence: async () => [f.evidence] }, now);
    expect(result.ok).toBe(false);
  });
  it('timeout-like exception releases no evidence', async () => {
    const f = fixture();
    const result = await validateLocation(f.request, { resolveLocation: async () => f.location, loadEvidence: async () => { throw new Error('ETIMEDOUT'); } }, now);
    expect(result.ok).toBe(false); expect(result.evidence).toEqual([]);
  });
  it('does not fabricate an OSM reference for an element without an id', () => {
    const result = validatePublicOsmLocation({ mode: 'commercial', ...point, address: 'Ligovsky, SPB', now,
      observedAt: now.toISOString(), hadProviderFailure: false,
      elements: [{ type: 'node', lat: point.lat, lon: point.lon, tags: { railway: 'subway_entrance', name: 'Station' } } as never] });
    expect(result.ok, JSON.stringify(result.provenance)).toBe(false);
  });
  it.each(['residential', 'commercial'] as const)('%s paid report rejects malformed OSM identity before persistence', async mode => {
    mocks.fetch.mockResolvedValue({ elements: [{ type: 'node', lat: point.lat, lon: point.lon, tags: { railway: 'subway_entrance', name: 'Station' } }], hadProviderFailure: false, usedFallbackQuery: false });
    const entity = { id: 'local-request', locale: 'ru', address: 'Ligovsky, SPB', mode, ...point, report_id: null } as LocationReportRequestEntity;
    let rejected = false;
    try { await ensurePaidLocationReportForRequest(entity.id, { entity }); } catch { rejected = true; }
    expect({ rejected, reports: mocks.create.mock.calls.length, links: mocks.link.mock.calls.length }).toEqual({ rejected: true, reports: 0, links: 0 });
  });
});

