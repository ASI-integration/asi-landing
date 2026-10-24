import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import bundle from '@/lib/location/__fixtures__/golden-addresses.json';
import { buildLocationStandaloneReport } from '@/lib/location/standalone-report';
const boundary = vi.hoisted(() => ({ provider:vi.fn(), save:vi.fn() }));
vi.mock('@/lib/location', async () => ({ ...await vi.importActual('@/lib/location'), fetchOsmData:boundary.provider }));
vi.mock('@/lib/location/cache', () => ({ cacheGet:async()=>null, cacheSet:vi.fn(), cacheEvictCoord:vi.fn() }));
vi.mock('@/lib/location/standalone-report-store', () => ({ createStandaloneReport:boundary.save }));
import { POST } from '../route';
beforeEach(() => { vi.clearAllMocks(); boundary.save.mockResolvedValue({reportId:'synthetic-report'}); });
// Real NextRequest/Response, scoring, decision and free-report projection; provider and persistence are synthetic.
describe('offline HTTP to canonical decision to report', () => {
  it.each(bundle.cases)('$id keeps input score out of canonical output', async fixture => {
    boundary.provider.mockResolvedValue({ elements:fixture.replay.elements, hadProviderFailure:false, usedFallbackQuery:false });
    const response = await POST(new NextRequest('http://fixture/api/location-demo-analyze', {method:'POST', body:JSON.stringify({lat:fixture.replay.lat,lon:fixture.replay.lon,inputAddress:fixture.addressRu,locale:'ru', finalScore:99999, accessStatus:'paid_unlocked'})}));
    expect(response.status).toBe(200);
    const payload=await response.json();
    const decision=payload.analysis.locationDecision;
    expect(decision.coordinates).toEqual({lat:fixture.replay.lat,lon:fixture.replay.lon});
    expect(decision.finalScore === null || (decision.finalScore >= 0 && decision.finalScore <= 100)).toBe(true);
    expect(decision.finalScore).not.toBe(99999);
    const report=buildLocationStandaloneReport({address:fixture.addressRu,analysis:payload.analysis,verdict:'synthetic',reportMode:'free'});
    expect(report.reportMode).toBe('free');
    expect(report.accessStatus).toBe('created');
    expect(report.locationValidation).toEqual(payload.analysis.locationValidation);
    expect(JSON.stringify(report)).not.toContain('99999');
    expect(boundary.provider).toHaveBeenCalledTimes(1);
    if (payload.meta.reportCtaEligible) {
      expect(boundary.save).toHaveBeenCalledWith(expect.objectContaining({report:expect.objectContaining({reportMode:'free',accessStatus:'created'})}));
    } else { expect(boundary.save).not.toHaveBeenCalled(); }
  });
  it('provider outage cannot become a complete trustworthy score', async () => {
    boundary.provider.mockResolvedValue({elements:[], hadProviderFailure:true, usedFallbackQuery:false});
    const response=await POST(new NextRequest('http://fixture/api/location-demo-analyze',{method:'POST',body:JSON.stringify({lat:59.92,lon:30.35,inputAddress:'Санкт-Петербург, Лиговский проспект',locale:'ru'})}));
    expect(response.status).toBe(200);
    const payload=await response.json();
    expect(payload.analysis.locationValidation.ok).toBe(false);
    expect(payload.analysis.analysisIntegrity.scoreBlockedDueToIncompleteData).toBe(true);
    expect(boundary.save).not.toHaveBeenCalled();
  });
});
