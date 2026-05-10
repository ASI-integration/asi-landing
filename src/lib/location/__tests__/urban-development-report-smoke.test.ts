import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { normalizeUrbanDevelopmentSignals, type UrbanDevelopmentSignalInput } from '../data-sources/urban-development';
import { buildFullLocationReport, locationReportInputFromLegacy } from '../unified-report';

/** Минимальный OSM-контекст без сетевых вызовов — фиксируем основной location score. */
function minimalAnalysisFixture() {
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

const sampleProcurementSignals: UrbanDevelopmentSignalInput[] = [
  {
    kind: 'publicProcurement',
    signalType: 'government_procurement',
    title: 'Смоук: закупка благоустройства',
    summary: 'Fixture procurement signal',
    status: 'planned',
    confidence: 'medium',
    lifecycleStage: 'construction_preparation',
    geoPrecision: 'district_level',
    sourceUrl: 'https://example.com/fixture-procurement',
    evidence: [],
    limitations: [],
  },
];

describe('urban development forecast — smoke (full unified report, fixtures only)', () => {
  it('пустые urbanDevelopmentSignals: прогноз 0 / low; fixture procurement поднимает forecast; overallScore и currentLocationScore не меняются', () => {
    const input = locationReportInputFromLegacy({
      address: 'Смоук-тест, fixture procurement',
      locale: 'ru',
      mode: 'residential',
    });
    const analysis = minimalAnalysisFixture();
    const normalized = normalizeUrbanDevelopmentSignals(sampleProcurementSignals);
    expect(normalized.length).toBeGreaterThan(0);

    const emptyForecast = buildFullLocationReport(input, { analysis, urbanDevelopmentSignals: [] });
    const withFixture = buildFullLocationReport(input, {
      analysis,
      urbanDevelopmentSignals: normalized,
    });

    expect(emptyForecast.urbanDevelopmentForecastScore.score).toBe(0);
    expect(emptyForecast.urbanDevelopmentForecastScore.level).toBe('low');
    expect(emptyForecast.urbanDevelopmentForecastScore.reasonsRu).toContain(
      'Нет нормализованных сигналов градоразвития для прогноза.',
    );

    expect(withFixture.urbanDevelopmentForecastScore.score).toBeGreaterThan(
      emptyForecast.urbanDevelopmentForecastScore.score,
    );

    expect(withFixture.overallScore).toBe(emptyForecast.overallScore);
    expect(withFixture.currentLocationScore).toBe(emptyForecast.currentLocationScore);
  });
});
