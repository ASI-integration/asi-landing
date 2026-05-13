import { describe, expect, it } from 'vitest';
import type { AnalysisMeta, LocationAnalysis } from '@/lib/location/types';
import {
  metaHasPartialCartographicWarning,
  ruDemoDeferPaidReportForMapRetry,
} from '@/components/location-demo-ru-ux';
import { resolveLocationDemoPublicScoreState } from '@/lib/location/location-demo-public-score-state';

const metaScoreBlocked: AnalysisMeta = {
  freshness: 'fresh',
  updatedAt: new Date().toISOString(),
  source: 'test',
  cached: false,
  scoreBlockedDueToIncompleteData: true,
};

describe('RU demo: defer misleading paid-report CTA when map data blocks scoring', () => {
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

describe('RU demo: no-data / partial / complete CTA eligibility', () => {
  it('marks no-data result as ineligible for an active paid report CTA', () => {
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: true,
        scoreBlockedDueToIncompleteData: true,
        reasons: ['osm_empty_result'],
      },
      locationDecision: {
        publicSummary: {
          publicDrivers: [{ textRu: 'Старая строка не должна разблокировать отчёт.', trace: {} }],
        },
      },
    } as unknown as LocationAnalysis;

    const state = resolveLocationDemoPublicScoreState({
      meta: metaScoreBlocked,
      analysis,
      mode: 'residential',
    });

    expect(state.analysisUsableForPublicScore).toBe(false);
    expect(state.reportCtaEligible).toBe(false);
    expect(state.noDataReason).toBe('osm_empty_result');
  });

  it('prioritizes retry for a no-data result', () => {
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

    const state = resolveLocationDemoPublicScoreState({
      meta: metaScoreBlocked,
      analysis,
      mode: 'residential',
    });

    expect(state.retryRecommended).toBe(true);
    expect(ruDemoDeferPaidReportForMapRetry({
      locale: 'ru',
      meta: metaScoreBlocked,
      analysis,
      mode: 'residential',
    })).toBe(true);
  });

  it('treats partial usable result as a soft warning, not a hard failure', () => {
    const meta: AnalysisMeta = {
      freshness: 'fresh',
      updatedAt: new Date().toISOString(),
      source: 'test',
      cached: false,
      analysisIncomplete: true,
      scoreBlockedDueToIncompleteData: false,
      warnings: [{ code: 'partial_result', message: 'Предварительная оценка.' }],
    };
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: true,
        scoreBlockedDueToIncompleteData: false,
        reasons: [],
      },
      locationDecision: {
        publicSummary: {
          publicDrivers: [{ textRu: 'Крупный объект рядом — около 500 м.', trace: {} }],
        },
      },
    } as unknown as LocationAnalysis;

    const state = resolveLocationDemoPublicScoreState({
      meta,
      analysis,
      mode: 'residential',
    });

    expect(metaHasPartialCartographicWarning(meta)).toBe(true);
    expect(state.analysisUsableForPublicScore).toBe(true);
    expect(state.reportCtaEligible).toBe(true);
    expect(state.retryRecommended).toBe(false);
    expect(state.noDataReason).toBeNull();
  });

  it('keeps complete result eligible for normal report CTA', () => {
    const meta: AnalysisMeta = {
      freshness: 'fresh',
      updatedAt: new Date().toISOString(),
      source: 'test',
      cached: false,
      analysisIncomplete: false,
      scoreBlockedDueToIncompleteData: false,
    };
    const analysis = {
      analysisIntegrity: {
        analysisIncomplete: false,
        scoreBlockedDueToIncompleteData: false,
        reasons: [],
      },
      locationDecision: {
        publicSummary: {
          publicDrivers: [{ textRu: 'Крупный объект рядом — около 500 м.', trace: {} }],
        },
      },
    } as unknown as LocationAnalysis;

    const state = resolveLocationDemoPublicScoreState({
      meta,
      analysis,
      mode: 'residential',
    });

    expect(metaHasPartialCartographicWarning(meta)).toBe(false);
    expect(state.analysisUsableForPublicScore).toBe(true);
    expect(state.reportCtaEligible).toBe(true);
    expect(state.retryRecommended).toBe(false);
  });
});
