import { describe, it, expect } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import { computeResidentialDemoPresentation } from '../rules/residential-location-rules';
import type { MagnetItem } from '../types';
function magnet(categoryId: string, name: string, distance = 500): MagnetItem {
  return { categoryId, categoryLabel: categoryId, icon: '', name, distance, lat: 55.75, lon: 37.61,
    weight: 6, permanenceType: 'permanent', scopeLevel: 'city', strengthClass: 'strong', attractionScore: 4.8 } as MagnetItem;
}
function present(magnets: MagnetItem[], primaryAudience: 'BUSINESS' | 'TOURIST' = 'BUSINESS', fit = 60) {
  const analysis = buildAnalysis([], 55.75, 37.61);
  analysis.magnets = magnets;
  analysis.audienceAnalysis = { ...analysis.audienceAnalysis!, primaryAudience, fallbackMode: false };
  analysis.locationScore!.breakdown.audience_fit_score = fit;
  return computeResidentialDemoPresentation(analysis, 92);
}
describe('Audience evidence is independent of strong-score eligibility', () => {
  it('one business anchor supports business audience but never a strong verdict', () => {
    const p = present([magnet('business', 'Бизнес-центр Сенатор')]);
    expect(p.sanity.displayAudience).toBe('BUSINESS');
    expect(p.cappedHeadline).toBe(80);
    expect(p.sanity.verdictTone).not.toBe('strong');
  });
  it('one transit anchor with adequate fit supports mixed audience only', () => {
    expect(present([magnet('metro', 'Фрунзенская')]).sanity.displayAudience).toBe('MIXED');
  });
  it('low-fit transit stays residential', () => {
    expect(present([magnet('metro', 'Марьино')], 'BUSINESS', 28).sanity.displayAudience).toBe('RESIDENTIAL');
  });
  it('a university alone cannot justify corporate demand', () => {
    expect(present([magnet('university', 'Кампус')]).sanity.displayAudience).toBe('MIXED');
  });
  it('insurance and local clinics do not become business anchors', () => {
    expect(present([magnet('business', 'Ингосстрах'), magnet('hospital', 'Клиника')]).sanity.displayAudience).toBe('RESIDENTIAL');
  });
  it.each(['Государственный музей искусства', 'National museum'])('isolated museum %s cannot bypass cluster gate', name => {
    const p = present([magnet('attraction', name)], 'TOURIST');
    expect(p.sanity.tier1Count).toBe(0);
    expect(p.cappedHeadline).toBe(70);
  });
  it('scale-qualified museum can contribute after the independent cluster gate', () => {
    const p = present([magnet('attraction', 'Государственный музей искусства'), magnet('stadium', 'Арена'), magnet('convention', 'Экспоцентр')], 'TOURIST');
    expect(p.sanity.tier1Magnets.some(m => m.name === 'Государственный музей искусства')).toBe(true);
  });
});
