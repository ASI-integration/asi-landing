import { describe, expect, it } from 'vitest';
import type { AnalysisMeta, LocationAnalysis } from '@/lib/location/types';
import {
  metaHasPartialCartographicWarning,
  ruDemoDeferPaidReportForMapRetry,
} from '@/components/location-demo-ru-ux';

describe('RU demo: defer misleading paid-report CTA when map data blocks scoring', () => {
  const metaScoreBlocked: AnalysisMeta = {
    freshness: 'fresh',
    updatedAt: new Date().toISOString(),
    source: 'test',
    cached: false,
    scoreBlockedDueToIncompleteData: true,
  };

  it('defers for commercial whenever scoring is blocked', () => {
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: true,
        scoreBlockedDueToIncompleteData: true,
        reasons: ['osm_empty_result'],
      },
      locationDecision: {
        publicSummary: {
          publicDrivers: [{ textRu: 'Есть строка — но коммерция всё равно ждёт карту', trace: {} }],
        },
      },
    } as unknown as LocationAnalysis;

    expect(
      ruDemoDeferPaidReportForMapRetry({
        locale: 'ru',
        meta: metaScoreBlocked,
        analysis,
        mode: 'commercial',
      }),
    ).toBe(true);
  });

  it('defers residential when blocked and there are no usable public driver lines', () => {
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: true,
        scoreBlockedDueToIncompleteData: true,
        reasons: ['analysis_incomplete'],
      },
      locationDecision: {
        publicSummary: {
          publicDrivers: [],
        },
      },
    } as unknown as LocationAnalysis;

    expect(
      ruDemoDeferPaidReportForMapRetry({
        locale: 'ru',
        meta: metaScoreBlocked,
        analysis,
        mode: 'residential',
      }),
    ).toBe(true);
  });

  it('defers residential when score is blocked even if stale kernel publicDrivers exist', () => {
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: true,
        scoreBlockedDueToIncompleteData: true,
        reasons: ['osm_sparse_result'],
      },
      locationDecision: {
        publicSummary: {
          publicDrivers: [{ textRu: 'Крупный объект рядом — около 500 м: рядом есть точки досуга и интереса.', trace: {} }],
        },
      },
    } as unknown as LocationAnalysis;

    expect(
      ruDemoDeferPaidReportForMapRetry({
        locale: 'ru',
        meta: metaScoreBlocked,
        analysis,
        mode: 'residential',
      }),
    ).toBe(true);
  });

  it('defers residential when incomplete + partial cartographic warning + no usable publicDrivers', () => {
    const meta: AnalysisMeta = {
      freshness: 'fresh',
      updatedAt: new Date().toISOString(),
      source: 'test',
      cached: false,
      scoreBlockedDueToIncompleteData: false,
      warnings: [{ code: 'partial_result', message: 'Часть картографических данных не успела загрузиться.' }],
    };
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: true,
        scoreBlockedDueToIncompleteData: false,
        reasons: [],
      },
      locationDecision: {
        publicSummary: {
          publicDrivers: [],
        },
      },
    } as unknown as LocationAnalysis;

    expect(
      ruDemoDeferPaidReportForMapRetry({
        locale: 'ru',
        meta,
        analysis,
        mode: 'residential',
      }),
    ).toBe(true);
  });

  it('does not defer residential partial preview with real publicDrivers when score not blocked', () => {
    const meta: AnalysisMeta = {
      freshness: 'fresh',
      updatedAt: new Date().toISOString(),
      source: 'test',
      cached: false,
      scoreBlockedDueToIncompleteData: false,
      warnings: [{ code: 'partial_result', message: 'Предварительная оценка.' }],
    };
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: false,
        scoreBlockedDueToIncompleteData: false,
        reasons: [],
      },
      locationDecision: {
        publicSummary: {
          publicDrivers: [{ textRu: 'Крупный объект рядом — около 500 м: рядом есть точки досуга и интереса.', trace: {} }],
        },
      },
    } as unknown as LocationAnalysis;

    expect(
      ruDemoDeferPaidReportForMapRetry({
        locale: 'ru',
        meta,
        analysis,
        mode: 'residential',
      }),
    ).toBe(false);
  });

  it('does not defer when score is not blocked (normal partial_result)', () => {
    const meta: AnalysisMeta = {
      freshness: 'fresh',
      updatedAt: new Date().toISOString(),
      source: 'test',
      cached: false,
      scoreBlockedDueToIncompleteData: false,
      warnings: [{ code: 'partial_result', message: 'Предварительная оценка.' }],
    };
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: false,
        scoreBlockedDueToIncompleteData: false,
        reasons: [],
      },
    } as unknown as LocationAnalysis;

    expect(
      ruDemoDeferPaidReportForMapRetry({
        locale: 'ru',
        meta,
        analysis,
        mode: 'residential',
      }),
    ).toBe(false);
    expect(metaHasPartialCartographicWarning(meta)).toBe(true);
  });

  it('is inactive outside RU locale', () => {
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: true,
        scoreBlockedDueToIncompleteData: true,
        reasons: [],
      },
    } as unknown as LocationAnalysis;

    expect(
      ruDemoDeferPaidReportForMapRetry({
        locale: 'en',
        meta: metaScoreBlocked,
        analysis,
        mode: 'commercial',
      }),
    ).toBe(false);
  });
});
