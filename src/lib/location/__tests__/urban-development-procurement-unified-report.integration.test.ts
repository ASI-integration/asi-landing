import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import {
  collectUrbanDevelopmentSignals,
  urbanDevelopmentSnapshotFromSignals,
} from '../data-sources/urban-development';
import { computeUrbanDevelopmentForecastScore } from '../data-sources/urban-development-forecast-score';
import { createDefaultSamplePublicProcurementFixtureAdapter } from '../data-sources/public-procurement/public-procurement-fixture-adapter';
import {
  buildFullLocationReport,
  locationReportInputFromLegacy,
} from '../unified-report';

/** Минимальный контекст анализа локации: только чтобы зафиксировать основной score без живых API. */
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

describe('интеграция: госзакупки (fixture) → urbanDevelopmentSignals → прогноз → UnifiedLocationReport', () => {
  it('сигналы доходят до urbanDevelopmentForecastScore отдельно от основного score', async () => {
    const adapter = createDefaultSamplePublicProcurementFixtureAdapter();
    const collected = await collectUrbanDevelopmentSignals({ regionOrCity: 'Москва', locale: 'ru' }, [
      adapter,
    ]);
    expect(collected.status).toBe('collected');
    const urbanDevelopmentSignals = collected.signals;
    expect(urbanDevelopmentSignals.length).toBeGreaterThan(0);

    const snapshot = urbanDevelopmentSnapshotFromSignals(urbanDevelopmentSignals);
    const forecastDirect = computeUrbanDevelopmentForecastScore(urbanDevelopmentSignals);

    const input = locationReportInputFromLegacy({
      address: 'Москва, интеграционный тест',
      locale: 'ru',
      mode: 'residential',
    });
    const analysis = minimalAnalysisFixture();

    const reportEmptyForecast = buildFullLocationReport(input, {
      analysis,
      urbanDevelopment: snapshot,
      urbanDevelopmentSignals: [],
    });

    const reportWithForecast = buildFullLocationReport(input, {
      analysis,
      urbanDevelopment: snapshot,
      urbanDevelopmentSignals,
    });

    expect(reportWithForecast.urbanDevelopmentForecastScore).toEqual(forecastDirect);

    expect(reportWithForecast.urbanDevelopmentForecastScore.score).toBeGreaterThan(0);
    expect(['low', 'moderate', 'high', 'very_high']).toContain(
      reportWithForecast.urbanDevelopmentForecastScore.level,
    );

    expect(reportEmptyForecast.urbanDevelopmentForecastScore.score).toBe(0);
    expect(reportEmptyForecast.urbanDevelopmentForecastScore.level).toBe('low');
    expect(reportEmptyForecast.urbanDevelopmentForecastScore.reasonsRu).toContain(
      'Нет нормализованных сигналов градоразвития для прогноза.',
    );

    expect(reportWithForecast.urbanDevelopmentForecastScore.score).toBeGreaterThan(
      reportEmptyForecast.urbanDevelopmentForecastScore.score,
    );

    expect(reportWithForecast.overallScore).toBe(reportEmptyForecast.overallScore);
    expect(reportWithForecast.currentLocationScore).toBe(reportEmptyForecast.currentLocationScore);

    expect(reportWithForecast.currentLocationScore).toBe(
      analysis.locationScore?.location_score ?? analysis.evergreenIndex ?? null,
    );
    expect(reportWithForecast.overallScore).toBe(
      analysis.locationScore?.location_score ?? analysis.evergreenIndex ?? null,
    );

    const ru = reportWithForecast.urbanDevelopmentForecastScore.reasonsRu.join('\n');
    expect(ru.length).toBeGreaterThan(0);
    expect(/\p{Script=Cyrillic}/u.test(ru)).toBe(true);

    expect(
      urbanDevelopmentSignals.some(s => s.kind === 'publicProcurement'),
      'ожидаем след закупок в нормализованных сигналах',
    ).toBe(true);
  });
});
