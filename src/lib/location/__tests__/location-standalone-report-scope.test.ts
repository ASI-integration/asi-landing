import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationStandaloneReport, isFreeLocationStandaloneReport } from '../standalone-report';
import { buildFullLocationReport, locationReportInputFromLegacy } from '../unified-report';

function fixtureAnalysis() {
  const subject = { lat: 55.751, lon: 37.618 };
  const elements: OSMElement[] = [
    {
      type: 'relation',
      id: 1,
      center: { lat: 55.755, lon: 37.616 },
      tags: { name: 'Метро Охотный Ряд', station: 'subway', railway: 'station' },
    },
    {
      type: 'node',
      id: 2,
      lat: 55.752,
      lon: 37.621,
      tags: { name: 'Business Center Test', office: 'company' },
    },
    {
      type: 'node',
      id: 3,
      lat: 55.7505,
      lon: 37.616,
      tags: { name: 'Test Grand Hotel', tourism: 'hotel' },
    },
    {
      type: 'node',
      id: 4,
      lat: 55.754,
      lon: 37.62,
      tags: { name: 'Test Competitor Hotel', tourism: 'hotel' },
    },
    {
      type: 'node',
      id: 5,
      lat: 55.753,
      lon: 37.619,
      tags: { name: 'Тестовая достопримечательность', tourism: 'attraction' },
    },
  ];

  return buildAnalysis(elements, subject.lat, subject.lon, { spatialFoundation: true });
}

describe('location standalone report: free vs paid scope', () => {
  it('free report omits unified snapshot and detailed sections', () => {
    const analysis = fixtureAnalysis();
    const free = buildLocationStandaloneReport({
      address: 'Москва, тестовая локация',
      analysis,
      verdict: 'Локация выглядит интересной для запуска при аккуратной упаковке.',
      reportMode: 'free',
    });

    expect(isFreeLocationStandaloneReport(free)).toBe(true);
    expect(free.unifiedReport).toBeUndefined();
    expect(free.sections.some(s => s.id === 'magnets')).toBe(false);
    expect(free.sections.some(s => s.id === 'business_fit')).toBe(false);

    const serialized = JSON.stringify(free);
    expect(serialized).not.toContain('urbanDevelopmentForecastScore');
    expect(serialized).not.toContain('scoreBreakdown');
    expect(serialized).not.toContain('distance_m');
    expect(serialized).not.toContain('tier1');
    expect(serialized).not.toContain('confidenceImpact');
  });

  it('free report includes a brief useful narrative block', () => {
    const analysis = fixtureAnalysis();
    const free = buildLocationStandaloneReport({
      address: 'Москва, тестовая локация',
      analysis,
      verdict: 'Итог: локация средней силы — есть якоря спроса, но конкуренцию нужно контролировать.',
      reportMode: 'free',
    });

    const brief = free.sections.find(s => s.id === 'free_brief');
    expect(brief && brief.id === 'free_brief').toBe(true);
    if (!brief || brief.id !== 'free_brief') return;

    expect(brief.location_score).not.toBeNull();
    expect(brief.main_factors_ru.length).toBeGreaterThanOrEqual(1);
    expect(brief.main_factors_ru.length).toBeLessThanOrEqual(5);
    expect(brief.risk_takeaways_ru.length).toBeLessThanOrEqual(2);
    expect(brief.conclusion_ru.length).toBeGreaterThan(10);
    expect(['low', 'medium', 'high']).toContain(brief.potential_band);
    expect(free.sections.some(s => s.id === 'next_step')).toBe(true);
  });

  it('paid report keeps unified report and detailed blocks', () => {
    const analysis = fixtureAnalysis();
    const paid = buildLocationStandaloneReport({
      address: 'Москва, тестовая локация',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
    });

    expect(isFreeLocationStandaloneReport(paid)).toBe(false);
    expect(paid.unifiedReport?.version).toBe('unified-location-potential-report-v1');
    expect(paid.sections.some(s => s.id === 'magnets')).toBe(true);
    expect(paid.sections.some(s => s.id === 'income_strategy')).toBe(true);

    const unified = paid.unifiedReport;
    expect(unified?.signals.magnets).toBeDefined();
    expect(unified?.urbanDevelopmentForecastScore).toBeDefined();
    expect(JSON.stringify(paid)).toContain('"id":"magnets"');
  });

  it('overall score matches full unified report — scoring path unchanged', () => {
    const analysis = fixtureAnalysis();
    const generatedAtIso = new Date().toISOString();
    const input = locationReportInputFromLegacy({
      address: 'Москва, тестовая локация',
      locale: 'ru',
      mode: 'residential',
      requestedAtIso: generatedAtIso,
    });
    const unifiedOnly = buildFullLocationReport(input, { analysis, generatedAtIso });

    const free = buildLocationStandaloneReport({
      address: 'Москва, тестовая локация',
      analysis,
      verdict: 'ok',
      reportMode: 'free',
    });
    const brief = free.sections.find(s => s.id === 'free_brief');
    expect(brief && brief.id === 'free_brief').toBe(true);
    if (!brief || brief.id !== 'free_brief') return;

    expect(brief.location_score).toBe(unifiedOnly.overallScore);
  });

  it('default standalone mode remains paid (legacy shape)', () => {
    const analysis = fixtureAnalysis();
    const legacy = buildLocationStandaloneReport({
      address: 'Москва, тестовая локация',
      analysis,
      verdict: 'ok',
    });
    expect(legacy.unifiedReport).toBeDefined();
    expect(legacy.reportMode).toBeUndefined();
    expect(legacy.sections.some(s => s.id === 'magnets')).toBe(true);
  });
});
