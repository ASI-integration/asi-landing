import { describe, expect, it } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import { buildAudienceAnalysis } from '../audience-scoring';
import { computeResidentialDemoPresentation } from '../rules/residential-location-rules';
import type { MagnetItem, OSMElement } from '../types';

const anchor = (name: string, categoryId = 'attraction'): MagnetItem => ({
  categoryId, name, categoryLabel: categoryId, icon: '', lat: 59.94, lon: 30.31,
  distance: 300, weight: 6, permanenceType: 'permanent', scopeLevel: 'city',
  strengthClass: 'strong', attractionScore: 4.8,
});
const cafe: OSMElement = { type: 'node', id: 1, lat: 59.9301, lon: 30.3601, tags: { amenity: 'cafe', name: 'Synthetic cafe A' } };

describe('Evidence-preserving scoring corrections', () => {
  it('credible tourist-only evidence does not depend on business anchors', () => {
    const a = buildAudienceAnalysis([anchor('Государственный Эрмитаж'), anchor('Мариинский театр')]);
    expect(a.primaryAudience).toBe('TOURIST');
    expect(a.fallbackMode).toBe(false);
  });
  it('weak tourism and missing evidence remain fallback', () => {
    expect(buildAudienceAnalysis([]).fallbackMode).toBe(true);
    expect(buildAudienceAnalysis([anchor('Музей предприятия')]).fallbackMode).toBe(true);
  });
  it('tourist classification alone never lifts the independent strong-score cap', () => {
    const a = buildAnalysis([], 59.93, 30.36);
    a.magnets = [anchor('Государственный Эрмитаж')];
    a.audienceAnalysis = buildAudienceAnalysis(a.magnets);
    const p = computeResidentialDemoPresentation(a, 96);
    expect(p.cappedHeadline).toBeLessThanOrEqual(80);
    expect(p.sanity.verdictTone).not.toBe('strong');
  });
  it('repeating one identical OSM cafe cannot manufacture a food cluster', () => {
    const once = buildAnalysis([cafe], 59.93, 30.36);
    const repeated = buildAnalysis(Array.from({ length: 12 }, () => structuredClone(cafe)), 59.93, 30.36);
    expect(repeated.magnets).toEqual(once.magnets);
    expect(repeated.evergreenIndex).toBe(once.evergreenIndex);
    expect(repeated.magnetCountByCategory).toEqual(once.magnetCountByCategory);
  });
  it('distinct cafes retain the real multi-venue cluster effect', () => {
    const once = buildAnalysis([cafe], 59.93, 30.36);
    const cluster = buildAnalysis(Array.from({ length: 12 }, (_, i) => ({...cafe,id:i+1,lat:59.9301+i*.0001,tags:{amenity:'cafe',name:`Synthetic cafe ${i}`}})), 59.93, 30.36);
    expect(cluster.magnets.find(m => m.categoryId === 'food')!.weight).toBeGreaterThan(once.magnets.find(m => m.categoryId === 'food')!.weight);
  });
});
