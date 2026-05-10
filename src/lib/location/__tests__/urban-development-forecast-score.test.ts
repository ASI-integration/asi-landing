import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  normalizeUrbanDevelopmentSignals,
  urbanDevelopmentSnapshotFromSignals,
  type UrbanDevelopmentSignalInput,
} from '../data-sources/urban-development';
import { computeUrbanDevelopmentForecastScore } from '../data-sources/urban-development-forecast-score';
import { buildFullLocationReport, locationReportInputFromLegacy } from '../unified-report';

const __dirname = dirname(fileURLToPath(import.meta.url));

function norm(rows: UrbanDevelopmentSignalInput[]) {
  return normalizeUrbanDevelopmentSignals(rows);
}

describe('computeUrbanDevelopmentForecastScore', () => {
  it('магниты и основной location score не импортируются модулем прогноза', () => {
    const path = join(__dirname, '../data-sources/urban-development-forecast-score.ts');
    const src = readFileSync(path, 'utf8');
    expect(src).not.toMatch(/\.\/gravity-scoring|\.\/location-score|\.\/signals\//);
  });

  it('один сильный сигнал с точной географией даёт высокий или очень высокий прогноз', () => {
    const [s] = norm([
      {
        kind: 'infrastructurePlans',
        signalType: 'road_project',
        title: 'Дорожный объект',
        summary: 'Тестовый сигнал',
        status: 'planned',
        confidence: 'high',
        lifecycleStage: 'construction_preparation',
        geoPrecision: 'exact_address',
        sourceUrl: 'https://example.com/source',
        evidence: [],
        limitations: [],
      },
    ]);
    const out = computeUrbanDevelopmentForecastScore([s]);
    expect(out.score).toBeGreaterThanOrEqual(72);
    expect(['high', 'very_high']).toContain(out.level);
    expect(out.contributingSignals).toEqual([
      { kind: 'infrastructurePlans', signalType: 'road_project' },
    ]);
    expect(out.reasonsRu.some(r => r.includes('дорог'))).toBe(true);
  });

  it('несколько слабых региональных сигналов не дают высокий прогноз', () => {
    const weak: UrbanDevelopmentSignalInput[] = Array.from({ length: 6 }, (_, i) => ({
      kind: 'publicProcurement',
      signalType: 'government_procurement',
      title: `Региональный лот ${i + 1}`,
      summary: 'Тест',
      status: 'planned',
      confidence: 'low',
      lifecycleStage: 'planning',
      geoPrecision: 'region_level',
      sourceUrl: 'https://example.com/r',
      evidence: [],
      limitations: [],
    }));
    const out = computeUrbanDevelopmentForecastScore(norm(weak));
    expect(out.score).toBeLessThan(48);
    expect(['low', 'moderate']).toContain(out.level);
  });

  it('construction_preparation сильнее planning при прочих равных', () => {
    const common = {
      kind: 'publicProcurement' as const,
      signalType: 'government_procurement' as const,
      title: 'Закупка',
      summary: 'Тест',
      status: 'planned' as const,
      confidence: 'medium' as const,
      geoPrecision: 'district_level' as const,
      sourceUrl: 'https://example.com/p',
      evidence: [],
      limitations: [],
    };
    const planning = computeUrbanDevelopmentForecastScore(norm([{ ...common, lifecycleStage: 'planning' }]));
    const prep = computeUrbanDevelopmentForecastScore(norm([{ ...common, lifecycleStage: 'construction_preparation' }]));
    expect(prep.score).toBeGreaterThan(planning.score);
    expect(prep.score - planning.score).toBeGreaterThan(15);
  });

  it('unknown geography почти не поднимает прогноз относительно точного адреса', () => {
    const base = {
      kind: 'infrastructurePlans' as const,
      signalType: 'road_project' as const,
      title: 'Дорога',
      summary: 'Тест',
      status: 'planned' as const,
      confidence: 'high' as const,
      lifecycleStage: 'construction_preparation' as const,
      sourceUrl: 'https://example.com/x',
      evidence: [],
      limitations: [],
    };
    const exact = computeUrbanDevelopmentForecastScore(norm([{ ...base, geoPrecision: 'exact_address' }]));
    const unknownGeo = computeUrbanDevelopmentForecastScore(norm([{ ...base, geoPrecision: 'unknown' }]));
    expect(exact.score).toBeGreaterThan(60);
    expect(unknownGeo.score).toBeLessThanOrEqual(25);
    expect(unknownGeo.reasonsRu.some(r => r.includes('География сигнала требует проверки'))).toBe(true);
  });

  it('urbanDevelopmentForecastScore не меняет currentLocationScore в unified report', () => {
    const input = locationReportInputFromLegacy({
      address: 'Тестовый адрес',
      locale: 'ru',
      mode: 'residential',
    });

    const snapshotOnly = urbanDevelopmentSnapshotFromSignals(
      norm([
        {
          kind: 'infrastructurePlans',
          signalType: 'road_project',
          title: 'Проба',
          summary: 'Тест',
          status: 'planned',
          confidence: 'high',
          sourceUrl: 'https://example.com/z',
        },
      ]),
    );

    const signals = norm([
      {
        kind: 'infrastructurePlans',
        signalType: 'road_project',
        title: 'Проба',
        summary: 'Тест',
        status: 'planned',
        confidence: 'high',
        lifecycleStage: 'construction_preparation',
        geoPrecision: 'exact_address',
        sourceUrl: 'https://example.com/z',
      },
    ]);

    const withoutSignals = buildFullLocationReport(input, { urbanDevelopment: snapshotOnly });
    const withSignals = buildFullLocationReport(input, {
      urbanDevelopment: snapshotOnly,
      urbanDevelopmentSignals: signals,
    });

    expect(withoutSignals.overallScore).toBe(withSignals.overallScore);
    expect(withoutSignals.currentLocationScore).toBe(withSignals.currentLocationScore);
    expect(withSignals.urbanDevelopmentForecastScore.score).toBeGreaterThan(
      withoutSignals.urbanDevelopmentForecastScore.score,
    );
  });
});
