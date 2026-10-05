import { describe, expect, it, vi } from 'vitest';
import { haversineMeters } from '../geometry';
import { validateLocation, validateSpatialEvidence, validSpatialRadius } from '../spatial-validation';
import type { SpatialEvidence, SpatialLocation, SpatialMode, SpatialRequest, SpatialSource } from '../spatial-validation-types';

const now = new Date('2026-10-01T12:00:00.000Z');
const source: SpatialSource = { provider: 'survey', observedAt: now.toISOString(), origin: 'external', delivery: 'live', reference: 'survey-1' };
function fixture(mode: SpatialMode = 'residential') {
  const request: SpatialRequest = { scope: { kind: 'account', accountId: 'A', locationId: 'P' }, mode, purpose: 'site_assessment', radiusMeters: 1000 };
  const coordinates = { lat: 59.92, lon: 30.35 };
  const location: SpatialLocation = { scope: request.scope, mode, objectKind: mode === 'commercial' ? 'commercial_location' : 'property',
    address: 'Лиговский проспект, Санкт-Петербург', city: 'Санкт-Петербург', country: 'RU', coordinates, addressCoordinates: coordinates, source };
  const evidence: SpatialEvidence = { scope: request.scope, mode, center: coordinates, radiusMeters: 1000,
    source, status: 'available', coverage: ['poi', 'competitor'],
    entities: [{ id: 'station', kind: 'transit', category: 'metro', name: 'Метро', coordinates, source }] };
  return { request, location, evidence };
}
describe('shared spatial validation', () => {
  it.each(['residential', 'commercial'] as const)('%s valid scoped real evidence', mode => {
    const f = fixture(mode);
    const result = validateSpatialEvidence(f.request, f.location, [f.evidence], now);
    expect(result.ok).toBe(true);
    expect(result.counts.competitor).toBe(0);
    expect(result.provenance).toContainEqual(source);
    expect(result).toEqual(validateSpatialEvidence(f.request, f.location, [f.evidence], now));
  });
  it.each([null, {lat:NaN,lon:30}, {lat:91,lon:30}, {lat:60,lon:181}])('rejects malformed point %j', coordinates => {
    const f = fixture(); f.location.coordinates = coordinates;
    expect(validateSpatialEvidence(f.request,f.location,[f.evidence],now).ok).toBe(false);
  });
  it('metres, 1–5 km bounds, exact radius boundary and longitude are respected', () => {
    expect(validSpatialRadius(1000)).toBe(true); expect(validSpatialRadius(5000)).toBe(true);
    for(const value of [999,5001,NaN,Infinity]) expect(validSpatialRadius(value)).toBe(false);
    expect(haversineMeters(0,0,0,1)).toBeCloseTo(111194.9266,2);
    const f=fixture(); f.request.radiusMeters=1001;
    const distance=1001, lon=f.location.coordinates!.lon;
    const lat=f.location.coordinates!.lat+distance/6371000*180/Math.PI;
    f.evidence.radiusMeters=1001;
    f.evidence.entities.push({...f.evidence.entities[0],id:'edge',coordinates:{lat,lon}});
    f.evidence.entities.push({...f.evidence.entities[0],id:'outside',coordinates:{lat:lat+0.00001,lon}});
    const result=validateSpatialEvidence(f.request,f.location,[f.evidence],now);
    expect(result.nearby.some(e=>e.id==='outside')).toBe(false);
    expect(result.nearby.find(e=>e.id==='edge')?.distanceMeters).toBeCloseTo(1001,5);
  });
  it.each(['residential', 'commercial'] as const)('%s foreign identity is redacted before provider is called', async mode => {
    const f=fixture(mode); f.location.scope={kind:'account',accountId:'B',locationId:'P'};
    const loadEvidence=vi.fn(async()=>[f.evidence]);
    const result=await validateLocation(f.request,{resolveLocation:async()=>f.location,loadEvidence},now);
    expect(result.ok).toBe(false); expect(result.location).toBeNull(); expect(loadEvidence).not.toHaveBeenCalled();
  });
  it('foreign cached evidence is neither returned nor counted', () => {
    const f=fixture(); f.evidence.scope={kind:'account',accountId:'B',locationId:'P'};
    const result=validateSpatialEvidence(f.request,f.location,[f.evidence],now);
    expect(result.ok).toBe(false); expect(result.evidence).toEqual([]); expect(result.nearby).toEqual([]);
  });
  it.each(['residential', 'commercial'] as const)('%s wrong location within the same account fails', mode => {
    const f=fixture(mode); f.location.scope={kind:'account',accountId:'A',locationId:'other'};
    expect(validateSpatialEvidence(f.request,f.location,[f.evidence],now).location).toBeNull();
  });
  it.each(['provider','resolver'] as const)('%s outage fails closed', async kind => {
    const f=fixture();
    const result=await validateLocation(f.request,{
      resolveLocation:async()=>{if(kind==='resolver')throw new Error('secret error');return f.location;},
      loadEvidence:async()=>{throw new Error('secret error');},
    },now);
    expect(result.ok).toBe(false);expect(JSON.stringify(result)).not.toContain('secret error');
    expect(result.counts.competitor).toBeUndefined();
  });
  it('ownership change while provider is awaited releases no data', async () => {
    const f=fixture(); let changed=false;
    const result=await validateLocation(f.request,{
      resolveLocation:async()=>changed?null:f.location,
      loadEvidence:async()=>{changed=true;return [f.evidence];},
    },now);
    expect(result.ok).toBe(false);expect(result.evidence).toEqual([]);expect(result.location).toBeNull();
  });
  it.each(['synthetic','stale','future','unavailable'] as const)('rejects %s evidence', kind => {
    const f=fixture();f.evidence.source={...source};
    if(kind==='synthetic') f.evidence.source.origin='synthetic';
    if(kind==='stale') f.evidence.source.observedAt='2020-01-01T00:00:00Z';
    if(kind==='future') f.evidence.source.observedAt='2030-01-01T00:00:00Z';
    if(kind==='unavailable') f.evidence.status='unavailable';
    const result=validateSpatialEvidence(f.request,f.location,[f.evidence],now);
    expect(result.ok).toBe(false);expect(result.automated).toBe(false);expect(result.counts.competitor).toBeUndefined();
  });
  it.each(['residential', 'commercial'] as const)('%s manual survey is explicit operator review, never automated certification', mode => {
    const f=fixture(mode);f.evidence.source={...source,origin:'manual',delivery:'manual'};
    const result=validateSpatialEvidence(f.request,f.location,[f.evidence],now);
    expect(result.ok).toBe(true);expect(result.automated).toBe(false);expect(result.manualControls).toContain('operator_verified_spatial_evidence');
  });
  it('commercial minimum cannot be met by residential-only evidence', () => {
    const f=fixture();f.evidence.coverage=['poi'];
    expect(validateSpatialEvidence(f.request,f.location,[f.evidence],now).ok).toBe(true);
    f.request.mode='commercial';f.location.mode='commercial';f.evidence.mode='commercial';
    expect(validateSpatialEvidence(f.request,f.location,[f.evidence],now).blockers).toContain('commercial_competitor_coverage');
  });
  it('swapped point or mismatched address cannot pass consistency', () => {
    const f=fixture();f.location.coordinates={lat:30.35,lon:59.92};
    expect(validateSpatialEvidence(f.request,f.location,[f.evidence],now).blockers).toContain('address_coordinates_consistent');
  });
});
