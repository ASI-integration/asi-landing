import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationStandaloneReport } from '../standalone-report';

function fixtureAnalysis(): ReturnType<typeof buildAnalysis> {
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
  ];
  return buildAnalysis(elements, subject.lat, subject.lon, { spatialFoundation: true });
}

describe('standalone residential reportMode (free vs paid)', () => {
  it('demo / free permalink builder uses reportMode free, free_brief, and omits unifiedReport', () => {
    const analysis = fixtureAnalysis();
    const report = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Краткий вывод для демо.',
      reportMode: 'free',
    });

    expect(report.reportMode).toBe('free');
    expect(report.metadata?.calculatedAt).toBeDefined();
    expect(report.metadata?.reportMode).toBe('free');
    expect(typeof report.free_brief).toBe('string');
    expect(report.free_brief!.length).toBeGreaterThan(10);
    expect(report.reportStructure?.mode).toBe('free');
    expect(report.reportStructure?.cta.primaryLabel).toBe('Получить подробный отчёт');
    expect(report.unifiedReport).toBeUndefined();

    const ids = report.sections.map(s => s.id);
    expect(ids).toEqual(['summary', 'next_step']);
    expect(report.sections.some(s => s.id === 'magnets')).toBe(false);
  });

  it('demo / free permalink builder prefers attached LocationDecision public verdict and bullets', () => {
    const analysis = fixtureAnalysis();
    Object.assign(analysis, {
      locationDecision: {
        publicSummary: { audienceVerdictRu: 'Канонический вывод LocationPublicSummary.' },
        uiProjection: { keyEvidenceBullets: ['Канонический фактор LocationPublicSummary.'] },
      },
    });

    const report = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Старый вывод не должен попасть в отчёт.',
      reportMode: 'free',
    });

    const summary = report.sections.find(s => s.id === 'summary');
    expect(summary && summary.id === 'summary').toBe(true);
    if (summary?.id !== 'summary') throw new Error('summary section missing');
    expect(summary.verdict).toBe('Канонический вывод LocationPublicSummary.');
    expect(summary.drivers).toEqual(['Канонический фактор LocationPublicSummary.']);
    expect(report.free_brief).toContain('Канонический вывод LocationPublicSummary.');
  });

  it('paid / full-report pipeline builder keeps reportMode paid, unifiedReport, and detailed sections', () => {
    const analysis = fixtureAnalysis();
    const report = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
    });

    expect(report.reportMode).toBe('paid');
    expect(report.metadata?.calculatedAt).toBeDefined();
    expect(report.metadata?.reportMode).toBe('paid');
    expect(report.free_brief).toBeUndefined();
    expect(report.reportStructure?.mode).toBe('paid');
    expect(report.reportStructure?.sections.map(section => section.id)).toEqual([
      'fullAddressConclusion',
      'detailedMagnets',
      'demandAudiences',
      'competition',
      'transportAccessibility',
      'objectEnvironment',
      'risksAndLimits',
      'packagingPricingChannels',
      'managementNextStepCta',
    ]);
    expect(report.reportStructure?.cta.primaryLabel).toBe('Подключить управление');
    expect(report.unifiedReport?.version).toBe('unified-location-potential-report-v1');
    expect(report.unifiedReport?.urbanDevelopmentForecastScore.score).toBe(0);
    expect(report.unifiedReport?.urbanDevelopmentForecastScore.level).toBe('low');

    const ids = report.sections.map(s => s.id);
    expect(ids).toContain('magnets');
    expect(ids).toContain('business_fit');
    expect(ids).toContain('competition');
    expect(ids).toContain('income_strategy');

    const magnets = report.sections.find(s => s.id === 'magnets');
    expect(magnets && magnets.id === 'magnets').toBe(true);
  });

  it('defaults to paid when reportMode omitted (legacy callers)', () => {
    const analysis = fixtureAnalysis();
    const report = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Полный отчёт.',
    });
    expect(report.unifiedReport?.version).toBe('unified-location-potential-report-v1');
    expect(report.sections.some(s => s.id === 'magnets')).toBe(true);
  });
});
